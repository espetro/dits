import type { Session, Turn } from "@di/shared/session";
import type { Report } from "@di/shared/report";

/**
 * Client-only persistence: no di server means no sqlite, so a session's
 * session/turns/report live in one OPFS file each, keyed by session id under
 * `sessions/<id>.json`. Read-modify-write (no concurrent writers per session
 * in this app), mirroring the server's store/db.ts responsibilities without a
 * database.
 */

interface SessionRecord {
  session: Session;
  turns: Turn[];
  report?: Report;
}

/** Typed text turns queued for the server (p0.5), keyed by session id. */
export interface PendingTurn {
  id: string;
  text: string;
  queued_at: string;
}

async function root(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot.getDirectoryHandle("sessions", { create: true });
}

async function readRecord(id: string): Promise<SessionRecord | undefined> {
  const dir = await root();
  let handle: FileSystemFileHandle;
  try {
    handle = await dir.getFileHandle(`${id}.json`);
  } catch {
    return undefined;
  }
  const file = await handle.getFile();
  return JSON.parse(await file.text()) as SessionRecord;
}

async function writeRecord(id: string, record: SessionRecord): Promise<void> {
  const dir = await root();
  const handle = await dir.getFileHandle(`${id}.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(record));
  await writable.close();
}

export async function createClientSession(input: {
  title: string;
  mode: Session["mode"];
  duration_min: number;
}): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    title: input.title,
    mode: input.mode,
    duration_min: input.duration_min,
    created_at: new Date().toISOString(),
    status: "created",
  };
  await writeRecord(session.id, { session, turns: [] });
  return session;
}

export async function getClientSession(id: string): Promise<Session | undefined> {
  return (await readRecord(id))?.session;
}

export async function setClientSessionStatus(id: string, status: Session["status"]): Promise<void> {
  const record = await readRecord(id);
  if (!record) return;
  record.session.status = status;
  await writeRecord(id, record);
}

export async function listClientSessions(): Promise<Session[]> {
  const dir = await root();
  const sessions: Session[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".json")) continue;
    const file = await handle.getFile();
    const record = JSON.parse(await file.text()) as SessionRecord;
    sessions.push(record.session);
  }
  return sessions;
}

export async function getClientTurns(id: string): Promise<Turn[]> {
  return (await readRecord(id))?.turns ?? [];
}

export async function appendClientTurn(id: string, turn: Turn): Promise<void> {
  const record = await readRecord(id);
  if (!record) return;
  record.turns.push(turn);
  await writeRecord(id, record);
}

export async function getClientReport(id: string): Promise<Report | undefined> {
  return (await readRecord(id))?.report;
}

export async function saveClientReport(id: string, report: Report): Promise<void> {
  const record = await readRecord(id);
  if (!record) return;
  record.report = report;
  await writeRecord(id, record);
}

interface QueueRecord {
  pending: PendingTurn[];
}

async function readQueue(id: string): Promise<QueueRecord> {
  const dir = await root();
  let handle: FileSystemFileHandle;
  try {
    handle = await dir.getFileHandle(`pending-turns-${id}.json`);
  } catch {
    return { pending: [] };
  }
  return JSON.parse(await (await handle.getFile()).text()) as QueueRecord;
}

async function writeQueue(id: string, record: QueueRecord): Promise<void> {
  const dir = await root();
  const handle = await dir.getFileHandle(`pending-turns-${id}.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(record));
  await writable.close();
}

export async function enqueuePendingTurn(id: string, turn: PendingTurn): Promise<void> {
  const record = await readQueue(id);
  record.pending.push(turn);
  await writeQueue(id, record);
}

export async function dequeuePendingTurn(id: string, turnId: string): Promise<void> {
  const record = await readQueue(id);
  record.pending = record.pending.filter((t) => t.id !== turnId);
  await writeQueue(id, record);
}

export async function getPendingTurns(id: string): Promise<PendingTurn[]> {
  return (await readQueue(id)).pending;
}

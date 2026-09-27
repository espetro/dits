/**
 * di API client. The di binary serves the SPA and the /v1 API from one origin,
 * so plain fetch against relative paths is all the web app needs.
 */
import { dequeuePendingTurn, enqueuePendingTurn, getPendingTurns } from "./opfs-store";
import type { PendingTurn } from "./opfs-store";
import { DiError } from "./errors";

const BASE = import.meta.env.VITE_DI_API_BASE ?? "";

interface ApiErrorBody {
  error?: string;
  code?: string;
}

/**
 * Turn a failed response into a DiError: the server's `code` field wins
 * (`errors.api.<code>`), otherwise the per-op `errors.api.<op>` key applies.
 */
async function apiFailure(res: Response, op: string): Promise<DiError> {
  const body = (await res.json().catch(() => undefined)) as ApiErrorBody | undefined;
  return new DiError(`api.${body?.code ?? op}`, { status: res.status });
}

const PENDING_TURN_RETRIES = 3;
const POST_TURN_RETRY_BASE_MS = 1_000;

export interface SessionDto {
  id: string;
  title: string;
  mode: "interview" | "coach";
  created_at: string;
  status: string;
  duration_min: number;
  /** Dock toolset, Record<toolId, variant> (p3); absent on old sessions. */
  tools?: Record<string, string>;
  /** Candidate-provided brief from setup (p3 scenario cards). */
  prompt?: string;
}

export interface ReportDto {
  overall_score: number;
  coverage_pct: number;
  competencies: Array<{
    name: string;
    score: number;
    evidence: Array<{ quote: string; turn_seq: number; verdict: string }>;
  }>;
}

export interface TurnDto {
  id: string;
  session_id: string;
  seq: number;
  speaker: "user" | "agent";
  text: string;
  created_at: string;
  source: "voice" | "text";
}

export async function createSession(body: {
  title: string;
  mode: string;
  duration_min: number;
  /** Dock toolset the scenario card seeds (p3); absent = default pair. */
  tools?: Record<string, string>;
  /** Candidate-provided brief; lands in the agent's system prompt. */
  prompt?: string;
}): Promise<SessionDto> {
  const res = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiFailure(res, "createSession");
  return res.json();
}

export interface DocumentDto {
  id: string;
  session_id: string;
  name: string;
  kind: "pdf" | "md" | "txt" | "docx";
  size_bytes: number;
  status: "pending" | "processing" | "ready" | "failed";
  error?: string;
  chunk_count?: number;
  created_at: string;
}

export async function uploadDocuments(
  id: string,
  files: File[],
): Promise<{ documents: DocumentDto[] }> {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const res = await fetch(`${BASE}/v1/sessions/${id}/documents`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw await apiFailure(res, "upload");
  return res.json();
}

export async function listSessions(): Promise<SessionDto[]> {
  const res = await fetch(`${BASE}/v1/sessions`);
  if (!res.ok) throw await apiFailure(res, "listSessions");
  return res.json();
}

export async function updateSessionStatus(id: string, status: string): Promise<SessionDto> {
  const res = await fetch(`${BASE}/v1/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await apiFailure(res, "updateSession");
  return res.json();
}

export async function getSession(id: string): Promise<SessionDto> {
  const res = await fetch(`${BASE}/v1/sessions/${id}`);
  if (!res.ok) throw await apiFailure(res, "getSession");
  return res.json();
}

export async function getTurns(id: string): Promise<TurnDto[]> {
  const res = await fetch(`${BASE}/v1/sessions/${id}/turns`);
  if (!res.ok) throw await apiFailure(res, "getTurns");
  return res.json();
}

export async function getReport(id: string): Promise<unknown> {
  const res = await fetch(`${BASE}/v1/sessions/${id}/report`);
  if (!res.ok) throw await apiFailure(res, "getReport");
  return res.json();
}

/**
 * Generate (or return the existing) report server-side. POST is the
 * write-shaped request but idempotent: an already-generated report is
 * returned unchanged, matching getReport's semantics for repeat loads.
 */
export async function requestReport(id: string): Promise<ReportDto> {
  const res = await fetch(`${BASE}/v1/sessions/${id}/report`, { method: "POST" });
  if (!res.ok) throw await apiFailure(res, "requestReport");
  return res.json();
}

/** Per-tool content map keyed by tool id (p3 ToolDock). */
export type ToolStateDto = Record<string, string>;

export async function pushToolState(id: string, state: ToolStateDto): Promise<void> {
  const res = await fetch(`${BASE}/v1/sessions/${id}/tools`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw await apiFailure(res, "pushToolState");
}

/**
 * Durable text turn (p0.5): the turn is enqueued in OPFS before the fetch and
 * removed on 2xx, so a failed/killed fetch can be retried (see
 * flushPendingTurns) without losing the turn.
 */
export async function postTextTurn(id: string, text: string): Promise<TurnDto> {
  const pending: PendingTurn = {
    id: crypto.randomUUID(),
    text,
    queued_at: new Date().toISOString(),
  };
  await enqueuePendingTurn(id, pending);
  return flushPendingTurn(id, pending);
}

async function postQueuedTurn(id: string, pending: PendingTurn): Promise<TurnDto> {
  const turn = {
    id: pending.id,
    session_id: id,
    seq: Date.now(),
    speaker: "user",
    text: pending.text,
    created_at: pending.queued_at,
    source: "text",
  };
  const res = await fetch(`${BASE}/v1/sessions/${id}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turn),
  });
  if (!res.ok) throw await apiFailure(res, "postTurn");
  await dequeuePendingTurn(id, pending.id);
  return res.json();
}

/** Retry a single enqueued turn with backoff (3 tries). */
async function flushPendingTurn(id: string, pending: PendingTurn): Promise<TurnDto> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < PENDING_TURN_RETRIES; attempt++) {
    try {
      return await postQueuedTurn(id, pending);
    } catch (err) {
      lastErr = err;
      const delay = POST_TURN_RETRY_BASE_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

/**
 * Replay any turns queued for this interview that never made it to the server
 * (page closed mid-turn, network down). Call on interview page mount.
 */
export async function replayPendingTurns(id: string): Promise<void> {
  const pending = await getPendingTurns(id);
  for (const turn of pending) {
    try {
      await postQueuedTurn(id, turn);
    } catch {
      return;
    }
  }
}

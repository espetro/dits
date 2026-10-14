import { $serverReachable, API_BASE } from "./runtime";
import { clearClientSessions } from "./opfs-store";
import { clearVoiceModels } from "./voice/models";
import { deleteAllTransformersModels } from "./agent/browser-provider";

/** localStorage namespaces owned by the app (`di.*` stores, `di:*` flags). */
const OWNED_KEY_PREFIXES = ["di.", "di:"] as const;

/** Remove every app-owned localStorage key (provider profile, prefs, probe cache, ...). */
export function clearLocalStorageKeys(storage: Storage = localStorage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && OWNED_KEY_PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/**
 * Delete every session held by the di server (the sidecar's sqlite), so
 * "delete past interviews" is not just a browser-side illusion. A no-op
 * when the server is unreachable (static/browser-only build).
 */
export async function deleteServerSessions(): Promise<void> {
  if ($serverReachable.get() !== true) return;
  const list = await fetch(`${API_BASE}/v1/sessions`);
  if (!list.ok) return;
  const sessions = (await list.json()) as Array<{ id: string }>;
  await Promise.all(
    sessions.map((s) => fetch(`${API_BASE}/v1/sessions/${s.id}`, { method: "DELETE" })),
  );
}

/**
 * Reset everything the app stored: server data (db rows, builtin model
 * cache, log) when reachable, then OPFS sessions, voice and transformers
 * model caches and all `di.*` localStorage keys. The caller reloads.
 * Each step is independent so one failure never strands the others.
 */
export async function resetEverything(): Promise<void> {
  const steps: Array<() => Promise<unknown>> = [
    async () => {
      if ($serverReachable.get() !== true) return;
      const res = await fetch(`${API_BASE}/v1/data`, { method: "DELETE" });
      if (!res.ok) throw new Error(`server reset failed: ${res.status}`);
    },
    clearClientSessions,
    clearVoiceModels,
    deleteAllTransformersModels,
    async () => clearLocalStorageKeys(),
  ];
  const results = await Promise.allSettled(steps.map((step) => step()));
  const failed = results.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") throw failed.reason;
}

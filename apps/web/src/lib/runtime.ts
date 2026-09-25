import { persistentAtom } from "@nanostores/persistent";
import { computed } from "nanostores";
import {
  PROVIDER_PROFILE_STORAGE_KEY,
  RUNTIME_MODE_STORAGE_KEY,
  decodeProviderProfile,
} from "@di/shared";
import type { ProviderSections, RuntimeMode } from "@di/shared";

/**
 * Runtime selection: server-managed (default), custom (BYO per-section
 * provider endpoints, client-side agent loop) or in-browser (Web Speech
 * STT/TTS + custom LLM). The mode is persisted; an unreachable server never
 * rewrites the persisted choice, it only changes the effective runtime used
 * by driver/route wiring.
 */

export const $runtimeMode = persistentAtom<RuntimeMode>(RUNTIME_MODE_STORAGE_KEY, "server", {
  // migrate pre-rename persisted values ("local-server" / "client-only")
  decode: (raw) =>
    raw === "local-server" || raw === "server"
      ? ("server" as RuntimeMode)
      : raw === "client-only"
        ? ("custom" as RuntimeMode)
        : raw === "custom" || raw === "in-browser"
          ? (raw as RuntimeMode)
          : ("server" as RuntimeMode),
  encode: (value: RuntimeMode) => value,
});

/** null = no BYO provider configured (custom runtime requires an llm section). */
export const $providerProfile = persistentAtom<ProviderSections | null>(
  PROVIDER_PROFILE_STORAGE_KEY,
  null,
  {
    encode: (value) => JSON.stringify(value),
    decode: (raw) => decodeProviderProfile(raw),
  },
);

/** Show first 3 + last 2 chars of a secret key; short keys collapse to dots. */
export function redactKey(key: string): string {
  if (key.length <= 5) return "•".repeat(key.length);
  return `${key.slice(0, 3)}${"•".repeat(Math.min(key.length - 5, 8))}${key.slice(-2)}`;
}

export const $serverReachable = persistentAtom<boolean | null>("di.server-reachable", null, {
  encode: String,
  decode: (raw) => (raw === "true" ? true : raw === "false" ? false : null),
});

const API_BASE = (import.meta.env.VITE_DI_API_BASE as string | undefined) ?? "";

/**
 * Strict health check: the di server answers JSON `{ok:true}` — anything else
 * (including a 200 from an SPA fallback serving index.html) is not a server.
 * Same check `probeServer` and voice driver selection use.
 */
export async function isHealthResponse(res: Response): Promise<boolean> {
  if (!res.ok) return false;
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return false;
  try {
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

export async function probeServer(): Promise<boolean> {
  const pinned = import.meta.env.VITE_VOICE_DEFAULT;
  if (pinned === "browser") {
    $serverReachable.set(false);
    return false;
  }
  const mode = $runtimeMode.get();
  const hasCustomBase = (import.meta.env.VITE_DI_API_BASE as string | undefined) !== undefined;
  if ((mode === "in-browser" || mode === "custom") && !hasCustomBase) {
    $serverReachable.set(false);
    return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${API_BASE}/api/health`, {
      method: "GET",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ok = await isHealthResponse(res);
    $serverReachable.set(ok);
    return ok;
  } catch {
    $serverReachable.set(false);
    return false;
  }
}

/**
 * Effective runtime: custom when the persisted mode says so, or when the
 * chosen server cannot be reached (probe result; null = not probed yet,
 * trust the persisted mode). Read-only derived, never mutates $runtimeMode.
 */
export const $effectiveRuntime = computed(
  [$runtimeMode, $serverReachable],
  (mode, reachable): RuntimeMode => (mode === "server" && reachable === false ? "custom" : mode),
);

/** Kick off the probe once per app; safe to call repeatedly. */
let probeStarted = false;
export function ensureRuntimeProbe(): void {
  if (probeStarted) return;
  probeStarted = true;
  if ($runtimeMode.get() === "server" && $serverReachable.get() !== true) {
    void probeServer();
  }
}

import { persistentAtom } from "@nanostores/persistent";
import { computed } from "nanostores";
import { envNum } from "./env";
import { PROVIDER_PROFILE_STORAGE_KEY, decodeProviderProfile } from "@di/shared";
import type { ProviderSections } from "@di/shared";
import { $voiceSttEngine, $voiceTtsEngine } from "../stores/voice";

/**
 * Deployment reachability: whether the di server hosts this app. The voice
 * driver is server-side only when BOTH stt and tts picks ask for it
 * ("server" pick, or "" auto) AND the health probe answers — otherwise the
 * browser driver runs the resolved per-layer engines.
 */

/** null = no BYO provider configured. */
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

/** Health-probe budget: keep it short — it only gates driver selection. */
const PROBE_TIMEOUT_MS = envNum("VITE_SERVER_PROBE_TIMEOUT_MS", 2_000);

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
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
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
 * A layer pick wants the server when it is "server" explicitly, or "" auto
 * (auto preserves the di-hosted default of the old server runtime).
 */
export function pickWantsServer(pick: string): boolean {
  return pick === "server" || pick === "";
}

/**
 * True when voice runs on the di server: both speech layers ask for it and
 * the probe hasn't disproven reachability (null = not probed yet — the
 * server-side read is the optimistic default, matching the old behavior
 * where "server" was assumed until the probe said otherwise).
 */
export const $serverDriven = computed(
  [$voiceSttEngine, $voiceTtsEngine, $serverReachable],
  (stt, tts, reachable): boolean =>
    pickWantsServer(stt) && pickWantsServer(tts) && reachable !== false,
);

/** Kick off the probe once per app; safe to call repeatedly. */
let probeStarted = false;
export function ensureRuntimeProbe(): void {
  if (probeStarted) return;
  probeStarted = true;
  if ($serverReachable.get() !== true) {
    void probeServer();
  }
}

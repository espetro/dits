import { atom, computed } from "nanostores";
import {
  $voiceDownload,
  $voiceModelsConsent,
  $voiceSttEngine,
  $voiceTtsEngine,
} from "../stores/voice";
import { $providerProfile, $serverDriven, $serverReachable } from "./runtime";
import { $voiceHealth } from "./voice/health";
import type { VoiceHealthEvent, VoiceHealthKind } from "./voice/health";
import { wasmVoiceSupported } from "./voice/models";

/**
 * Seam health: one up/down verdict per pluggable seam (stt, tts, llm) for
 * the navbar chip and the settings status view. Two inputs are aggregated:
 *
 * - configuration — a pick that cannot resolve (unsupported browser,
 *   missing download, unconfigured endpoint, unreachable server) is down
 *   before anything even ran;
 * - operations — the last real op through the seam errored (voice health
 *   events + driver/agent onError codes); the next success clears it.
 */

export type SeamId = "stt" | "tts" | "llm";

export interface SeamStatus {
  state: "up" | "down";
  /** stable reason slug for the status view copy */
  reason?: string;
}

export interface SeamOps {
  ok: boolean;
  reason?: string;
  at: number;
}

/** Last operation outcome per seam; a success overwrites the error. */
export const $seamOps = atom<Partial<Record<SeamId, SeamOps>>>({});

export function markSeamOp(seam: SeamId, ok: boolean, reason?: string): void {
  $seamOps.set({ ...$seamOps.get(), [seam]: { ok, reason, at: Date.now() } });
}

/** voice.* error codes (driver.onError) -> the seam(s) they sink. */
export function markDriverError(code: string): void {
  const all: SeamId[] = ["stt", "tts", "llm"];
  const map: [SeamId[], RegExp][] = [
    [["stt"], /^voice\.(stt|sttUnsupported|mic|micDenied|micUnavailable|capture)/],
    [["tts"], /^voice\.tts/],
    [["llm"], /^voice\.(llm|noResponse|agent)/],
    [all, /^voice\.(server|boot|connect|socket|reconnect|start|restart|turnstile)/],
  ];
  for (const [seams, re] of map) {
    if (re.test(code)) {
      for (const seam of seams) markSeamOp(seam, false, code);
      return;
    }
  }
}

const KIND_SEAM: Partial<Record<VoiceHealthKind, SeamId | "all">> = {
  "engine.boot": "all",
  "stt.firstPartial": "stt",
  "stt.feed": "stt",
  "stt.flush": "stt",
  "tts.speak": "tts",
  "playback.gap": "tts",
  "playback.drained": "tts",
  "playback.stop": "tts",
  turnstile: "llm",
  "llm.turn": "llm",
};

// op-marks from the health ring: engine errors and successes alike.
// detail carries the engine for ambiguous kinds (worker.error).
function seamOfEvent(e: VoiceHealthEvent): SeamId[] {
  if (e.kind === "worker.error") {
    return e.detail?.includes("stt") ? ["stt"] : ["tts"];
  }
  const m = KIND_SEAM[e.kind];
  return m === "all" ? ["stt", "tts", "llm"] : m ? [m] : [];
}

if (typeof window !== "undefined") {
  let lastSeen = 0;
  $voiceHealth.subscribe((events) => {
    for (const e of events) {
      if (e.at <= lastSeen) continue;
      lastSeen = e.at;
      for (const seam of seamOfEvent(e)) markSeamOp(seam, e.ok, e.ok ? undefined : e.kind);
    }
  });
  // a layer re-pick clears its stale op error (the user just "fixed" it)
  const clearOnPick = (seam: SeamId) => () => {
    const ops = { ...$seamOps.get() };
    if (seam in ops) {
      delete ops[seam];
      $seamOps.set(ops);
    }
  };
  $voiceSttEngine.listen(clearOnPick("stt"));
  $voiceTtsEngine.listen(clearOnPick("tts"));
  $providerProfile.listen(() => $seamOps.set({}));
}

function browserSttSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

/** Configuration-side verdict per seam — is the picked layer resolvable? */
function configStatus(seam: SeamId): SeamStatus {
  const up: SeamStatus = { state: "up" };
  const profile = $providerProfile.get();
  const server = $serverDriven.get();
  const pick =
    seam === "stt" ? $voiceSttEngine.get() : seam === "tts" ? $voiceTtsEngine.get() : null;

  if (seam === "llm") {
    if (server) return up; // the di server owns the interview brain
    return profile?.llm ? up : { state: "down", reason: "llm.unconfigured" };
  }

  if (pick === "server") {
    // an explicit server pick that the driver can't honor is unresolvable;
    // auto ("") instead keeps falling through to the browser chain below
    return server ? up : { state: "down", reason: "server.unreachable" };
  }
  if (pick === "wasm") {
    if (!wasmVoiceSupported()) return { state: "down", reason: `${seam}.unsupported` };
    if ($voiceModelsConsent.get() !== "granted")
      return { state: "down", reason: `${seam}.needsConsent` };
    if (!(seam === "stt" ? sttInstalled() : ttsInstalled()))
      return { state: "down", reason: `${seam}.notDownloaded` };
    return up;
  }
  if (pick === "cloud") {
    const section = seam === "stt" ? profile?.stt : profile?.tts;
    return section ? up : { state: "down", reason: `${seam}.noEndpoint` };
  }
  // "" auto on a server-driven app is owned by the di pipeline
  if (server) return up;
  // "in-browser" explicitly, or "" auto resolved through the browser chain
  if (seam === "stt" && !browserSttSupported()) return { state: "down", reason: "stt.unsupported" };
  if (seam === "tts" && typeof speechSynthesis === "undefined")
    return { state: "down", reason: "tts.unsupported" };
  return up;
}

// install state without an async cache read: the download store and the
// seam ops are enough for the chip (it errs toward "up" once a wasm op
// succeeded — lastSuccess means files must exist)
function sttInstalled(): boolean {
  return $voiceDownload.get().status === "ready" || lastOk("stt") !== null;
}

function ttsInstalled(): boolean {
  return $voiceDownload.get().status === "ready" || lastOk("tts") !== null;
}

function lastOk(seam: SeamId): number | null {
  const op = $seamOps.get()[seam];
  return op?.ok ? op.at : null;
}

export const $seamHealth = computed(
  [
    $seamOps,
    $voiceSttEngine,
    $voiceTtsEngine,
    $providerProfile,
    $serverDriven,
    $voiceModelsConsent,
    $voiceDownload,
  ],
  (): Record<SeamId, SeamStatus> => {
    const out = {} as Record<SeamId, SeamStatus>;
    for (const seam of ["stt", "tts", "llm"] as const) {
      const cfg = configStatus(seam);
      const op = $seamOps.get()[seam];
      if (cfg.state === "down") out[seam] = cfg;
      else if (op && !op.ok) out[seam] = { state: "down", reason: op.reason ?? "op.failed" };
      else out[seam] = cfg;
    }
    return out;
  },
);

export type ChipState = "ok" | "offline" | { down: SeamId[] };

/** Chip aggregate: which seams are down right now. */
export function chipState(h: Record<SeamId, SeamStatus>): ChipState {
  const down = (["stt", "tts", "llm"] as const).filter((s) => h[s].state === "down");
  if (down.length === 0) return "ok";
  if (down.length === 3) return "offline";
  return { down };
}

const DIAG_EVENT_CAP = 20;

/** Prefilled github issue url for the report-issue button. */
export async function reportIssueUrl(): Promise<string> {
  const { resolveInstalledVoiceEngines } = await import("./voice/engines");
  const engines = await resolveInstalledVoiceEngines().catch(() => null);
  const events = $voiceHealth.get().slice(-DIAG_EVENT_CAP);
  const diag = {
    userAgent: navigator.userAgent,
    driver: $serverDriven.get() ? "server" : "browser",
    reachable: $serverReachable.get(),
    picks: { stt: $voiceSttEngine.get() || "auto", tts: $voiceTtsEngine.get() || "auto" },
    engines,
    seams: $seamHealth.get(),
    events,
  };
  const body = [
    "<!-- describe what happened -->",
    "",
    "```diagnostics",
    JSON.stringify(diag, null, 2),
    "```",
  ].join("\n");
  return `https://github.com/espetro/dits/issues/new?body=${encodeURIComponent(body)}`;
}

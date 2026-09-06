import { BrowserVoiceDriver } from "./browser-driver";
import { ServerVoiceDriver } from "./server-driver";
import type { SpeechDriver } from "./server-driver";
import { createStoreToolExecutors } from "../agent/client-agent";
import { $currentQuestion, $clientTurns } from "../agent/session-store";
import { $editorBuffer, $question, $whiteboard } from "../../stores/session";
import {
  $effectiveRuntime,
  $providerProfile,
  $runtimeMode,
  $serverReachable,
  probeServer,
} from "../runtime";
import { describeWhiteboardSnapshot } from "@di/shared";
import type { LlmSection, ProviderSections } from "@di/shared";

export type VoiceDriverKind = "server" | "browser";

const API_BASE = (import.meta.env.VITE_DI_API_BASE as string | undefined) ?? "";

/**
 * Pick a driver. Precedence: runtime mode selection (custom/in-browser =
 * browser driver), else VITE_VOICE_DEFAULT pin, else probe the server health
 * endpoint; a fetch-able ${BASE}/api/health means the di binary (with the WS
 * voice endpoint) is hosting, otherwise fall back to the browser driver.
 */
export async function selectDriver(): Promise<VoiceDriverKind> {
  const mode = $runtimeMode.get();
  if (mode === "custom" || mode === "in-browser") return "browser";
  const pinned = import.meta.env.VITE_VOICE_DEFAULT as VoiceDriverKind | undefined;
  if (pinned === "server" || pinned === "browser") return pinned;
  const hasCustomBase = (import.meta.env.VITE_DI_API_BASE as string | undefined) !== undefined;
  if (!hasCustomBase && $serverReachable.get() === false) return "browser";
  try {
    const res = await fetch(`${API_BASE}/api/health`, { method: "GET" });
    return res.ok ? "server" : "browser";
  } catch {
    return "browser";
  }
}

export async function createDriver(sessionId: string): Promise<SpeechDriver> {
  const kind = await selectDriver();
  if (kind === "server") return new ServerVoiceDriver(sessionId);

  const profile = $providerProfile.get();
  const driver = new BrowserVoiceDriver(sessionId);
  if (profile?.llm && $effectiveRuntime.get() !== "server") {
    const withLlm = profile as ProviderSections & { llm: LlmSection };
    const executors = createStoreToolExecutors({
      editorGetter: () => $editorBuffer.get(),
      whiteboardGetter: () => describeWhiteboardSnapshot($whiteboard.get()),
      onQuestion: (q) => {
        $question.set(q);
        $currentQuestion.set(q);
      },
    });
    driver.useClientAgent(withLlm, executors, () => ({
      mode: "interview",
      currentQuestion: $question.get().text,
      hints: $question.get().hints,
    }));
  }
  return driver;
}

export { BrowserVoiceDriver, ServerVoiceDriver, probeServer, $clientTurns };
export type { SpeechDriver } from "./server-driver";
export type { ProviderSections };

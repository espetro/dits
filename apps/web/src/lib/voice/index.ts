import { BrowserVoiceDriver } from "./browser-driver";
import { ServerVoiceDriver } from "./server-driver";
import type { SpeechDriver } from "./server-driver";
import { createStoreToolExecutors } from "../agent/client-agent";
import { $clientTurns, $currentQuestion } from "../agent/session-store";
import { getClientSession } from "../opfs-store";
import {
  $editorBuffer,
  $question,
  $whiteboard,
  codeToolReadout,
  setQuestion,
} from "../../stores/session";
import { $providerProfile, $serverDriven, pickWantsServer, probeServer } from "../runtime";
import { $voiceSttEngine, $voiceTtsEngine } from "../../stores/voice";
import { DEFAULT_SESSION_TOOLS } from "@di/shared";
import type { LlmSection, ProviderSections } from "@di/shared";

export type VoiceDriverKind = "server" | "browser";

/**
 * Pick a driver. The di server pipeline is all-or-nothing across the
 * speech seams, so the server driver is chosen only when BOTH stt and tts
 * picks want it — a "server" pick or "" auto (auto preserves the old
 * di-hosted default). Any browser-side pick on either seam sends the whole
 * turn to the browser driver, which resolves each layer on its own; a
 * "server" pick it could not honor degrades to the auto chain and the
 * status view reports it. VITE_VOICE_DEFAULT still pins one driver for
 * deployments that force it. With both layers wanting the server, a
 * reachable /api/health means the di binary (with the .cpp WS pipeline)
 * hosts this app; unreachable means the browser pipeline runs.
 */
export async function selectDriver(): Promise<VoiceDriverKind> {
  const pinned = import.meta.env.VITE_VOICE_DEFAULT as VoiceDriverKind | undefined;
  if (pinned === "server" || pinned === "browser") return pinned;
  if (!pickWantsServer($voiceSttEngine.get()) || !pickWantsServer($voiceTtsEngine.get())) {
    return "browser";
  }
  return (await probeServer()) ? "server" : "browser";
}

export async function createDriver(
  sessionId: string,
  loadSignal?: AbortSignal,
): Promise<SpeechDriver> {
  const kind = await selectDriver();
  if (kind === "server") return new ServerVoiceDriver(sessionId);

  const profile = $providerProfile.get();
  const driver = new BrowserVoiceDriver(sessionId);
  if (profile?.llm && !$serverDriven.get()) {
    const withLlm = profile as ProviderSections & { llm: LlmSection };
    // The session's toolset decides which agent tools exist (p3 ToolSpec
    // registry): content getters stay store-backed per tool id.
    const clientSession = await getClientSession(sessionId);
    const toolset = clientSession?.tools ?? DEFAULT_SESSION_TOOLS;
    const executors = createStoreToolExecutors({
      toolset,
      contentGetters: {
        editor: () => $editorBuffer.get(),
        whiteboard: () => $whiteboard.get(),
        code: () => codeToolReadout(),
      },
      onQuestion: (q) => {
        setQuestion(q);
        $currentQuestion.set(q);
      },
    });
    // model load is caller-abortable (interview route bounds it at 10min); a
    // timeout/abort surfaces as a normal error state (p0.2 retry path)
    await AbortSignalAbortable(loadSignal, () =>
      driver.useClientAgent(withLlm, executors, toolset, () => ({
        mode: "interview",
        prompt: clientSession?.prompt,
        currentQuestion: $question.get().text,
        hints: $question.get().hints,
      })),
    );
  }
  return driver;
}

async function AbortSignalAbortable(signal: AbortSignal | undefined, run: () => Promise<void>) {
  if (!signal) return run();
  return Promise.race([
    run(),
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
        once: true,
      }),
    ),
  ]);
}

export { BrowserVoiceDriver, ServerVoiceDriver, probeServer, $clientTurns };
export type { SpeechDriver } from "./server-driver";
export type { ProviderSections };

import * as v from "valibot";
import { AUDIO_HEADER_BYTES, VoiceServerMessageSchema } from "@di/shared/voice";
import type { TtsMessage, VoiceServerMessage } from "@di/shared/voice";
import type { Turn } from "@di/shared/session";
import { startCapture } from "./capture";
import type { MicCapture } from "./capture";
import { createPcmPlayer } from "./pcm-player";
import { pushMicLevel } from "./levels";
import type { PcmPlayer } from "./pcm-player";
import { createVadGate } from "./vad";
import type { VadGate } from "./vad";

/**
 * SpeechDriver: the transport-facing voice interface. Both server-driver
 * (WS + Web Audio) and browser-driver (Web Speech API) implement it; turns
 * always land via the existing REST API so transcripts/reports are identical.
 */
export interface SpeechDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
  readonly status: "idle" | "connecting" | "connected" | "error";
  readonly agentSpeaking: boolean;
  /** error sink; the route assigns this. readonly in the interface, mutable on impls */
  onError: (message: string) => void;
  /** driver-specific state machine events, surfaced for the route UI */
  events: {
    onSpeechStart?: () => void;
    onSpeechEnd?: (text: string) => void;
    onUserTurn?: (turn: Turn) => void;
    onAgentTurn?: (turn: Turn) => void;
    onAgentStart?: () => void;
    onAgentDone?: () => void;
  };
}

const API_BASE = (import.meta.env.VITE_DI_API_BASE as string | undefined) ?? "";

/** Build the voice WS URL from the page origin + API base override. */
export function voiceWsUrl(sessionId: string): string {
  const originOverride =
    API_BASE && /^https?:/.test(API_BASE) ? API_BASE.replace(/^http/, "ws") : null;
  if (originOverride) return `${originOverride}/v1/sessions/${sessionId}/voice`;
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
  const host = typeof location !== "undefined" ? location.host : "localhost";
  return `${proto}://${host}${API_BASE}/v1/sessions/${sessionId}/voice`;
}

function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 4-byte big-endian seq + PCM16 payload, per shared/src/voice.ts. */
function frameAudio(seq: number, pcm: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(AUDIO_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, seq, false);
  new Uint8Array(buf, AUDIO_HEADER_BYTES).set(pcm);
  return buf;
}

export interface ServerDriverDeps {
  WebSocketCtor?: new (url: string) => WebSocket;
  capture?: () => Promise<MicCapture>;
  player?: PcmPlayer;
  vad?: (opts: {
    onSpeechStart: () => void;
    onSpeechEnd: (audio: Float32Array) => void;
  }) => Promise<VadGate>;
}

/**
 * WS voice driver: mic capture (16k PCM16) -> client VAD utterances -> binary
 * frames to the server; server tts chunks -> PcmPlayer (24k); barge-in sends
 * interrupt and kills scheduled playback.
 */
export class ServerVoiceDriver implements SpeechDriver {
  status: SpeechDriver["status"] = "idle";
  agentSpeaking = false;
  onError: (message: string) => void = () => undefined;
  events: SpeechDriver["events"] = {};

  private ws: WebSocket | null = null;
  private capture: MicCapture | null = null;
  private vad: VadGate | null = null;
  private player: PcmPlayer;
  private seq = 0;
  private muted = false;
  private speaking = false;

  constructor(
    private readonly sessionId: string,
    private readonly deps: ServerDriverDeps = {},
  ) {
    this.player = deps.player ?? createPcmPlayer();
  }

  async start(): Promise<void> {
    this.status = "connecting";
    const WS = this.deps.WebSocketCtor ?? (globalThis.WebSocket as new (url: string) => WebSocket);
    const ws = new WS(voiceWsUrl(this.sessionId));
    this.ws = ws;
    this.agentSpeaking = false;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("voice socket failed"));
      ws.onclose = () => {
        if (this.status === "connected") {
          this.status = "idle";
          this.agentSpeaking = false;
        }
      };
    });

    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    this.status = "connected";

    // vad gates utterances; speech start during agent playback is barge-in
    const vadFactory = this.deps.vad ?? ((opts) => createVadGate(opts));
    this.vad = await vadFactory({
      onSpeechStart: () => {
        this.speaking = true;
        this.events.onSpeechStart?.();
        if (this.agentSpeaking) {
          this.player.stop();
          this.sendJson({ t: "interrupt" });
        }
      },
      onSpeechEnd: (audio) => {
        this.speaking = false;
        // audio is not transcribed client-side; the server transcribed the
        // streamed frames. non-empty placeholder so the FSM advances to
        // thinking instead of the empty-transcript path back to listening;
        // the real transcript arrives later as user_transcript.
        void audio;
        this.sendJson({ t: "utterance_end" });
        this.events.onSpeechEnd?.("\u200b");
      },
    });

    const captureFactory = this.deps.capture ?? (() => startCapture());
    this.capture = await captureFactory();
    this.capture.onLevel?.((rms) => pushMicLevel(rms));
    this.capture.onFrame((pcm16) => {
      this.vad?.processFrame(pcm16);
      if (!this.speaking || this.muted) return; // only stream during an utterance
      this.sendBinary(frameAudio(this.seq++, pcm16));
    });
  }

  private handleMessage(ev: MessageEvent) {
    if (typeof ev.data !== "string") {
      // binary tts frame: strip the 4-byte seq header
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      this.player.write(bytes.subarray(AUDIO_HEADER_BYTES));
      return;
    }
    const parsed = v.safeParse(VoiceServerMessageSchema, JSON.parse(ev.data));
    if (!parsed.success) return;
    const msg = parsed.output as VoiceServerMessage;
    switch (msg.t) {
      case "agent_speaking":
        this.agentSpeaking = msg.on;
        if (msg.on) this.events.onAgentStart?.();
        else this.events.onAgentDone?.();
        break;
      case "user_transcript":
        this.events.onUserTurn?.(msg.turn);
        break;
      case "agent_transcript":
        this.events.onAgentTurn?.(msg.turn);
        break;
      case "tts":
        this.player.write(decodeB64(msg.pcm));
        if ((msg as TtsMessage).final && !this.agentSpeaking) this.events.onAgentDone?.();
        break;
      case "error":
        this.onError(msg.message);
        break;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.capture?.setMuted(muted);
    this.sendJson({ t: "mute", muted });
  }

  async stop(): Promise<void> {
    this.capture?.onFrame(() => undefined);
    await this.capture?.stop();
    this.capture = null;
    await this.vad?.destroy();
    this.vad = null;
    this.player.stop();
    this.ws?.close();
    this.ws = null;
    this.status = "idle";
    this.agentSpeaking = false;
  }

  private sendJson(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendBinary(buf: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
  }
}

import { TTS_SAMPLE_RATE } from "@di/shared/voice";

import { pushAgentLevel } from "./levels";

/** Minimal structural types so tests can pass a fake without a real AudioContext. */
export interface AudioBufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  onended: ((this: AudioBufferSourceNodeLike, ev: unknown) => void) | null;
  connect(destination: unknown): AudioBufferSourceNodeLike;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  disconnect(): void;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  close(): Promise<void>;
}

export interface PcmPlayer {
  /** Queue PCM16LE mono bytes for back-to-back playback. Never blocks. */
  write(pcm16: Uint8Array): void;
  /** Stop all scheduled sources (barge-in) and drop queued buffers. */
  stop(): void;
  /** Fired when the last scheduled buffer finishes and nothing is queued. */
  onDrained(cb: () => void): void;
  readonly playing: boolean;
}

/** Convert interleaved little-endian PCM16 bytes to float samples in [-1, 1]. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const samples = bytes.byteLength >> 1;
  const out = new Float32Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

interface QueuedChunk {
  source: AudioBufferSourceNodeLike;
  buffer: AudioBufferLike;
}

/**
 * Web Audio playback for streamed PCM16 chunks: one AudioContext at
 * TTS_SAMPLE_RATE, AudioBufferSourceNodes scheduled back-to-back off a
 * running playhead. write() only enqueues, so the WS receive path never
 * blocks on audio.
 */
export function createPcmPlayer(opts: { createContext?: () => AudioContextLike } = {}): PcmPlayer {
  const ctx =
    opts.createContext?.() ??
    new (globalThis.AudioContext as unknown as new (o?: {
      sampleRate: number;
    }) => AudioContextLike)({
      sampleRate: TTS_SAMPLE_RATE,
    });

  let playhead = 0;
  let drainedCb: (() => void) | null = null;
  const active = new Set<AudioBufferSourceNodeLike>();
  // small pending queue: chunks written while a gap already exists are
  // scheduled immediately; this exists so stop() can drop not-yet-started ones
  const pending: QueuedChunk[] = [];

  function scheduleNext() {
    while (pending.length > 0) {
      const { source, buffer } = pending.shift()!;
      const at = Math.max(playhead, ctx.currentTime);
      playhead = at + buffer.duration;
      source.start(at);
      active.add(source);
    }
  }

  return {
    write(pcm16: Uint8Array) {
      const samples = pcm16ToFloat(pcm16);
      if (samples.length === 0) return;
      // loudness tap for the voice orb (attack envelope, see lib/voice/levels)
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s !== undefined) sum += s * s;
      }
      pushAgentLevel(Math.sqrt(sum / (samples.length || 1)));
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination as unknown);
      source.onended = () => {
        active.delete(source);
        source.disconnect();
        if (active.size === 0 && pending.length === 0) drainedCb?.();
      };
      pending.push({ source, buffer });
      scheduleNext();
    },
    stop() {
      for (const { source } of pending.splice(0)) source.disconnect();
      for (const s of active) {
        try {
          s.stop();
        } catch {
          // already stopped
        }
        s.disconnect();
      }
      active.clear();
      // reset playhead so the next utterance starts now, not after the killed one
      playhead = ctx.currentTime;
    },
    onDrained(cb) {
      drainedCb = cb;
    },
    get playing() {
      return active.size > 0 || pending.length > 0;
    },
  };
}

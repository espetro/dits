import { describe, expect, it, vi } from "vitest";
import { ServerVoiceDriver, voiceWsUrl } from "./server-driver";
import type { MicCapture } from "./capture";
import type { PcmPlayer } from "./pcm-player";
import type { VadGate } from "./vad";

function fakeWs() {
  const sent: Array<{ kind: "text" | "binary"; data: unknown }> = [];
  const handlers: Record<string, ((ev: { data: unknown }) => void) | null> = {};
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: (d: unknown) => sent.push({ kind: typeof d === "string" ? "text" : "binary", data: d }),
    close: vi.fn(),
    set onopen(cb: () => void) {
      cb();
    },
    set onerror(cb: () => void) {
      void cb;
    },
    set onclose(cb: () => void) {
      void cb;
    },
    set onmessage(cb: (ev: { data: unknown }) => void) {
      handlers.onmessage = cb;
    },
  };
  return {
    ws: ws as unknown as WebSocket,
    sent,
    receive: (data: unknown) => handlers.onmessage?.({ data }),
  };
}

function fakeCapture() {
  let frameCb: ((pcm: Uint8Array) => void) | null = null;
  const cap: MicCapture = {
    onFrame: (cb) => (frameCb = cb),
    setMuted: vi.fn(),
    stop: async () => undefined,
  };
  return {
    cap,
    emit: (frame: Uint8Array) => frameCb?.(frame),
  };
}

function fakePlayer(): PcmPlayer & { written: Uint8Array[] } {
  const written: Uint8Array[] = [];
  return {
    written,
    write: (frame) => written.push(frame),
    stop: vi.fn(),
    onDrained: () => undefined,
    get playing() {
      return written.length > 0;
    },
  };
}

function fakeVad() {
  const cbs = {
    start: [] as Array<() => void>,
    end: [] as Array<(a: Float32Array) => void>,
  };
  const gate: VadGate = {
    processFrame: vi.fn(),
    destroy: async () => undefined,
  };
  return {
    gate,
    factory: (opts: { onSpeechStart: () => void; onSpeechEnd: (audio: Float32Array) => void }) => {
      cbs.start.push(opts.onSpeechStart);
      cbs.end.push(opts.onSpeechEnd);
      return Promise.resolve(gate);
    },
    speechStart: () => cbs.start.forEach((f) => f()),
    speechEnd: () => cbs.end.forEach((f) => f(new Float32Array(0))),
  };
}

function pcm(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

describe("voiceWsUrl", () => {
  it("builds a ws(s) url on the page origin", () => {
    // jsdom default origin is http://localhost/
    expect(voiceWsUrl("abc").startsWith("ws://")).toBe(true);
    expect(voiceWsUrl("abc").endsWith("/v1/sessions/abc/voice")).toBe(true);
  });
});

describe("ServerVoiceDriver", () => {
  async function boot() {
    const ws = fakeWs();
    const capture = fakeCapture();
    const player = fakePlayer();
    const vad = fakeVad();
    const driver = new ServerVoiceDriver("s1", {
      WebSocketCtor: function FakeWS() {
        return ws.ws;
      } as unknown as new (url: string) => WebSocket,
      capture: async () => capture.cap,
      player,
      vad: vad.factory as never,
    });
    await driver.start();
    return { driver, ws, capture, player, vad };
  }

  it("streams frames with 4-byte BE seq only while speaking", async () => {
    const { ws, capture, vad } = await boot();
    capture.emit(pcm(100)); // not speaking yet: dropped
    expect(ws.sent).toHaveLength(0);
    vad.speechStart();
    capture.emit(pcm(100));
    capture.emit(pcm(100));
    expect(ws.sent).toHaveLength(2);
    const buf = ws.sent[0]!.data as ArrayBuffer;
    expect(new DataView(buf).getUint32(0, false)).toBe(0);
    expect(new DataView(ws.sent[1]!.data as ArrayBuffer).getUint32(0, false)).toBe(1);
    vad.speechEnd();
    expect(JSON.parse(ws.sent.at(-1)!.data as string)).toEqual({
      t: "utterance_end",
    });
    capture.emit(pcm(100));
    expect(ws.sent).toHaveLength(3); // no new audio frames
  });

  it("mute gates frames and notifies the server", async () => {
    const ws = fakeWs();
    const capture = fakeCapture();
    const vad = fakeVad();
    const driver = new ServerVoiceDriver("s1", {
      WebSocketCtor: function () {
        return ws.ws;
      } as unknown as new (url: string) => WebSocket,
      capture: async () => capture.cap,
      player: fakePlayer(),
      vad: vad.factory as never,
    });
    await driver.start();
    vad.speechStart();
    capture.emit(pcm(100));
    expect(ws.sent).toHaveLength(1);
    driver.setMuted(true);
    expect(capture.cap.setMuted).toHaveBeenCalledWith(true);
    capture.emit(pcm(100));
    expect(ws.sent).toHaveLength(2); // only the mute json, no audio frame
    const muteMsg = ws.sent.find((s) => s.kind === "text" && (s.data as string).includes('"mute"'));
    expect(JSON.parse(muteMsg!.data as string)).toEqual({
      t: "mute",
      muted: true,
    });
  });

  it("barge-in: speech start during agent playback stops player and sends interrupt", async () => {
    const { ws, player, vad, driver } = await boot();
    ws.receive(JSON.stringify({ t: "agent_speaking", on: true }));
    expect(driver.agentSpeaking).toBe(true);
    vad.speechStart();
    const interrupt = ws.sent.find(
      (s) => s.kind === "text" && (s.data as string).includes('"interrupt"'),
    );
    expect(interrupt).toBeTruthy();
    expect(player.stop).toHaveBeenCalled();
  });

  it("tts messages decode b64 and binary frames strip the seq header", async () => {
    const { ws, player } = await boot();
    ws.receive(JSON.stringify({ t: "tts", seq: 0, pcm: "AQI=", final: false }));
    expect([...player.written[0]!]).toEqual([1, 2]);
    const buf = new ArrayBuffer(6);
    new DataView(buf).setUint32(0, 42, false);
    new Uint8Array(buf, 4).set([9, 9]);
    ws.receive(buf);
    expect([...player.written[1]!]).toEqual([9, 9]);
  });

  it("agent_speaking on/off drives events and transcripts surface turns", async () => {
    const sid = crypto.randomUUID();
    const { driver, ws } = await boot();
    const turns: string[] = [];
    driver.events.onUserTurn = () => turns.push("user");
    driver.events.onAgentTurn = () => turns.push("agent");
    driver.events.onAgentStart = () => turns.push("start");
    driver.events.onAgentDone = () => turns.push("done");
    ws.receive(
      JSON.stringify({
        t: "user_transcript",
        turn: {
          id: crypto.randomUUID(),
          session_id: sid,
          seq: 1,
          speaker: "user",
          text: "hi",
          created_at: "2026-01-01T00:00:00.000Z",
          source: "voice",
        },
      }),
    );
    ws.receive(
      JSON.stringify({
        t: "agent_transcript",
        turn: {
          id: crypto.randomUUID(),
          session_id: sid,
          seq: 2,
          speaker: "agent",
          text: "hello",
          created_at: "2026-01-01T00:00:01.000Z",
          source: "voice",
        },
      }),
    );
    ws.receive(JSON.stringify({ t: "agent_speaking", on: true }));
    ws.receive(JSON.stringify({ t: "agent_speaking", on: false }));
    expect(turns).toEqual(["user", "agent", "start", "done"]);
    expect(driver.agentSpeaking).toBe(false);
  });

  it("error messages call onError", async () => {
    const { driver, ws } = await boot();
    const errs: string[] = [];
    driver.onError = (m) => errs.push(m);
    ws.receive(JSON.stringify({ t: "error", message: "stt down" }));
    expect(errs).toEqual(["stt down"]);
  });
});

describe("reconnect loop", () => {
  interface TestSocket {
    open: () => void;
    close: () => void;
    fail: () => void;
  }

  function reconnectHarness() {
    const sockets: TestSocket[] = [];
    const errs: string[] = [];
    const reconnects: number[] = [];
    const capture = fakeCapture();
    let current: {
      onopen: (() => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
    } = {
      onopen: null,
      onerror: null,
      onclose: null,
    };
    const driver = new ServerVoiceDriver("s1", {
      WebSocketCtor: function () {
        current = { onopen: null, onerror: null, onclose: null };
        const ws = {
          readyState: 0,
          OPEN: 1,
          send: () => undefined,
          close: () => undefined,
          set onopen(cb: () => void) {
            this.readyState = 1;
            current.onopen = cb;
          },
          set onerror(cb: () => void) {
            current.onerror = cb;
          },
          set onclose(cb: () => void) {
            current.onclose = cb;
          },
          set onmessage(cb: unknown) {
            void cb;
          },
        };
        sockets.push({
          open: () => current.onopen?.(),
          close: () => current.onclose?.(),
          fail: () => current.onerror?.(),
        });
        return ws as unknown as WebSocket;
      } as unknown as new (url: string) => WebSocket,
      capture: async () => capture.cap,
      player: fakePlayer(),
      vad: fakeVad().factory as never,
    });
    driver.onError = (m) => errs.push(m);
    driver.onReconnecting = (attempt) => reconnects.push(attempt);
    return { driver, sockets, errs, reconnects };
  }

  it("reconnects with exp backoff after an unexpected close", async () => {
    vi.useFakeTimers();
    try {
      const { driver, sockets, reconnects } = reconnectHarness();
      const started = driver.start();
      await vi.advanceTimersByTimeAsync(0);
      sockets[0]!.open();
      await started;
      expect(driver.status).toBe("connected");
      sockets[0]!.close();
      expect(driver.status).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(1_000);
      sockets[1]!.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(driver.status).toBe("connected");
      expect(reconnects).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after 5 failed attempts with a human-readable error", async () => {
    vi.useFakeTimers();
    try {
      const { driver, sockets, errs, reconnects } = reconnectHarness();
      const started = driver.start();
      await vi.advanceTimersByTimeAsync(0);
      sockets[0]!.open();
      await started;
      sockets[0]!.close();
      for (let i = 1; i <= 5; i++) {
        await vi.advanceTimersByTimeAsync(16_000);
        sockets[i]!.fail();
      }
      await vi.advanceTimersByTimeAsync(16_000);
      expect(reconnects).toEqual([1, 2, 3, 4, 5]);
      expect(driver.status).toBe("error");
      expect(errs[0]).toContain("retry");
    } finally {
      vi.useRealTimers();
    }
  });
});

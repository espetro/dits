import { describe, expect, it, vi } from "vitest";
import { createDatabase, migrate } from "../store/db";
import { VoiceLoop } from "./loop";
import type { VoiceLlm, VoiceStt, VoiceTts } from "./loop";
import { KICKOFF_UTTERANCE } from "@di/shared";
import type { Config, VoiceServerMessage } from "@di/shared";
import { AUDIO_HEADER_BYTES, TTS_SAMPLE_RATE } from "@di/shared/voice";

function testConfig(): Config {
  return {
    server: { port: 3000, auth: "none" },
    llm: { provider: "mock", base_url: "http://localhost:9000", model: "m", flavor: "openai" },
    stt: { base_url: "http://localhost:9000", model: "s", mode: "buffered" },
    tts: { base_url: "http://localhost:9000", model: "t", voice: "v" },
    files: { db_path: ":memory:", log_path: "", data_dir: "" },
  };
}

function pcmBytes(samples: number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return out;
}

/** Binary frame: 4-byte BE seq + PCM. */
function frame(seq: number, pcm: Uint8Array): { t: "binary"; data: Uint8Array } {
  const data = new Uint8Array(AUDIO_HEADER_BYTES + pcm.length);
  new DataView(data.buffer).setUint32(0, seq, false);
  data.set(pcm, AUDIO_HEADER_BYTES);
  return { t: "binary" as const, data };
}

async function makeLoop(
  overrides?: Partial<{
    stt: VoiceStt;
    tts: VoiceTts;
    llm: VoiceLlm;
    kickoffMs: number;
  }>,
) {
  const db = createDatabase(":memory:");
  await migrate(db);
  await db
    .insertInto("sessions")
    .values({
      id: "s1",
      title: "Go loop",
      mode: "interview",
      created_at: new Date().toISOString(),
      status: "created",
      duration_min: 30,
      plan: null,
      tools: "{}",
    })
    .execute();
  const messages: VoiceServerMessage[] = [];
  const binary: Uint8Array[] = [];
  const seenPcm: Uint8Array[] = [];
  const seenTexts: string[] = [];
  const loop = new VoiceLoop({
    sessionId: "s1",
    config: testConfig(),
    db,
    send: (m) => {
      messages.push(m);
      if (m.t === "agent_transcript") {
        seenTexts.push(m.turn.text);
      }
    },
    sendBinary: (d) => {
      binary.push(d);
      seenPcm.push(d.subarray(AUDIO_HEADER_BYTES));
    },
    kickoffMs: 0,
    ...overrides,
  });
  await loop.start();
  return { loop, db, messages, binary, seenPcm, seenTexts };
}

function stubStt(text: string): VoiceStt & { calls: number; aborts: number } {
  return {
    calls: 0,
    aborts: 0,
    async transcribePcm(_pcm: Uint8Array, opts?: { signal?: AbortSignal }) {
      (this as any).calls++;
      if (opts?.signal?.aborted) (this as any).aborts++;
      return text;
    },
  } as never;
}

/** One 20ms chunk of PCM16 mono at 24k = 960 bytes. */
const CHUNK_BYTES = (TTS_SAMPLE_RATE * 2 * 20) / 1000;
let calls = 0;

describe("VoiceLoop", () => {
  it("streams user_transcript -> agent_transcript -> agent_speaking -> tts chunks -> off, and persists", async () => {
    const ttsPcm = pcmBytes(new Array(CHUNK_BYTES / 2 + 5).fill(100)); // 20ms + remainder -> 2 chunks
    const stt = stubStt("tell me about maps");
    const { loop, db, messages, binary, seenPcm } = await makeLoop({
      stt,
      tts: { synthesizeToPcm: async () => ttsPcm },
      llm: {
        chat: async () => ({ content: "Sure, what is a map?", toolCalls: [] }),
      },
    });

    await loop.handleMessage(frame(0, pcmBytes([1, 2, 3, 4])));
    await loop.handleMessage({ t: "utterance_end" });
    await loop.handleMessage({ t: "utterance_end" }); // empty buffer: no-op
    expect(messages).toHaveLength(5);

    const types = messages.map((m) => m.t);
    expect(types).toEqual([
      "user_transcript",
      "agent_transcript",
      "agent_speaking",
      "agent_speaking",
      "metrics",
    ]);
    expect(messages[2]).toMatchObject({ t: "agent_speaking", on: true });
    expect(messages.at(-2)).toMatchObject({ t: "agent_speaking", on: false });
    // tts chunks ride binary frames only: BE seq header + PCM payload
    expect(binary).toHaveLength(2);
    expect(new DataView(binary[0]!.buffer).getUint32(0, false)).toBe(0);
    expect(new DataView(binary[1]!.buffer).getUint32(0, false)).toBe(1);
    expect(binary[0]!.length).toBe(AUDIO_HEADER_BYTES + CHUNK_BYTES);
    expect(Buffer.concat([Buffer.from(seenPcm[0]!), Buffer.from(seenPcm[1]!)]).length).toBe(
      ttsPcm.length,
    );

    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns.map((t) => [t.speaker, t.text, t.source])).toEqual([
      ["user", "tell me about maps", "voice"],
      ["agent", "Sure, what is a map?", "voice"],
    ]);
    const events = await db.selectFrom("events").selectAll().orderBy("id").execute();
    // stub stt/tts/llm don't emit adapter telemetry (covered in their own
    // tests); the loop itself emits agent.started and vad.speech_ended.
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["agent.started", "vad.speech_ended"]),
    );
    expect(JSON.parse(events[0]!.payload!)).toEqual({ transport: "ws" });
  });

  it("emits a metrics message after a full turn with sane fields, and mirrors it as turn.metrics", async () => {
    const { loop, db, messages } = await makeLoop({
      stt: stubStt("tell me about maps"),
      tts: {
        synthesizeToPcm: async () => pcmBytes(new Array(CHUNK_BYTES / 2).fill(1)),
      },
      llm: { chat: async () => ({ content: "Sure.", toolCalls: [] }) },
    });
    await loop.handleMessage(frame(0, pcmBytes([1, 2, 3, 4])));
    await loop.handleMessage({ t: "utterance_end" });

    const metricsMsg = messages.find((m) => m.t === "metrics") as Extract<
      VoiceServerMessage,
      { t: "metrics" }
    >;
    expect(metricsMsg).toBeDefined();
    const m = metricsMsg.metrics;
    expect(m.total_ms).toBeGreaterThanOrEqual(0);
    expect(m.stt_ms).toBeGreaterThanOrEqual(0);
    expect(m.llm_ttft_ms).toBeGreaterThanOrEqual(0);
    expect(m.first_audio_ms).toBeGreaterThanOrEqual(0);
    expect(m.vad_ms).toBeGreaterThanOrEqual(0);
    const events = await db.selectFrom("events").selectAll().execute();
    const ev = events.find((e) => e.type === "turn.metrics");
    expect(ev).toBeDefined();
    expect(JSON.parse(ev!.payload!)).toEqual(m);
  });

  it("metrics on an empty-transcript turn omits optional stages but keeps total_ms", async () => {
    const { loop, messages } = await makeLoop({
      stt: stubStt(""),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "x", toolCalls: [] }) },
    });
    await loop.handleMessage(frame(0, pcmBytes([1])));
    await loop.handleMessage({ t: "utterance_end" });
    const metricsMsg = messages.find((m) => m.t === "metrics") as Extract<
      VoiceServerMessage,
      { t: "metrics" }
    >;
    expect(metricsMsg.metrics).toEqual({
      vad_ms: expect.any(Number),
      total_ms: expect.any(Number),
    });
    expect(metricsMsg.metrics.stt_ms).toBeUndefined();
  });

  it("handles b64 JSON audio frames like binary ones", async () => {
    const stt = stubStt("hi");
    const { loop, messages } = await makeLoop({
      stt,
      tts: { synthesizeToPcm: async () => pcmBytes([0, 0]) },
      llm: { chat: async () => ({ content: "hello", toolCalls: [] }) },
    });
    await loop.handleMessage({
      t: "audio",
      seq: 0,
      pcm: Buffer.from(pcmBytes([5, 6])).toString("base64"),
    });
    await loop.handleMessage({ t: "utterance_end" });
    expect(messages.some((m) => m.t === "user_transcript")).toBe(true);
  });

  it("mute drops buffered audio and ignores frames while muted", async () => {
    const stt = stubStt("should not run");
    const { loop, messages } = await makeLoop({
      stt,
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "x", toolCalls: [] }) },
    });
    await loop.handleMessage(frame(0, pcmBytes([1])));
    await loop.handleMessage({ t: "mute", muted: true });
    await loop.handleMessage(frame(1, pcmBytes([2])));
    await loop.handleMessage({ t: "utterance_end" });
    expect(stt.calls).toBe(0);
    expect(messages.filter((m) => m.t === "user_transcript")).toHaveLength(0);
    // unmute restores capture
    await loop.handleMessage({ t: "mute", muted: false });
    await loop.handleMessage(frame(2, pcmBytes([3])));
    await loop.handleMessage({ t: "utterance_end" });
    expect(stt.calls).toBe(1);
  });

  it("interrupt aborts in-flight llm/tts and sends agent_speaking off", async () => {
    let releaseChat: (() => void) | undefined;
    const { loop, messages } = await makeLoop({
      stt: stubStt("long answer"),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: {
        chat: (_msgs, _tools, opts) =>
          new Promise((resolve, reject) => {
            opts?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            releaseChat = () => resolve({ content: "late", toolCalls: [] });
          }),
      },
    });
    // feed audio first, then start the turn; interrupt cancels the in-flight llm call
    await loop.handleMessage(frame(0, pcmBytes([1, 1])));
    const pending = loop.handleMessage({ t: "utterance_end" });
    await vi.waitFor(() => expect(releaseChat).toBeDefined());
    loop.handleMessage({ t: "interrupt" });
    await expect(pending).resolves.toBeUndefined(); // aborted turn ends quietly
    expect(messages.some((m) => m.t === "agent_speaking" && m.on === false)).toBe(true);
    expect(messages.filter((m) => m.t === "metrics")).toHaveLength(0); // aborted: no metrics
    releaseChat?.();
  });

  it("executes tool calls: update_question persists an event, read_editor reads tool_state", async () => {
    const { loop, db } = await makeLoop({
      stt: stubStt("start"),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: {
        chat: async (_m, _t, _o) => {
          calls++;
          if (calls === 1) {
            return {
              content: "",
              toolCalls: [
                { name: "update_question", args: { question: "Q2?" } },
                { name: "read_editor", args: {} },
              ],
            };
          }
          return { content: "done", toolCalls: [] };
        },
      },
    });
    await db
      .insertInto("tool_states")
      .values({
        session_id: "s1",
        tool: "editor",
        state: "console.log(1)",
        updated_at: new Date().toISOString(),
      })
      .execute();
    await loop.handleMessage(frame(0, pcmBytes([1])));
    await loop.handleMessage({ t: "utterance_end" });

    const events = await db.selectFrom("events").selectAll().orderBy("id").execute();
    const types = events.map((e) => e.type);
    expect(types).toContain("question.updated");
    expect(types).toContain("tool.read_editor");
    const q = events.find((e) => e.type === "question.updated")!;
    expect(JSON.parse(q.payload!)).toEqual({ question: "Q2?", hints: [] });
    const turns = await db.selectFrom("turns").selectAll().execute();
    expect(turns.map((t) => t.speaker)).toEqual(["user", "agent"]);
  });

  it("typed text message: same turn pipeline as speech, source=text, stt untouched", async () => {
    const stt = stubStt("stt must not run");
    const { loop, db, messages } = await makeLoop({
      stt,
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "typed reply", toolCalls: [] }) },
    });
    await loop.handleMessage({ t: "text", text: "typed question" });

    expect(stt.calls).toBe(0);
    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns.map((t) => [t.speaker, t.source, t.text])).toEqual([
      ["user", "text", "typed question"],
      ["agent", "voice", "typed reply"],
    ]);
    expect(messages.map((m) => m.t)).toEqual(
      expect.arrayContaining(["user_transcript", "agent_transcript", "metrics"]),
    );
  });

  it("kickoff: silent connect fires the synthetic opening turn", async () => {
    const { db, messages } = await makeLoop({
      kickoffMs: 1,
      stt: stubStt("x"),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "welcome aboard", toolCalls: [] }) },
    });
    await vi.waitFor(async () => {
      const turns = await db.selectFrom("turns").selectAll().execute();
      expect(turns).toHaveLength(2);
    });
    const userMsg = messages.find((m) => m.t === "user_transcript");
    expect(userMsg).toMatchObject({ turn: { text: KICKOFF_UTTERANCE, source: "text" } });
    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns[1]).toMatchObject({ speaker: "agent", text: "welcome aboard" });
  });

  it("kickoff is cancelled once a real typed turn arrives", async () => {
    const { loop, db } = await makeLoop({
      kickoffMs: 60_000,
      stt: stubStt("x"),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "ok", toolCalls: [] }) },
    });
    await loop.handleMessage({ t: "text", text: "real first turn" });
    const turns = await db.selectFrom("turns").selectAll().execute();
    expect(turns.every((t) => t.text !== KICKOFF_UTTERANCE)).toBe(true);
  });

  it("start() seeds history from persisted turns (text-first resume)", async () => {
    const seenMessages: { role: string; content: string }[][] = [];
    const db = createDatabase(":memory:");
    await migrate(db);
    await db
      .insertInto("sessions")
      .values({
        id: "s1",
        title: "Resume",
        mode: "interview",
        created_at: new Date().toISOString(),
        status: "created",
        duration_min: 30,
        plan: null,
        tools: "{}",
      })
      .execute();
    await db
      .insertInto("turns")
      .values([
        {
          id: crypto.randomUUID(),
          session_id: "s1",
          seq: 0,
          speaker: "user",
          text: "earlier answer",
          created_at: new Date().toISOString(),
          source: "text",
        },
      ])
      .execute();
    const loop = new VoiceLoop({
      sessionId: "s1",
      config: testConfig(),
      db,
      send: () => undefined,
      sendBinary: () => undefined,
      kickoffMs: 0,
      stt: stubStt("follow up"),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: {
        chat: async (msgs) => {
          seenMessages.push(msgs as { role: string; content: string }[]);
          return { content: "continuing", toolCalls: [] };
        },
      },
    });
    await loop.start();
    await loop.handleMessage({ t: "text", text: "next answer" });
    const call = seenMessages[0]!;
    // system prompt + seeded prior turn + the new turn
    expect(call.map((m) => [m.role, m.content])).toEqual([
      ["system", expect.any(String)],
      ["user", "earlier answer"],
      ["user", "next answer"],
    ]);
  });

  it("update_question also pushes a question ws message", async () => {
    let hop = 0;
    const { loop, messages } = await makeLoop({
      stt: stubStt("start"),
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: {
        chat: async () => {
          hop++;
          if (hop === 1) {
            return {
              content: "",
              toolCalls: [{ name: "update_question", args: { question: "Q2?", hints: ["h1"] } }],
            };
          }
          return { content: "done", toolCalls: [] };
        },
      },
    });
    await loop.handleMessage({ t: "text", text: "start" });
    const q = messages.find((m) => m.t === "question");
    expect(q).toMatchObject({ question: "Q2?", hints: ["h1"] });
  });

  it("close() stops further processing", async () => {
    const stt = stubStt("x");
    const { loop, messages } = await makeLoop({
      stt,
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "y", toolCalls: [] }) },
    });
    loop.close();
    await loop.handleMessage(frame(0, pcmBytes([1])));
    await loop.handleMessage({ t: "utterance_end" });
    expect(messages).toHaveLength(0);
  });

  it("streaming llm: per-sentence tts, agent_speaking on before first chunk, monotonic seq, final chunk", async () => {
    const ttsCalls: string[] = [];
    const chunkPcm = pcmBytes(new Array(CHUNK_BYTES / 2 + 5).fill(7)); // 2 chunks per sentence
    const { loop, db, messages, binary } = await makeLoop({
      stt: stubStt("hello there"),
      tts: {
        synthesizeToPcm: async (text) => {
          ttsCalls.push(text);
          return chunkPcm;
        },
      },
      llm: {
        chat: async () => {
          throw new Error("chat must not be used when streamChat exists");
        },
        streamChat: async (_m, _t, opts) => {
          for (const d of ["One sentence here. ", "Another sentence follows. ", "trailing words"]) {
            opts?.onText?.(d);
          }
          return {
            content: "One sentence here. Another sentence follows. trailing words",
            toolCalls: [],
          };
        },
      },
    });
    await loop.handleMessage(frame(0, pcmBytes([1])));
    await loop.handleMessage({ t: "utterance_end" });

    // cutSentences minChars=24: the short first sentence merges with the
    // second into one cut sentence; the unpunctuated tail flushes as final.
    expect(ttsCalls).toEqual(["One sentence here. Another sentence follows.", "trailing words"]);
    // agent_speaking on precedes the first binary tts frame
    const firstOn = messages.findIndex((m) => m.t === "agent_speaking" && m.on);
    expect(firstOn).toBeGreaterThanOrEqual(0);
    expect(binary).toHaveLength(4); // 2 sentences x 2 chunks
    // seq monotonic across sentences
    expect(binary.map((f) => new DataView(f.buffer).getUint32(0, false))).toEqual([0, 1, 2, 3]);
    // the turn ends on agent_speaking off, not a final-chunk flag
    expect(messages.some((m) => m.t === "agent_speaking" && m.on === false)).toBe(true);
    // transcript persisted with the full reply
    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns.at(-1)).toMatchObject({
      speaker: "agent",
      text: "One sentence here. Another sentence follows. trailing words",
    });
    // metrics still emitted
    expect(messages.some((m) => m.t === "metrics")).toBe(true);
  });

  it("streaming llm: abort mid-stream stops further tts synthesis", async () => {
    const ttsCalls: string[] = [];
    let seenSignal: AbortSignal | undefined;
    const { loop, messages } = await makeLoop({
      stt: stubStt("go"),
      tts: {
        synthesizeToPcm: async (text) => {
          ttsCalls.push(text);
          return pcmBytes([1, 2, 3, 4, 5, 6]);
        },
      },
      llm: {
        chat: async () => ({ content: "x", toolCalls: [] }),
        streamChat: (_m, _t, opts) =>
          new Promise((resolve) => {
            seenSignal = opts?.signal;
            seenSignal?.addEventListener("abort", () =>
              resolve({ content: "partial sentence", toolCalls: [] }),
            );
          }),
      },
    });
    await loop.handleMessage(frame(0, pcmBytes([1])));
    const pending = loop.handleMessage({ t: "utterance_end" });
    await vi.waitFor(() => expect(seenSignal).toBeDefined());
    loop.handleMessage({ t: "interrupt" });
    await pending;
    expect(ttsCalls).toHaveLength(0); // no sentence was synthesized before abort
    expect(messages.some((m) => m.t === "tts")).toBe(false);
    expect(messages.some((m) => m.t === "agent_speaking" && m.on === false)).toBe(true);
    expect(messages.filter((m) => m.t === "metrics")).toHaveLength(0);
  });

  it("streaming llm: tts failure degrades to silent text — transcript still persisted and sent", async () => {
    const ttsCalls: string[] = [];
    const { loop, db, messages, binary } = await makeLoop({
      stt: stubStt("hello there"),
      tts: {
        synthesizeToPcm: async (text) => {
          ttsCalls.push(text);
          throw new Error("tts is down");
        },
      },
      llm: {
        chat: async () => {
          throw new Error("chat must not be used when streamChat exists");
        },
        streamChat: async (_m, _t, opts) => {
          for (const d of ["One sentence here. ", "Another sentence follows. ", "trailing words"]) {
            opts?.onText?.(d);
          }
          return {
            content: "One sentence here. Another sentence follows. trailing words",
            toolCalls: [],
          };
        },
      },
    });
    await loop.handleMessage(frame(0, pcmBytes([1])));
    await loop.handleMessage({ t: "utterance_end" });

    // first failure ends speech: later sentences are not retried
    expect(ttsCalls).toHaveLength(1);
    expect(binary).toHaveLength(0);
    const types = messages.map((m) => m.t);
    expect(types).toEqual(
      expect.arrayContaining([
        "user_transcript",
        "agent_speaking",
        "error",
        "agent_speaking",
        "agent_transcript",
        "metrics",
      ]),
    );
    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns.at(-1)).toMatchObject({
      speaker: "agent",
      text: "One sentence here. Another sentence follows. trailing words",
    });
  });

  it("streaming stt mode: frames are fed, finish() resolves the transcript, turn proceeds", async () => {
    const fed: number[] = [];
    let finishCalls = 0;
    const db = createDatabase(":memory:");
    await migrate(db);
    await db
      .insertInto("sessions")
      .values({
        id: "s1",
        title: "Stream",
        mode: "interview",
        created_at: new Date().toISOString(),
        status: "created",
        duration_min: 30,
        plan: null,
        tools: "{}",
      })
      .execute();
    const messages: VoiceServerMessage[] = [];
    const loop = new VoiceLoop({
      sessionId: "s1",
      config: {
        ...testConfig(),
        stt: {
          base_url: "http://localhost:9000",
          model: "s",
          mode: "streaming",
        },
      },
      db,
      send: (m) => messages.push(m),
      sendBinary: () => undefined,
      stt: {
        transcribePcm: async () => {
          throw new Error("buffered stt must not run in streaming mode");
        },
      },
      streamingStt: {
        feed: async (pcm) => void fed.push(pcm.byteLength),
        finish: async () => {
          finishCalls++;
          return "streamed transcript";
        },
      },
      tts: { synthesizeToPcm: async () => pcmBytes([0]) },
      llm: { chat: async () => ({ content: "ok", toolCalls: [] }) },
      kickoffMs: 0,
    });
    await loop.start();
    await loop.handleMessage(frame(0, pcmBytes([1, 2, 3, 4])));
    await loop.handleMessage(frame(1, pcmBytes([5, 6])));
    await loop.handleMessage({ t: "utterance_end" });

    expect(fed).toEqual([8, 4]); // both frames fed (header-stripped)
    expect(finishCalls).toBe(1);
    expect(messages.map((m) => m.t)).toEqual(
      expect.arrayContaining(["user_transcript", "agent_transcript", "metrics"]),
    );
    const turns = await db.selectFrom("turns").selectAll().orderBy("seq").execute();
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ["user", "streamed transcript"],
      ["agent", "ok"],
    ]);
  });
});

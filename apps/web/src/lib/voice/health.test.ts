import { beforeEach, describe, expect, it } from "vitest";

import { $voiceHealth, pushVoiceHealth } from "./health";

describe("voice health log", () => {
  beforeEach(() => $voiceHealth.set([]));

  it("appends timestamped events", () => {
    pushVoiceHealth({ kind: "engine.boot", ok: true, ms: 42, detail: "stt" });
    const events = $voiceHealth.get();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("engine.boot");
    expect(events[0]?.ms).toBe(42);
    expect(events[0]?.at).toBeTypeOf("number");
  });

  it("mirrors to window.voiceHealth in dev", () => {
    pushVoiceHealth({ kind: "tts.speak", ok: false, ms: 10, detail: "boom" });
    const w = globalThis as { voiceHealth?: unknown[] };
    expect(w.voiceHealth).toEqual($voiceHealth.get());
  });

  it("caps the ring at 300 events", () => {
    for (let i = 0; i < 320; i++) {
      pushVoiceHealth({ kind: "tts.speak", ok: true, ms: i });
    }
    const events = $voiceHealth.get();
    expect(events).toHaveLength(300);
    expect(events.at(-1)?.ms).toBe(319);
  });
});

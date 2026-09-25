import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { ConfigSchema, describeConfigError } from "./config";
import { SessionSchema, TurnSchema } from "./session";
import { InterviewPlanSchema } from "./plan";
import { ReportSchema } from "./report";

const validConfig = {
  server: { port: 8080 },
  llm: {
    provider: "mock",
    base_url: "http://localhost:9000/v1",
    model: "mock-chat",
  },
  stt: {
    base_url: "http://localhost:9000/v1",
    model: "mock-stt",
    mode: "buffered",
  },
  tts: {
    base_url: "http://localhost:9000/v1",
    model: "mock-tts",
    voice: "alloy",
  },
  files: { db_path: "data/di.db", log_path: "data/di.log", data_dir: "data" },
};

describe("ConfigSchema", () => {
  it("accepts a valid config", () => {
    expect(v.safeParse(ConfigSchema, validConfig).success).toBe(true);
  });

  it("rejects a bad port with a named key path", () => {
    const r = v.safeParse(ConfigSchema, {
      ...validConfig,
      server: { port: 0 },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(describeConfigError(r.issues)).toContain("server.port");
    }
  });

  it("rejects an invalid stt mode", () => {
    const r = v.safeParse(ConfigSchema, {
      ...validConfig,
      stt: { ...validConfig.stt, mode: "stream" },
    });
    expect(r.success).toBe(false);
  });
});

describe("SessionSchema", () => {
  it("accepts a valid session", () => {
    const s = {
      id: crypto.randomUUID(),
      title: "Backend screen",
      mode: "interview",
      created_at: new Date().toISOString(),
      status: "created",
      duration_min: 30,
    };
    expect(v.safeParse(SessionSchema, s).success).toBe(true);
  });

  it("rejects out-of-range duration", () => {
    const s = {
      id: crypto.randomUUID(),
      title: "x",
      mode: "interview",
      created_at: new Date().toISOString(),
      status: "created",
      duration_min: 3,
    };
    expect(v.safeParse(SessionSchema, s).success).toBe(false);
  });
});

describe("TurnSchema", () => {
  it("requires iso timestamps and known speakers", () => {
    const t = {
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      seq: 0,
      speaker: "user",
      text: "hello",
      created_at: new Date().toISOString(),
      source: "text",
    };
    expect(v.safeParse(TurnSchema, t).success).toBe(true);
    expect(v.safeParse(TurnSchema, { ...t, created_at: "not-a-date" }).success).toBe(false);
  });
});

describe("InterviewPlanSchema", () => {
  it("accepts a minimal plan", () => {
    const p = {
      type: "system design",
      duration_min: 45,
      tone: "friendly",
      difficulty: "medium",
      language: "en",
      focus_areas: [{ tag: "caching" }],
      questions: [{ id: crypto.randomUUID(), text: "Design a URL shortener" }],
    };
    expect(v.safeParse(InterviewPlanSchema, p).success).toBe(true);
  });
});

describe("ReportSchema", () => {
  it("accepts a report with evidence quotes", () => {
    const r = {
      session_id: crypto.randomUUID(),
      overall_score: 7.5,
      coverage_pct: 80,
      competencies: [
        {
          name: "system design",
          score: 7,
          evidence: [
            {
              quote: "I would shard by user id",
              turn_seq: 3,
              verdict: "worked",
            },
          ],
        },
      ],
      model_answers: [],
      generated_at: new Date().toISOString(),
    };
    expect(v.safeParse(ReportSchema, r).success).toBe(true);
  });

  it("rejects scores above 10", () => {
    const r = {
      session_id: crypto.randomUUID(),
      overall_score: 11,
      coverage_pct: 80,
      competencies: [],
      model_answers: [],
      generated_at: new Date().toISOString(),
    };
    expect(v.safeParse(ReportSchema, r).success).toBe(false);
  });
});

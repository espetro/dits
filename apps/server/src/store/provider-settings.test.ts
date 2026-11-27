import { describe, expect, it } from "vitest";
import { ServerProviderSettingsReadModelSchema } from "@di/shared";
import * as v from "valibot";
import { createDatabase, migrate } from "./db";
import {
  clearProviderSettings,
  clearProviderSettingsSection,
  loadProviderSettingsForResolution,
  loadProviderSettingsReadModel,
  saveProviderSettings,
} from "./provider-settings";

const SECRET = "sk-provider-settings-test-secret";

const settings = {
  llm: {
    provider: "openai" as const,
    base_url: "https://api.openai.com/v1",
    api_key: SECRET,
    model: "gpt-4.1-mini",
  },
  stt: {
    provider: "remote" as const,
    base_url: "http://localhost:9000/v1",
    api_key: SECRET,
    model: "whisper-1",
  },
  tts: {
    provider: "builtin" as const,
  },
};

const migratedDb = async () => {
  const db = createDatabase(":memory:");
  await migrate(db);
  return db;
};

describe("provider settings store", () => {
  it("round-trips sparse settings with secrets for internal resolution", async () => {
    const db = await migratedDb();
    await saveProviderSettings(db, settings);

    const stored = await loadProviderSettingsForResolution(db);
    expect(stored?.settings).toEqual(settings);
    expect(stored?.settings.llm?.api_key).toBe(SECRET);
    expect(stored?.created_at).toEqual(expect.any(String));
    expect(stored?.updated_at).toEqual(expect.any(String));
  });

  it("returns null before settings are saved", async () => {
    const db = await migratedDb();
    expect(await loadProviderSettingsForResolution(db)).toBeNull();
    expect(await loadProviderSettingsReadModel(db)).toBeNull();
  });

  it("read model redacts every api key and validates against the shared contract", async () => {
    const db = await migratedDb();
    await saveProviderSettings(db, settings);

    const view = await loadProviderSettingsReadModel(db);
    expect(view?.settings.llm?.api_key_set).toBe(true);
    expect(view?.settings.stt?.api_key_set).toBe(true);
    expect(view?.settings.tts?.api_key_set).toBe(false);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain('"api_key"');
    expect(v.safeParse(ServerProviderSettingsReadModelSchema, view).success).toBe(true);
  });

  it("save is replacement semantics, not a deep merge", async () => {
    const db = await migratedDb();
    await saveProviderSettings(db, settings);
    await saveProviderSettings(db, { llm: { model: "replacement-model" } });

    const stored = await loadProviderSettingsForResolution(db);
    expect(stored?.settings).toEqual({ llm: { model: "replacement-model" } });
    expect(stored?.settings.stt).toBeUndefined();
    expect(stored?.settings.llm?.api_key).toBeUndefined();
  });

  it("keeps created_at stable across replacement saves", async () => {
    const db = await migratedDb();
    const first = await saveProviderSettings(db, settings);
    const second = await saveProviderSettings(db, { tts: { voice: "alloy" } });
    expect(second.created_at).toBe(first.created_at);
  });

  it("clears all settings", async () => {
    const db = await migratedDb();
    expect(await clearProviderSettings(db)).toBe(false);
    await saveProviderSettings(db, settings);
    expect(await clearProviderSettings(db)).toBe(true);
    expect(await loadProviderSettingsForResolution(db)).toBeNull();
  });

  it("clears one section so it can fall back to config", async () => {
    const db = await migratedDb();
    await saveProviderSettings(db, settings);

    expect(await clearProviderSettingsSection(db, "stt")).toBe(true);
    const stored = await loadProviderSettingsForResolution(db);
    expect(stored?.settings.stt).toBeUndefined();
    expect(stored?.settings.llm).toEqual(settings.llm);
    expect(await clearProviderSettingsSection(db, "stt")).toBe(false);
  });

  it("drops the singleton row when clearing the last section", async () => {
    const db = await migratedDb();
    await saveProviderSettings(db, { llm: { model: "only" } });
    expect(await clearProviderSettingsSection(db, "llm")).toBe(true);
    expect(await loadProviderSettingsForResolution(db)).toBeNull();
  });

  it("corrupt stored payloads fail without echoing payload content", async () => {
    const db = await migratedDb();
    const now = new Date().toISOString();
    await db
      .insertInto("provider_settings")
      .values({
        id: 1,
        settings: `{"llm":{"api_key":"${SECRET}",bad`,
        created_at: now,
        updated_at: now,
      })
      .execute();

    try {
      await loadProviderSettingsForResolution(db);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/invalid JSON/);
      expect((err as Error).message).not.toContain(SECRET);
    }
  });
});

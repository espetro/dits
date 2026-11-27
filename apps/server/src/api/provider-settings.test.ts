import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createDatabase, migrate } from "../store/db";
import { loadProviderSettingsForResolution } from "../store/provider-settings";
import { apiRoutes } from "./routes";

async function makeApp(reportLlmFactory?: () => Promise<never>) {
  const db = createDatabase(":memory:");
  await migrate(db);
  const app = new Hono();
  app.route("/v1", apiRoutes(db, { testMode: false, reportLlmFactory }));
  return { app, db };
}

function patch(app: Hono, section: string, body: unknown) {
  return app.request(`/v1/provider-settings/${section}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/v1/provider-settings", () => {
  it("returns 404 before settings exist", async () => {
    const { app } = await makeApp();
    const res = await app.request("/v1/provider-settings");
    expect(res.status).toBe(404);
  });

  it("saves redacted llm settings without exposing the raw key", async () => {
    const { app } = await makeApp();
    const res = await patch(app, "llm", {
      provider: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-test-secret",
      model: "gpt-5",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      settings: { llm: Record<string, unknown> };
      created_at: string;
      updated_at: string;
    };
    expect(json.settings.llm).toMatchObject({
      provider: "openai",
      base_url: "https://api.openai.com/v1",
      model: "gpt-5",
      api_key_set: true,
    });
    expect(json.settings.llm.api_key).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("sk-test-secret");
  });

  it("field-merges patches so omitting api_key preserves the stored key", async () => {
    const { app, db } = await makeApp();
    await patch(app, "llm", {
      provider: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-test-secret",
      model: "gpt-5",
    });
    const res = await patch(app, "llm", { model: "gpt-5-mini" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { settings: { llm: Record<string, unknown> } };
    expect(json.settings.llm).toMatchObject({
      base_url: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      api_key_set: true,
    });
    const stored = await loadProviderSettingsForResolution(db);
    expect(stored?.settings.llm).toMatchObject({
      api_key: "sk-test-secret",
      model: "gpt-5-mini",
    });
  });

  it("null clears a stored optional key and section delete removes overrides", async () => {
    const { app, db } = await makeApp();
    await patch(app, "tts", {
      provider: "remote",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-tts-secret",
      model: "tts-1",
      voice: "alloy",
    });
    const cleared = await patch(app, "tts", { api_key: null });
    expect(cleared.status).toBe(200);
    expect(
      ((await cleared.json()) as { settings: { tts: { api_key_set: boolean } } }).settings.tts
        .api_key_set,
    ).toBe(false);
    let stored = await loadProviderSettingsForResolution(db);
    expect(stored?.settings.tts?.api_key).toBeNull();

    const del = await app.request("/v1/provider-settings/tts", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()) as { deleted: boolean }).toEqual({ deleted: true });
    stored = await loadProviderSettingsForResolution(db);
    expect(stored?.settings.tts).toBeUndefined();
  });

  it("tests the effective llm through the server-side route", async () => {
    const { app } = await makeApp(
      async () =>
        ({
          chat: async () => ({ content: "ok", toolCalls: [] }),
        }) as never,
    );
    const res = await app.request("/v1/provider-settings/test/llm", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string; ms: number };
    expect(json.text).toBe("ok");
    expect(json.ms).toBeGreaterThanOrEqual(0);
  });

  it("reports llm test failures without hiding them as success", async () => {
    const { app } = await makeApp(
      async () =>
        ({
          chat: async () => {
            throw new Error("upstream 401");
          },
        }) as never,
    );
    const res = await app.request("/v1/provider-settings/test/llm", { method: "POST" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream 401");
  });

  it("rejects invalid sections, bodies, and field shapes", async () => {
    const { app } = await makeApp();
    expect((await patch(app, "nope", {})).status).toBe(404);
    expect((await patch(app, "llm", { base_url: "not-a-url" })).status).toBe(400);
    expect((await patch(app, "llm", [])).status).toBe(400);
  });
});

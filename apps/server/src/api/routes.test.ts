import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { apiRoutes } from "./routes";
import { createDatabase, migrate } from "../store/db";

async function makeApp(testMode = false) {
  const db = createDatabase(":memory:");
  await migrate(db);
  const app = new Hono();
  app.route("/v1", apiRoutes(db, { testMode }));
  return app;
}

async function makeSession(app: Hono): Promise<string> {
  const res = await app.request("/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "t", mode: "interview", duration_min: 30 }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("tool state routes", () => {
  it("returns empty tool state before any push", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const res = await app.request(`/v1/sessions/${id}/tools`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ editor: "", whiteboard: "" });
  });

  it("stores and updates tool state via PUT", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const put = (body: unknown) =>
      app.request(`/v1/sessions/${id}/tools`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const res = await put({ editor: "def solve(): pass", whiteboard: "{}" });
    expect(res.status).toBe(200);
    const res2 = await app.request(`/v1/sessions/${id}/tools`);
    expect(await res2.json()).toEqual({
      editor: "def solve(): pass",
      whiteboard: "{}",
    });
    await put({ editor: "updated", whiteboard: "" });
    const res3 = await app.request(`/v1/sessions/${id}/tools`);
    expect(await res3.json()).toEqual({ editor: "updated", whiteboard: "" });
  });

  it("rejects invalid payloads and unknown sessions", async () => {
    const app = await makeApp();
    const id = await makeSession(app);
    const bad = await app.request(`/v1/sessions/${id}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editor: 42 }),
    });
    expect(bad.status).toBe(400);
    const missing = await app.request(`/v1/sessions/${crypto.randomUUID()}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editor: "", whiteboard: "" }),
    });
    expect(missing.status).toBe(404);
  });
});

describe("test mode smoke route", () => {
  it("returns ok with latency when test mode is on", async () => {
    const app = await makeApp(true);
    const res = await app.request("/v1/test/smoke");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      latency_ms: number;
      session_id: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.latency_ms).toBe("number");
    expect(body.session_id).toBeTruthy();
  });

  it("404s when test mode is off", async () => {
    const app = await makeApp(false);
    const res = await app.request("/v1/test/smoke");
    expect(res.status).toBe(404);
  });
});

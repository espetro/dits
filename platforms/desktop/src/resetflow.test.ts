import { describe, expect, it } from "bun:test";

import { createResetFlow, type ResetView } from "./resetflow";
import { dashboardHtml } from "./dashboard";

function setup(res: () => Promise<{ ok: boolean; json: () => Promise<{ error?: string }> }>) {
  const calls: string[] = [];
  const views: ResetView[] = [];
  let refreshed = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const flow = createResetFlow({
    fetch: async (path, init) => {
      calls.push(`${init.method} ${path}`);
      await gate;
      return res();
    },
    render: (v) => views.push(v),
    afterReset: () => void refreshed++,
  });
  return { flow, calls, views, release, refreshed: () => refreshed };
}

const ok = async () => ({ ok: true, json: async () => ({}) });

describe("reset flow", () => {
  it("first click only arms confirm, no request", async () => {
    const t = setup(ok);
    await t.flow.click();
    expect(t.calls).toEqual([]);
    expect(t.flow.view()).toMatchObject({
      phase: "confirm",
      label: "yes, erase everything",
      cancelHidden: false,
    });
  });

  it("cancel returns to idle without a request", async () => {
    const t = setup(ok);
    await t.flow.click();
    t.flow.cancel();
    expect(t.flow.view()).toMatchObject({
      phase: "idle",
      label: "reset all data…",
      cancelHidden: true,
      message: "",
    });
    expect(t.calls).toEqual([]);
  });

  it("cancel is a no-op outside confirm", () => {
    const t = setup(ok);
    t.flow.cancel();
    expect(t.views).toEqual([]);
  });

  it("second click posts /api/reset and reports success", async () => {
    const t = setup(ok);
    t.release();
    await t.flow.click();
    await t.flow.click();
    expect(t.calls).toEqual(["POST /api/reset"]);
    expect(t.flow.view()).toMatchObject({
      phase: "done",
      message: "all data erased",
      disabled: false,
    });
    expect(t.refreshed()).toBe(1);
  });

  it("surfaces the server error message", async () => {
    const t = setup(async () => ({ ok: false, json: async () => ({ error: "disk full" }) }));
    t.release();
    await t.flow.click();
    await t.flow.click();
    expect(t.flow.view()).toMatchObject({ phase: "error", message: "reset failed: disk full" });
    expect(t.refreshed()).toBe(1);
  });

  it("falls back to a generic message on a non-json failure", async () => {
    const t = setup(async () => ({
      ok: false,
      json: async () => {
        throw new Error("bad json");
      },
    }));
    t.release();
    await t.flow.click();
    await t.flow.click();
    expect(t.flow.view().message).toBe("reset failed: reset failed");
  });

  it("reports an unreachable control api", async () => {
    const t = setup(async () => {
      throw new Error("down");
    });
    t.release();
    await t.flow.click();
    await t.flow.click();
    expect(t.flow.view()).toMatchObject({
      phase: "error",
      message: "reset failed: control api unreachable",
    });
  });

  it("guards clicks while running (one request, button disabled)", async () => {
    const t = setup(ok);
    await t.flow.click();
    const pending = t.flow.click();
    expect(t.flow.view()).toMatchObject({
      phase: "running",
      disabled: true,
      message: "resetting…",
    });
    await t.flow.click();
    await t.flow.click();
    t.flow.cancel();
    expect(t.flow.view().phase).toBe("running");
    t.release();
    await pending;
    expect(t.calls).toEqual(["POST /api/reset"]);
  });

  it("can be armed again after finishing", async () => {
    const t = setup(ok);
    t.release();
    await t.flow.click();
    await t.flow.click();
    await t.flow.click();
    expect(t.flow.view().phase).toBe("confirm");
  });
});

describe("dashboard inlines the same state machine", () => {
  it("embeds the flow source, evaluated in the webview script", () => {
    const html = dashboardHtml();
    expect(html).toContain("const createResetFlow = ");
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    const fnSrc = script.match(/const createResetFlow = ([\s\S]*?);\n  const resetFlow/)?.[1] ?? "";
    const factory = new Function(`return (${fnSrc})`)() as typeof createResetFlow;
    const views: ResetView[] = [];
    const flow = factory({
      fetch: ok as never,
      render: (v) => views.push(v),
      afterReset: () => {},
    });
    void flow.click();
    expect(views[0]?.phase).toBe("confirm");
  });
});

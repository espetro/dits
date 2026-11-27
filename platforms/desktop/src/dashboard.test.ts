import { describe, expect, it } from "bun:test";

import { dashboardHtml } from "./dashboard";

describe("dashboardHtml reset control", () => {
  const html = dashboardHtml();

  it("renders a destructive reset button with a cancel step", () => {
    expect(html).toContain('id="reset"');
    expect(html).toContain('id="resetcancel"');
    expect(html).toContain("yes, erase everything");
  });

  it("posts to /api/reset and surfaces the result", () => {
    expect(html).toContain('fetch("/api/reset", { method: "POST" })');
    expect(html).toContain("all data erased");
    expect(html).toContain("reset failed");
  });

  it("emits a parseable inline script", () => {
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });
});

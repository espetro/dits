import { describe, expect, it } from "vitest";
import { envBool, envNum, envStr } from "./env";

describe("env helpers", () => {
  it("envStr returns the fallback when unset or empty", () => {
    expect(envStr("VITE_X", "dflt", {})).toBe("dflt");
    expect(envStr("VITE_X", "dflt", { VITE_X: "" })).toBe("dflt");
  });

  it("envStr returns the override when set", () => {
    expect(envStr("VITE_X", "dflt", { VITE_X: "custom" })).toBe("custom");
  });

  it("envNum parses numeric strings and falls back on junk", () => {
    expect(envNum("VITE_X", 42, {})).toBe(42);
    expect(envNum("VITE_X", 42, { VITE_X: "1000" })).toBe(1000);
    expect(envNum("VITE_X", 42, { VITE_X: "abc" })).toBe(42);
    expect(envNum("VITE_X", 42, { VITE_X: "" })).toBe(42);
  });

  it("envBool treats 'true'/'1' as true and everything else as false", () => {
    expect(envBool("VITE_X", false, {})).toBe(false);
    expect(envBool("VITE_X", true, {})).toBe(true);
    expect(envBool("VITE_X", false, { VITE_X: "true" })).toBe(true);
    expect(envBool("VITE_X", false, { VITE_X: "1" })).toBe(true);
    expect(envBool("VITE_X", true, { VITE_X: "false" })).toBe(false);
    expect(envBool("VITE_X", true, { VITE_X: "0" })).toBe(false);
  });
});

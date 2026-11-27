import { describe, expect, it } from "bun:test";

import { normalizeDesktopVersion } from "./version";

describe("normalizeDesktopVersion", () => {
  it("keeps an exact release tag semver without the v prefix", () => {
    expect(normalizeDesktopVersion("v2026.43.0")).toBe("2026.43.0");
    expect(normalizeDesktopVersion("2026.43.1")).toBe("2026.43.1");
  });

  it("derives a numeric version from git describe between tags", () => {
    expect(normalizeDesktopVersion("v2026.43.0-81-g3cb5888")).toBe("2026.43.81");
    expect(normalizeDesktopVersion("2026.43.2-4-gabcdef1")).toBe("2026.43.6");
  });

  it("ignores dirty suffixes before deriving", () => {
    expect(normalizeDesktopVersion("v2026.43.0-dirty")).toBe("2026.43.0");
    expect(normalizeDesktopVersion("v2026.43.0-81-g3cb5888-dirty")).toBe("2026.43.81");
  });

  it("falls back for unreleased commit-only or malformed values", () => {
    expect(normalizeDesktopVersion("3cb5888", "0.1.0")).toBe("0.1.0");
    expect(normalizeDesktopVersion("not-a-version", "0.1.0")).toBe("0.1.0");
    expect(normalizeDesktopVersion(undefined, "0.1.0")).toBe("0.1.0");
  });
});

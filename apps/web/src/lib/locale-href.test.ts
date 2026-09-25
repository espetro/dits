import { describe, expect, it } from "vitest";

import { localeFromPathname, replaceLocale, withLocale } from "./locale-href";

describe("localeFromPathname", () => {
  it("returns en for the bare root", () => {
    expect(localeFromPathname("/")).toBe("en");
  });

  it("returns en for unprefixed paths", () => {
    expect(localeFromPathname("/setup")).toBe("en");
    expect(localeFromPathname("/interview/abc")).toBe("en");
  });

  it("detects a valid locale prefix", () => {
    expect(localeFromPathname("/es")).toBe("es");
    expect(localeFromPathname("/es/setup")).toBe("es");
    expect(localeFromPathname("/pt-BR/history")).toBe("pt-BR");
    expect(localeFromPathname("/zh-CN/report/x")).toBe("zh-CN");
  });

  it("falls back to en for unknown segments", () => {
    expect(localeFromPathname("/xx/setup")).toBe("en");
    expect(localeFromPathname("/setup/es")).toBe("en");
  });
});

describe("withLocale", () => {
  it("leaves en unprefixed", () => {
    expect(withLocale("en", "/setup")).toBe("/setup");
    expect(withLocale("en", "/")).toBe("/");
  });

  it("prefixes other locales", () => {
    expect(withLocale("es", "/setup")).toBe("/es/setup");
    expect(withLocale("fr", "/")).toBe("/fr");
    expect(withLocale("pt-BR", "/interview/1")).toBe("/pt-BR/interview/1");
  });
});

describe("replaceLocale", () => {
  it("swaps the prefix on prefixed paths", () => {
    expect(replaceLocale("/es/setup", "fr")).toBe("/fr/setup");
    expect(replaceLocale("/fr/interview/abc", "pt-BR")).toBe("/pt-BR/interview/abc");
  });

  it("drops the prefix when target is en", () => {
    expect(replaceLocale("/es/setup", "en")).toBe("/setup");
    expect(replaceLocale("/fr", "en")).toBe("/");
  });

  it("adds the prefix when source is unprefixed en", () => {
    expect(replaceLocale("/setup", "es")).toBe("/es/setup");
    expect(replaceLocale("/interview/abc", "ja")).toBe("/ja/interview/abc");
  });

  it("handles the bare root", () => {
    expect(replaceLocale("/", "es")).toBe("/es");
    expect(replaceLocale("/es", "en")).toBe("/");
    expect(replaceLocale("/es", "fr")).toBe("/fr");
  });

  it("normalizes trailing slashes", () => {
    expect(replaceLocale("/es/setup/", "en")).toBe("/setup");
    expect(replaceLocale("/setup/", "es")).toBe("/es/setup");
  });

  it("round-trips through every locale", () => {
    for (const target of ["en", "es", "fr", "de", "ja", "pt-BR", "zh-CN", "ko", "it", "ar"]) {
      expect(replaceLocale("/es/setup", target)).toBe(
        target === "en" ? "/setup" : `/${target}/setup`,
      );
    }
  });
});

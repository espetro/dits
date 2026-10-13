import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { RELAY_PATH, RelayQuerySchema, relayUrlPath } from "./relay";

describe("RelayQuerySchema", () => {
  it("accepts http and https urls", () => {
    for (const url of ["http://localhost:8317/v1", "https://openrouter.ai/api/v1"]) {
      const parsed = v.safeParse(RelayQuerySchema, { url });
      expect(parsed.success, url).toBe(true);
    }
  });

  it("rejects non-http schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/pub",
      "data:text/plain,hi",
      "ws://localhost:8317",
    ]) {
      const parsed = v.safeParse(RelayQuerySchema, { url });
      expect(parsed.success, url).toBe(false);
    }
  });

  it("reports a clear message for a bad scheme", () => {
    const parsed = v.safeParse(RelayQuerySchema, { url: "file:///etc/passwd" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues[0]?.message).toBe("relay url must use http or https");
    }
  });

  it("rejects malformed urls", () => {
    expect(v.safeParse(RelayQuerySchema, { url: "not a url" }).success).toBe(false);
    expect(v.safeParse(RelayQuerySchema, { url: "" }).success).toBe(false);
    expect(v.safeParse(RelayQuerySchema, {}).success).toBe(false);
    expect(v.safeParse(RelayQuerySchema, "http://x/").success).toBe(false);
  });
});

describe("relayUrlPath", () => {
  it("encodes the upstream as the url query param", () => {
    expect(relayUrlPath("https://openrouter.ai/api/v1")).toBe(
      `${RELAY_PATH}?url=${encodeURIComponent("https://openrouter.ai/api/v1")}`,
    );
  });

  it("fully encodes upstream query and fragment so it round-trips", () => {
    const upstream = "http://x/p?a=1&b=2#frag";
    const path = relayUrlPath(upstream);
    const query = path.slice(path.indexOf("?") + 1);
    const parsed = new URLSearchParams(query);
    expect(parsed.get("url")).toBe(upstream);
    expect([...parsed.keys()]).toEqual(["url"]);
    expect(query).not.toMatch(/&(?!#*[0-9A-Fa-f]{2})/);
  });

  it("round-trips through the schema", () => {
    const upstream = "http://localhost:9000/v1/chat/completions?x=1&y=%2F#z";
    const path = relayUrlPath(upstream);
    const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(v.safeParse(RelayQuerySchema, Object.fromEntries(query)).success).toBe(true);
  });

  it("throws on empty input", () => {
    expect(() => relayUrlPath("")).toThrow();
  });
});

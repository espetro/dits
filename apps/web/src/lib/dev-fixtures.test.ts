// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixturesMode, hasSeedMarker, maybeSeedFixtures } from "./dev-fixtures";

// vi.mock is hoisted above the import, so the mock still applies even though
// the import appears first. dev-fixtures reads import.meta.env at call time.
const seedFixtures = vi.hoisted(() => vi.fn(async () => []));

vi.mock("./dev-fixtures-impl", () => ({ seedFixtures }));

describe("dev-fixtures gating", () => {
  beforeEach(() => {
    localStorage.clear();
    seedFixtures.mockClear();
  });

  it("returns null when the URL has no fixtures param", () => {
    window.history.replaceState(null, "", "/");
    expect(fixturesMode()).toBeNull();
  });

  it("maps ?fixtures=1 to seed and ?fixtures=reset to reset", () => {
    window.history.replaceState(null, "", "/?fixtures=1");
    expect(fixturesMode()).toBe("seed");
    window.history.replaceState(null, "", "/?fixtures=reset");
    expect(fixturesMode()).toBe("reset");
  });

  it("seeds once, then skips on a second boot (idempotence marker)", async () => {
    window.history.replaceState(null, "", "/?fixtures=1");
    await maybeSeedFixtures();
    expect(seedFixtures).toHaveBeenCalledTimes(1);
    expect(hasSeedMarker()).toBe(true);

    await maybeSeedFixtures();
    expect(seedFixtures).toHaveBeenCalledTimes(1);
  });

  it("?fixtures=reset reseeds even when the marker exists", async () => {
    window.history.replaceState(null, "", "/?fixtures=1");
    await maybeSeedFixtures();
    expect(seedFixtures).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, "", "/?fixtures=reset");
    await maybeSeedFixtures();
    expect(seedFixtures).toHaveBeenCalledTimes(2);
  });

  it("does nothing without the URL param", async () => {
    window.history.replaceState(null, "", "/");
    await maybeSeedFixtures();
    expect(seedFixtures).not.toHaveBeenCalled();
  });
});

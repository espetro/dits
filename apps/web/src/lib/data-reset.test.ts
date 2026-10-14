import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLocalStorageKeys, deleteServerSessions } from "./data-reset";
import { $serverReachable } from "./runtime";

afterEach(() => {
  vi.unstubAllGlobals();
  $serverReachable.set(null);
});

describe("clearLocalStorageKeys", () => {
  it("removes di.* and di:* keys and leaves foreign keys alone", () => {
    localStorage.setItem("di.provider-profile", "{}");
    localStorage.setItem("di:flag", "1");
    localStorage.setItem("theme", "dark");
    clearLocalStorageKeys();
    expect(localStorage.getItem("di.provider-profile")).toBeNull();
    expect(localStorage.getItem("di:flag")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    localStorage.removeItem("theme");
  });
});

describe("deleteServerSessions", () => {
  it("does nothing when the server is unreachable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    $serverReachable.set(false);
    await deleteServerSessions();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes every listed session", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify([{ id: "a" }, { id: "b" }])),
    );
    vi.stubGlobal("fetch", fetchMock);
    $serverReachable.set(true);
    await deleteServerSessions();
    const deleted = fetchMock.mock.calls.filter(([, i]) => i?.method === "DELETE").map(([u]) => u);
    expect(deleted).toEqual(["/v1/sessions/a", "/v1/sessions/b"]);
  });
});

import { describe, expect, it } from "vitest";
import type { VoiceModelManifest } from "@di/shared";
import type { VoiceModelStorage } from "./models";
import {
  DEFAULT_VOICE_MODEL_MANIFEST,
  clearVoiceModels,
  downloadVoiceModels,
  modelFileKey,
  readVoiceModelFile,
  voiceModelInstalled,
} from "./models";

function memStorage(): VoiceModelStorage & { map: Map<string, ArrayBuffer> } {
  const map = new Map<string, ArrayBuffer>();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    put: async (key, bytes) => void map.set(key, bytes),
    clear: async () => map.clear(),
  };
}

async function shaHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeManifest(
  bodies: Record<string, Uint8Array>,
): Promise<{ manifest: VoiceModelManifest; fetchImpl: typeof fetch }> {
  const entries = Object.entries(bodies);
  const manifest: VoiceModelManifest = {
    version: 1,
    models: {
      stt: {
        version: "v1",
        files: await Promise.all(
          entries.map(async ([path, body]) => ({
            path: `stt/${path}`,
            url: `https://cdn.test/${path}`,
            size: body.byteLength,
            sha256: await shaHex(body),
          })),
        ),
      },
    },
  };
  const fetchImpl: typeof fetch = (async (url: unknown) => {
    const path = String(url).split("/").pop()!;
    const body = bodies[path];
    if (!body) return new Response("nope", { status: 404 });
    return new Response(body.buffer as ArrayBuffer);
  }) as typeof fetch;
  return { manifest, fetchImpl };
}

describe("DEFAULT_VOICE_MODEL_MANIFEST", () => {
  it("covers stt and tts with pinned files", () => {
    expect(Object.keys(DEFAULT_VOICE_MODEL_MANIFEST.models).sort()).toEqual(["stt", "tts"]);
    for (const entry of Object.values(DEFAULT_VOICE_MODEL_MANIFEST.models)) {
      expect(entry.version.length).toBeGreaterThan(0);
      for (const f of entry.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.size).toBeGreaterThan(0);
        expect(f.url).toMatch(/^https:\/\//);
      }
    }
  });
});

describe("downloadVoiceModels", () => {
  it("downloads, verifies and stores each file", async () => {
    const bodies = { "model.bin": new Uint8Array([1, 2, 3]), "tokens.txt": new Uint8Array([4]) };
    const { manifest, fetchImpl } = await makeManifest(bodies);
    const storage = memStorage();
    await downloadVoiceModels({ manifest, fetchImpl, storage });
    expect(await voiceModelInstalled("stt", manifest, storage)).toBe(true);
    expect(await readVoiceModelFile("stt", "stt/model.bin", manifest, storage)).not.toBeNull();
    expect(await readVoiceModelFile("stt", "stt/nope", manifest, storage)).toBeNull();
  });

  it("rejects on sha256 mismatch and does not write", async () => {
    const { manifest, fetchImpl } = await makeManifest({ "model.bin": new Uint8Array([1]) });
    const entry = manifest.models.stt;
    const file = entry?.files[0];
    if (!file) throw new Error("fixture");
    file.sha256 = "0".repeat(64);
    const storage = memStorage();
    await expect(downloadVoiceModels({ manifest, fetchImpl, storage })).rejects.toThrow(/sha256/);
    expect(storage.map.size).toBe(0);
  });

  it("rejects on size mismatch", async () => {
    const { manifest, fetchImpl } = await makeManifest({ "model.bin": new Uint8Array([1]) });
    const entry = manifest.models.stt;
    const file = entry?.files[0];
    if (!file) throw new Error("fixture");
    file.size = 99;
    const storage = memStorage();
    await expect(downloadVoiceModels({ manifest, fetchImpl, storage })).rejects.toThrow(/size/);
  });

  it("propagates http failures", async () => {
    const { manifest } = await makeManifest({ "model.bin": new Uint8Array([1]) });
    const storage = memStorage();
    const fetchImpl = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    await expect(downloadVoiceModels({ manifest, fetchImpl, storage })).rejects.toThrow(/503/);
  });

  it("version bump makes the old cache miss", async () => {
    const { manifest, fetchImpl } = await makeManifest({ "model.bin": new Uint8Array([1]) });
    const storage = memStorage();
    await downloadVoiceModels({ manifest, fetchImpl, storage });
    const stt = manifest.models.stt;
    if (!stt) throw new Error("fixture");
    const bumped: VoiceModelManifest = {
      ...manifest,
      models: { stt: { ...stt, version: "v2" } },
    };
    expect(await voiceModelInstalled("stt", bumped, storage)).toBe(false);
    expect(modelFileKey("stt", "v1", "stt/model.bin")).not.toBe(
      modelFileKey("stt", "v2", "stt/model.bin"),
    );
  });

  it("clearVoiceModels empties the store", async () => {
    const { manifest, fetchImpl } = await makeManifest({ "model.bin": new Uint8Array([1]) });
    const storage = memStorage();
    await downloadVoiceModels({ manifest, fetchImpl, storage });
    await clearVoiceModels(storage);
    expect(await voiceModelInstalled("stt", manifest, storage)).toBe(false);
  });
});

/**
 * VoiceModelStorage over a plain directory — the server-side (Bun/node)
 * model cache. File names mirror the OPFS adapter's url-encoded key names
 * so a dir can be inspected/migrated 1:1.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VoiceModelStorage } from "./models";

export function fsVoiceModelStorage(rootDir: string): VoiceModelStorage {
  const name = (key: string) => encodeURIComponent(key.replace(/^https?:\/\//, ""));
  return {
    async get(key) {
      try {
        const buf = await readFile(join(rootDir, name(key)));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    },
    async put(key, bytes) {
      await mkdir(rootDir, { recursive: true });
      await writeFile(join(rootDir, name(key)), Buffer.from(bytes));
    },
    async clear() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

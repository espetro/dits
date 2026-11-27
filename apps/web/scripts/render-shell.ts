// Writes the SPA html shells (/ and /setup) by calling the built SSR handler
// in-process. A DI_NO_PRERENDER build leaves dist/client without index.html;
// this fills it in without the vite preview server the prerender crawl boots
// (which intermittently dies with ECONNREFUSED). Used by `build:e2e`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..", "dist");
const mod = (await import(join(root, "server", "server.js"))) as {
  default: { fetch(req: Request): Promise<Response> };
};

for (const [route, file] of [
  ["/", "index.html"],
  ["/setup", join("setup", "index.html")],
] as const) {
  const res = await mod.default.fetch(new Request(`http://localhost${route}`));
  if (!res.ok) throw new Error(`render ${route}: ${res.status}`);
  const out = join(root, "client", file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await res.text());
}
console.log("[render-shell] wrote / and /setup");

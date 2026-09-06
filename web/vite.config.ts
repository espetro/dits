import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Inlined literal (not imported from stores/session.ts): that module also
// exports persistentAtom-backed stores which touch localStorage at import
// time, unsafe in this Node-only config context.
const LOCALES = ["en", "de", "es", "fr", "ja", "pt-BR", "zh-CN", "ko", "it", "ar"] as const;

export default defineConfig({
  plugins: [
    tanstackStart({
      // static SPA: prerender all routes, no server runtime needed in the di binary
      prerender: { enabled: true, crawlLinks: true },
      // belt-and-suspenders: explicit locale landing pages, in case crawl
      // discovery via LandingLocaleSwitcher links ever misses one.
      pages: [
        "/",
        ...LOCALES.filter((l) => l !== "en").map((l) => `/${l}`),
        // belt-and-suspenders: prefixed in-app pages (crawlLinks should find these
        // from the landing nav, but they are cheap to list explicitly).
        ...LOCALES.filter((l) => l !== "en").map((l) => `/${l}/setup`),
      ].map((path) => ({
        path,
      })),
    }),
    react(),
    tailwindcss(),
  ],
  // silero onnx + ort wasm for the VAD are vendored in web/public/vad/
  // (committed, no CDN); the SPA build copies public/ verbatim, so no
  // vite-plugin-static-copy pass is needed.
});

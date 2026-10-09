import type { ElectrobunConfig } from "electrobun";

import { version } from "./package.json";

// CEF is only needed in dev mode for debugging; release builds stay lean.
const isBuild = process.argv.some((arg) => arg === "build");

const cefFlags = {
  "remote-debugging-address": "127.0.0.1",
  "remote-debugging-port": process.env.ELECTROBUN_CDP_PORT ?? "9333",
};

const config: ElectrobunConfig = {
  app: {
    name: "di.",
    identifier: "com.di.app",
    version,
  },
  build: {
    buildFolder: "build",
    artifactFolder: "artifacts",
    mac: {
      bundleCEF: !isBuild,
      chromiumFlags: isBuild ? undefined : cefFlags,
    },
    win: {
      // WebView2 ships with Windows; no CEF needed.
      bundleCEF: false,
    },
    linux: {
      // CEF keeps the linux leg self-contained (no webkit2gtk at runtime).
      bundleCEF: true,
      chromiumFlags: isBuild ? undefined : cefFlags,
      icon: "../../apps/web/public/icon-512.png",
    },
    bun: {
      entrypoint: "src/index.ts",
    },
    copy: {
      "../../apps/web/dist/client": "views/web",
    },
    watch: ["../../apps/server/src"],
  },
  release: {
    baseUrl: "https://github.com/espetro/dits/releases/latest/download",
  },
};

export default config;

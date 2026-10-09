import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { dashboardHtml } from "./dashboard";
import { tailLog } from "./logbuffer";
import {
  appUrl,
  configuredLogPath,
  getConfigPath,
  serverState,
  startServer,
  stopServer,
  webClientDir,
} from "./server";

export interface ControlDeps {
  /** Open a URL in the user's default browser (electrobun Utils.openExternal). */
  openExternal: (url: string) => void;
}

interface StateBody {
  running: boolean;
  port: number | null;
  url: string | null;
  configPath: string | null;
  logPath: string | null;
  logs: string[];
}

function stateBody(): StateBody {
  const { running, port } = serverState();
  return {
    running,
    port,
    url: appUrl(),
    configPath: getConfigPath(),
    logPath: configuredLogPath(),
    logs: tailLog(120),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

/**
 * Tiny localhost control API backing the dashboard webview. Separate from the
 * di server so it stays up when di is stopped. No RPC bridge needed — the
 * dashboard is a plain fetch() client, which keeps it debuggable with curl.
 */
export function startControlServer(deps: ControlDeps): { port: number } {
  const server = Bun.serve({
    port: parseInt(process.env.DI_DESKTOP_CONTROL_PORT ?? "0", 10),
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/") return html(dashboardHtml());
      // Bundled SPA fonts for the dashboard's @font-face (views/web/fonts in
      // the electrobun bundle, apps/web/dist/client/fonts in a repo build).
      if (req.method === "GET" && pathname.startsWith("/fonts/")) {
        const root = webClientDir();
        const file = basename(pathname);
        if (!root || !/^[\w.-]+\.woff2$/.test(file)) return json({ error: "not found" }, 404);
        const full = join(root, "fonts", file);
        if (!existsSync(full)) return json({ error: "not found" }, 404);
        return new Response(await readFile(full), {
          headers: { "content-type": "font/woff2", "cache-control": "max-age=3600" },
        });
      }
      if (req.method === "GET" && pathname === "/api/state") return json(stateBody());
      if (req.method === "GET" && pathname === "/api/logs") return json({ logs: tailLog(300) });

      if (req.method === "POST" && pathname === "/api/start") {
        try {
          await startServer();
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 500);
        }
        return json(stateBody());
      }
      if (req.method === "POST" && pathname === "/api/stop") {
        await stopServer();
        return json(stateBody());
      }
      if (req.method === "POST" && pathname === "/api/open") {
        const target = appUrl();
        if (!target) return json({ error: "server is not running" }, 409);
        deps.openExternal(target);
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    },
  });

  const port = server.port;
  if (port === undefined) throw new Error("control server failed to bind");
  return { port };
}

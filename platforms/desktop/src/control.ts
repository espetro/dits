import { dashboardHtml } from "./dashboard";
import { tailLog } from "./logbuffer";
import { appUrl, getConfigPath, serverState, startServer, stopServer } from "./server";

export interface ControlDeps {
  /** Open a URL in the user's default browser (electrobun Utils.openExternal). */
  openExternal: (url: string) => void;
}

interface StateBody {
  running: boolean;
  port: number | null;
  url: string | null;
  configPath: string | null;
  logs: string[];
}

function stateBody(): StateBody {
  const { running, port } = serverState();
  return {
    running,
    port,
    url: appUrl(),
    configPath: getConfigPath(),
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

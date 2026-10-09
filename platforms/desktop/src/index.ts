import { Utils } from "electrobun/bun";

import { startControlServer } from "./control";
import { appendLog, installConsoleTap } from "./logbuffer";
import { setupApplicationMenu } from "./menu";
import { setConfigPath, startServer } from "./server";
import { dataDir, ensureConfigFile } from "./storage";
import { createWindow } from "./window";

/**
 * di. desktop — an Electrobun control shell. The bun process runs the di
 * server in-process (sidecar) plus a tiny localhost control API; the webview
 * only shows the dashboard (start/stop/status/logs). The app itself always
 * opens in the user's real browser — the webview never touches the mic.
 */
async function main(): Promise<void> {
  installConsoleTap();

  const dir = dataDir();
  const configPath = ensureConfigFile(dir);
  setConfigPath(configPath);
  appendLog(`[desktop] config: ${configPath}`);

  // Autostart the sidecar; a bad config must not take the dashboard down —
  // the user can fix the yaml and hit start.
  await startServer().catch((e) => {
    appendLog(`[desktop] autostart failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  const { port } = startControlServer({
    openExternal: (url) => Utils.openExternal(url),
  });

  setupApplicationMenu();
  createWindow(`http://localhost:${port}/`);
}

main().catch((e) => {
  console.error("[desktop] fatal:", e);
  process.exit(1);
});

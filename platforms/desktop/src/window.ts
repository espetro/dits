import { BrowserWindow, Utils } from "electrobun/bun";

import { appendLog } from "./logbuffer";
import { stopServer } from "./server";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Open the control-shell window pointed at the local control server. */
export function createWindow(url: string): void {
  appendLog(`[desktop] opening dashboard at ${url}`);

  mainWindow = new BrowserWindow({
    title: "di.",
    frame: { x: 100, y: 100, width: 640, height: 620 },
    url,
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    // The dashboard is the whole app — closing it stops the sidecar.
    void stopServer().finally(() => Utils.quit());
  });
}

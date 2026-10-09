import { appendFileSync } from "node:fs";

import { ensureParent } from "./storage";

const MAX_LINES = 300;
const lines: string[] = [];

let logFile: string | null = null;
let tapped = false;

export function appendLog(line: string): void {
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  if (logFile) {
    try {
      appendFileSync(logFile, `${line}\n`);
    } catch {
      // log sink is best-effort; never take the app down over it
    }
  }
}

export function tailLog(n = 100): string[] {
  return lines.slice(-n);
}

/** Point the file sink at config.files.log_path ("" disables it). */
export function setLogFile(path: string | null): void {
  if (!path) {
    logFile = null;
    return;
  }
  try {
    ensureParent(path);
    logFile = path;
  } catch {
    logFile = null;
  }
}

/**
 * Tee console.* into the ring buffer (and the file sink once setLogFile
 * runs). The di server logs via console, so this is how the dashboard's
 * log tail sees server output in-process.
 */
export function installConsoleTap(): void {
  if (tapped) return;
  tapped = true;
  for (const level of ["log", "info", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      appendLog(`[${level}] ${line}`);
      orig(...args);
    };
  }
}

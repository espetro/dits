/**
 * Cloudflare Turnstile for the managed demo llm endpoint. The worker ingress
 * in front of the gateway requires a fresh `cf-turnstile-response` token on
 * every keyless request — tokens are single-use and verified via siteverify,
 * so execute() runs per request, not per session. The official api.js loads
 * lazily and only when a request actually targets the demo endpoint; BYO
 * endpoints never pull the script or get the header.
 */
import { isDemoLlm } from "./demo-llm";
import { pushVoiceHealth } from "./voice/health";

const envKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
/**
 * Build-time sitekey: unset uses the managed demo key; an empty string
 * disables turnstile entirely (no script, no header).
 */
export const TURNSTILE_SITE_KEY = envKey === undefined ? "0x4AAAAAAFQYyuFKwM_ZZ7R3" : envKey;

const API_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** wall-clock budget for one execute() — beyond this the token is lost */
const TURNSTILE_TIMEOUT_MS = 15_000;

interface TurnstileRenderParams {
  sitekey: string;
  /** interaction-only: no visible widget unless the challenge needs input */
  appearance: "interaction-only";
  execution: "execute";
  callback: (token: string) => void;
  "error-callback": () => void;
  "timeout-callback": () => void;
  "expired-callback": () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, params: TurnstileRenderParams): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
let widgetId: string | null = null;
let pending: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;
/** serializes execute() — one in-flight challenge at a time per widget */
let queue: Promise<unknown> = Promise.resolve();

function loadApi(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onload = () => {
      const api = window.turnstile;
      if (api) resolve(api);
      else reject(new Error("turnstile api.js loaded without window.turnstile"));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile api.js failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function settleToken(token: string): void {
  pending?.resolve(token);
}

function settleError(err: Error): void {
  pending?.reject(err);
}

async function ensureWidget(api: TurnstileApi): Promise<string> {
  if (widgetId) return widgetId;
  const host = document.createElement("div");
  document.body.appendChild(host);
  widgetId = api.render(host, {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: "interaction-only",
    execution: "execute",
    callback: settleToken,
    "error-callback": () => settleError(new Error("turnstile challenge failed")),
    "timeout-callback": () => settleError(new Error("turnstile challenge timed out")),
    "expired-callback": () => settleError(new Error("turnstile token expired")),
  });
  return widgetId;
}

async function executeOnce(): Promise<string> {
  const api = await loadApi();
  const id = await ensureWidget(api);
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      api.reset(id);
      reject(new Error("turnstile token timed out"));
    }, TURNSTILE_TIMEOUT_MS);
    pending = {
      resolve: (token) => {
        clearTimeout(timer);
        pending = null;
        api.reset(id);
        resolve(token);
      },
      reject: (err) => {
        clearTimeout(timer);
        pending = null;
        api.reset(id);
        reject(err);
      },
    };
    api.execute(id);
  });
}

/**
 * Fresh token for `baseUrl`, or null when turnstile doesn't apply — no
 * sitekey configured, not the managed demo endpoint, or no DOM (SSR/tests
 * without jsdom). Callers attach it as `cf-turnstile-response`.
 */
export async function turnstileTokenFor(baseUrl: string): Promise<string | null> {
  if (!TURNSTILE_SITE_KEY || !isDemoLlm(baseUrl)) return null;
  if (typeof document === "undefined") return null;
  const run = queue.then(async () => {
    const started = performance.now();
    try {
      const token = await executeOnce();
      pushVoiceHealth({ kind: "turnstile", ok: true, ms: Math.round(performance.now() - started) });
      return token;
    } catch (err) {
      pushVoiceHealth({
        kind: "turnstile",
        ok: false,
        ms: Math.round(performance.now() - started),
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

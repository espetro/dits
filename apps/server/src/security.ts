import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Config } from "@di/shared";
import { DEFAULT_SERVER_HOST } from "@di/shared";

export type SecurityFailure = "host" | "origin" | "auth";

export interface RequestSecurityResult {
  ok: boolean;
  failure?: SecurityFailure;
  /** Normalized cross-origin dev origin that must receive CORS headers. */
  corsOrigin?: string;
}

export interface InspectRequestOptions {
  requireAuth: boolean;
  /** Browser WebSocket clients cannot set Authorization, so the voice upgrade accepts ?token=. */
  allowQueryToken?: boolean;
}

interface HostHeaderParts {
  /** Normalized host[:port] as serialized by URL. */
  host: string;
  /** Normalized hostname without a port; IPv6 keeps URL brackets here. */
  hostname: string;
}

interface OriginInspection {
  ok: boolean;
  corsOrigin?: string;
}

function parseHostHeader(value: string | undefined): HostHeaderParts | undefined {
  if (!value || value !== value.trim() || value.length > 255 || /\s/.test(value)) return undefined;
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    if (!url.hostname) return undefined;
    return { host: url.host, hostname: url.hostname };
  } catch {
    return undefined;
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Lowercase and canonicalize numeric IPs/IPv6; strip the DNS root dot from names. */
function normalizeHostName(value: string): string {
  let input = stripIpv6Brackets(value.trim().toLowerCase());
  if (input.includes(":")) {
    try {
      return stripIpv6Brackets(new URL(`http://[${input}]`).hostname);
    } catch {
      return input;
    }
  }
  input = input.replace(/\.$/, "");
  try {
    return new URL(`http://${input}`).hostname.replace(/\.$/, "");
  } catch {
    return input;
  }
}

function isIpv4Loopback(hostname: string): boolean {
  if (isIP(hostname) !== 4) return false;
  return Number(hostname.split(".")[0]) === 127;
}

function isIpv6Loopback(hostname: string): boolean {
  if (isIP(hostname) !== 6) return false;
  if (hostname === "::1") return true;
  // IPv4-mapped loopback, canonicalized by URL as ::ffff:7fxx:xxxx.
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(hostname);
}

/** True for loopback hostnames/IPs only; wildcard and lan addresses are deliberately false. */
export function isLoopbackHost(host: string): boolean {
  const hostname = normalizeHostName(host);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return isIpv4Loopback(hostname) || isIpv6Loopback(hostname);
}

function isWildcardHost(host: string): boolean {
  const hostname = normalizeHostName(host);
  return hostname === "0.0.0.0" || hostname === "::";
}

function hostAllowed(parts: HostHeaderParts, config: Config): boolean {
  const requestHost = normalizeHostName(parts.hostname);
  if (isLoopbackHost(requestHost)) return true;
  const configured = config.server.host ?? DEFAULT_SERVER_HOST;
  if (isWildcardHost(configured)) return true;
  return requestHost === normalizeHostName(configured);
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function inspectOrigin(
  originHeader: string | undefined,
  host: HostHeaderParts,
  config: Config,
): OriginInspection {
  if (!originHeader) return { ok: true };
  const origin = normalizeOrigin(originHeader);
  if (!origin) return { ok: false };
  const url = new URL(origin);
  // The Host header is authority for the origin the browser actually reached;
  // matching host[:port] keeps server-hosted SPA fetches working without CORS.
  if (url.host === host.host) return { ok: true };
  const allowed = new Set(
    (config.server.dev_origins ?? [])
      .map((value) => normalizeOrigin(value))
      .filter((value): value is string => value !== undefined),
  );
  if (allowed.has(origin)) return { ok: true, corsOrigin: origin };
  return { ok: false };
}

function tokenEquals(received: string, expected: string): boolean {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function hasValidToken(req: Request, config: Config, allowQueryToken: boolean): boolean {
  if (config.server.auth !== "token") return true;
  const expected = config.server.token;
  if (!expected) return false;

  const authorization = req.headers.get("authorization");
  const bearer = authorization ? /^Bearer[ \t]+(\S+)$/i.exec(authorization) : null;
  if (bearer && tokenEquals(bearer[1]!, expected)) return true;

  if (allowQueryToken) {
    const token = new URL(req.url).searchParams.get("token");
    if (token && tokenEquals(token, expected)) return true;
  }
  return false;
}

/** Validate Host, Origin and auth once for both Hono HTTP requests and the Bun WS upgrade. */
export function inspectRequestSecurity(
  req: Request,
  config: Config,
  opts: InspectRequestOptions,
): RequestSecurityResult {
  const host = parseHostHeader(req.headers.get("host") ?? undefined);
  if (!host || !hostAllowed(host, config)) return { ok: false, failure: "host" };

  const origin = inspectOrigin(req.headers.get("origin") ?? undefined, host, config);
  if (!origin.ok) return { ok: false, failure: "origin" };

  if (opts.requireAuth && !hasValidToken(req, config, opts.allowQueryToken === true)) {
    return { ok: false, failure: "auth" };
  }
  return { ok: true, corsOrigin: origin.corsOrigin };
}

/** /v1 is the authenticated API surface; /api/health and static assets stay unauthenticated. */
export function pathRequiresAuth(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

/** Generic responses that never echo the token, Host, or Origin back to the caller. */
export function securityResponse(result: RequestSecurityResult): Response {
  if (result.failure === "auth") {
    return Response.json(
      { error: "authentication required", code: "unauthorized" },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }
  const code = result.failure === "host" ? "forbidden_host" : "forbidden_origin";
  return Response.json({ error: "forbidden", code }, { status: 403 });
}

function tokenConfigured(token: string | undefined): boolean {
  return typeof token === "string" && /^\S{16,}$/.test(token);
}

/** Startup invariant for intentional exposure beyond loopback. The token itself is never interpolated. */
export function serverExposureError(config: Config): string | undefined {
  if (config.server.auth === "token" && !tokenConfigured(config.server.token)) {
    return "server.token is required when server.auth is token";
  }
  const host = config.server.host ?? DEFAULT_SERVER_HOST;
  if (
    !isLoopbackHost(host) &&
    (config.server.auth !== "token" || !tokenConfigured(config.server.token))
  ) {
    return "server.host is non-loopback; set server.auth: token and a server.token of at least 16 non-whitespace characters before exposing di";
  }
  return undefined;
}

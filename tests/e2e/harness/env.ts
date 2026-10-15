// Single source for where the e2e stack lives. harness/up.ts starts it on
// these ports and exports them; specs read the same values back, so a bare
// `playwright test` against an already-running stack agrees with up.ts.
export const PORTS = { server: 3100, cors: 3101, noCors: 3102, fail: 3103, static: 3104 } as const;

/** di server (test mode) that also serves the built SPA */
export const DI_URL = process.env.DI_URL ?? `http://localhost:${PORTS.server}`;
/** the SPA origin; the same server in the built-SPA harness */
export const WEB_URL = process.env.DI_WEB_URL ?? DI_URL;

export const MOCK_PORTS = {
  cors: Number(process.env.MOCK_CORS_PORT ?? PORTS.cors),
  noCors: Number(process.env.MOCK_NOCORS_PORT ?? PORTS.noCors),
  fail: Number(process.env.MOCK_FAIL_PORT ?? PORTS.fail),
};

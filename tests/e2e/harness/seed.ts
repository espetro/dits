// Shared browser-state seeds. Every persisted gate the SPA reads on first
// load (engine picks, provider profile, voice consent, reachability cache)
// is set here, once, so a new gate is a one-file fix instead of three
// copy-pasted `seedClientOnly` helpers drifting apart.
//
//   await applySeed(page, clientOnly());
//   await applySeed(page, wasmReady(MODELS_BASE), noServer());
import type { Page } from "@playwright/test";

/**
 * localStorage keys the app persists. Mirrors @di/shared
 * (PROVIDER_PROFILE_STORAGE_KEY) and apps/web/src/{stores/voice,lib/runtime}.ts;
 * not imported since this package has no workspace dependency. Drift is
 * caught by harness/check-keys.ts.
 */
export const KEYS = {
  profile: "di.provider-profile",
  sttEngine: "di.voice.sttEngine",
  ttsEngine: "di.voice.ttsEngine",
  modelsConsent: "di.voice.modelsConsent",
  modelsInstalled: "di.voice.modelsInstalled",
  modelsBase: "di.voice.models-base",
  serverReachable: "di.server-reachable",
} as const;

export interface Seed {
  storage: Record<string, string>;
  /** page.route stubs that must exist before the first navigation */
  routes?: (page: Page) => Promise<void>;
}

export const PROFILE_WITH_KEY = {
  llm: {
    baseUrl: "http://mock.local/v1",
    apiKey: "test-key",
    model: "mock-model",
    mode: "remote",
  },
};

export const PROFILE_KEYLESS = {
  llm: { baseUrl: "http://mock.local/v1", apiKey: "", model: "mock-model", mode: "remote" },
};

/** nothing persisted: a first-time visitor */
export const fresh = (): Seed => ({ storage: {} });

export const profileKey = (): Seed => ({
  storage: { [KEYS.profile]: JSON.stringify(PROFILE_WITH_KEY) },
});

export const profileKeyless = (): Seed => ({
  storage: { [KEYS.profile]: JSON.stringify(PROFILE_KEYLESS) },
});

/**
 * Everything in-browser (no di server involved) with a BYO llm profile.
 * Consent is `declined` so the on-device models dialog never covers the
 * interview; specs that exercise the dialog use `fresh()` + `profileKey()`
 * plus in-browser picks instead.
 */
export const clientOnly = (): Seed => ({
  storage: {
    [KEYS.sttEngine]: "in-browser",
    [KEYS.ttsEngine]: "in-browser",
    [KEYS.modelsConsent]: "declined",
    [KEYS.profile]: JSON.stringify(PROFILE_WITH_KEY),
  },
});

/** in-browser picks + profile, consent still unset (dialog expected) */
export const clientOnlyUnconsented = (): Seed => {
  const { [KEYS.modelsConsent]: _consent, ...storage } = clientOnly().storage;
  return { storage };
};

/** consent granted, models served from `base`, and the cache marked installed */
export const wasmReady = (base: string): Seed => ({
  storage: {
    ...clientOnly().storage,
    // "in-browser" resolves to the built-in engines; only "wasm" (or the
    // auto chain) reaches the on-device workers
    [KEYS.sttEngine]: "wasm",
    [KEYS.ttsEngine]: "wasm",
    [KEYS.modelsConsent]: "granted",
    [KEYS.modelsBase]: base,
    [KEYS.modelsInstalled]: JSON.stringify({ stt: true, tts: true }),
  },
});

/** reachability cache says "no server" */
export const staleFalse = (): Seed => ({ storage: { [KEYS.serverReachable]: "false" } });

/** cache says reachable, but the server is gone: the stale-true case */
export const staleTrueServerDown = (): Seed => ({
  storage: { [KEYS.serverReachable]: "true" },
  routes: noServer().routes,
});

/** aborts the di health probe and every /v1 call on the di origin */
export const noServer = (): Seed => ({
  storage: {},
  routes: async (page) => {
    const diOrigin = new URL(process.env.DI_URL ?? "http://localhost:3100").origin;
    // third-party mocks (BYO provider hosts) are left to the spec's own routes
    const own = (url: URL) => url.origin === diOrigin;
    await page.route("**/api/health", (route) =>
      own(new URL(route.request().url())) ? route.abort("connectionrefused") : route.fallback(),
    );
    await page.route("**/v1/**", (route) =>
      own(new URL(route.request().url())) ? route.abort("connectionrefused") : route.fallback(),
    );
  },
});

/**
 * Merge seeds left to right (later wins) and install them before any
 * navigation. Keys are only written while absent, so a reload keeps what
 * the test changed (e.g. a consent decision) instead of re-seeding it.
 */
export async function applySeed(page: Page, ...seeds: Seed[]): Promise<void> {
  const storage: Record<string, string> = {};
  for (const s of seeds) Object.assign(storage, s.storage);
  await page.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }
  }, storage);
  for (const s of seeds) await s.routes?.(page);
}

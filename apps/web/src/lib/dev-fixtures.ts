import { seedFixtures } from "./dev-fixtures-impl";

/**
 * Dev-only OPFS fixtures: seed a few fake completed sessions so history,
 * report and finish screens have data without a server or API keys.
 * Fixture content lives in `dev-fixtures-impl.ts`.
 *
 * Gate: `import.meta.env.DEV` AND `?fixtures=1` (or `?fixtures=reset`) in the
 * URL. Idempotent via a localStorage marker (`di.fixtures-seeded`).
 * `?fixtures=reset` clears the marker and reseeds. No OPFS deletion: the
 * marker reset simply rewrites the fixture sessions in place.
 */

const MARKER_KEY = "di.fixtures-seeded";

/** True when the current URL asks for fixture seeding (`?fixtures=1|reset`). */
export function fixturesMode(): "seed" | "reset" | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("fixtures");
  if (value === "1") return "seed";
  if (value === "reset") return "reset";
  return null;
}

/** Marker check, exposed for tests. */
export function hasSeedMarker(): boolean {
  try {
    return localStorage.getItem(MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Boot hook: seed when gated and not yet seeded. Idempotent. */
export async function maybeSeedFixtures(): Promise<void> {
  const mode = fixturesMode();
  if (!mode) return;
  if (mode === "seed" && hasSeedMarker()) return;
  await seedFixtures();
  try {
    localStorage.setItem(MARKER_KEY, "1");
  } catch {
    // private mode etc: seeding just re-runs per boot, harmless
  }
}

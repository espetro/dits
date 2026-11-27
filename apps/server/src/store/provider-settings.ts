import * as v from "valibot";
import {
  ServerProviderSettingsReadModelSchema,
  ServerProviderSettingsSchema,
  redactServerProviderSettings,
} from "@di/shared";
import type {
  ServerProviderSettings,
  ServerProviderSettingsReadModel,
  ServerProviderSettingsSection,
} from "@di/shared";
import type { Db } from "./db";

const PROVIDER_SETTINGS_ID = 1;

/** Internal record: `settings` contains raw provider keys and must stay server-side. */
export interface StoredProviderSettings {
  settings: ServerProviderSettings;
  created_at: string;
  updated_at: string;
}

export class ProviderSettingsStoreError extends Error {}

function decodeSettings(json: string): ServerProviderSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProviderSettingsStoreError("provider_settings row contains invalid JSON");
  }
  const parsed = v.safeParse(ServerProviderSettingsSchema, raw);
  if (!parsed.success) {
    // Do not include issues or payload text here: payloads can contain api keys.
    throw new ProviderSettingsStoreError(
      "provider_settings row does not match the settings contract",
    );
  }
  return parsed.output;
}

/**
 * Internal load for resolver/composition code. The return value contains raw
 * api keys; never serialize it to a response or log. Use
 * `loadProviderSettingsReadModel` for anything user-visible.
 */
export async function loadProviderSettingsForResolution(
  db: Db,
): Promise<StoredProviderSettings | null> {
  const row = await db
    .selectFrom("provider_settings")
    .selectAll()
    .where("id", "=", PROVIDER_SETTINGS_ID)
    .executeTakeFirst();
  if (!row) return null;
  return {
    settings: decodeSettings(row.settings),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** User-visible read model: redacted key presence only, never raw key material. */
export async function loadProviderSettingsReadModel(
  db: Db,
): Promise<ServerProviderSettingsReadModel | null> {
  const stored = await loadProviderSettingsForResolution(db);
  if (!stored) return null;
  return v.parse(ServerProviderSettingsReadModelSchema, {
    settings: redactServerProviderSettings(stored.settings),
    created_at: stored.created_at,
    updated_at: stored.updated_at,
  });
}

/**
 * Replace the singleton settings document. This is deliberately replacement
 * rather than deep merge: callers that want patch semantics must read, merge
 * explicitly, then save. Sparse sections are preserved for resolver overlay.
 */
export async function saveProviderSettings(
  db: Db,
  settings: ServerProviderSettings,
): Promise<StoredProviderSettings> {
  const parsed = v.parse(ServerProviderSettingsSchema, settings);
  const now = new Date().toISOString();
  await db
    .insertInto("provider_settings")
    .values({
      id: PROVIDER_SETTINGS_ID,
      settings: JSON.stringify(parsed),
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({ settings: JSON.stringify(parsed), updated_at: now }),
    )
    .execute();
  const stored = await loadProviderSettingsForResolution(db);
  if (!stored) throw new ProviderSettingsStoreError("provider settings save did not round-trip");
  return stored;
}

/** Clear all server-owned provider settings, returning whether a row existed. */
export async function clearProviderSettings(db: Db): Promise<boolean> {
  const res = await db
    .deleteFrom("provider_settings")
    .where("id", "=", PROVIDER_SETTINGS_ID)
    .executeTakeFirst();
  return Number(res.numDeletedRows) > 0;
}

/**
 * Clear one settings section so that section falls back to yaml/env config.
 * Removes the singleton row entirely when no sections remain.
 */
export async function clearProviderSettingsSection(
  db: Db,
  section: ServerProviderSettingsSection,
): Promise<boolean> {
  const stored = await loadProviderSettingsForResolution(db);
  if (!stored || stored.settings[section] === undefined) return false;
  const next: ServerProviderSettings = { ...stored.settings };
  delete next[section];
  if (Object.keys(next).length === 0) return clearProviderSettings(db);
  await saveProviderSettings(db, next);
  return true;
}

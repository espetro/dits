import { Hono } from "hono";
import * as v from "valibot";
import { ServerProviderSettingsSchema, ServerProviderSettingsSectionSchema } from "@di/shared";
import type { ServerProviderSettings, ServerProviderSettingsSection } from "@di/shared";
import type { Db } from "../store/db";
import type { ReportLlm } from "../report/generate";
import {
  clearProviderSettings,
  clearProviderSettingsSection,
  loadProviderSettingsForResolution,
  loadProviderSettingsReadModel,
  saveProviderSettings,
} from "../store/provider-settings";

function mergeSparse<T extends object>(base: T | undefined, patch: T): T {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function mergeSection(
  settings: ServerProviderSettings,
  section: ServerProviderSettingsSection,
  patch: NonNullable<ServerProviderSettings[ServerProviderSettingsSection]>,
): ServerProviderSettings {
  const current = settings[section];
  return {
    ...settings,
    [section]: mergeSparse(current, patch),
  } as ServerProviderSettings;
}

/**
 * Server-owned provider settings API. PATCH is field-merging within one
 * section: omitted fields preserve existing stored overrides, `null` applies
 * the contract's explicit clear semantics, and raw api keys are never read back.
 */
export interface ProviderSettingsRoutesOptions {
  /** Resolve the effective server-owned llm for the settings test route. */
  llmTest?: () => Promise<ReportLlm | undefined>;
}

const LLM_TEST_PROMPT = "Reply with the single word: ok";

export function providerSettingsRoutes(db: Db, opts: ProviderSettingsRoutesOptions = {}): Hono {
  const api = new Hono();

  api.post("/test/llm", async (c) => {
    if (!opts.llmTest) {
      return c.json({ error: "llm test unavailable", code: "llm_test_off" }, 503);
    }
    const llm = await opts.llmTest();
    if (!llm) {
      return c.json({ error: "llm is not configured", code: "llm_unconfigured" }, 503);
    }
    const startedAt = performance.now();
    try {
      const messages = [{ role: "user" as const, content: LLM_TEST_PROMPT }];
      const result = llm.streamChat ? await llm.streamChat(messages) : await llm.chat(messages);
      return c.json({
        text: result.content,
        ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err), code: "llm_test_failed" },
        502,
      );
    }
  });

  api.get("/", async (c) => {
    const stored = await loadProviderSettingsReadModel(db);
    if (!stored) {
      return c.json(
        { error: "provider settings not found", code: "provider_settings_not_found" },
        404,
      );
    }
    return c.json(stored);
  });

  api.patch("/:section", async (c) => {
    const sectionParsed = v.safeParse(ServerProviderSettingsSectionSchema, c.req.param("section"));
    if (!sectionParsed.success) {
      return c.json({ error: "unknown settings section", code: "settings_section_unknown" }, 404);
    }
    const section = sectionParsed.output;
    const body = await c.req.json().catch(() => null);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "object body required", code: "settings_body_invalid" }, 400);
    }
    // Validate through the document schema so the patch is typed as the
    // section selected by the URL while unknown keys are stripped.
    const parsed = v.safeParse(ServerProviderSettingsSchema, { [section]: body });
    if (!parsed.success) {
      return c.json({ error: "provider settings are invalid", code: "settings_invalid" }, 400);
    }
    const patch = parsed.output[section];
    if (!patch) {
      return c.json({ error: "provider settings are invalid", code: "settings_invalid" }, 400);
    }
    const stored = await loadProviderSettingsForResolution(db);
    const merged = mergeSection(stored?.settings ?? {}, section, patch);
    await saveProviderSettings(db, merged);
    return c.json(await loadProviderSettingsReadModel(db));
  });

  api.delete("/", async (c) => c.json({ deleted: await clearProviderSettings(db) }));

  api.delete("/:section", async (c) => {
    const sectionParsed = v.safeParse(ServerProviderSettingsSectionSchema, c.req.param("section"));
    if (!sectionParsed.success) {
      return c.json({ error: "unknown settings section", code: "settings_section_unknown" }, 404);
    }
    return c.json({ deleted: await clearProviderSettingsSection(db, sectionParsed.output) });
  });

  return api;
}

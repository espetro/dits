import { atom } from "nanostores";
import * as v from "valibot";
import { ServerProviderSettingsReadModelSchema } from "@di/shared";
import type {
  RedactedServerLlmProviderSettings,
  RedactedServerSttProviderSettings,
  RedactedServerTtsProviderSettings,
  ServerProviderSettingsReadModel,
  ServerProviderSettingsSection,
} from "@di/shared";
import { DiError } from "./errors";

const BASE = import.meta.env.VITE_DI_API_BASE ?? "";

/** undefined = not loaded yet; null = reachable server has no stored overrides. */
export const $serverProviderSettings = atom<ServerProviderSettingsReadModel | null | undefined>(
  undefined,
);

async function apiFailure(res: Response, op: string): Promise<DiError> {
  const body = (await res.json().catch(() => undefined)) as
    | { error?: string; code?: string }
    | undefined;
  return new DiError(`api.${body?.code ?? op}`, { status: res.status });
}

export async function refreshServerProviderSettings(): Promise<ServerProviderSettingsReadModel | null> {
  const res = await fetch(`${BASE}/v1/provider-settings`);
  if (res.status === 404) {
    $serverProviderSettings.set(null);
    return null;
  }
  if (!res.ok) throw await apiFailure(res, "getProviderSettings");
  const model = v.parse(ServerProviderSettingsReadModelSchema, await res.json());
  $serverProviderSettings.set(model);
  return model;
}

export async function patchServerProviderSettings(
  section: ServerProviderSettingsSection,
  patch: Record<string, unknown>,
): Promise<ServerProviderSettingsReadModel> {
  const res = await fetch(`${BASE}/v1/provider-settings/${section}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await apiFailure(res, "saveProviderSettings");
  const model = v.parse(ServerProviderSettingsReadModelSchema, await res.json());
  $serverProviderSettings.set(model);
  return model;
}

export async function testServerLlm(): Promise<{ text: string; ms: number }> {
  const res = await fetch(`${BASE}/v1/provider-settings/test/llm`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as
      | { error?: string; code?: string }
      | undefined;
    if (body?.error) throw new Error(body.error);
    throw await apiFailure(res, "testProviderSettings");
  }
  return res.json() as Promise<{ text: string; ms: number }>;
}

/** Draft-shaped subset mirrored into the settings pane drafts. */
export interface ServerSectionDraft {
  enabled: boolean;
  flavor: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  llmMode: "remote" | "browser";
}

export function llmDraftFromServer(
  section: RedactedServerLlmProviderSettings | undefined,
): Partial<ServerSectionDraft> {
  if (!section) return {};
  return {
    enabled: true,
    llmMode: "remote",
    flavor: section.flavor ?? (section.provider === "anthropic" ? "anthropic" : "openai"),
    baseUrl: section.base_url ?? "",
    apiKey: "",
    model: section.model ?? "",
  };
}

export function sttDraftFromServer(
  section: RedactedServerSttProviderSettings | undefined,
): Partial<ServerSectionDraft> {
  if (!section) return {};
  return {
    enabled: true,
    baseUrl: section.base_url ?? "",
    apiKey: "",
    model: section.model ?? "",
  };
}

export function ttsDraftFromServer(
  section: RedactedServerTtsProviderSettings | undefined,
): Partial<ServerSectionDraft> {
  if (!section) return {};
  return {
    enabled: true,
    baseUrl: section.base_url ?? "",
    apiKey: "",
    model: section.model ?? "",
    voice: section.voice ?? "",
  };
}

interface DraftForServerPatch {
  enabled: boolean;
  flavor: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  llmMode: "remote" | "browser";
}

function keyPatch(apiKey: string, keyIsSet: boolean): { api_key?: string | null } {
  // Blank means "keep the stored key" only when the server says one exists.
  // Without a stored key it explicitly clears any yaml-inherited key.
  if (apiKey) return { api_key: apiKey };
  return keyIsSet ? {} : { api_key: null };
}

function completeRemoteDraft(draft: DraftForServerPatch): boolean {
  return (
    draft.enabled &&
    draft.llmMode === "remote" &&
    URL.canParse(draft.baseUrl) &&
    draft.model.trim().length > 0
  );
}

/**
 * Convert one complete endpoint draft into the sparse server patch for its
 * section. Incomplete drafts return null and are not autosaved, matching the
 * client-side profile behavior.
 */
export function serverPatchFromDraft(
  section: "llm" | "stt" | "tts",
  draft: DraftForServerPatch,
  keyIsSet: boolean,
): Record<string, unknown> | null {
  if (!completeRemoteDraft(draft)) return null;
  const common = {
    base_url: draft.baseUrl,
    model: draft.model,
    ...keyPatch(draft.apiKey, keyIsSet),
  };
  if (section === "llm") {
    return {
      provider: draft.flavor === "anthropic" ? "anthropic" : "openai",
      flavor: draft.flavor,
      ...common,
    };
  }
  if (section === "stt") return { provider: "remote", ...common };
  return {
    provider: "remote",
    ...common,
    ...(draft.voice ? { voice: draft.voice } : { voice: null }),
  };
}

export function serverSectionKeyIsSet(
  model: ServerProviderSettingsReadModel | null | undefined,
  section: "llm" | "stt" | "tts",
): boolean {
  return model?.settings[section]?.api_key_set === true;
}

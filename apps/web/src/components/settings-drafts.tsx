import * as React from "react";
import * as v from "valibot";
import { useIntl } from "react-intl";

import { ProviderSectionsSchema } from "@di/shared";
import type { LlmSection, ProviderEndpoint, ProviderSections, TtsEndpoint } from "@di/shared";
import { $providerProfile, $serverReachable } from "../lib/runtime";
import { isDemoLlm } from "../lib/demo-llm";
import { errorDetail } from "../lib/errors";
import { probeModels } from "../lib/llm";
import { useSsrStore } from "../lib/ssr";

/**
 * Shared editable state for the settings panes. Each of the three provider
 * sections (stt, tts, llm) edits a SectionDraft that autosaves into
 * $providerProfile after a debounce; the pane components render the drafts
 * in different places (llm under interviewer ai, stt/tts under advanced).
 */

export type SectionKey = "stt" | "tts" | "llm";

/** Per-section editable endpoint state (empty string = not set). */
export interface SectionDraft {
  enabled: boolean;
  flavor: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  /** llm only: remote endpoint vs in-browser engine. */
  llmMode: "remote" | "browser";
  /** llm only: which in-browser engine. */
  engine: "gemini-nano" | "transformers";
  /** llm only: transformers.js model id (catalog default when empty). */
  browserModelId: string;
}

const EMPTY_SECTION: SectionDraft = {
  enabled: false,
  flavor: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
  voice: "",
  llmMode: "remote",
  engine: "gemini-nano",
  browserModelId: "",
};

function draftFromLlm(llm: LlmSection | undefined): SectionDraft {
  if (!llm) return { ...EMPTY_SECTION, enabled: true };
  if (llm.mode === "browser") {
    return {
      ...EMPTY_SECTION,
      enabled: true,
      llmMode: "browser",
      engine: llm.engine,
      browserModelId: llm.modelId ?? "",
    };
  }
  return {
    ...EMPTY_SECTION,
    enabled: true,
    flavor: llm.flavor ?? "openai",
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    model: llm.model,
  };
}

function draftFromEndpoint(endpoint: ProviderEndpoint | TtsEndpoint | undefined): SectionDraft {
  if (!endpoint) return { ...EMPTY_SECTION };
  return {
    ...EMPTY_SECTION,
    enabled: true,
    flavor: endpoint.flavor ?? "openai",
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    model: endpoint.model,
    voice: "voice" in endpoint ? endpoint.voice : "",
  };
}

export interface SettingsDrafts {
  drafts: Record<SectionKey, SectionDraft>;
  update(key: SectionKey, patch: Partial<SectionDraft>): void;
}

const DraftsContext = React.createContext<SettingsDrafts | null>(null);

export function useSettingsDrafts(): SettingsDrafts {
  const ctx = React.useContext(DraftsContext);
  if (!ctx) throw new Error("useSettingsDrafts outside SettingsDraftsProvider");
  return ctx;
}

export interface ModelOptions {
  options: string[];
  /** localized reason the list is empty; null when fine or not probed. */
  error: string | null;
}

/**
 * /models poll for a draft's Model ID datalist (custom endpoint mode).
 * Failures never block: the field stays free-text, but the reason is
 * surfaced next to it. Re-runs when the server probe settles, since the
 * relay choice depends on it.
 */
export function useModelOptions(draft: SectionDraft): ModelOptions {
  const intl = useIntl();
  const reachable = useSsrStore($serverReachable, null);
  const [state, setState] = React.useState<ModelOptions>({ options: [], error: null });
  React.useEffect(() => {
    if (!draft.enabled || !draft.baseUrl || !URL.canParse(draft.baseUrl)) {
      setState({ options: [], error: null });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      probeModels(draft).then(
        (options) => {
          if (!cancelled) setState({ options, error: null });
        },
        (err: unknown) => {
          if (!cancelled) setState({ options: [], error: errorDetail(intl, err) });
        },
      );
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // intl identity is stable per locale; draft fields are the real inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.enabled, draft.baseUrl, draft.apiKey, reachable]);
  return state;
}

/** Loopback / private-network hosts: local gateways (ollama, bifrost) run keyless. */
export function isLocalHost(baseUrl: string): boolean {
  if (!URL.canParse(baseUrl)) return false;
  const host = new URL(baseUrl).hostname;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host)
  );
}

/** True when an enabled remote-section draft is missing fields (never persisted). */
export function sectionIncomplete(key: SectionKey, draft: SectionDraft): boolean {
  const isUrl = (s: string): boolean => URL.canParse(s);
  const keyMissing =
    !draft.apiKey && !(key === "llm" && isDemoLlm(draft.baseUrl)) && !isLocalHost(draft.baseUrl);
  return (
    draft.enabled &&
    (key === "llm" ? draft.llmMode === "remote" : true) &&
    (!draft.baseUrl || keyMissing || !draft.model || !isUrl(draft.baseUrl))
  );
}

export function SettingsDraftsProvider(props: { children: React.ReactNode }) {
  const profile = useSsrStore($providerProfile, null);
  const [drafts, setDrafts] = React.useState<Record<SectionKey, SectionDraft>>(() => ({
    stt: draftFromEndpoint(profile?.stt),
    tts: draftFromEndpoint(profile?.tts),
    llm: draftFromLlm(profile?.llm),
  }));
  // useSsrStore yields null during SSR/first paint, so the useState
  // initializer can run before the persisted profile is readable. Hydrate
  // once on the first real profile — but never over an edit the user
  // already typed into an empty draft.
  const hydrated = React.useRef(profile !== null);
  React.useEffect(() => {
    if (hydrated.current || !profile) return;
    hydrated.current = true;
    setDrafts({
      stt: draftFromEndpoint(profile.stt),
      tts: draftFromEndpoint(profile.tts),
      llm: draftFromLlm(profile.llm),
    });
  }, [profile]);
  function update(key: SectionKey, patch: Partial<SectionDraft>) {
    hydrated.current = true;
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  // Autosave: every edit is validated and persisted after a short debounce,
  // so there is no Save button to forget. An incomplete llm draft never
  // overwrites the last valid persisted profile (the stale one keeps the
  // session startable while the user is mid-edit).
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const next = buildProfile(drafts);
      if (!next.llm) return;
      const parsed = v.safeParse(ProviderSectionsSchema, next);
      if (parsed.success) $providerProfile.set(parsed.output);
    }, 600);
    return () => clearTimeout(timer);
  }, [drafts]);
  // (per-section test flows live in the section components; the old shared
  // runTest here was dead code since the two-pane settings rework)
  const value: SettingsDrafts = {
    drafts,
    update,
  };
  return <DraftsContext.Provider value={value}>{props.children}</DraftsContext.Provider>;
}

function buildProfile(drafts: Record<SectionKey, SectionDraft>): ProviderSections {
  const out: ProviderSections = {};
  // In-browser mode has no endpoint fields, so `enabled` (which means
  // "custom endpoint fields shown") is false; gate on llmMode alone.
  if (drafts.llm.llmMode === "browser") {
    out.llm = {
      mode: "browser",
      engine: drafts.llm.engine,
      ...(drafts.llm.browserModelId ? { modelId: drafts.llm.browserModelId } : {}),
    };
  } else if (
    drafts.llm.enabled &&
    drafts.llm.baseUrl &&
    (drafts.llm.apiKey || isDemoLlm(drafts.llm.baseUrl) || isLocalHost(drafts.llm.baseUrl)) &&
    drafts.llm.model
  ) {
    out.llm = {
      mode: "remote",
      flavor: drafts.llm.flavor,
      baseUrl: drafts.llm.baseUrl,
      apiKey: drafts.llm.apiKey,
      model: drafts.llm.model,
    };
  }
  if (
    drafts.stt.enabled &&
    drafts.stt.baseUrl &&
    (drafts.stt.apiKey || isLocalHost(drafts.stt.baseUrl)) &&
    drafts.stt.model
  ) {
    out.stt = {
      flavor: drafts.stt.flavor,
      baseUrl: drafts.stt.baseUrl,
      apiKey: drafts.stt.apiKey,
      model: drafts.stt.model,
    };
  }
  if (
    drafts.tts.enabled &&
    drafts.tts.baseUrl &&
    (drafts.tts.apiKey || isLocalHost(drafts.tts.baseUrl)) &&
    drafts.tts.model
  ) {
    out.tts = {
      flavor: drafts.tts.flavor,
      baseUrl: drafts.tts.baseUrl,
      apiKey: drafts.tts.apiKey,
      model: drafts.tts.model,
      voice: drafts.tts.voice,
    };
  }
  return out;
}

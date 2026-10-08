import * as React from "react";
import { useIntl } from "react-intl";
import * as v from "valibot";

import { ProviderSectionsSchema } from "@di/shared";
import type { LlmSection, ProviderEndpoint, ProviderSections, TtsEndpoint } from "@di/shared";
import { $providerProfile } from "../lib/runtime";
import { smokeTestModel } from "../lib/agent/browser-provider";
import { isDemoLlm } from "../lib/demo-llm";
import { synthesizeSpeech } from "../lib/agent/tts";
import { createOpenAiCompatibleModel } from "../lib/agent/openai-compatible-provider";
import { hasBrowserStt, probeModels, startLiveStt, testBrowserTts } from "../lib/settings-tests";
import { DiError, codeMessage, errorDetail } from "../lib/errors";
import { useSsrStore } from "../lib/ssr";
import { LLM_SMOKE_TEST_TIMEOUT_MS } from "../lib/timeouts";

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

export interface TestState {
  status: "idle" | "running" | "ok" | "err";
  message?: string;
}

export interface SettingsDrafts {
  drafts: Record<SectionKey, SectionDraft>;
  update(key: SectionKey, patch: Partial<SectionDraft>): void;
  testState: Partial<Record<SectionKey, TestState>>;
  testing: SectionKey | null;
  runTest(key: SectionKey): Promise<void>;
  /** in-browser stt read-aloud transcript output */
  sttOutput: string;
  /** true when the llm pick resolves to the managed demo endpoint */
  llmIsDemo: boolean;
}

const DraftsContext = React.createContext<SettingsDrafts | null>(null);

export function useSettingsDrafts(): SettingsDrafts {
  const ctx = React.useContext(DraftsContext);
  if (!ctx) throw new Error("useSettingsDrafts outside SettingsDraftsProvider");
  return ctx;
}

/**
 * /models poll for a draft's Model ID datalist (custom endpoint mode).
 * Failures are silent: the field stays free-text.
 */
export function useModelOptions(draft: SectionDraft): string[] {
  const [modelOptions, setModelOptions] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!draft.enabled || !draft.baseUrl || !draft.apiKey) {
      setModelOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const base = draft.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${draft.apiKey}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { data?: Array<{ id?: string }> } | null) => {
          if (cancelled || !json) return;
          const ids = (json.data ?? [])
            .map((m) => m.id ?? "")
            .filter(Boolean)
            .sort();
          setModelOptions(ids);
        })
        .catch(() => undefined);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.enabled, draft.baseUrl, draft.apiKey]);
  return modelOptions;
}

/** True when an enabled remote-section draft is missing fields (never persisted). */
export function sectionIncomplete(key: SectionKey, draft: SectionDraft): boolean {
  const isUrl = (s: string): boolean => URL.canParse(s);
  const keyMissing = !draft.apiKey && !(key === "llm" && isDemoLlm(draft.baseUrl));
  return (
    draft.enabled &&
    (key === "llm" ? draft.llmMode === "remote" : true) &&
    (!draft.baseUrl || keyMissing || !draft.model || !isUrl(draft.baseUrl))
  );
}

export function SettingsDraftsProvider(props: { children: React.ReactNode }) {
  const intl = useIntl();
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
  const [testing, setTesting] = React.useState<SectionKey | null>(null);
  const [testState, setTestState] = React.useState<Partial<Record<SectionKey, TestState>>>({});
  // STT read-aloud block: live transcript shown in a read-only textarea.
  const [sttOutput, setSttOutput] = React.useState("");
  const liveStt = React.useRef<{ stop: () => void } | null>(null);
  React.useEffect(() => () => liveStt.current?.stop(), []);

  function update(key: SectionKey, patch: Partial<SectionDraft>) {
    hydrated.current = true;
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setTestState((prev) => ({ ...prev, [key]: undefined }));
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

  async function runTest(key: SectionKey) {
    const draft = drafts[key];
    // Browser-mode LLM test skips the endpoint guards; the manager handles it.
    if (key === "llm" && draft.llmMode === "browser") {
      setTesting(key);
      setTestState((prev) => ({ ...prev, llm: { status: "running" } }));
      try {
        await smokeTestModel(
          {
            mode: "browser",
            engine: draft.engine,
            ...(draft.browserModelId ? { modelId: draft.browserModelId } : {}),
          },
          // a cached model loads in seconds; a cold 450MB download belongs
          // behind the manager's Download button, not the test.
          { timeoutMs: LLM_SMOKE_TEST_TIMEOUT_MS },
        );
        setTestState((prev) => ({
          ...prev,
          llm: { status: "ok", message: intl.formatMessage({ id: "settings.llm.testOk" }) },
        }));
      } catch (err) {
        setTestState((prev) => ({
          ...prev,
          llm: { status: "err", message: errorDetail(intl, err) },
        }));
      } finally {
        setTesting(null);
      }
      return;
    }
    // Client-side guard: an empty baseUrl/model would otherwise hit a
    // relative fetch or an empty completion and look like a false "ok".
    // Managed demo llm endpoints need no key.
    const needsKey = key !== "tts" && !(key === "llm" && isDemoLlm(draft.baseUrl));
    if (draft.enabled && (!draft.baseUrl || !draft.model || (needsKey && !draft.apiKey))) {
      setTestState((prev) => ({
        ...prev,
        [key]: { status: "err", message: intl.formatMessage({ id: "settings.invalid" }) },
      }));
      return;
    }
    if (key === "stt" && !draft.enabled) {
      // in-browser STT: run the read-aloud test with the selected mic
      if (!hasBrowserStt()) {
        setTestState((prev) => ({
          ...prev,
          stt: { status: "err", message: intl.formatMessage({ id: "settings.test.unsupported" }) },
        }));
        return;
      }
      setTesting(key);
      setTestState((prev) => ({ ...prev, stt: { status: "running" } }));
      setSttOutput("");
      liveStt.current?.stop();
      liveStt.current = startLiveStt({
        onText: (text) => setSttOutput(text),
        onError: (code) => {
          liveStt.current = null;
          setTesting(null);
          setTestState((prev) => ({
            ...prev,
            stt: { status: "err", message: codeMessage(intl, code) },
          }));
        },
        timeoutMs: 15_000,
      });
      // the session ends via its own timeout/stop; success is judged by
      // whether any transcript was captured, checked when it finishes
      const checkDone = setInterval(() => {
        if (!liveStt.current) {
          clearInterval(checkDone);
          return;
        }
      }, 500);
      setTimeout(() => {
        clearInterval(checkDone);
        if (liveStt.current) {
          liveStt.current.stop();
          liveStt.current = null;
          setTesting(null);
          setSttOutput((output) => {
            setTestState((prev) => ({
              ...prev,
              stt: output.trim()
                ? { status: "ok" }
                : { status: "err", message: intl.formatMessage({ id: "settings.stt.noSpeech" }) },
            }));
            return output;
          });
        }
      }, 15_500);
      return;
    }
    setTesting(key);
    setTestState((prev) => ({ ...prev, [key]: { status: "running" } }));
    try {
      if (key === "llm") {
        const d = draft;
        if (!d.enabled) throw new Error(intl.formatMessage({ id: "settings.test.inBrowser" }));
        const model = createOpenAiCompatibleModel(
          { baseUrl: d.baseUrl, apiKey: d.apiKey, model: d.model },
          {},
        );
        const { streamText } = await import("ai");
        let reply = "";
        const { textStream } = streamText({
          model,
          prompt: "Reply with the single word: ok",
          maxOutputTokens: 5,
        });
        for await (const delta of textStream) reply += delta;
        setTestState((prev) => ({ ...prev, llm: { status: "ok", message: reply.slice(0, 40) } }));
      } else if (key === "tts") {
        const d = draft;
        if (!d.enabled) {
          await testBrowserTts();
          setTestState((prev) => ({ ...prev, tts: { status: "ok" } }));
        } else {
          const pcm = await synthesizeSpeech(
            {
              baseUrl: d.baseUrl,
              apiKey: d.apiKey,
              model: d.model || "tts-1",
              voice: d.voice,
            },
            "hello",
          );
          if (pcm.length === 0) throw new DiError("tts.empty", undefined, "empty audio");
          setTestState((prev) => ({ ...prev, tts: { status: "ok" } }));
        }
      } else {
        await probeModels(draft);
        setTestState((prev) => ({ ...prev, stt: { status: "ok" } }));
      }
    } catch (err) {
      setTestState((prev) => ({
        ...prev,
        [key]: { status: "err", message: errorDetail(intl, err) },
      }));
    } finally {
      setTesting(null);
    }
  }

  const value: SettingsDrafts = {
    drafts,
    update,
    testState,
    testing,
    runTest,
    sttOutput,
    llmIsDemo: isDemoLlm(drafts.llm.baseUrl),
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
    (drafts.llm.apiKey || isDemoLlm(drafts.llm.baseUrl)) &&
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
  if (drafts.stt.enabled && drafts.stt.baseUrl && drafts.stt.apiKey && drafts.stt.model) {
    out.stt = {
      flavor: drafts.stt.flavor,
      baseUrl: drafts.stt.baseUrl,
      apiKey: drafts.stt.apiKey,
      model: drafts.stt.model,
    };
  }
  if (drafts.tts.enabled && drafts.tts.baseUrl && drafts.tts.apiKey && drafts.tts.model) {
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

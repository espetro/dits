import { AlertTriangle, Bot, Check, History, Loader2, X } from "lucide-react";
import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as v from "valibot";

import { useLocale } from "../lib/locale-href";
import { HistoryPane } from "./history-pane";
import { ProviderSectionsSchema } from "@di/shared";
import type {
  BrowserLlmSection,
  LlmSection,
  ProviderEndpoint,
  ProviderSections,
  TtsEndpoint,
} from "@di/shared";
import { $providerProfile, redactKey } from "../lib/runtime";
import { smokeTestModel } from "../lib/agent/browser-provider";
import { SttTestPanel } from "./stt-test-panel";
import { BrowserLlmManager } from "./browser-llm-manager";
import { EndpointFields } from "./endpoint-fields";
import { synthesizeSpeech } from "../lib/agent/tts";
import { createOpenAiCompatibleModel } from "../lib/agent/openai-compatible-provider";
import { hasBrowserStt, probeModels, startLiveStt, testBrowserTts } from "../lib/settings-tests";
import { useStore } from "@nanostores/react";
import { Button } from "./vendor/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./vendor/dialog";
import { Input } from "./vendor/input";
import { Label } from "./vendor/label";
import { RadioGroup, RadioGroupItem } from "./vendor/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./vendor/tabs";

/**
 * Centered settings dialog, ChatGPT-style: borderless left nav
 * (History / AI Provider) and an inset rounded content card. Fully URL-driven:
 * `?settings=1&pane=…` in the root search params opens it at a pane, so any
 * flow (and any QA agent) can reach it by link. Uses the root Route search
 * schema; navigate with the openSettings/clearSettings helpers below.
 */

export type SettingsPane = "history" | "aiProvider";

export interface SettingsSearch {
  settings?: "1";
  pane?: SettingsPane;
}

/** Open (or retarget) the settings dialog via URL search params. */
export function openSettings(pane: SettingsPane = "history"): void {
  const url = new URL(window.location.href);
  url.searchParams.set("settings", "1");
  url.searchParams.set("pane", pane);
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Close the dialog by dropping its search params (history back if ours). */
export function clearSettings(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("settings");
  url.searchParams.delete("pane");
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Reactive read of the settings search params. Deliberately NOT TanStack
 * validateSearch: the Start dev/prerender server canonicalizes root-route
 * search params and 307s `/?settings=1` to `/` before hydration, so the
 * dialog could never open from a cold URL. Reading the raw query string
 * keeps the params in the address bar for QA agents and deep links.
 */
function useSettingsSearch(): SettingsSearch {
  const [search, setSearch] = React.useState<SettingsSearch>(() =>
    typeof window === "undefined" ? {} : parseSettingsSearch(window.location.search),
  );
  React.useEffect(() => {
    const update = () => setSearch(parseSettingsSearch(window.location.search));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return search;
}

function parseSettingsSearch(query: string): SettingsSearch {
  const parsed = v.safeParse(
    v.object({
      settings: v.optional(v.picklist(["1"])),
      pane: v.optional(v.picklist(["history", "aiProvider"])),
    }),
    Object.fromEntries(new URLSearchParams(query)),
  );
  return {
    settings: parsed.success ? parsed.output.settings : undefined,
    pane: parsed.success ? parsed.output.pane : undefined,
  };
}

/** Mount once near the app root: mirrors ?settings&pane onto the dialog. */
export function SettingsDialogHost() {
  const { settings, pane } = useSettingsSearch();
  const open = settings === "1";
  const activePane: SettingsPane = pane ?? "history";
  return (
    <SettingsDialog
      open={open}
      onOpenChange={(next) => (next ? openSettings(activePane) : clearSettings())}
      pane={activePane}
      onPaneChange={(next) => openSettings(next)}
    />
  );
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

/** Per-section editable endpoint state (empty string = not set). */
interface SectionDraft {
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

type SectionKey = "stt" | "tts" | "llm";
type TestState = { status: "idle" | "running" | "ok" | "err"; message?: string };

const fieldClass = "block text-xs text-muted-foreground";

const helperClass = "mt-1 text-xs text-muted-foreground";

/** Pane heading: large display title over a full-width hairline rule. */
function PaneHeading(props: { title: string }) {
  return (
    <div className="border-b border-border pb-4">
      <h2 className="text-xl font-semibold tracking-tight">{props.title}</h2>
    </div>
  );
}

function AiProviderPane() {
  const intl = useIntl();
  const profile = useStore($providerProfile);
  const [tab, setTab] = React.useState<SectionKey>("llm");
  const [drafts, setDrafts] = React.useState<Record<SectionKey, SectionDraft>>(() => ({
    stt: draftFromEndpoint(profile?.stt),
    tts: draftFromEndpoint(profile?.tts),
    llm: draftFromLlm(profile?.llm),
  }));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [testing, setTesting] = React.useState<SectionKey | null>(null);
  const [testState, setTestState] = React.useState<Partial<Record<SectionKey, TestState>>>({});
  // STT read-aloud block: live transcript shown in a read-only textarea.
  const [sttOutput, setSttOutput] = React.useState("");
  const liveStt = React.useRef<{ stop: () => void } | null>(null);
  React.useEffect(() => () => liveStt.current?.stop(), []);
  // In-browser sections can only be tested when the browser actually ships
  // the Web Speech feature; computed per-render (SSR-safe, cheap).
  const browserCapable =
    typeof window !== "undefined" &&
    (tab === "stt" ? hasBrowserStt() : tab === "tts" ? "speechSynthesis" in window : false);

  // LLM in-browser capability: Gemini Nano (Prompt API) available now, or
  // transformers.js possible (WebGPU). Re-probed when the llm tab opens.
  const [llmBrowserCapable, setLlmBrowserCapable] = React.useState(false);
  React.useEffect(() => {
    if (tab !== "llm") return;
    if (typeof window === "undefined") return;
    if ("LanguageModel" in globalThis) {
      setLlmBrowserCapable(true);
      return;
    }
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      setLlmBrowserCapable(true);
      return;
    }
    setLlmBrowserCapable(false);
  }, [tab]);

  // Test results persist until the user edits an input (see `update`) or
  // re-tests. Only the "Saved." confirmation auto-clears; the timer resets
  // whenever it is scheduled again and is cleaned up on unmount.
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const timer = savedTimer.current;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  const draft = drafts[tab];

  // /models poll results for the Model ID datalist (custom endpoint mode).
  const [modelOptions, setModelOptions] = React.useState<string[]>([]);

  // Once base URL + key are set, poll the endpoint's /models and offer the
  // ids in the Model ID input's datalist. Failures are silent: the field
  // stays free-text.
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
  const llmComplete =
    !drafts.llm.enabled ||
    drafts.llm.llmMode === "browser" ||
    (drafts.llm.baseUrl && drafts.llm.apiKey && drafts.llm.model);
  const llmOk = drafts.llm.enabled ? Boolean(llmComplete) : Boolean(profile?.llm);
  const canSave = llmOk || drafts.llm.enabled;

  function update(patch: Partial<SectionDraft>) {
    setDrafts((prev) => ({ ...prev, [tab]: { ...prev[tab], ...patch } }));
    setSaved(false);
    setError(null);
    setTestState((prev) => ({ ...prev, [tab]: undefined }));
  }

  function buildProfile(): ProviderSections {
    const out: ProviderSections = {};
    if (drafts.llm.enabled && drafts.llm.llmMode === "browser") {
      out.llm = {
        mode: "browser",
        engine: drafts.llm.engine,
        ...(drafts.llm.browserModelId ? { modelId: drafts.llm.browserModelId } : {}),
      };
    } else if (drafts.llm.enabled && drafts.llm.baseUrl && drafts.llm.apiKey && drafts.llm.model) {
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

  function save() {
    setSaved(false);
    const profile = buildProfile();
    if (!profile.llm) {
      setError(intl.formatMessage({ id: "settings.llmRequired" }));
      return;
    }
    const parsed = v.safeParse(ProviderSectionsSchema, profile);
    if (!parsed.success) {
      setError(intl.formatMessage({ id: "settings.invalid" }));
      return;
    }
    setError(null);
    $providerProfile.set(parsed.output);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 3000);
  }

  async function runTest() {
    // Browser-mode LLM test skips the endpoint guards; the manager handles it.
    if (tab === "llm" && draft.llmMode === "browser") {
      setTesting(tab);
      setTestState((prev) => ({ ...prev, llm: { status: "running" } }));
      try {
        await smokeTestModel({
          mode: "browser",
          engine: draft.engine,
          ...(draft.browserModelId ? { modelId: draft.browserModelId } : {}),
        });
        setTestState((prev) => ({
          ...prev,
          llm: { status: "ok", message: intl.formatMessage({ id: "settings.llm.testOk" }) },
        }));
      } catch (err) {
        setTestState((prev) => ({
          ...prev,
          llm: { status: "err", message: err instanceof Error ? err.message : String(err) },
        }));
      } finally {
        setTesting(null);
      }
      return;
    }
    // Client-side guard: an empty baseUrl/model would otherwise hit a
    // relative fetch or an empty completion and look like a false "ok".
    if (draft.enabled && (!draft.baseUrl || !draft.model || (tab !== "tts" && !draft.apiKey))) {
      setTestState((prev) => ({
        ...prev,
        [tab]: { status: "err", message: intl.formatMessage({ id: "settings.invalid" }) },
      }));
      return;
    }
    if (tab === "stt" && !draft.enabled) {
      // in-browser STT: run the read-aloud test with the selected mic
      if (!hasBrowserStt()) {
        setTestState((prev) => ({
          ...prev,
          stt: { status: "err", message: intl.formatMessage({ id: "settings.test.unsupported" }) },
        }));
        return;
      }
      setTesting(tab);
      setTestState((prev) => ({ ...prev, stt: { status: "running" } }));
      setSttOutput("");
      liveStt.current?.stop();
      liveStt.current = startLiveStt({
        onText: (text) => setSttOutput(text),
        onError: (message) => {
          liveStt.current = null;
          setTesting(null);
          setTestState((prev) => ({
            ...prev,
            stt: { status: "err", message },
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
    setTesting(tab);
    setTestState((prev) => ({ ...prev, [tab]: { status: "running" } }));
    try {
      if (tab === "llm") {
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
      } else if (tab === "tts") {
        const d = draft;
        if (!d.enabled) {
          await testBrowserTts();
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
          if (pcm.length === 0) throw new Error("empty audio");
          setTestState((prev) => ({ ...prev, tts: { status: "ok" } }));
        }
      } else {
        await probeModels(draft);
        setTestState((prev) => ({ ...prev, stt: { status: "ok" } }));
      }
    } catch (err) {
      setTestState((prev) => ({
        ...prev,
        [tab]: { status: "err", message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setTesting(null);
    }
  }

  const tabs: { key: SectionKey; label: string }[] = [
    { key: "stt", label: intl.formatMessage({ id: "settings.stt" }) },
    { key: "tts", label: intl.formatMessage({ id: "settings.tts" }) },
    { key: "llm", label: intl.formatMessage({ id: "settings.llm" }) },
  ];
  const state = testState[tab];

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(value) => setTab(value as SectionKey)}>
        <TabsList className="rounded-full">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="rounded-full px-3 text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* forceMount keeps every content node in the DOM (Radix hides
            inactive ones with the hidden attribute) so each trigger's
            aria-controls always resolves to a real id. */}
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} forceMount>
            {tab === t.key && (
              <div className="space-y-5 rounded-xl border border-border p-4">
                <RadioGroup
                  value={draft.enabled ? "custom" : "browser"}
                  onValueChange={(value) => update({ enabled: value === "custom" })}
                  className="flex flex-wrap gap-4"
                >
                  <Label className="flex items-center gap-1.5 text-sm font-normal">
                    <RadioGroupItem
                      value="browser"
                      disabled={tab === "llm" && !llmBrowserCapable}
                    />
                    <FormattedMessage id="settings.inBrowser" />
                  </Label>
                  <Label className="flex items-center gap-1.5 text-sm font-normal">
                    <RadioGroupItem value="custom" />
                    <FormattedMessage id="settings.customEndpoint" />
                  </Label>
                </RadioGroup>
                {tab === "llm" && draft.enabled && draft.llmMode === "remote" && (
                  <div className="space-y-1.5">
                    <span className={fieldClass}>
                      <FormattedMessage id="settings.flavor" />
                    </span>
                    <select
                      value={draft.flavor}
                      onChange={(e) => update({ flavor: e.target.value as "openai" | "anthropic" })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-persimmon/50"
                    >
                      <option value="openai">
                        {intl.formatMessage({ id: "settings.flavor.openai" })}
                      </option>
                      <option value="anthropic">
                        {intl.formatMessage({ id: "settings.flavor.anthropic" })}
                      </option>
                    </select>
                    <span className={helperClass}>
                      <FormattedMessage id="settings.flavorHelp" />
                    </span>
                  </div>
                )}
                {tab === "llm" && draft.llmMode === "browser" && (
                  <BrowserLlmManager
                    engine={draft.engine}
                    modelId={draft.browserModelId}
                    onEngineChange={(engine) => update({ engine })}
                    onModelIdChange={(browserModelId) => update({ browserModelId })}
                  />
                )}
                {tab === "llm" && !draft.enabled && (
                  <p className="text-xs text-muted-foreground">
                    <FormattedMessage id="settings.llmRequired" />
                  </p>
                )}
                {tab === "llm" && (
                  <div
                    role="note"
                    className="flex gap-2 rounded-lg border border-persimmon/30 bg-persimmon/5 p-3 text-xs text-espresso-soft"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-persimmon-deep"
                      aria-hidden="true"
                    />
                    <FormattedMessage id="settings.llm.inBrowserWarning" />
                  </div>
                )}

                {tab === "stt" && <SttTestPanel inBrowser={!draft.enabled} output={sttOutput} />}
                {draft.enabled && (
                  <EndpointFields
                    tab={tab}
                    draft={draft}
                    savedApiKey={
                      profile?.[tab]
                        ? redactKey(("apiKey" in profile[tab] ? profile[tab].apiKey : "") as string)
                        : null
                    }
                    modelOptions={modelOptions}
                    onChange={(patch) => update(patch)}
                  />
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void runTest()}
                      disabled={(!draft.enabled && !browserCapable) || testing === tab}
                      aria-busy={testing === tab}
                      title={
                        !draft.enabled && !browserCapable
                          ? intl.formatMessage({ id: "settings.test.unsupported" })
                          : undefined
                      }
                    >
                      {testing === tab ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          <FormattedMessage id="settings.testing" />
                        </>
                      ) : (
                        <FormattedMessage id="settings.test" />
                      )}
                    </Button>
                    {!draft.enabled && !browserCapable && (
                      <span role="note" className="text-xs text-muted-foreground">
                        <FormattedMessage id="settings.test.unsupported" />
                      </span>
                    )}
                    {state?.status === "ok" && (
                      <span
                        role="status"
                        className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        <FormattedMessage id="settings.testOk" />
                        {state.message ? `: ${state.message}` : ""}
                      </span>
                    )}
                    {state?.status === "err" && (
                      <span role="status" className="flex items-center gap-1 text-xs text-red-600">
                        <X className="size-3.5" aria-hidden="true" />
                        <FormattedMessage
                          id="settings.testFailed"
                          values={{ message: state.message ?? "" }}
                        />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:ml-auto">
                    {saved && (
                      <span
                        role="status"
                        className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        <FormattedMessage id="settings.saved" />
                      </span>
                    )}
                    <Button type="button" size="sm" onClick={save} disabled={!canSave}>
                      <FormattedMessage id="settings.save" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange, pane, onPaneChange }: SettingsDialogProps) {
  const isMobile = useIsMobile();
  const intl = useIntl();

  const tabs: { id: SettingsPane; label: string; icon: React.ReactNode }[] = [
    {
      id: "history",
      label: intl.formatMessage({ id: "settings.history" }),
      icon: <History className="size-4" aria-hidden="true" />,
    },
    {
      id: "aiProvider",
      label: intl.formatMessage({ id: "settings.aiProvider" }),
      icon: <Bot className="size-4" aria-hidden="true" />,
    },
  ];

  const configTabs = tabs.filter((tab) => tab.id !== "history");

  const nav = (
    <>
      {tabs
        .filter((tab) => tab.id === "history")
        .map((tab) => (
          <Button
            key={tab.id}
            variant="ghost"
            className={
              "h-9 w-full min-w-0 justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm font-normal " +
              (pane === tab.id
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
            }
            onClick={() => onPaneChange(tab.id)}
          >
            {tab.icon}
            <span className="truncate">{tab.label}</span>
          </Button>
        ))}
      {/* cached session data sits apart from actual configuration */}
      <div role="separator" className="mx-1 my-2 border-t border-border" />
      {configTabs.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          className={
            "h-9 w-full min-w-0 justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm font-normal " +
            (pane === tab.id
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
          }
          onClick={() => onPaneChange(tab.id)}
        >
          {tab.icon}
          <span className="truncate">{tab.label}</span>
        </Button>
      ))}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "inset-0 flex h-svh w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 bg-background p-0 [&>button]:hidden"
            : "flex h-[min(40rem,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-4xl flex-row gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl [&>button]:hidden lg:max-w-5xl"
        }
      >
        <DialogTitle className="sr-only">
          <FormattedMessage id="settings.title" />
        </DialogTitle>
        <DialogDescription className="sr-only">
          <FormattedMessage id="settings.history" /> and{" "}
          <FormattedMessage id="settings.aiProvider" />
        </DialogDescription>
        {isMobile ? (
          <div className="flex shrink-0 items-center justify-between border-b border-border p-2">
            <Tabs value={pane} onValueChange={(value) => onPaneChange(value as SettingsPane)}>
              <TabsList className="w-full">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} className="flex-1 gap-1.5 px-2 text-xs">
                    {tab.icon}
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <DialogClose
              className="ml-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={clearSettings}
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">
                <FormattedMessage id="settings.close" />
              </span>
            </DialogClose>
          </div>
        ) : (
          <nav className="flex w-60 shrink-0 flex-col p-5">
            <div className="pb-5">
              <DialogClose
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                onClick={clearSettings}
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">
                  <FormattedMessage id="settings.close" />
                </span>
              </DialogClose>
            </div>
            <div className="flex flex-col gap-y-1">{nav}</div>
          </nav>
        )}
        <div
          className={
            isMobile
              ? "flex-1 overflow-y-auto p-3"
              : "my-3 mr-3 flex-1 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-sm"
          }
        >
          {isMobile ? (
            pane === "history" ? (
              <HistoryPane />
            ) : (
              <AiProviderPane />
            )
          ) : (
            <div
              className={
                pane === "history" ? "mx-auto max-w-2xl space-y-10" : "mx-auto max-w-xl space-y-10"
              }
            >
              <PaneHeading
                title={intl.formatMessage({
                  id: pane === "history" ? "settings.history" : "settings.aiProvider",
                })}
              />
              {pane === "history" ? <HistoryPane /> : <AiProviderPane />}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pane: SettingsPane;
  onPaneChange: (pane: SettingsPane) => void;
}

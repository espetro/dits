import { Bot, Check, History, Loader2, X } from "lucide-react";
import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "@tanstack/react-router";
import * as v from "valibot";

import { withLocale, useLocale } from "../lib/locale-href";
import { listClientSessions } from "../lib/opfs-store";
import type { Session } from "@di/shared/session";
import { ProviderSectionsSchema } from "@di/shared";
import type { ProviderEndpoint, ProviderSections, TtsEndpoint } from "@di/shared";
import { $providerProfile, redactKey } from "../lib/runtime";
import { synthesizeSpeech } from "../lib/agent/tts";
import { createOpenAiCompatibleModel } from "../lib/agent/openai-compatible-provider";
import { useStore } from "@nanostores/react";
import { Button } from "./vendor/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./vendor/dialog";
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

function useHistoryPane() {
  const locale = useLocale();
  const intl = useIntl();
  const [sessions, setSessions] = React.useState<Session[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listClientSessions()
      .then((all) => {
        if (cancelled) return;
        all.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setSessions(all);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function target(s: Session): string {
    if (s.status === "reported") return withLocale(locale, `/report/${s.id}`);
    if (s.status === "finished") return withLocale(locale, `/finish/${s.id}`);
    return withLocale(locale, `/interview/${s.id}`);
  }

  function relative(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days < 1) return intl.formatMessage({ id: "history.today" });
    if (days === 1) return intl.formatMessage({ id: "history.yesterday" });
    if (days < 7) return intl.formatMessage({ id: "history.daysAgo" }, { n: days });
    return intl.formatMessage({ id: "history.weeksAgo" }, { n: Math.floor(days / 7) });
  }

  return { sessions, target, relative };
}

function HistoryPane() {
  const { sessions, target, relative } = useHistoryPane();

  if (sessions === null) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <FormattedMessage id="history.empty" />
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <Link
          key={s.id}
          to={target(s)}
          className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{s.title}</span>
            <span className="block text-xs text-muted-foreground">
              {s.status} · {relative(s.created_at)}
            </span>
          </span>
          <span
            className={
              "ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
              (s.status === "reported"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground")
            }
          >
            {s.status}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Per-section editable endpoint state (empty string = not set). */
interface SectionDraft {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

const EMPTY_SECTION: SectionDraft = {
  enabled: false,
  baseUrl: "",
  apiKey: "",
  model: "",
  voice: "",
};

function draftFromEndpoint(endpoint: ProviderEndpoint | TtsEndpoint | undefined): SectionDraft {
  if (!endpoint) return { ...EMPTY_SECTION };
  return {
    enabled: true,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    model: endpoint.model,
    voice: "voice" in endpoint ? endpoint.voice : "",
  };
}

type SectionKey = "stt" | "tts" | "llm";
type TestState = { status: "idle" | "running" | "ok" | "err"; message?: string };

const fieldClass = "block text-xs text-muted-foreground";

/** Clickable free-provider links shared by the LLM/STT/TTS helper notes. */
const FREE_PROVIDERS = [
  { name: "OpenRouter", href: "https://openrouter.ai/" },
  { name: "Groq", href: "https://console.groq.com/home" },
  { name: "Cerebras", href: "https://inference.cerebras.ai/" },
  { name: "Google AI Studio", href: "https://aistudio.google.com/" },
];

function FreeProviderLinks() {
  return (
    <>
      {FREE_PROVIDERS.map((p, i) => (
        <React.Fragment key={p.name}>
          {i > 0 && ", "}
          <a
            href={p.href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-persimmon-text"
          >
            {p.name}
          </a>
        </React.Fragment>
      ))}
      {"."}
    </>
  );
}

/** /models probe shared by all sections: the endpoint class is the same. */
async function probeModels(draft: SectionDraft): Promise<void> {
  const base = draft.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const res = await fetch(`${base}/v1/models`, {
    headers: { authorization: `Bearer ${draft.apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function AiProviderPane() {
  const intl = useIntl();
  const profile = useStore($providerProfile);
  const [tab, setTab] = React.useState<SectionKey>("llm");
  const [drafts, setDrafts] = React.useState<Record<SectionKey, SectionDraft>>(() => ({
    stt: draftFromEndpoint(profile?.stt),
    tts: draftFromEndpoint(profile?.tts),
    llm: profile?.llm
      ? {
          enabled: true,
          baseUrl: profile.llm.baseUrl,
          apiKey: profile.llm.apiKey,
          model: profile.llm.model,
          voice: "",
        }
      : // LLM has no usable in-browser fallback on most setups, so the
        // section defaults to a custom endpoint (the in-browser radio is
        // disabled for LLM anyway).
        { ...EMPTY_SECTION, enabled: true },
  }));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [testing, setTesting] = React.useState<SectionKey | null>(null);
  const [testState, setTestState] = React.useState<Partial<Record<SectionKey, TestState>>>({});

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
  const llmComplete =
    !drafts.llm.enabled || (drafts.llm.baseUrl && drafts.llm.apiKey && drafts.llm.model);
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
    if (drafts.llm.enabled && drafts.llm.baseUrl && drafts.llm.apiKey && drafts.llm.model) {
      out.llm = { baseUrl: drafts.llm.baseUrl, apiKey: drafts.llm.apiKey, model: drafts.llm.model };
    }
    if (drafts.stt.enabled && drafts.stt.baseUrl && drafts.stt.apiKey && drafts.stt.model) {
      out.stt = { baseUrl: drafts.stt.baseUrl, apiKey: drafts.stt.apiKey, model: drafts.stt.model };
    }
    if (drafts.tts.enabled && drafts.tts.baseUrl && drafts.tts.apiKey && drafts.tts.model) {
      out.tts = {
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
    // Client-side guard: an empty baseUrl/model would otherwise hit a
    // relative fetch or an empty completion and look like a false "ok".
    if (!draft.baseUrl || !draft.model || (tab !== "tts" && !draft.apiKey)) {
      setTestState((prev) => ({
        ...prev,
        [tab]: { status: "err", message: intl.formatMessage({ id: "settings.invalid" }) },
      }));
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
        if (!d.enabled) throw new Error(intl.formatMessage({ id: "settings.test.inBrowser" }));
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
      } else {
        if (!draft.enabled) throw new Error(intl.formatMessage({ id: "settings.test.inBrowser" }));
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
              <div className="space-y-4 rounded-xl border border-border p-4">
                <RadioGroup
                  value={draft.enabled ? "custom" : "browser"}
                  onValueChange={(value) => update({ enabled: value === "custom" })}
                  className="flex flex-wrap gap-4"
                >
                  <Label className="flex items-center gap-1.5 text-sm font-normal">
                    <RadioGroupItem value="browser" disabled={tab === "llm"} />
                    <FormattedMessage id="settings.inBrowser" />
                  </Label>
                  <Label className="flex items-center gap-1.5 text-sm font-normal">
                    <RadioGroupItem value="custom" />
                    <FormattedMessage id="settings.customEndpoint" />
                  </Label>
                </RadioGroup>
                {tab === "llm" && (
                  <p className="text-xs text-muted-foreground">
                    <FormattedMessage id="settings.llmRequired" />
                  </p>
                )}

                {draft.enabled && (
                  <div className="space-y-2">
                    <label className="block">
                      <span className={fieldClass}>
                        <FormattedMessage id="settings.baseUrl" />
                      </span>
                      <Input
                        value={draft.baseUrl}
                        onChange={(e) => update({ baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                        className="mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className={fieldClass}>
                        <FormattedMessage id="settings.apiKey" />
                      </span>
                      <Input
                        type="password"
                        value={draft.apiKey}
                        onChange={(e) => update({ apiKey: e.target.value })}
                        placeholder={
                          profile?.[tab]
                            ? intl.formatMessage(
                                { id: "settings.apiKeySaved" },
                                { key: redactKey(profile[tab]!.apiKey) },
                              )
                            : ""
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className={fieldClass}>
                        <FormattedMessage id="settings.model" />
                      </span>
                      <Input
                        value={draft.model}
                        onChange={(e) => update({ model: e.target.value })}
                        className="mt-1"
                      />
                    </label>
                    {tab === "tts" && (
                      <label className="block">
                        <span className={fieldClass}>
                          <FormattedMessage id="settings.voice" />
                        </span>
                        <Input
                          value={draft.voice}
                          onChange={(e) => update({ voice: e.target.value })}
                          className="mt-1"
                        />
                      </label>
                    )}
                    <p className="text-xs text-muted-foreground">
                      <FormattedMessage id="settings.customProviders" />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <FormattedMessage id="settings.freeProvidersLabel" /> <FreeProviderLinks />
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void runTest()}
                      disabled={!draft.enabled || testing === tab}
                      aria-busy={testing === tab}
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
                  <div className="flex items-center gap-2">
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

  const nav = (
    <>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          className={
            "h-9 w-full min-w-0 justify-start gap-2.5 rounded-lg px-3 text-sm font-normal " +
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
            : "flex h-[min(34rem,calc(100vh-4rem))] w-[calc(100vw-2rem)] max-w-3xl flex-row gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl"
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
          <div className="shrink-0 border-b border-border p-2">
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
          </div>
        ) : (
          <nav className="flex w-48 shrink-0 flex-col gap-1 p-3 pt-4">{nav}</nav>
        )}
        <div
          className={
            isMobile
              ? "flex-1 overflow-y-auto p-3"
              : "my-3 mr-3 flex-1 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-sm"
          }
        >
          {pane === "history" ? <HistoryPane /> : <AiProviderPane />}
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

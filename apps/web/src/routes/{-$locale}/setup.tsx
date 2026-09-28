import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLocaleNav, withLocale } from "../../lib/locale-href";
import { FormattedMessage, useIntl } from "react-intl";
import * as React from "react";
import { useStore } from "@nanostores/react";
import { useSsrStore } from "../../lib/ssr";
import { useQuery } from "@tanstack/react-query";
import { $draft, $interviewLanguage } from "../../stores/session";
import { $micDeviceId } from "../../stores/devices";
import { createSession, listSessions, uploadDocuments } from "../../lib/api";
import { MicSelector } from "../../components/mic-selector";
import { Button } from "../../components/vendor/button";
import { Textarea } from "../../components/vendor/textarea";
import { RadioGroup } from "../../components/vendor/radio-group";
import { RadioPill, RadioPills } from "../../components/radio-pills";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/vendor/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/vendor/collapsible";
import { Alert, AlertDescription } from "../../components/vendor/alert";
import {
  $effectiveRuntime,
  $providerProfile,
  $serverReachable,
  ensureRuntimeProbe,
  probeServer,
} from "../../lib/runtime";
import { openSettings } from "../../components/settings-nav";
import { createClientSession, listClientSessions } from "../../lib/opfs-store";
import { resetClientSession } from "../../lib/agent/session-store";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { ScenarioCard } from "../../components/scenario-card";
import type { Scenario } from "../../components/scenario-card";
import { intlFor } from "../../locales/i18n";
import { errorDetail } from "../../lib/errors";
import { DEFAULT_SESSION_TOOLS, DOCUMENT_CAPS } from "@di/shared";

// Pre-upload mirror of the server-enforced caps (rag/ingest.ts); the
// operator can raise the server side via documents.max_* config keys.
const MAX_FILES = DOCUMENT_CAPS.maxFiles;
const MAX_TOTAL_BYTES = DOCUMENT_CAPS.maxTotalBytes;
const ACCEPTED = [".pdf", ".md", ".markdown", ".txt", ".docx"];

export const Route = createFileRoute("/{-$locale}/setup")({
  head: ({ params }) => ({
    meta: [{ title: intlFor(params.locale ?? "en").formatMessage({ id: "meta.title.setup" }) }],
  }),
  component: Setup,
});

const SCENARIOS: Scenario[] = [
  {
    id: "sysDesign",
    promptKey: "setup.scenario.sysDesign.prompt",
    goalCount: 3,
    tools: { editor: "", whiteboard: "" },
  },
  {
    id: "behavioral",
    promptKey: "setup.scenario.behavioral.prompt",
    goalCount: 3,
    tools: { editor: "" },
  },
  {
    id: "frontend",
    promptKey: "setup.scenario.frontend.prompt",
    goalCount: 3,
    tools: { editor: "" },
  },
  {
    id: "ml",
    promptKey: "setup.scenario.ml.prompt",
    goalCount: 3,
    tools: { editor: "" },
  },
  {
    id: "custom",
    // custom keeps whatever the candidate typed — the textarea drives it
    goalCount: 0,
    tools: { ...DEFAULT_SESSION_TOOLS },
  },
];

const DURATIONS = [20, 30, 45, 60];
const TONES = ["friendly", "challenging", "neutral"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const LANGUAGES = ["en", "es", "fr", "de", "it", "pt-br", "ja", "ko", "zh-cn", "ar"];

const fieldHeadingClass = "text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft";

function Setup() {
  const { locale } = useLocaleNav();
  const intl = useIntl();
  const scenarioPrompt = (scenario?: Scenario) =>
    scenario?.promptKey ? intl.formatMessage({ id: scenario.promptKey }) : "";
  const draft = useStore($draft);
  const micDeviceId = useSsrStore($micDeviceId, "");
  const effectiveRuntime = useSsrStore($effectiveRuntime, "server");
  const clientOnly = effectiveRuntime !== "server";
  const profile = useSsrStore($providerProfile, null);
  // coach unlock gate (p1): available once any session reached `reported`.
  const { data: hasReport } = useQuery({
    queryKey: ["has-report", effectiveRuntime],
    queryFn: async () =>
      (clientOnly ? await listClientSessions() : await listSessions()).some(
        (s) => s.status === "reported",
      ),
  });
  React.useEffect(() => {
    ensureRuntimeProbe();
    // A stale persisted "reachable" value would skip the probe and send the
    // session POST at a static host (405, dead button). Re-probe on mount
    // whenever reachability is not freshly confirmed this session.
    if ($serverReachable.get() !== false) void probeServer();
  }, []);
  const navigate = useNavigate();
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const languageNames = React.useMemo(
    function makeLanguageNames() {
      return new Intl.DisplayNames([intl.locale], { type: "language" });
    },
    [intl.locale],
  );

  function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return;
    setError(null);
    const accepted: File[] = [];
    for (const f of incoming) {
      const ext = `.${f.name.split(".").pop()?.toLowerCase()}`;
      if (!ACCEPTED.includes(ext)) {
        setError(intl.formatMessage({ id: "setup.filesBadType" }, { name: f.name }));
        continue;
      }
      accepted.push(f);
    }
    setFiles((prev) => {
      const next = [...prev, ...accepted];
      if (next.length > MAX_FILES) {
        setError(intl.formatMessage({ id: "setup.filesTooMany" }, { max: MAX_FILES }));
        return next.slice(0, MAX_FILES);
      }
      if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
        setError(intl.formatMessage({ id: "setup.filesTooBig" }));
        return prev;
      }
      return next;
    });
  }

  async function start(validate: boolean, scenario?: Scenario) {
    // guard tied to the runtime FSM: custom/in-browser sessions run the
    // agent loop client-side, which is impossible without an LLM endpoint
    if (clientOnly && !profile?.llm) {
      toast.error(intl.formatMessage({ id: "setup.needsProviderToast" }), {
        description: intl.formatMessage({ id: "setup.needsProvider" }),
      });
      openSettings("ai");
      return;
    }
    setBusy(true);
    setError(null);
    if (scenario) {
      setSelectedId(scenario.id);
      const preset = scenarioPrompt(scenario);
      if (preset) $draft.set({ ...draft, prompt: preset });
    }
    const tools =
      scenario?.tools ?? SCENARIOS.find((s) => s.id === selectedId)?.tools ?? DEFAULT_SESSION_TOOLS;
    const prompt = buildBriefWith(scenario);
    try {
      const title =
        (scenario && scenario.id !== "custom"
          ? intl.formatMessage({ id: `setup.preset.${scenario.id}` })
          : draft.title) || intl.formatMessage({ id: "setup.defaultTitle" });
      if (clientOnly) {
        resetClientSession();
        const session = await createClientSession({
          title,
          mode: draft.mode,
          duration_min: draft.durationMin,
          tools,
          prompt: prompt || undefined,
        });
        // no ingestion pipeline client-side: say so rather than dropping silently.
        if (files.length > 0) {
          toast.error(intl.formatMessage({ id: "setup.filesServerOnly" }));
        }
        navigate({
          href: withLocale(
            locale,
            validate ? `/validate/${session.id}` : `/interview/${session.id}`,
          ),
        });
        return;
      }
      const session = await createSession({
        title,
        mode: draft.mode,
        duration_min: draft.durationMin,
        tools,
        prompt: prompt || undefined,
      });
      if (files.length > 0) {
        try {
          await uploadDocuments(session.id, files);
        } catch (err) {
          // ingestion failure must not block starting the interview
          setError(errorDetail(intl, err));
        }
      }
      navigate({
        href: withLocale(locale, validate ? `/validate/${session.id}` : `/interview/${session.id}`),
      });
    } catch (err) {
      // a dead/unexpected server surface (405 from a static host, network
      // error, 5xx) must never silently swallow the click: tell the user,
      // refresh reachability so the next attempt uses the client runtime.
      const probed = await probeServer();
      if (!probed) {
        toast.error(intl.formatMessage({ id: "setup.startFailedToast" }), {
          description: intl.formatMessage({ id: "setup.needsProvider" }),
        });
      } else {
        setError(errorDetail(intl, err));
      }
    } finally {
      setBusy(false);
    }
  }

  // Card starts use the scenario's prompt (the textarea is already synced,
  // but build it off the card value so it is right even pre-sync).
  function buildBriefWith(scenario?: Scenario): string {
    const base = scenarioPrompt(scenario) || draft.prompt;
    const knobs = [
      draft.tone !== "friendly" ? `tone: ${draft.tone}` : null,
      draft.difficulty !== "medium" ? `difficulty: ${draft.difficulty}` : null,
      draft.language !== "en" ? `language: ${draft.language}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return [base.trim(), knobs].filter(Boolean).join("\n\n");
  }

  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 md:px-8">
        <div className="rounded-shell bg-paper p-2 ring-1 ring-hairline">
          <div className="rounded-[calc(2rem-0.375rem)] bg-cream p-6 sm:p-8 lg:p-12">
            {clientOnly && !profile?.llm && (
              <section className="rise-in mb-10 rounded-card bg-white/70 p-4 ring-1 ring-hairline">
                <p className="text-sm text-espresso-soft">
                  <FormattedMessage id="setup.needsProvider" />
                </p>
                <Button
                  variant="ghost"
                  onClick={() => openSettings("ai")}
                  className="mt-3 h-auto min-h-11 rounded-full bg-white px-5 py-2 font-body text-sm font-medium text-espresso ring-1 ring-hairline transition-fluid hover:bg-white hover:ring-persimmon/50"
                >
                  <FormattedMessage id="setup.openProviderSettings" />
                </Button>
              </section>
            )}

            <section className="rise-in" style={{ "--rise-delay": "0ms" } as React.CSSProperties}>
              <h2 id="setup-scenario-heading" className={fieldHeadingClass}>
                <FormattedMessage id="setup.pickScenario" />
              </h2>
              <RadioGroup
                value={selectedId ?? ""}
                onValueChange={(v) => {
                  setSelectedId(v);
                  const picked = SCENARIOS.find((s) => s.id === v);
                  const preset = scenarioPrompt(picked);
                  if (preset) $draft.set({ ...draft, prompt: preset });
                }}
                aria-labelledby="setup-scenario-heading"
                className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {SCENARIOS.map((s) => (
                  <ScenarioCard
                    key={s.id}
                    scenario={s}
                    busy={busy}
                    onStart={() => void start(false, s)}
                  />
                ))}
              </RadioGroup>
            </section>

            <section
              className="rise-in mt-10"
              style={{ "--rise-delay": "120ms" } as React.CSSProperties}
            >
              <h2 id="setup-prompt-label" className={fieldHeadingClass}>
                <FormattedMessage id="setup.promptLabel" />
              </h2>
              <Textarea
                value={draft.prompt}
                onChange={(e) => $draft.set({ ...draft, prompt: e.target.value })}
                placeholder={intl.formatMessage({
                  id: "setup.promptPlaceholder",
                })}
                rows={4}
                aria-labelledby="setup-prompt-label"
                className="mt-3 w-full resize-none rounded-card bg-white p-4 text-sm ring-1 ring-hairline outline-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-espresso-soft focus-visible:ring-2 focus-visible:ring-persimmon/50"
              />
            </section>

            {error && (
              <Alert
                ref={(node) => node?.focus()}
                tabIndex={-1}
                variant="destructive"
                className="rise-in mt-6 border-0 bg-white ring-1 ring-persimmon/40"
              >
                <AlertDescription className="text-persimmon-deep">{error}</AlertDescription>
              </Alert>
            )}

            {/* advanced options: every knob is pre-picked — cards are zero-knob */}
            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              className="rise-in mt-10"
              style={{ "--rise-delay": "240ms" } as React.CSSProperties}
            >
              <CollapsibleTrigger className="flex min-h-11 items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft transition-fluid hover:text-espresso">
                <ChevronDown
                  className={`size-4 transition-transform duration-300 ${advancedOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
                <FormattedMessage id="setup.advanced" />
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-4 flex flex-col gap-8 rounded-card bg-white/50 p-5 ring-1 ring-hairline">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 id="setup-duration-label" className={fieldHeadingClass}>
                      <FormattedMessage id="setup.duration" />
                    </h3>
                    <RadioPills
                      value={String(draft.durationMin)}
                      onValueChange={(v) => $draft.set({ ...draft, durationMin: Number(v) })}
                      aria-labelledby="setup-duration-label"
                    >
                      {DURATIONS.map((d) => (
                        <RadioPill key={d} value={String(d)}>
                          {d}
                        </RadioPill>
                      ))}
                    </RadioPills>
                  </div>
                  <div>
                    <h3 id="setup-mode-label" className={fieldHeadingClass}>
                      <FormattedMessage id="setup.mode" />
                    </h3>
                    <RadioPills
                      value={draft.mode}
                      onValueChange={(v) =>
                        $draft.set({ ...draft, mode: v as "interview" | "coach" })
                      }
                      aria-labelledby="setup-mode-label"
                    >
                      <RadioPill value="interview">
                        <FormattedMessage id="setup.mode.interview" />
                      </RadioPill>
                      <RadioPill value="coach" disabled={!hasReport}>
                        <FormattedMessage id="setup.mode.coach" />
                        {!hasReport && (
                          <span className="text-[10px] uppercase tracking-wide opacity-60">
                            · <FormattedMessage id="setup.coachHint" />
                          </span>
                        )}
                      </RadioPill>
                    </RadioPills>
                    {!hasReport && (
                      <p className="mt-2 text-xs text-espresso-soft">
                        <FormattedMessage id="setup.coachHint" />
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <h3 id="setup-tone-label" className={fieldHeadingClass}>
                      <FormattedMessage id="setup.tone" />
                    </h3>
                    <RadioPills
                      value={draft.tone}
                      onValueChange={(v) => $draft.set({ ...draft, tone: v })}
                      aria-labelledby="setup-tone-label"
                    >
                      {TONES.map((t) => (
                        <RadioPill key={t} value={t}>
                          <FormattedMessage id={`setup.tone.${t}`} />
                        </RadioPill>
                      ))}
                    </RadioPills>
                  </div>
                  <div>
                    <h3 id="setup-difficulty-label" className={fieldHeadingClass}>
                      <FormattedMessage id="setup.difficulty" />
                    </h3>
                    <RadioPills
                      value={draft.difficulty}
                      onValueChange={(v) => $draft.set({ ...draft, difficulty: v })}
                      aria-labelledby="setup-difficulty-label"
                    >
                      {DIFFICULTIES.map((d) => (
                        <RadioPill key={d} value={d}>
                          <FormattedMessage id={`setup.difficulty.${d}`} />
                        </RadioPill>
                      ))}
                    </RadioPills>
                  </div>
                  <div>
                    <h3 id="setup-language-label" className={fieldHeadingClass}>
                      <FormattedMessage id="setup.language" />
                    </h3>
                    <Select
                      value={draft.language}
                      onValueChange={(v) => {
                        $draft.set({ ...draft, language: v });
                        $interviewLanguage.set(v);
                      }}
                    >
                      <SelectTrigger
                        aria-labelledby="setup-language-label"
                        className="mt-3 min-h-11 w-full rounded-full border-0 bg-white px-4 text-sm text-espresso ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-2 focus-visible:ring-persimmon/50 sm:min-h-9"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l} value={l}>
                            {languageNames.of(l) ?? l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <h3 className={fieldHeadingClass}>
                    <FormattedMessage id="setup.files" />{" "}
                    <span className="normal-case tracking-normal text-espresso-soft">
                      · <FormattedMessage id="setup.filesHint" />
                    </span>
                  </h3>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={ACCEPTED.join(",")}
                    className="hidden"
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {clientOnly ? (
                    <div className="mt-3 rounded-card border border-dashed border-espresso-faint/40 bg-white/40 p-6 text-center text-sm text-espresso-soft md:p-8">
                      <FormattedMessage id="setup.filesServerOnly" />
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={intl.formatMessage({ id: "setup.dropHint" })}
                      onClick={() => fileInput.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          fileInput.current?.click();
                        }
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        addFiles(e.dataTransfer.files);
                      }}
                      className="mt-3 cursor-pointer rounded-card border border-dashed border-espresso-faint/40 bg-white/60 p-6 text-center text-sm text-espresso-soft transition-fluid hover:border-persimmon/50 hover:text-espresso-soft md:p-8"
                    >
                      <FormattedMessage id="setup.dropHint" />
                    </div>
                  )}
                  {files.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {files.map((f, i) => (
                        <li
                          key={`${f.name}-${i}`}
                          className="flex min-w-0 items-center justify-between gap-2 rounded-full bg-white px-4 py-2 text-sm ring-1 ring-hairline"
                        >
                          <span className="truncate text-espresso">{f.name}</span>
                          <span className="ml-3 flex shrink-0 items-center gap-3 text-xs text-espresso-soft">
                            {Math.round(f.size / 1024)} kb
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={intl.formatMessage(
                                { id: "setup.fileRemove" },
                                { name: f.name },
                              )}
                              onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                              className="text-espresso-soft transition-fluid hover:bg-transparent hover:text-persimmon"
                            >
                              ×
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className={fieldHeadingClass}>
                    <FormattedMessage id="setup.mic" />
                  </h3>
                  <div className="mt-3" data-testid="mic-check">
                    <MicSelector value={micDeviceId} onValueChange={(id) => $micDeviceId.set(id)} />
                  </div>
                </div>

                {/* the validate step stays reachable, opt-in only (p3) */}
                <Button
                  variant="link"
                  onClick={() => void start(true)}
                  disabled={busy}
                  className="h-auto min-h-11 self-start px-0 font-body text-sm font-normal text-espresso-soft underline decoration-hairline underline-offset-4 transition-fluid hover:text-persimmon hover:no-underline disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <FormattedMessage id="setup.startWithPlan" />
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </main>
    </div>
  );
}

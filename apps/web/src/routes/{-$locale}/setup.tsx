import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLocaleNav, withLocale } from "../../lib/locale-href";
import { FormattedMessage, useIntl } from "react-intl";
import * as React from "react";
import { useStore } from "@nanostores/react";
import { $draft } from "../../stores/session";
import { $micDeviceId } from "../../stores/devices";
import { createSession, uploadDocuments } from "../../lib/api";
import { MicSelector } from "../../components/vendor/mic-selector";
import { Button } from "../../components/vendor/button";
import { Textarea } from "../../components/vendor/textarea";
import { ToggleGroup, ToggleGroupItem } from "../../components/vendor/toggle-group";
import {
  $effectiveRuntime,
  $providerProfile,
  $serverReachable,
  ensureRuntimeProbe,
  probeServer,
} from "../../lib/runtime";
import { openSettings } from "../../components/settings-dialog";
import { createClientSession } from "../../lib/opfs-store";
import { resetClientSession } from "../../lib/agent/session-store";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ACCEPTED = [".pdf", ".md", ".markdown", ".txt", ".docx"];

export const Route = createFileRoute("/{-$locale}/setup")({
  head: () => ({ meta: [{ title: "setup — di" }] }),
  component: Setup,
});

const PRESETS = [
  {
    id: "sysDesign",
    prompt: "Run a system design interview. Focus on scaling, caching and tradeoff reasoning.",
  },
  {
    id: "behavioral",
    prompt: "Run a behavioral interview using the STAR method. Probe for specifics.",
  },
  {
    id: "frontend",
    prompt: "Run a frontend interview. Mix of component design and JS fundamentals.",
  },
  {
    id: "ml",
    prompt: "Run a machine learning interview. Model choice, evaluation, and data hygiene.",
  },
];

const DURATIONS = [20, 30, 45, 60];

function Setup() {
  const { locale } = useLocaleNav();
  const intl = useIntl();
  const draft = useStore($draft);
  const micDeviceId = useStore($micDeviceId);
  const effectiveRuntime = useStore($effectiveRuntime);
  const profile = useStore($providerProfile);
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
  const fileInput = React.useRef<HTMLInputElement>(null);

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

  async function start(validate: boolean) {
    // guard tied to the runtime FSM: custom/in-browser sessions run the
    // agent loop client-side, which is impossible without an LLM endpoint
    if (effectiveRuntime !== "server" && !profile?.llm) {
      toast.error(intl.formatMessage({ id: "setup.needsProviderToast" }), {
        description: intl.formatMessage({ id: "setup.needsProvider" }),
      });
      openSettings("aiProvider");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const title =
        draft.title || PRESETS.find((p) => draft.prompt === p.prompt)?.id || "practice session";
      if (effectiveRuntime !== "server") {
        resetClientSession();
        const session = await createClientSession({
          title,
          mode: draft.mode,
          duration_min: draft.durationMin,
        });
        // no ingestion pipeline client-side: uploaded files are dropped.
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
      });
      if (files.length > 0) {
        try {
          await uploadDocuments(session.id, files);
        } catch (err) {
          // ingestion failure must not block starting the interview
          setError(err instanceof Error ? err.message : "upload failed");
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
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ambient grain min-h-[100dvh] bg-cream">
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 md:px-8">
        <div className="rounded-shell bg-paper p-2 ring-1 ring-hairline">
          <div className="rounded-[calc(2rem-0.375rem)] bg-cream p-8 lg:p-12">
            <section className="rise-in" style={{ "--rise-delay": "0ms" } as React.CSSProperties}>
              <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
                <FormattedMessage id="setup.presets" />
              </h2>
              <ToggleGroup
                type="single"
                value={PRESETS.find((p) => draft.title === p.id)?.id ?? ""}
                onValueChange={(v) => {
                  const p = PRESETS.find((x) => x.id === v);
                  if (p) $draft.set({ ...draft, prompt: p.prompt, title: p.id });
                }}
                className="mt-3 flex flex-wrap gap-2"
              >
                {PRESETS.map((p) => (
                  <ToggleGroupItem
                    key={p.id}
                    value={p.id}
                    className="rounded-full bg-white px-4 py-2 text-sm font-medium text-espresso-soft ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-persimmon/40 active:scale-[0.97] data-[state=on]:bg-persimmon data-[state=on]:text-cream data-[state=on]:hover:bg-persimmon"
                  >
                    <FormattedMessage id={`setup.preset.${p.id}`} />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </section>

            <section
              className="rise-in mt-10"
              style={{ "--rise-delay": "120ms" } as React.CSSProperties}
            >
              <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
                <FormattedMessage id="setup.promptLabel" />
              </h2>
              <Textarea
                value={draft.prompt}
                onChange={(e) => $draft.set({ ...draft, prompt: e.target.value })}
                placeholder={intl.formatMessage({
                  id: "setup.promptPlaceholder",
                })}
                rows={4}
                className="mt-3 w-full resize-none rounded-card bg-white p-4 text-sm ring-1 ring-hairline outline-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-espresso-soft focus-visible:ring-2 focus-visible:ring-persimmon/50"
              />
            </section>

            <section
              className="rise-in mt-10"
              style={{ "--rise-delay": "240ms" } as React.CSSProperties}
            >
              <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
                <FormattedMessage id="setup.files" />{" "}
                <span className="normal-case tracking-normal text-espresso-soft">
                  · <FormattedMessage id="setup.filesHint" />
                </span>
              </h2>
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
              <div
                role="button"
                tabIndex={0}
                aria-label={intl.formatMessage({ id: "setup.dropHint" })}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(e.dataTransfer.files);
                }}
                className="mt-3 cursor-pointer rounded-card border border-dashed border-espresso-faint/40 bg-white/60 p-6 text-center text-sm text-espresso-soft transition-fluid hover:border-persimmon/50 hover:text-espresso-soft md:p-8 text-center text-sm text-espresso-soft transition-fluid hover:border-persimmon/50 hover:text-espresso-soft"
              >
                <FormattedMessage id="setup.dropHint" />
              </div>
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
              {error && (
                <p role="alert" className="mt-3 text-sm text-persimmon-deep">
                  {error}
                </p>
              )}
            </section>

            <section
              className="rise-in mt-10"
              style={{ "--rise-delay": "300ms" } as React.CSSProperties}
            >
              <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
                <FormattedMessage id="setup.mic" />
              </h2>
              <div className="mt-3" data-testid="mic-check">
                <MicSelector value={micDeviceId} onValueChange={(id) => $micDeviceId.set(id)} />
              </div>
            </section>

            <section
              className="rise-in mt-10 grid gap-6 md:grid-cols-2"
              style={{ "--rise-delay": "360ms" } as React.CSSProperties}
            >
              <div>
                <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
                  <FormattedMessage id="setup.duration" />
                </h2>
                <ToggleGroup
                  type="single"
                  value={String(draft.durationMin)}
                  onValueChange={(v) => {
                    if (v) $draft.set({ ...draft, durationMin: Number(v) });
                  }}
                  className="mt-3 flex w-full flex-wrap gap-2"
                >
                  {DURATIONS.map((d) => (
                    <ToggleGroupItem
                      key={d}
                      value={String(d)}
                      className="flex-1 rounded-full bg-white py-2 text-sm font-medium text-espresso-soft ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] data-[state=on]:bg-espresso data-[state=on]:text-cream data-[state=on]:hover:bg-espresso"
                    >
                      {d}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div>
                <h2 className="text-[10px] uppercase tracking-[0.2em] font-medium text-espresso-soft">
                  <FormattedMessage id="setup.mode" />
                </h2>
                <ToggleGroup
                  type="single"
                  value={draft.mode}
                  onValueChange={(v) => {
                    if (v) $draft.set({ ...draft, mode: v as "interview" | "coach" });
                  }}
                  className="mt-3 flex w-full flex-wrap gap-2"
                >
                  <ToggleGroupItem
                    value="interview"
                    className="flex-1 rounded-full bg-white py-2 text-sm font-medium text-espresso-soft ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] data-[state=on]:bg-espresso data-[state=on]:text-cream data-[state=on]:hover:bg-espresso"
                  >
                    <FormattedMessage id="setup.mode.interview" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="coach"
                    disabled
                    title={intl.formatMessage({ id: "setup.coachHint" })}
                    className="flex-1 cursor-not-allowed rounded-full bg-white/50 py-2 text-sm font-medium text-espresso-soft ring-1 ring-hairline animate-pulse data-[state=on]:bg-white/50 data-[state=on]:text-espresso-soft data-[state=on]:hover:bg-white/50"
                  >
                    <FormattedMessage id="setup.mode.coach" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </section>

            {effectiveRuntime !== "server" && !profile?.llm && (
              <section
                className="rise-in mt-10 rounded-card bg-white/70 p-4 ring-1 ring-hairline"
                style={{ "--rise-delay": "300ms" } as React.CSSProperties}
              >
                <p className="text-sm text-espresso-soft">
                  <FormattedMessage id="setup.needsProvider" />
                </p>
                <Button
                  variant="ghost"
                  onClick={() => openSettings("aiProvider")}
                  className="mt-3 h-auto rounded-full bg-white px-5 py-2 font-body text-sm font-medium text-espresso ring-1 ring-hairline transition-fluid hover:bg-white hover:ring-persimmon/50"
                >
                  <FormattedMessage id="setup.openProviderSettings" />
                </Button>
              </section>
            )}

            <section
              className="rise-in mt-10 flex flex-col items-center gap-3"
              style={{ "--rise-delay": "480ms" } as React.CSSProperties}
            >
              <Button
                onClick={() => void start(true)}
                disabled={busy}
                aria-busy={busy}
                className="group relative inline-flex items-center gap-2.5 rounded-full bg-espresso px-7 py-3.5 font-body text-base font-semibold text-cream ring-persimmon/0 shadow-lg shadow-espresso/20 transition-all duration-300 ease-out hover:bg-espresso hover:shadow-md hover:ring-2 hover:ring-persimmon/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <FormattedMessage id="setup.validate" />
                <ArrowRight
                  className="size-4 transition-all duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-persimmon"
                  aria-hidden="true"
                />
              </Button>
              <Button
                variant="ghost"
                onClick={() => void start(false)}
                disabled={busy}
                className="font-body text-sm text-espresso-soft underline decoration-hairline underline-offset-4 transition-fluid hover:bg-transparent hover:text-persimmon disabled:cursor-not-allowed disabled:opacity-70"
              >
                <FormattedMessage id="setup.skipValidation" />
              </Button>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useLocale, withLocale } from "../../lib/locale-href";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { useSsrStore } from "../../lib/ssr";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/vendor/dialog";
import { useVoice } from "../../lib/voice/use-voice";
import { FormattedMessage, useIntl } from "react-intl";
import { toast } from "sonner";
import {
  getSession,
  getTurns,
  postTextTurn,
  pushToolState,
  replayPendingTurns,
} from "../../lib/api";
import { getClientSession, getClientTurns, setClientSessionStatus } from "../../lib/opfs-store";
import { $clientTurns, resetClientSession } from "../../lib/agent/session-store";
import { $effectiveRuntime } from "../../lib/runtime";
import { Button } from "../../components/vendor/button";
import { LiveWaveform } from "../../components/vendor/live-waveform";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
} from "../../components/vendor/prompt-input";
import { AgentStage } from "../../components/agent-stage";
import { CallBar } from "../../components/call-bar";
import { QuestionCard } from "../../components/question-card";
import { ToolDock } from "../../components/tool-dock";
import { ControlBar } from "../../components/control-bar";
import { TranscriptPane } from "../../components/transcript-pane";
import { VoiceConsentDialog } from "../../components/voice-consent-dialog";
import { dockSpecs } from "../../lib/tools/registry";
import { DEFAULT_SESSION_TOOLS } from "@di/shared";
import {
  $editorBuffer,
  $muted,
  $question,
  $questionCount,
  $whiteboard,
  resetQuestion,
} from "../../stores/session";

export const Route = createFileRoute("/{-$locale}/interview/$id")({
  component: Interview,
  // Active dock tab lives in the URL (?tool=editor) — the URL is source of truth.
  validateSearch: (search: Record<string, unknown>): { tool?: string } => ({
    tool: typeof search.tool === "string" ? search.tool : undefined,
  }),
});

/** Countdown anchored to session.created_at — a reload keeps real elapsed time. */
function useCountdown(durationMin: number, createdAt?: string) {
  const mountAt = useRef(Date.now());
  const [secsLeft, setSecsLeft] = useState(durationMin * 60);
  useEffect(() => {
    const t = setInterval(() => {
      const parsed = createdAt ? Date.parse(createdAt) : NaN;
      const start = Number.isNaN(parsed) ? mountAt.current : parsed;
      setSecsLeft(Math.max(0, durationMin * 60 - Math.floor((Date.now() - start) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [durationMin, createdAt]);
  return secsLeft;
}

const phaseKeys: Record<string, string> = {
  listening: "interview.phase.listening",
  user_speaking: "interview.phase.userSpeaking",
  thinking: "interview.phase.thinking",
  agent_speaking: "interview.phase.agentSpeaking",
  interrupted: "interview.phase.interrupted",
};

const ACTIVE_STATUSES = new Set(["created", "interviewing"]);

function Interview() {
  const { id } = Route.useParams();
  const effectiveRuntime = useSsrStore($effectiveRuntime, "server");
  const clientOnly = effectiveRuntime !== "server";
  const { data: session } = useQuery({
    queryKey: ["session", id, effectiveRuntime],
    queryFn: () => (clientOnly ? getClientSession(id) : getSession(id)),
  });

  // Ended-session re-entry: a finished/reported/discarded session renders a
  // read-only summary instead of booting a dead voice socket (p3-25).
  if (session && !ACTIVE_STATUSES.has(session.status)) {
    return <InterviewEnded id={id} clientOnly={clientOnly} />;
  }
  return <InterviewLive id={id} clientOnly={clientOnly} />;
}

/** Read-only summary for re-entering a session that already ended. */
function InterviewEnded({ id, clientOnly }: { id: string; clientOnly: boolean }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const { data: session } = useQuery({
    queryKey: ["session", id, clientOnly],
    queryFn: () => (clientOnly ? getClientSession(id) : getSession(id)),
  });
  const { data: turns } = useQuery({
    queryKey: ["ended-turns", id, clientOnly],
    queryFn: () => (clientOnly ? getClientTurns(id) : getTurns(id)),
  });
  return (
    <div className="ambient grain flex min-h-[100dvh] flex-col bg-cream">
      <header className="flex items-center justify-between px-4 py-3 md:px-8">
        <h1 className="min-w-0 truncate font-display text-base font-semibold">
          {session?.title ?? "…"}
        </h1>
        <span className="font-mono text-[10px] uppercase tracking-wide text-espresso-soft">
          <FormattedMessage id="interview.endedBadge" />
        </span>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-8">
        <p className="text-sm text-espresso-soft">
          <FormattedMessage id="interview.endedBody" />
        </p>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-card bg-paper p-4 ring-1 ring-hairline">
          {(turns ?? []).map((t) => (
            <div
              key={t.id}
              className={`rounded-2xl px-3 py-2 text-sm ${t.speaker === "agent" ? "bg-persimmon-faint" : "bg-white/70"}`}
            >
              <span className="block text-[10px] uppercase tracking-wider text-espresso-soft">
                {t.speaker} · {t.source}
              </span>
              {t.text}
            </div>
          ))}
          {(turns ?? []).length === 0 && (
            <p className="text-sm text-espresso-soft">
              <FormattedMessage id="interview.endedEmpty" />
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => navigate({ href: withLocale(locale, `/report/${id}`) })}
            className="h-11 flex-1 rounded-full bg-espresso px-5 text-cream shadow-none transition-all duration-500 hover:bg-persimmon active:scale-[0.97] sm:flex-none"
          >
            <FormattedMessage id="interview.viewReport" />
          </Button>
          <Button
            onClick={() => navigate({ href: withLocale(locale, "/setup") })}
            className="h-11 flex-1 rounded-full bg-white px-5 text-espresso ring-1 ring-hairline shadow-none transition-all duration-500 hover:ring-persimmon/50 active:scale-[0.97] sm:flex-none"
          >
            <FormattedMessage id="interview.newSession" />
          </Button>
        </div>
      </main>
    </div>
  );
}

function InterviewLive({ id, clientOnly }: { id: string; clientOnly: boolean }) {
  const intl = useIntl();
  const locale = useLocale();
  const navigate = useNavigate();
  const { tool } = Route.useSearch();
  const { data: session } = useQuery({
    queryKey: ["session", id, clientOnly],
    queryFn: () => (clientOnly ? getClientSession(id) : getSession(id)),
  });
  const { data: polledTurns } = useQuery({
    queryKey: ["turns", id],
    queryFn: () => getTurns(id),
    refetchInterval: 2000,
    enabled: !clientOnly,
  });
  const clientTurns = useStore($clientTurns);
  const turns = clientOnly ? clientTurns : polledTurns;
  const question = useStore($question);
  const questionCount = useStore($questionCount);

  // hydrate persisted state on mount: a reload must not wipe the visible
  // transcript (p0.9). server mode polls turns from the API instead.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!clientOnly || hydratedRef.current) return;
    hydratedRef.current = true;
    resetClientSession();
    resetQuestion();
    void setClientSessionStatus(id, "interviewing").catch(() => undefined);
    void getClientTurns(id).then((persisted) => {
      $clientTurns.set([...persisted, ...$clientTurns.get()]);
    });
  }, [id, clientOnly]);
  const muted = useStore($muted);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const typeInputRef = useRef<HTMLTextAreaElement | null>(null);
  // stage-caption fallback: when the agent never calls update_question
  // (text-only providers, kickoff answers), show the latest agent turn.
  const latestAgentText = [...(turns ?? [])].reverse().find((t) => t.speaker === "agent")?.text;
  const caption = latestAgentText || question.text;
  const noQuestionYet = !caption;
  // cold-start fallback: if the agent hasn't asked anything after 15s
  // (e.g. mic never picked the candidate up), surface a type-instead hint.
  useEffect(() => {
    if (!noQuestionYet) {
      setShowSlowHint(false);
      return;
    }
    const t = setTimeout(() => setShowSlowHint(true), 15_000);
    return () => clearTimeout(t);
  }, [noQuestionYet]);
  const editor = useStore($editorBuffer);
  const whiteboard = useStore($whiteboard);
  const voice = useVoice(id, muted);
  // p1.14 voice->text degradation: a voice failure (mic denied, unsupported
  // browser, ws down) immediately offers the type-instead path instead of
  // waiting the 15s slow-start grace. Typed turns persist the same way.
  useEffect(() => {
    if (voice.status === "error") setShowSlowHint(true);
  }, [voice.status]);
  const statusKey =
    voice.status === "error"
      ? "interview.voiceError"
      : voice.status === "reconnecting"
        ? "interview.voiceReconnecting"
        : voice.status === "connected"
          ? (phaseKeys[voice.phase] ?? "interview.voiceConnected")
          : voice.status === "connecting"
            ? "interview.voiceConnecting"
            : "interview.voiceIdle";

  // retry the voice driver after an error (p0.2); transcript stays intact
  const [restarting, setRestarting] = useState(false);
  async function retryVoice() {
    setRestarting(true);
    try {
      await voice.restart();
    } finally {
      setRestarting(false);
    }
  }

  // replay text turns that never reached the server (p0.5), once per mount
  const replayedRef = useRef(false);
  useEffect(() => {
    if (replayedRef.current) return;
    replayedRef.current = true;
    void replayPendingTurns(id).catch(() => undefined);
  }, [id]);

  // global toast on voice failure (barge-in aborts are filtered at the driver
  // level and never reach onError)
  const voiceErroredRef = React.useRef(false);
  React.useEffect(() => {
    if (voice.status === "error") {
      if (!voiceErroredRef.current) {
        voiceErroredRef.current = true;
        toast.error(intl.formatMessage({ id: "interview.voiceErrorToast" }), {
          description: voice.error ?? undefined,
          action: {
            label: intl.formatMessage({ id: "interview.voiceRetry" }),
            onClick: () => void retryVoice(),
          },
        });
      }
    } else {
      voiceErroredRef.current = false;
    }
  }, [voice.status, voice.error, intl]);

  const sessionTools = session?.tools ?? DEFAULT_SESSION_TOOLS;
  const specs = dockSpecs(sessionTools, clientOnly);
  const activeTool = specs.some((s) => s.id === tool) ? tool! : (specs[0]?.id ?? "editor");

  // Mirror browser-held tool content to di so the voice agent can read it.
  // Client-only mode's tool executors read the stores in-process, so there
  // is nothing to push.
  useEffect(() => {
    if (clientOnly) return;
    const t = setTimeout(() => {
      const state: Record<string, string> = {};
      for (const toolId of Object.keys(sessionTools)) {
        state[toolId] = toolId === "editor" ? editor : toolId === "whiteboard" ? whiteboard : "";
      }
      pushToolState(id, state).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [id, editor, whiteboard, clientOnly, sessionTools]);

  const durationSecs = (session?.duration_min ?? 30) * 60;
  const secsLeft = useCountdown(session?.duration_min ?? 30, session?.created_at);
  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const elapsed = fmt(Math.min(durationSecs, durationSecs - secsLeft));
  const total = fmt(durationSecs);
  const wrapping = secsLeft <= 120;

  // Back-guard + end-early confirmations both navigate to /finish; the
  // bypass ref lets intentional exits through the blocker (p3-19/25).
  const bypassNavRef = useRef(false);
  const goFinish = React.useCallback(() => {
    bypassNavRef.current = true;
    navigate({ href: withLocale(locale, `/finish/${id}`) });
  }, [navigate, locale, id]);

  useEffect(() => {
    if (secsLeft === 0) goFinish();
  }, [secsLeft, goFinish]);

  const blocker = useBlocker({
    shouldBlockFn: () => !bypassNavRef.current,
    enableBeforeUnload: true,
    withResolver: true,
  });

  async function sendText(raw: string) {
    const t = raw.trim();
    if (!t) return;
    // typed turns reach the agent: ws message when voice is up (both modes),
    // durable REST write only as a degraded-path fallback in server mode.
    if (clientOnly || voice.status === "connected") {
      voice.sendText(t);
    } else {
      await postTextTurn(id, t);
    }
  }

  function focusTypeInput() {
    // the composer is always mounted now — just give it a tick
    setTimeout(() => typeInputRef.current?.focus(), 50);
  }

  return (
    <div className="ambient grain flex h-[100dvh] flex-col overflow-hidden bg-cream">
      {/* 44px in-call bar replaces AppHeader on /interview/* */}
      <CallBar
        title={session?.title ?? ""}
        elapsed={elapsed}
        total={total}
        wrapping={wrapping}
        onEnd={() => setConfirmEndOpen(true)}
        end={
          voice.status === "error" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={restarting}
              onClick={() => void retryVoice()}
              className="h-6 rounded-full px-2 text-[10px]"
            >
              <FormattedMessage id="interview.voiceRetry" />
            </Button>
          ) : undefined
        }
      />

      {/* two-card grid on desktop; conversation card only on mobile.
          ~70px bottom clearance keeps the floating pillbar off the composer. */}
      <div className="grid min-h-0 flex-1 gap-3.5 p-3.5 md:grid-cols-[minmax(360px,34%)_1fr]">
        <section
          aria-label={intl.formatMessage({ id: "interview.conversation" })}
          className="flex min-h-0 flex-col gap-3 rounded-card bg-paper p-4 pb-[78px] ring-1 ring-hairline md:pb-4"
        >
          <QuestionCard
            n={questionCount}
            hints={question.hints}
            showTypeHint={showSlowHint && noQuestionYet}
            onType={focusTypeInput}
          />
          <AgentStage
            phase={voice.phase}
            orbMuted={muted || voice.status !== "connected"}
            statusKey={statusKey}
            caption={caption || intl.formatMessage({ id: "interview.preparing" })}
          />
          <TranscriptPane turns={turns} />
          <div className="flex items-center gap-3 border-t border-hairline pt-2">
            <LiveWaveform
              active={voice.status === "connected" && !muted}
              processing={voice.status === "connecting" || voice.status === "reconnecting"}
              height={26}
              barWidth={2}
              barGap={2}
              barRadius={1}
              sensitivity={1.6}
              aria-label={intl.formatMessage({ id: "interview.micWaveform" })}
              className="min-w-0 flex-1 text-persimmon"
            />
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-espresso-faint">
              <FormattedMessage id="interview.youMic" />
            </span>
          </div>
          <PromptInput
            onSubmit={(m) => void sendText(m.text)}
            className="[&_[data-slot=input-group]]:rounded-full [&_[data-slot=input-group]]:bg-cream [&_[data-slot=input-group]]:shadow-none"
          >
            <PromptInputBody>
              <PromptInputTextarea
                ref={typeInputRef}
                placeholder={intl.formatMessage({ id: "interview.talkOrType" })}
                aria-label={intl.formatMessage({ id: "interview.talkOrType" })}
                className="max-h-24 min-h-9 px-4 py-2 text-sm"
              />
            </PromptInputBody>
          </PromptInput>
        </section>

        {/* workspace card — ToolDock gets the full column height, desktop only */}
        {specs.length > 0 && (
          <aside className="hidden min-h-0 md:flex md:flex-col">
            <ToolDock
              specs={specs}
              active={activeTool}
              onActive={(toolId) =>
                void navigate({ to: ".", search: { tool: toolId }, replace: true })
              }
              loadingLabel={intl.formatMessage({ id: "interview.whiteboardLoading" })}
            />
          </aside>
        )}
      </div>

      {/* floating pillbar — sits above the conversation card's clearance */}
      <ControlBar
        muted={muted}
        onMute={() => $muted.set(!muted)}
        onType={focusTypeInput}
        onEnd={() => setConfirmEndOpen(true)}
      />

      {/* on-device voice consent: first browser-mode entry only */}
      {clientOnly && <VoiceConsentDialog />}

      {/* end-early confirm (p3-19) */}
      <Dialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <DialogContent className="bg-paper">
          <DialogTitle>
            <FormattedMessage id="interview.endConfirmTitle" />
          </DialogTitle>
          <DialogDescription>
            <FormattedMessage id="interview.endConfirmBody" />
          </DialogDescription>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmEndOpen(false)}
              className="h-11 rounded-full"
            >
              <FormattedMessage id="interview.stay" />
            </Button>
            <Button
              onClick={() => {
                setConfirmEndOpen(false);
                goFinish();
              }}
              className="h-11 rounded-full bg-espresso text-cream hover:bg-persimmon"
            >
              <FormattedMessage id="interview.endEarly" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* back-guard confirm (p3-25) */}
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <DialogContent className="bg-paper">
          <DialogTitle>
            <FormattedMessage id="interview.leaveTitle" />
          </DialogTitle>
          <DialogDescription>
            <FormattedMessage id="interview.leaveBody" />
          </DialogDescription>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => blocker.status === "blocked" && blocker.reset()}
              className="h-11 rounded-full"
            >
              <FormattedMessage id="interview.stay" />
            </Button>
            <Button
              onClick={() => blocker.status === "blocked" && blocker.proceed()}
              className="h-11 rounded-full bg-espresso text-cream hover:bg-persimmon"
            >
              <FormattedMessage id="interview.leave" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

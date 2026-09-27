import { Suspense, lazy } from "react";
import { FormattedMessage } from "react-intl";
import type { OrbAgentPhase } from "./voice-orb";

const VoiceOrb = lazy(() => import("./voice-orb").then((m) => ({ default: m.VoiceOrb })));

/**
 * AgentStage: compact stage row inside the conversation card — small orb
 * (~48-56px) + uppercase status word + 2-line fraunces live caption. The
 * caption holds the latest agent utterance so the question stays on screen
 * during user turns.
 */
export function AgentStage({
  phase,
  orbMuted,
  statusKey,
  caption,
}: {
  phase: OrbAgentPhase;
  orbMuted: boolean;
  statusKey: string;
  caption: string;
}) {
  return (
    <section
      aria-label="agent stage"
      className="flex items-center gap-3 border-b border-hairline px-0.5 pb-3"
    >
      <Suspense
        fallback={<div className="size-12 animate-pulse rounded-full bg-espresso/5 md:size-14" />}
      >
        <VoiceOrb phase={phase} muted={orbMuted} className="size-12 shrink-0 md:size-14" />
      </Suspense>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-espresso-soft">
          <FormattedMessage id={statusKey} />
        </p>
        {caption && (
          <p className="line-clamp-2 font-display text-sm leading-snug text-espresso">{caption}</p>
        )}
      </div>
    </section>
  );
}

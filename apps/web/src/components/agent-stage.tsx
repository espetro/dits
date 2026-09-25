import { Suspense, lazy } from "react";
import { FormattedMessage } from "react-intl";
import type { OrbAgentPhase } from "./voice-orb";

const VoiceOrb = lazy(() => import("./voice-orb").then((m) => ({ default: m.VoiceOrb })));

/**
 * AgentStage (p3-18): the single zone carrying the agent's presence —
 * orb + state word + live caption. The orb leaves the transcript rail so
 * state stays semantic and volume stays motion.
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
      className="flex flex-col items-center gap-1 px-4 pt-1 text-center"
    >
      <Suspense
        fallback={<div className="size-20 animate-pulse rounded-full bg-espresso/5 md:size-24" />}
      >
        <VoiceOrb phase={phase} muted={orbMuted} className="size-20 shrink-0 md:size-24" />
      </Suspense>
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-espresso-soft">
        <FormattedMessage id={statusKey} />
      </p>
      {caption && (
        <p className="line-clamp-2 w-full max-w-xl font-display text-sm leading-snug text-espresso-soft md:text-base">
          {caption}
        </p>
      )}
    </section>
  );
}

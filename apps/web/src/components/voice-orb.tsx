import * as React from "react";

import { Orb } from "./vendor/orb";
import { getAgentLevel, getMicLevel } from "../lib/voice/levels";
import { $effectiveRuntime } from "../lib/runtime";
import { useSsrStore } from "../lib/ssr";

/**
 * Voice orb for the interview screen: ElevenLabs UI Orb (WebGL, three.js)
 * driven by live mic/agent loudness taps (lib/voice/levels). Rendered above
 * the transcript panel; lazy-loaded from the interview route so three.js
 * stays out of the initial chunk.
 *
 * agentState mapping: phase "speaking" -> talking, "listening" -> listening,
 * "thinking" -> thinking; otherwise null (idle drift).
 *
 * In client-only runs (browser llm) a css-only pulse dot renders instead of
 * the WebGL canvas: the three.js context is a real gpu cost we skip so the
 * in-browser model keeps its headroom.
 *
 * Volumes go through refs (polled by the orb's frame loop, per upstream
 * docs). When the voice session is not connected (or the active driver does
 * not tap real audio, e.g. browser STT), the getters fall back to a gentle
 * synthetic oscillation so the orb still reads as "alive" instead of flat 0.
 */
export type OrbAgentPhase = "speaking" | "listening" | "thinking" | string;

function synthetic(t: number, base: number, amp: number, freq: number): number {
  return Math.max(0, Math.min(1, base + amp * Math.sin(t * freq)));
}

export function VoiceOrb({
  phase,
  muted,
  className = "",
}: {
  phase: OrbAgentPhase;
  muted: boolean;
  className?: string;
}) {
  const inputRef = React.useRef(0);
  const outputRef = React.useRef(0);
  const effectiveRuntime = useSsrStore($effectiveRuntime, "server");
  const clientOnly = effectiveRuntime !== "server";

  React.useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const liveMic = !muted ? getMicLevel() : 0;
      const liveAgent = getAgentLevel();
      // synthetic fallback keeps the orb breathing when taps are silent
      inputRef.current = Math.max(liveMic, synthetic(t, 0.35, 0.25, 2.1));
      outputRef.current = Math.max(liveAgent, synthetic(t, 0.45, 0.2, 1.4));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [muted]);

  const agentState =
    phase === "speaking"
      ? ("talking" as const)
      : phase === "listening"
        ? ("listening" as const)
        : phase === "thinking"
          ? ("thinking" as const)
          : null;

  if (clientOnly) {
    return (
      <div aria-hidden="true" className={`shrink-0 ${className}`}>
        <span
          className={`block size-full rounded-full bg-gradient-to-br from-persimmon to-persimmon-deep shadow-[0_0_0_4px_var(--color-persimmon-soft),0_4px_16px_rgba(194,72,10,0.2)] ${
            agentState ? "orb-live" : "opacity-70"
          }`}
        />
      </div>
    );
  }

  return (
    <Orb
      className={className}
      volumeMode="manual"
      inputVolumeRef={inputRef}
      outputVolumeRef={outputRef}
      agentState={agentState}
      colors={["#ff6f1e", "#c2480a"]}
      seed={7}
    />
  );
}

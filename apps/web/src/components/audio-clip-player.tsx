import * as React from "react";
import { Loader2, Play, Square } from "lucide-react";

import { Button } from "./vendor/button";
import { Progress } from "./vendor/progress";

export interface AudioClipPlayerProps {
  /** wav blob to play (wasm/cloud synth output); absent while synthesizing */
  src?: Blob;
  /** fallback player for speechSynthesis output that produces no blob */
  onBuiltinStart?(): void;
  onBuiltinStop?(): void;
  /** estimated duration for the builtin fallback's progress bar */
  estimatedMs?: number;
}

/**
 * Minimal audio player for the voice test row: one play/stop button and a
 * linear progress bar. Blob sources drive a real audio element; the
 * speechSynthesis fallback renders an estimated linear bar instead (the
 * api exposes no progress).
 */
export function AudioClipPlayer(props: AudioClipPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const builtinTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (!props.src) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(props.src);
    setUrl(u);
    setProgress(0);
    return () => URL.revokeObjectURL(u);
  }, [props.src]);

  React.useEffect(
    () => () => {
      if (builtinTimer.current) clearInterval(builtinTimer.current);
    },
    [],
  );

  function stop() {
    if (url && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      setProgress(0);
    } else {
      props.onBuiltinStop?.();
      if (builtinTimer.current) clearInterval(builtinTimer.current);
      builtinTimer.current = null;
      setPlaying(false);
      setProgress(0);
    }
  }

  function start() {
    if (url && audioRef.current) {
      void audioRef.current.play();
      setPlaying(true);
      return;
    }
    props.onBuiltinStart?.();
    setPlaying(true);
    const t0 = Date.now();
    const est = props.estimatedMs ?? 3_000;
    builtinTimer.current = setInterval(() => {
      const p = Math.min((Date.now() - t0) / est, 0.99);
      setProgress(p);
      if (p >= 0.99) stop();
    }, 120);
  }

  const ready = Boolean(url) || Boolean(props.onBuiltinStart);
  return (
    <span className="flex min-w-40 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!ready}
        onClick={() => (playing ? stop() : start())}
        aria-label={playing ? "stop" : "play"}
      >
        {playing ? (
          <Square className="size-3.5" aria-hidden="true" />
        ) : (
          <Play className="size-3.5" aria-hidden="true" />
        )}
      </Button>
      <Progress value={progress * 100} className="h-1.5 flex-1" />
      {url && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- synthesized speech has no caption track
        <audio
          ref={audioRef}
          src={url}
          className="hidden"
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
        />
      )}
    </span>
  );
}

export function SynthSpinner() {
  return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />;
}

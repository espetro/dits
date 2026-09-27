import { useIntl } from "react-intl";
import { Keyboard, Mic, MicOff, X } from "lucide-react";
import { Button } from "./vendor/button";

/**
 * ControlBar: floating bottom-center espresso pillbar — icons-only controls
 * (mute / switch to typing / end interview). Fixed above content; callers
 * leave clearance under the composer so it never overlaps (mobile pads the
 * conversation card ~70px).
 */
export function ControlBar({
  muted,
  onMute,
  onType,
  onEnd,
}: {
  muted: boolean;
  onMute: () => void;
  onType: () => void;
  onEnd: () => void;
}) {
  const intl = useIntl();
  const btn =
    "size-11 rounded-full bg-white/10 p-0 text-cream shadow-none ring-0 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/20 active:scale-[0.94]";
  return (
    <div
      role="toolbar"
      aria-label={intl.formatMessage({ id: "interview.controls" })}
      className="fixed bottom-[18px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-espresso p-2 shadow-[0_12px_32px_rgba(43,33,24,0.28)]"
      style={{ bottom: "calc(18px + env(safe-area-inset-bottom))" }}
    >
      <Button
        onClick={onMute}
        aria-pressed={muted}
        aria-label={intl.formatMessage({
          id: muted ? "interview.unmuteMic" : "interview.muteMic",
        })}
        className={btn}
      >
        {muted ? (
          <MicOff className="size-4" aria-hidden="true" />
        ) : (
          <Mic className="size-4" aria-hidden="true" />
        )}
      </Button>
      <Button
        onClick={onType}
        aria-label={intl.formatMessage({ id: "interview.switchToTyping" })}
        className={btn}
      >
        <Keyboard className="size-4" aria-hidden="true" />
      </Button>
      <Button
        onClick={onEnd}
        aria-label={intl.formatMessage({ id: "interview.endInterview" })}
        className={`${btn} bg-persimmon-deep hover:bg-persimmon`}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

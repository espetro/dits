import { FormattedMessage } from "react-intl";
import { Flag, Keyboard, Mic, MicOff } from "lucide-react";
import { Button } from "./vendor/button";

/**
 * ControlBar (p3-19): sticky bottom cluster on every viewport — mute,
 * type-instead, end early. All targets >= 44px and the bar pads
 * env(safe-area-inset-bottom) for notched devices.
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
  return (
    <footer
      className="flex shrink-0 items-stretch gap-2 border-t border-hairline bg-paper/80 px-3 py-2 backdrop-blur-sm sm:gap-3 sm:px-4"
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
    >
      <Button
        onClick={onMute}
        aria-pressed={muted}
        className="h-11 min-w-0 flex-1 gap-2 rounded-full bg-white px-4 text-espresso ring-1 ring-hairline shadow-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white hover:ring-persimmon/50 active:scale-[0.97] sm:flex-none sm:px-5"
      >
        {muted ? (
          <MicOff className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Mic className="size-4 shrink-0" aria-hidden="true" />
        )}
        <FormattedMessage id={muted ? "interview.unmute" : "interview.mute"} />
      </Button>
      <Button
        onClick={onType}
        className="h-11 min-w-0 flex-1 gap-2 rounded-full bg-white px-4 text-espresso ring-1 ring-hairline shadow-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white hover:ring-persimmon/50 active:scale-[0.97] sm:flex-none sm:px-5"
      >
        <Keyboard className="size-4 shrink-0" aria-hidden="true" />
        <FormattedMessage id="interview.type" />
      </Button>
      <Button
        onClick={onEnd}
        className="h-11 min-w-0 flex-1 gap-2 truncate rounded-full bg-espresso px-4 text-cream shadow-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-persimmon active:scale-[0.97] sm:flex-none sm:px-5"
      >
        <Flag className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          <FormattedMessage id="interview.endEarly" />
        </span>
      </Button>
    </footer>
  );
}

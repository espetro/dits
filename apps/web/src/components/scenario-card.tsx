import { ArrowRight } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Button } from "./vendor/button";
import { Label } from "./vendor/label";
import { RadioGroupItem } from "./vendor/radio-group";
import { TOOL_REGISTRY } from "../lib/tools/registry";
import type { SessionTools } from "@di/shared";

/** One setup scenario (p3): narrative + goal checklist + toolset preview + start CTA. */
export interface Scenario {
  id: string;
  /** preset text filled into the shared prompt textarea */
  prompt: string;
  /** number of localized `setup.scenario.<id>.goalN` lines rendered */
  goalCount: number;
  /** toolset seeded into session.tools on start */
  tools: SessionTools;
}

interface Props {
  scenario: Scenario;
  busy: boolean;
  onStart: () => void;
}

/** Radio card option: the label wraps the RadioGroupItem so the whole card
 *  body selects; the start CTA is a real button sibling (no nested
 *  interactives). Checked state styles the shell via `has-[]`. */
export function ScenarioCard({ scenario, busy, onStart }: Props) {
  const { id } = scenario;
  const titleId = `scenario-${id}-title`;
  const descId = `scenario-${id}-desc`;
  return (
    <div className="flex flex-col rounded-card bg-white ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-persimmon hover:ring-persimmon/40 has-[[data-state=checked]]:hover:ring-persimmon">
      <Label className="flex flex-1 cursor-pointer flex-col items-stretch gap-3 p-5 leading-normal font-normal">
        <span className="flex items-start justify-between gap-3">
          <h3 id={titleId} className="font-display text-base font-semibold">
            <FormattedMessage id={`setup.preset.${id}`} />
          </h3>
          <RadioGroupItem
            value={id}
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="mt-0.5"
          />
        </span>
        <p id={descId} className="text-sm font-normal text-espresso-soft">
          <FormattedMessage id={`setup.scenario.${id}.narrative`} />
        </p>
        {scenario.goalCount > 0 && (
          <ul className="space-y-1.5 text-sm font-normal text-espresso">
            {Array.from({ length: scenario.goalCount }, (_, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1 shrink-0 rounded-full bg-persimmon" aria-hidden="true" />
                <FormattedMessage id={`setup.scenario.${id}.goal${i + 1}`} />
              </li>
            ))}
          </ul>
        )}
      </Label>
      <div className="flex items-center justify-between gap-2 px-5 pt-1 pb-5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-espresso-soft">
            <FormattedMessage id="setup.toolsLabel" />
          </span>
          {Object.keys(scenario.tools).map((toolId) => {
            const spec = TOOL_REGISTRY[toolId];
            if (!spec) return null;
            const Icon = spec.icon;
            return (
              <span
                key={toolId}
                title={toolId}
                className="inline-flex size-6 items-center justify-center rounded-full bg-cream ring-1 ring-hairline"
              >
                <Icon className="size-3 text-espresso-soft" aria-hidden="true" />
              </span>
            );
          })}
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={onStart}
          className="group h-11 shrink-0 rounded-full bg-espresso px-4 text-cream shadow-none transition-all duration-300 hover:bg-persimmon active:scale-[0.97] sm:h-9"
        >
          <FormattedMessage id="setup.start" />
          <ArrowRight
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  );
}

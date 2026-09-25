import { ArrowRight } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Button } from "./vendor/button";
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
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onStart: () => void;
}

export function ScenarioCard({ scenario, selected, busy, onSelect, onStart }: Props) {
  const { id } = scenario;
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex cursor-pointer flex-col gap-3 rounded-card bg-white p-5 ring-1 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-persimmon/40 active:scale-[0.99] ${
        selected ? "ring-2 ring-persimmon" : "ring-hairline"
      }`}
    >
      <h3 className="font-display text-base font-semibold">
        <FormattedMessage id={`setup.preset.${id}`} />
      </h3>
      <p className="text-sm text-espresso-soft">
        <FormattedMessage id={`setup.scenario.${id}.narrative`} />
      </p>
      {scenario.goalCount > 0 && (
        <ul className="space-y-1.5 text-sm text-espresso">
          {Array.from({ length: scenario.goalCount }, (_, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="size-1 shrink-0 rounded-full bg-persimmon" aria-hidden="true" />
              <FormattedMessage id={`setup.scenario.${id}.goal${i + 1}`} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
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
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className="group h-11 shrink-0 rounded-full bg-espresso px-4 text-cream shadow-none transition-all duration-300 hover:bg-persimmon active:scale-[0.97] sm:h-9"
        >
          <FormattedMessage id="setup.start" />
          <ArrowRight
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Button>
      </div>
    </article>
  );
}

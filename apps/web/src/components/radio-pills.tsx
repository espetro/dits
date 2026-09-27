import * as React from "react";
import { Label } from "./vendor/label";
import { RadioGroup, RadioGroupItem } from "./vendor/radio-group";

/** Chip-style single-select built on the vendored RadioGroup + Label:
 *  one tab stop per row, arrow-key navigation, real radio semantics. */
function RadioPills({ className, ...props }: React.ComponentProps<typeof RadioGroup>) {
  return (
    <RadioGroup className={`mt-3 flex w-full flex-wrap gap-2 ${className ?? ""}`} {...props} />
  );
}

interface RadioPillProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

function RadioPill({ value, disabled, className, children }: RadioPillProps) {
  return (
    <Label
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-normal text-espresso-soft ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] has-[[data-state=checked]]:bg-espresso has-[[data-state=checked]]:text-cream has-[[data-state=checked]]:hover:bg-espresso has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-persimmon/50 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60 sm:min-h-8 sm:py-1.5 ${className ?? ""}`}
    >
      <RadioGroupItem value={value} disabled={disabled} className="sr-only" />
      {children}
    </Label>
  );
}

export { RadioPills, RadioPill };

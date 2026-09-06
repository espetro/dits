import * as React from "react";
import { useIntl } from "react-intl";

import { Button } from "./vendor/button";

/**
 * Markdown editor for the interview editor tab, built on Milkdown Crepe
 * (WYSIWYG markdown with CodeMirror 6 code blocks). Loaded lazily: Crepe
 * pulls ProseMirror + CodeMirror + language data, which must stay off the
 * interview screen's critical path.
 *
 * Value contract: plain markdown string, mirrored from/to the caller's
 * onChange (the interview route stores it in $editorBuffer so the voice
 * agent can read it). Milkdown is uncontrolled, so external value changes
 * only apply while the user is not editing (props.value !== lastEmitted).
 */

export interface MilkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  /** Registered once the lazy impl mounts; lets the toolbar drive the editor. */
  onReady?: (api: MilkdownApi) => void;
}

export interface MilkdownApi {
  insertCodeBlock: (language: string) => void;
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  const [Mod, setMod] = React.useState<{
    default: React.ComponentType<MilkdownEditorProps>;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    import("./milkdown-editor-impl").then((m) => {
      if (!cancelled) setMod({ default: m.MilkdownEditorImpl });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Mod) {
    return (
      <div
        role="textbox"
        aria-busy="true"
        aria-label={props.placeholder ?? "editor"}
        className={"animate-pulse rounded-2xl bg-espresso/5 " + (props.className ?? "")}
      />
    );
  }
  return <Mod.default {...props} />;
}

/**
 * One-click language shortcuts for starting a code block. Crepe's own
 * in-block picker (searchable, all CodeMirror languages) remains the source
 * of truth for retargeting existing blocks.
 */
const QUICK_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "java",
  "go",
  "rust",
  "sql",
] as const;

export function CodeLanguageBar({
  className = "",
  onInsert,
}: {
  className?: string;
  onInsert?: (language: string) => void;
}) {
  const intl = useIntl();
  return (
    <div
      className={"flex flex-wrap gap-1 " + className}
      role="toolbar"
      aria-label={intl.formatMessage({ id: "interview.editorLanguages" })}
    >
      {QUICK_LANGUAGES.map((lang) => (
        <Button
          key={lang}
          variant="ghost"
          className="h-7 rounded-full px-2.5 text-[11px] font-medium text-espresso-soft hover:bg-cream-deep hover:text-espresso"
          onClick={() => onInsert?.(lang)}
        >
          {lang}
        </Button>
      ))}
    </div>
  );
}

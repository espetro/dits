import * as React from "react";
import { useIntl } from "react-intl";

/**
 * Code notepad for the interview `code` tool tab, built on CodeMirror 6.
 * Loaded lazily: CM6 + language grammars stay off the interview screen's
 * critical path (same split as milkdown-editor.tsx).
 *
 * Value contract: plain code string, mirrored from/to the caller's onChange
 * (the code tab stores it in $codeBuffer so the agent can read it). The
 * editor is uncontrolled; external value changes only apply while the user
 * is not editing.
 */

/** Curated languages for the notepad picker; ids map to grammar packs in the impl. */
export const CODE_LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "json", label: "JSON" },
] as const;

export interface CodeEditorProps {
  value: string;
  /** One of CODE_LANGUAGES ids; the impl reconfigures its grammar on change. */
  language: string;
  onChange: (code: string) => void;
  /** Lezer parse verdict after each doc change; "unknown" while parsing lags. */
  onSyntax?: (verdict: "unknown" | "ok" | "error") => void;
  placeholder?: string;
  className?: string;
}

export function CodeEditor(props: CodeEditorProps) {
  const intl = useIntl();
  const [Mod, setMod] = React.useState<{
    default: React.ComponentType<CodeEditorProps>;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    import("./code-editor-impl").then((m) => {
      if (!cancelled) setMod({ default: m.CodeEditorImpl });
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
        aria-label={props.placeholder ?? intl.formatMessage({ id: "a11y.editor" })}
        className={"animate-pulse rounded-2xl bg-espresso/5 " + (props.className ?? "")}
      />
    );
  }
  return <Mod.default {...props} />;
}

import * as React from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, placeholder as cmPlaceholder } from "@codemirror/view";
import { HighlightStyle, ensureSyntaxTree, syntaxHighlighting } from "@codemirror/language";
import type { LanguageSupport } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";

import type { CodeEditorProps } from "./code-editor";

/**
 * Lazy-loaded CodeMirror 6 implementation (see code-editor.tsx for the
 * contract). Kept in its own module so grammars only load when the code tab
 * mounts. Theme maps onto the di palette via theme.css vars.
 */

const LANGUAGE_SUPPORT: Record<string, () => LanguageSupport> = {
  python: () => python(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  java: () => java(),
  cpp: () => cpp(),
  go: () => go(),
  rust: () => rust(),
  sql: () => sql(),
  json: () => json(),
};

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-paper)",
    color: "var(--color-espresso)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--color-espresso)" },
  ".cm-cursor": { borderLeftColor: "var(--color-espresso)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-espresso-faint)",
    border: "none",
    fontFamily: "var(--font-mono)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--color-espresso)",
  },
  ".cm-activeLine": { backgroundColor: "rgba(43, 33, 24, 0.04)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(255, 111, 30, 0.18)",
  },
  ".cm-selectionMatch": { backgroundColor: "rgba(255, 111, 30, 0.12)" },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(255, 111, 30, 0.16)",
    outline: "none",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-foreground)",
  },
});

const editorHighlight = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword],
      color: "var(--color-persimmon-text)",
    },
    { tag: [tags.string, tags.special(tags.string)], color: "#7a8f4e" },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment],
      color: "var(--color-espresso-faint)",
      fontStyle: "italic",
    },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--color-persimmon-deep)" },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: "#7da7c4",
    },
    { tag: [tags.typeName, tags.className, tags.tagName], color: "#2f6f8f" },
    { tag: [tags.propertyName, tags.attributeName], color: "#8a6b3d" },
    { tag: [tags.operator, tags.punctuation], color: "var(--color-espresso-soft)" },
  ]),
);

/**
 * Lezer is error-tolerant: walk the parse tree for error nodes. The tree is
 * incremental — `ensureSyntaxTree` returns null while it lags behind the doc,
 * which we surface as "unknown" rather than a false clean bill.
 */
function syntaxVerdict(state: EditorState): "unknown" | "ok" | "error" {
  const tree = ensureSyntaxTree(state, state.doc.length, 100);
  if (!tree) return "unknown";
  let verdict: "ok" | "error" = "ok";
  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        verdict = "error";
        return false;
      }
    },
  });
  return verdict;
}

export function CodeEditorImpl({
  value,
  language,
  onChange,
  onSyntax,
  placeholder,
  className = "",
}: CodeEditorProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const languageConf = React.useRef(new Compartment());
  const lastEmitted = React.useRef(value);
  const callbacksRef = React.useRef({ onChange, onSyntax });
  callbacksRef.current = { onChange, onSyntax };

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || viewRef.current) return;
    const view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          editorTheme,
          editorHighlight,
          languageConf.current.of(LANGUAGE_SUPPORT[language]?.() ?? []),
          cmPlaceholder(placeholder ?? ""),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const code = update.state.doc.toString();
              lastEmitted.current = code;
              callbacksRef.current.onChange(code);
              callbacksRef.current.onSyntax?.(syntaxVerdict(update.state));
            } else if (update.transactions.length) {
              callbacksRef.current.onSyntax?.(syntaxVerdict(update.state));
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    callbacksRef.current.onSyntax?.(syntaxVerdict(view.state));
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uncontrolled editor: create once
  }, []);

  // language picker swaps the grammar, not the buffer
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageConf.current.reconfigure(LANGUAGE_SUPPORT[language]?.() ?? []),
    });
    callbacksRef.current.onSyntax?.(syntaxVerdict(view.state));
  }, [language]);

  // external rewrites while untouched (value differs from what we emitted)
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmitted.current) return;
    lastEmitted.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={rootRef}
      className={
        "h-full min-h-0 overflow-hidden rounded-2xl bg-paper ring-1 ring-hairline " + className
      }
    />
  );
}

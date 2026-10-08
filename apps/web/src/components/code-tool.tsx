import { FormattedMessage, useIntl } from "react-intl";
import { useStore } from "@nanostores/react";
import { $codeBuffer, $codeLanguage, $codeSyntax } from "../stores/session";
import { CodeEditor, CODE_LANGUAGES } from "./code-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./vendor/select";

/** Dock pane for the `code` tool: language picker + CodeMirror notepad. */
export function CodeTool() {
  const intl = useIntl();
  const buffer = useStore($codeBuffer);
  const language = useStore($codeLanguage);
  const syntax = useStore($codeSyntax);
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <Select value={language} onValueChange={(v) => $codeLanguage.set(v)}>
          <SelectTrigger
            aria-label={intl.formatMessage({ id: "interview.codeLanguage" })}
            className="h-8 w-auto gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-[11px] font-medium text-espresso-soft shadow-none hover:bg-cream-deep hover:text-espresso"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODE_LANGUAGES.map((lang) => (
              <SelectItem key={lang.id} value={lang.id}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {syntax === "error" && (
          <span className="text-[11px] font-medium text-persimmon-text">
            <FormattedMessage id="interview.codeSyntaxError" />
          </span>
        )}
      </div>
      <CodeEditor
        value={buffer}
        language={language}
        onChange={(code) => $codeBuffer.set(code)}
        onSyntax={(verdict) => $codeSyntax.set(verdict)}
        placeholder={intl.formatMessage({ id: "interview.codePlaceholder" })}
        className="min-h-0 w-full flex-1"
      />
    </div>
  );
}

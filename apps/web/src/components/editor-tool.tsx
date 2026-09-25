import { lazy, useRef } from "react";
import { useIntl } from "react-intl";
import { useStore } from "@nanostores/react";
import { $editorBuffer } from "../stores/session";

const MilkdownEditor = lazy(() =>
  import("./milkdown-editor").then((m) => ({
    default: m.MilkdownEditor,
  })),
);

const CodeLanguageBar = lazy(() =>
  import("./milkdown-editor").then((m) => ({
    default: m.CodeLanguageBar,
  })),
);

type EditorApi = import("./milkdown-editor").MilkdownApi;

/** Dock pane for the `editor` tool: language bar + markdown/code editor. */
export function EditorTool() {
  const intl = useIntl();
  const buffer = useStore($editorBuffer);
  const editorApi = useRef<EditorApi | null>(null);
  return (
    <div className="flex h-full flex-col gap-2">
      <CodeLanguageBar
        className="px-1"
        onInsert={(lang) => editorApi.current?.insertCodeBlock(lang)}
      />
      <MilkdownEditor
        value={buffer}
        onChange={(markdown) => $editorBuffer.set(markdown)}
        placeholder={intl.formatMessage({ id: "interview.editorPlaceholder" })}
        className="min-h-0 w-full flex-1"
        onReady={(api) => (editorApi.current = api)}
      />
    </div>
  );
}

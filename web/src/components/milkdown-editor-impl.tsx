import * as React from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { replaceAll, callCommand } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import { createCodeBlockCommand } from "@milkdown/kit/preset/commonmark";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

import type { MilkdownApi } from "./milkdown-editor";

/**
 * Lazy-loaded Milkdown Crepe implementation (see milkdown-editor.tsx for the
 * contract). Kept in its own module so the heavy ProseMirror/CodeMirror
 * dependencies are only fetched when the editor tab mounts.
 *
 * Theme: the frame theme is token-driven via CSS; overrides in theme.css map
 * --crepe-* variables onto the di palette.
 */
export function MilkdownEditorImpl({
  value,
  onChange,
  placeholder,
  className = "",
  onReady,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  onReady?: (api: MilkdownApi) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const crepeRef = React.useRef<Crepe | null>(null);
  const lastEmitted = React.useRef<string>(value);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || crepeRef.current) return;
    const crepe = new Crepe({
      root,
      defaultValue: value,
      features: {
        // editor tab is a notes surface: keep it lean
        [CrepeFeature.Latex]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.AI]: false,
      },
      featureConfigs: {
        [CrepeFeature.Placeholder]: { text: placeholder ?? "", mode: "doc" },
      },
    });
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown, _prev) => {
        lastEmitted.current = markdown;
        onChange(markdown);
      });
    });
    void crepe.create().then(() => {
      crepeRef.current = crepe;
      onReady?.({
        insertCodeBlock: (language) => {
          crepe.editor.action((ctx) => {
            // turn the current text block into a code block, then set its
            // language attr on the resolved node (setNodeAttribute wants the
            // node's own position, not the selection offset)
            const view = ctx.get(editorViewCtx);
            view.focus();
            if (!callCommand(createCodeBlockCommand.key)(ctx)) return;
            const { state } = view;
            const { from } = state.selection;
            const depth = state.doc.resolve(from).depth;
            const nodePos = state.doc.resolve(from).before(depth);
            view.dispatch(state.tr.setNodeAttribute(nodePos, "language", language));
          });
        },
      });
    });
    return () => {
      void crepe.destroy();
      crepeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uncontrolled editor: create once
  }, []);

  // external rewrites (e.g. agent editing the buffer) while untouched
  React.useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe || value === lastEmitted.current) return;
    lastEmitted.current = value;
    crepe.editor.action(replaceAll(value));
  }, [value, onChange]);

  return (
    <div ref={rootRef} className={"di-milkdown h-full min-h-0 overflow-y-auto " + className} />
  );
}

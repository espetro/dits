import * as React from "react";
import { Tldraw, getSnapshot } from "tldraw";
import type { Editor } from "tldraw";
import "tldraw/tldraw.css";
import { pruneSnapshot, serializeSnapshot } from "../lib/whiteboard-store";
import { $whiteboard } from "../stores/session";

const DEBOUNCE_MS = 400;

/**
 * Embedded tldraw canvas. Client-side only state; every committed store change
 * is debounced, pruned via whiteboard-store.ts, and mirrored into the
 * $whiteboard nanostore so the worker's read_whiteboard tool (fetched through
 * the di API) always sees the latest board.
 */
export function WhiteboardPanel() {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = React.useCallback((editor: Editor) => {
    const flush = () => {
      const snapshot = pruneSnapshot(getSnapshot(editor.store).document);
      $whiteboard.set(serializeSnapshot(snapshot));
    };
    flush();
    editor.store.listen(
      () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, DEBOUNCE_MS);
      },
      { scope: "document" },
    );
  }, []);

  return (
    <div className="h-full w-full overflow-hidden rounded-2xl">
      <Tldraw onMount={handleMount} />
    </div>
  );
}

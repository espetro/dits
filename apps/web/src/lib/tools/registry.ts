import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { Code2, PenLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentAccess } from "@di/shared";

/**
 * ToolSpec registry (p3-21): one entry per dock tool. `agentAccess` mirrors
 * `TOOL_AGENT_ACCESS` in @di/shared and decides which `read_*`/`update_*`
 * agent tools the spec exposes; `platforms` hides heavy panes where they
 * cannot run (whiteboard stays server-only while tldraw is bundled).
 */
export interface ToolSpec {
  id: string;
  /** react-intl message id for the tab label. */
  labelKey: string;
  icon: LucideIcon;
  component: LazyExoticComponent<ComponentType>;
  agentAccess: AgentAccess;
  platforms: "all" | "server-only";
}

export const TOOL_REGISTRY: Record<string, ToolSpec> = {
  editor: {
    id: "editor",
    labelKey: "interview.tab.editor",
    icon: Code2,
    component: lazy(() =>
      import("../../components/editor-tool").then((m) => ({ default: m.EditorTool })),
    ),
    agentAccess: "read",
    platforms: "all",
  },
  whiteboard: {
    id: "whiteboard",
    labelKey: "interview.tab.whiteboard",
    icon: PenLine,
    component: lazy(() =>
      import("../../components/whiteboard-panel").then((m) => ({
        default: m.WhiteboardPanel,
      })),
    ),
    agentAccess: "read",
    platforms: "server-only",
  },
};

/**
 * Resolve a session's `tools` record into renderable specs, preserving record
 * order (insertion order = tab order). Unknown ids (tools the registry does
 * not ship yet) and server-only panes in client-only mode are skipped.
 */
export function dockSpecs(
  sessionTools: Record<string, string> | undefined,
  clientOnly: boolean,
): ToolSpec[] {
  return Object.keys(sessionTools ?? {})
    .map((id) => TOOL_REGISTRY[id])
    .filter(
      (spec): spec is ToolSpec => !!spec && !(clientOnly && spec.platforms === "server-only"),
    );
}

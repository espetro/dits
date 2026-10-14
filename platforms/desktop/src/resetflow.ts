export interface ResetView {
  phase: "idle" | "confirm" | "running" | "done" | "error";
  label: string;
  cancelHidden: boolean;
  disabled: boolean;
  message: string;
}

export interface ResetFlowDeps {
  fetch: (
    path: string,
    init: { method: string },
  ) => Promise<{
    ok: boolean;
    json: () => Promise<{ error?: string }>;
  }>;
  /** Called after every transition with the view to render. */
  render: (view: ResetView) => void;
  /** Called once the request settled (success or failure). */
  afterReset: () => Promise<void> | void;
}

/**
 * Reset button state machine: idle -> confirm -> running -> done | error.
 * Self-contained on purpose: dashboard.ts inlines this function's source
 * into the webview script via toString(), so it must not reference any
 * outer binding.
 */
export function createResetFlow(deps: ResetFlowDeps) {
  let phase: ResetView["phase"] = "idle";
  let message = "";
  const view = (): ResetView => ({
    phase,
    label: phase === "confirm" ? "yes, erase everything" : "reset all data…",
    cancelHidden: phase !== "confirm",
    disabled: phase === "running",
    message,
  });
  const emit = () => deps.render(view());

  async function click(): Promise<void> {
    if (phase === "running") return;
    if (phase !== "confirm") {
      phase = "confirm";
      message = "this deletes the database, models, logs, config and keys. it cannot be undone.";
      emit();
      return;
    }
    phase = "running";
    message = "resetting…";
    emit();
    try {
      const res = await deps.fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        phase = "done";
        message = "all data erased";
      } else {
        let m = "reset failed";
        try {
          m = (await res.json()).error || m;
        } catch {}
        phase = "error";
        message = "reset failed: " + m;
      }
    } catch {
      phase = "error";
      message = "reset failed: control api unreachable";
    }
    emit();
    await deps.afterReset();
  }

  function cancel(): void {
    if (phase !== "confirm") return;
    phase = "idle";
    message = "";
    emit();
  }

  return { click, cancel, view };
}

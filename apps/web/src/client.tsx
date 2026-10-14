import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { ensureRuntimeProbe } from "./lib/runtime";

// probe /api/health once per app load: every route needs $serverReachable
// settled (relay activation, driver pick), not just /setup
ensureRuntimeProbe();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});

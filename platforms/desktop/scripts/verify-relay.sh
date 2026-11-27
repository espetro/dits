#!/usr/bin/env bash
# Desktop verify with the relay leg exercised: starts the evals mock provider
# (no-cors, emulating openrouter/bifrost) unless one is already up, then runs
# the sidecar smoke (platforms/desktop/scripts/verify.ts) against it. Requires
# the built SPA in apps/web/dist/client (mise run build or cd apps/web && bun
# run build) — without it the SPA-index leg fails.
set -euo pipefail
cd "$(dirname "$0")/../../.."

mock_port="${MOCK_PORT:-9000}"
mock_pid=""
cleanup() {
  if [ -n "$mock_pid" ] && kill -0 "$mock_pid" 2>/dev/null; then
    kill "$mock_pid" 2>/dev/null || true
    wait "$mock_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if curl -sf -m 1 "http://localhost:${mock_port}/v1/models" >/dev/null 2>&1; then
  echo "[verify-relay] mock provider already on :${mock_port}"
else
  # mock CLI parses query-string style args: `port=9000 no-cors` (NOT --port).
  bun run packages/evals/mock-provider/main.ts "port=${mock_port}" no-cors &
  mock_pid=$!
  for _ in $(seq 1 50); do
    curl -sf -m 1 "http://localhost:${mock_port}/v1/models" >/dev/null 2>&1 && break
    sleep 0.1
  done
  echo "[verify-relay] mock provider started on :${mock_port} (pid ${mock_pid})"
fi

export MOCK_PORT="$mock_port"
bun run platforms/desktop/scripts/verify.ts

#!/usr/bin/env bash
# Compatibility wrapper for the old relay-smoke entrypoint. Relay behavior is
# server-owned and covered by apps/server and tests/e2e; desktop verification
# stays scoped to supervisor behavior in scripts/verify.ts.
set -euo pipefail
cd "$(dirname "$0")/../../.."

echo "[verify-relay] relay legs moved out of desktop verify; running desktop supervisor verify"
bun run platforms/desktop/scripts/verify.ts

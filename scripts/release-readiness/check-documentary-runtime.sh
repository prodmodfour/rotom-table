#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TRACE="$(mktemp /tmp/rotom-documentary-trace.XXXXXX)"
cleanup() { rm -f "$TRACE"; }
trap cleanup EXIT
cd "$ROOT"
strace -f -qq -e trace=openat,newfstatat,statx,access,execve -o "$TRACE" \
  npx vite-node --config vitest.config.ts scripts/release-readiness/runtime-documentary-probe.ts
node scripts/release-readiness/check-documentary-reads.mjs --trace "$TRACE"

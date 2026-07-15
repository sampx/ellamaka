#!/usr/bin/env bash
set -euo pipefail
# check-app-baseline.sh — Verify packages/app/ matches its fixed upstream baseline
#
# The upstream reference commit is:
#   385cb694419f98103af0e8fc6187ddcbcbb6eecb
# This is OpenCode v1.15.13.
#
# Usage:
#   ./scripts/check-app-baseline.sh
#
# Exit 0: packages/app/ is identical to the baseline.
# Exit 1: packages/app/ has drifted from the baseline.

BASELINE_COMMIT="385cb694419f98103af0e8fc6187ddcbcbb6eecb"

cd "$(dirname "$0")/.."

echo "Checking packages/app/ against upstream baseline ${BASELINE_COMMIT}..."

if git diff --exit-code "${BASELINE_COMMIT}" -- packages/app/ > /dev/null 2>&1; then
  echo "✓ packages/app/ matches baseline ${BASELINE_COMMIT} — no drift."
  exit 0
else
  echo "✗ packages/app/ has drifted from baseline ${BASELINE_COMMIT}."
  echo ""
  echo "Diff summary:"
  git diff --stat "${BASELINE_COMMIT}" -- packages/app/
  exit 1
fi

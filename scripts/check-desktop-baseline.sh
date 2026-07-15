#!/usr/bin/env bash
set -euo pipefail
# check-desktop-baseline.sh — Verify packages/desktop/ matches its fixed upstream baseline
#
# The upstream reference commit is:
#   385cb694419f98103af0e8fc6187ddcbcbb6eecb
# This is OpenCode v1.15.13, Electron 41.2.1.
#
# Usage:
#   ./scripts/check-desktop-baseline.sh
#
# Exit 0: packages/desktop/ is identical to the baseline.
# Exit 1: packages/desktop/ has drifted from the baseline.

BASELINE_COMMIT="385cb694419f98103af0e8fc6187ddcbcbb6eecb"

cd "$(dirname "$0")/.."

echo "Checking packages/desktop/ against upstream baseline ${BASELINE_COMMIT}..."

if git diff --exit-code "${BASELINE_COMMIT}" -- packages/desktop/ > /dev/null 2>&1; then
  echo "✓ packages/desktop/ matches baseline ${BASELINE_COMMIT} — no drift."
  exit 0
else
  echo "✗ packages/desktop/ has drifted from baseline ${BASELINE_COMMIT}."
  echo ""
  echo "Diff summary:"
  git diff --stat "${BASELINE_COMMIT}" -- packages/desktop/
  exit 1
fi
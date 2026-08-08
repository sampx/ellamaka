#!/usr/bin/env bash
set -euo pipefail
# check-app-baseline.sh — Verify packages/app/ matches its fixed upstream baseline
#
# The baseline commit is read from release/upstreams.lock.json
# (componentBaselines["packages/app"].gitCommit). Per
# docs/DISTRIBUTION.md §3.3, the lock is the single source of truth for
# frozen component baselines; this script must not hardcode the commit.
#
# Usage:
#   ./scripts/check-app-baseline.sh
#
# Exit 0: packages/app/ is identical to the baseline.
# Exit 1: packages/app/ has drifted from the baseline.

SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_FILE="$REPO_ROOT/release/upstreams.lock.json"
COMPONENT="packages/app"

cd "$REPO_ROOT"

if [ ! -f "$LOCK_FILE" ]; then
  echo "✗ upstream lock not found: $LOCK_FILE" >&2
  exit 1
fi

BASELINE_COMMIT="$(node -e "
const lock = JSON.parse(require('fs').readFileSync('$LOCK_FILE', 'utf8'));
const entry = lock.componentBaselines && lock.componentBaselines['$COMPONENT'];
if (!entry) { console.error('component $COMPONENT missing from lock'); process.exit(1); }
process.stdout.write(entry.gitCommit);
")"

echo "Checking $COMPONENT/ against upstream baseline ${BASELINE_COMMIT}..."

if git diff --exit-code "${BASELINE_COMMIT}" -- "$COMPONENT/" > /dev/null 2>&1; then
  echo "✓ $COMPONENT/ matches baseline ${BASELINE_COMMIT} — no drift."
  exit 0
else
  echo "✗ $COMPONENT/ has drifted from baseline ${BASELINE_COMMIT}." >&2
  echo "" >&2
  echo "Diff summary:" >&2
  git diff --stat "${BASELINE_COMMIT}" -- "$COMPONENT/" >&2
  exit 1
fi

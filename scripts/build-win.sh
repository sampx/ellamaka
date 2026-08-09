#!/bin/bash
# scripts/build-win.sh — build the Ellamaka Desktop for Windows via CI.
#
# Triggers the publish-ellamaka-desktop workflow on the current branch with
# channel=main, os=windows, and a locally-resolved dev version (same format as
# build.sh: <next>-main.<timestamp>), waits for the run, then downloads the
# Windows NSIS artifact. Never publishes: publish=false is always passed.
#
# Usage:
#   bash scripts/build-win.sh [--out <dir>] [--no-wait] [--force]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="wopal-cn/ellamaka"
WORKFLOW="publish-ellamaka-desktop.yml"
CHANNEL="main"
OS_TARGET="windows"
ARTIFACT_NAME="desktop-windows-latest"
OUT_DIR="$PROJECT_ROOT/dist/ci"
NO_WAIT=false
FORCE=false

show_help() {
  cat <<'EOF'
Usage: build-win.sh [options]

Build the Ellamaka Desktop for Windows via the CI workflow (channel=main,
os=windows, dev version, no publish), then download the NSIS artifact.

Options:
  --out <dir>     Download directory (default: <repo>/dist/ci)
  --no-wait       Trigger the workflow and exit without waiting
  --force         Skip the interactive working-tree / push confirmation
  -h, --help      Show this help
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help ;;
    --out)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "❌ --out requires a directory path" >&2
        exit 1
      fi
      OUT_DIR="$2"
      shift 2
      ;;
    --no-wait)
      NO_WAIT=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    *)
      echo "❌ Unknown option: $1" >&2
      show_help
      ;;
  esac
done

# ── Preflight ──────────────────────────────────────────────

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ gh CLI is required (brew install gh)" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

BRANCH="$(git -C "$PROJECT_ROOT" branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "❌ Not on a branch (detached HEAD). Check out a branch first." >&2
  exit 1
fi

# CI builds the pushed code. A dirty tree or an unpushed branch means the
# build would not contain local changes — confirm before burning a run.
DIRTY="$(git -C "$PROJECT_ROOT" status --porcelain)"
UPSTREAM="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref "@{u}" 2>/dev/null || true)"
AHEAD=""
if [[ -n "$UPSTREAM" ]]; then
  AHEAD="$(git -C "$PROJECT_ROOT" rev-list --count "@{u}..HEAD" 2>/dev/null || echo 0)"
fi

if [[ -n "$DIRTY" || -z "$UPSTREAM" || ( -n "$AHEAD" && "$AHEAD" != "0" ) ]]; then
  if ! $FORCE; then
    echo "⚠️  CI builds the pushed code on branch '$BRANCH'."
    if [[ -n "$DIRTY" ]]; then
      echo "   Working tree has uncommitted changes — they will NOT be in the build:"
      echo "$DIRTY" | head -10
    fi
    if [[ -z "$UPSTREAM" ]]; then
      echo "   Branch has no upstream — it has not been pushed."
    elif [[ -n "$AHEAD" && "$AHEAD" != "0" ]]; then
      echo "   Branch is $AHEAD commit(s) ahead of its upstream."
    fi
    read -r -p "Continue anyway? [y/N] " answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

# ── Resolve version (same format as build.sh) ──────────────

source "$SCRIPT_DIR/lib/version.sh"
VERSION="$(resolve_build_version "ellamaka-desktop" "$CHANNEL" "$PROJECT_ROOT")"
echo "📦 Building Desktop (channel: $CHANNEL, os: $OS_TARGET, version: $VERSION, branch: $BRANCH)"

# ── Trigger workflow ────────────────────────────────────────

echo "→ dispatching $WORKFLOW (ref=$BRANCH, channel=$CHANNEL, os=$OS_TARGET, version=$VERSION, publish=false)"
if ! gh workflow run "$WORKFLOW" -R "$REPO" \
  --ref "$BRANCH" \
  -f "channel=$CHANNEL" \
  -f "os=$OS_TARGET" \
  -f "version=$VERSION" \
  -f "publish=false"; then
  echo "❌ Failed to dispatch workflow" >&2
  exit 1
fi

# The dispatch response does not include a run id; poll the run list for the
# newest run on this branch. Sleep briefly so the new run appears first.
sleep 3
RUN_ID="$(gh run list --workflow "$WORKFLOW" -R "$REPO" --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
if [[ -z "$RUN_ID" ]]; then
  echo "❌ Could not determine the workflow run id. Check https://github.com/$REPO/actions" >&2
  exit 1
fi
echo "→ workflow run: https://github.com/$REPO/actions/runs/$RUN_ID"

if $NO_WAIT; then
  echo "ℹ️  --no-wait: run triggered, not waiting. Download later with:"
  echo "   gh run download $RUN_ID -R $REPO --name $ARTIFACT_NAME --dir $OUT_DIR"
  exit 0
fi

# ── Wait for completion ─────────────────────────────────────

if ! gh run watch "$RUN_ID" -R "$REPO" --exit-status >/dev/null 2>&1; then
  echo "❌ Workflow run $RUN_ID failed. Failed step logs:" >&2
  gh run view "$RUN_ID" -R "$REPO" --log-failed 2>/dev/null | tail -50 >&2 || true
  echo "   Full logs: gh run view $RUN_ID -R $REPO --log" >&2
  exit 1
fi

# ── Download artifact ───────────────────────────────────────

mkdir -p "$OUT_DIR"
echo "→ downloading $ARTIFACT_NAME → $OUT_DIR"
if ! gh run download "$RUN_ID" -R "$REPO" --name "$ARTIFACT_NAME" --dir "$OUT_DIR"; then
  echo "❌ Artifact download failed" >&2
  exit 1
fi

# The artifact preserves the repo layout (packages/ellamaka-desktop/dist/…).
# Flatten the NSIS installer to the output root.
EXE="$(find "$OUT_DIR" -name "ellamaka-desktop-win-x64.exe" -type f 2>/dev/null | head -1)"
if [[ -z "$EXE" ]]; then
  echo "❌ ellamaka-desktop-win-x64.exe not found in downloaded artifact" >&2
  find "$OUT_DIR" -type f | head -20 >&2
  exit 1
fi
if [[ "$(dirname "$EXE")" != "$OUT_DIR" ]]; then
  mv "$EXE" "$OUT_DIR/"
  EXE="$OUT_DIR/$(basename "$EXE")"
fi

HEAD_SHA="$(gh run view "$RUN_ID" -R "$REPO" --json headSha -q '.headSha' 2>/dev/null || echo unknown)"
SIZE="$(du -h "$EXE" | cut -f1)"
echo ""
echo "✅ Windows Desktop build ready:"
echo "   $EXE"
echo "   size: $SIZE, commit: ${HEAD_SHA:0:12}"

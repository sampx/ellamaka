#!/bin/bash
# scripts/build-linux.sh — build Ellamaka Desktop or CLI for Linux via CI.
#
# Dispatches the selected workflow on the current branch with publish=false,
# waits for completion, downloads the Linux artifact, and prints its run link.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="wopal-cn/ellamaka"
TARGET="desktop"
TARGET_EXPLICIT=false
CHANNEL="main"
WEB_UI="ellamaka-app"
OUT_DIR="$PROJECT_ROOT/dist/ci"
NO_WAIT=false
FORCE=false
ARCH="x64"

show_help() {
  cat <<'EOF'
Usage: build-linux.sh [options]

Build the Ellamaka Desktop or CLI for Linux via CI, without publishing, then
download the Linux artifact. The default target is Desktop.

Options:
  --desktop        Build Linux Desktop (default)
  --cli            Build Linux CLI
  --arch <arch>    Linux architecture: x64 or arm64 (default: x64)
  --channel <name> Desktop channel: main, beta, or prod (default: main)
  --web-ui <value> Embedded web UI for CLI (default: ellamaka-app)
  --out <dir>      Download directory (default: <repo>/dist/ci)
  --no-wait        Trigger the workflow and exit without waiting
  --force          Skip the interactive working-tree / push confirmation
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    --desktop|--cli)
      requested_target="${1#--}"
      if $TARGET_EXPLICIT && [[ "$TARGET" != "$requested_target" ]]; then
        echo "Cannot select both --desktop and --cli" >&2
        exit 1
      fi
      TARGET="$requested_target"
      TARGET_EXPLICIT=true
      shift
      ;;
    --arch)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--arch requires x64 or arm64" >&2
        exit 1
      fi
      ARCH="$2"
      shift 2
      ;;
    --channel)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--channel requires main, beta, or prod" >&2
        exit 1
      fi
      CHANNEL="$2"
      shift 2
      ;;
    --web-ui)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--web-ui requires a value" >&2
        exit 1
      fi
      WEB_UI="$2"
      shift 2
      ;;
    --out)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--out requires a directory path" >&2
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
      echo "Unknown option: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

case "$CHANNEL" in
  main|beta|prod) ;;
  *)
    echo "Unsupported channel: $CHANNEL (expected main, beta, or prod)" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x64|arm64) ;;
  *)
    echo "Unsupported architecture: $ARCH (expected x64 or arm64)" >&2
    exit 1
    ;;
esac

# ── Preflight ──────────────────────────────────────────────

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required (brew install gh)" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

BRANCH="$(git -C "$PROJECT_ROOT" branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "Not on a branch (detached HEAD). Check out a branch first." >&2
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
    echo "CI builds the pushed code on branch '$BRANCH'."
    if [[ -n "$DIRTY" ]]; then
      echo "  Working tree has uncommitted changes — they will NOT be in the build:"
      echo "$DIRTY" | head -10
    fi
    if [[ -z "$UPSTREAM" ]]; then
      echo "  Branch has no upstream — it has not been pushed."
    elif [[ -n "$AHEAD" && "$AHEAD" != "0" ]]; then
      echo "  Branch is $AHEAD commit(s) ahead of its upstream."
    fi
    read -r -p "Continue anyway? [y/N] " answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

# ── Resolve version and workflow ───────────────────────────

source "$SCRIPT_DIR/lib/version.sh"

if [[ "$TARGET" == "desktop" ]]; then
  WORKFLOW="publish-ellamaka-desktop.yml"
  ARTIFACT_NAME="desktop-ubuntu-latest"
  VERSION="$(resolve_build_version "ellamaka-desktop" "$CHANNEL" "$PROJECT_ROOT")"
  DESKTOP_ARTIFACT_PREFIX="ellamaka-desktop"
  if [[ "$CHANNEL" == "beta" ]]; then
    DESKTOP_ARTIFACT_PREFIX="ellamaka-desktop-beta"
  fi

  # The desktop workflow maps these inputs and github.sha to the same values
  # remotely, ensuring electron-builder produces the requested artifact name.
  export OPENCODE_VERSION="$VERSION"
  export OPENCODE_CHANNEL="$CHANNEL"
  export OPENCODE_BUILD_ID="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"

  WORKFLOW_ARGS=(
    -f "channel=$CHANNEL"
    -f "os=linux"
    -f "version=$VERSION"
    -f "publish=false"
  )
  echo "Building Linux Desktop ($ARCH, channel: $CHANNEL, version: $VERSION, branch: $BRANCH)"
else
  WORKFLOW="publish-ellamaka.yml"
  VERSION="$(resolve_build_version "ellamaka-cli" "main" "$PROJECT_ROOT")"
  WORKFLOW_ARGS=(
    -f "version=$VERSION"
    -f "web_ui=$WEB_UI"
    -f "publish=false"
  )
  echo "Building Linux CLI ($ARCH, web UI: $WEB_UI, version: $VERSION, branch: $BRANCH)"
fi

# ── Trigger workflow ───────────────────────────────────────

echo "Dispatching $WORKFLOW (ref=$BRANCH, version=$VERSION, publish=false)"
if ! gh workflow run "$WORKFLOW" -R "$REPO" --ref "$BRANCH" "${WORKFLOW_ARGS[@]}"; then
  echo "Failed to dispatch workflow" >&2
  exit 1
fi

# The dispatch response does not include a run id; poll the run list for the
# newest run on this branch. Sleep briefly so the new run appears first.
sleep 3
RUN_ID="$(gh run list --workflow "$WORKFLOW" -R "$REPO" --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
if [[ -z "$RUN_ID" ]]; then
  echo "Could not determine the workflow run id. Check https://github.com/$REPO/actions" >&2
  exit 1
fi
RUN_URL="https://github.com/$REPO/actions/runs/$RUN_ID"
echo "Workflow run: $RUN_URL"

if [[ "$TARGET" == "cli" ]]; then
  HEAD_SHA="$(gh run view "$RUN_ID" -R "$REPO" --json headSha -q '.headSha' 2>/dev/null || true)"
  if [[ -z "$HEAD_SHA" ]]; then
    echo "Could not determine the workflow commit for CLI artifact download" >&2
    exit 1
  fi
  ARTIFACT_NAME="cli-preview-$HEAD_SHA"
fi

print_download_links() {
  echo "Download links:"
  echo "  Run: $RUN_URL"
  echo "  Artifacts: $RUN_URL/artifacts"
}

if $NO_WAIT; then
  echo "--no-wait: run triggered, not waiting. Download later with:"
  echo "  gh run download $RUN_ID -R $REPO --name $ARTIFACT_NAME --dir $OUT_DIR"
  print_download_links
  exit 0
fi

# ── Wait for completion ─────────────────────────────────────

if ! gh run watch "$RUN_ID" -R "$REPO" --exit-status >/dev/null 2>&1; then
  echo "Workflow run $RUN_ID failed. Failed step logs:" >&2
  gh run view "$RUN_ID" -R "$REPO" --log-failed 2>/dev/null | tail -50 >&2 || true
  echo "Full logs: gh run view $RUN_ID -R $REPO --log" >&2
  exit 1
fi

# ── Download artifact ───────────────────────────────────────

mkdir -p "$OUT_DIR"
echo "Downloading $ARTIFACT_NAME to $OUT_DIR"
if ! gh run download "$RUN_ID" -R "$REPO" --name "$ARTIFACT_NAME" --dir "$OUT_DIR"; then
  echo "Artifact download failed" >&2
  exit 1
fi

flatten_artifact() {
  local name="$1" source destination
  source="$(find "$OUT_DIR" -type f -name "$name" -print -quit 2>/dev/null)"
  if [[ -z "$source" ]]; then
    return 1
  fi
  destination="$OUT_DIR/$(basename "$source")"
  if [[ "$source" != "$destination" ]]; then
    mv "$source" "$destination"
  fi
  printf '%s\n' "$destination"
}

if [[ "$TARGET" == "desktop" ]]; then
  APPIMAGE="$(flatten_artifact "$DESKTOP_ARTIFACT_PREFIX-linux-$ARCH.AppImage" || true)"
  if [[ -z "$APPIMAGE" ]]; then
    echo "$DESKTOP_ARTIFACT_PREFIX-linux-$ARCH.AppImage not found in downloaded artifact" >&2
    exit 1
  fi

  LINUX_PACKAGES=("$APPIMAGE")
  for extension in deb rpm; do
    package="$(flatten_artifact "$DESKTOP_ARTIFACT_PREFIX-linux-$ARCH.$extension" || true)"
    if [[ -n "$package" ]]; then
      LINUX_PACKAGES+=("$package")
    fi
  done

  SIZE="$(du -h "$APPIMAGE" | cut -f1)"
  echo "Linux Desktop build ready:"
  for package in "${LINUX_PACKAGES[@]}"; do
    echo "  $package"
  done
  echo "  AppImage size: $SIZE"
else
  CLI_ARCHIVE="$(flatten_artifact "ellamaka-linux-$ARCH.tar.gz" || true)"
  if [[ -z "$CLI_ARCHIVE" ]]; then
    echo "ellamaka-linux-$ARCH.tar.gz not found in downloaded artifact" >&2
    exit 1
  fi

  SIZE="$(du -h "$CLI_ARCHIVE" | cut -f1)"
  echo "Linux CLI build ready:"
  echo "  $CLI_ARCHIVE"
  echo "  size: $SIZE"
fi

print_download_links

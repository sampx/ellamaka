#!/bin/bash
# scripts/build-on-github.sh — build Ellamaka Desktop and/or CLI via GitHub Actions CI.
#
# Dispatches the selected workflow(s) on the current branch with publish=false,
# waits for completion, downloads the artifact(s), and prints run links.
#
# Usage:
#   build-on-github.sh [desktop|cli] [options]
#
# Subcommands:
#   desktop   Build Desktop (default when no subcommand)
#   cli       Build CLI
#   (none)    Build both Desktop and CLI
#
# Options:
#   --os <linux|windows>  Target OS for CI build (default: linux)
#   --arch <x64|arm64>    Architecture (default: x64; Windows supports x64 only)
#   --channel <name>      Desktop channel: main, beta, or prod (default: main)
#   --web-ui <value>      Embedded web UI for CLI (default: ellamaka-app)
#   --out <dir>           Download directory (default: <repo>/dist/ci)
#   --no-wait             Trigger the workflow and exit without waiting
#   --force               Skip the interactive working-tree / push confirmation
#   -h, --help            Show this help

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="wopal-cn/ellamaka"
OS="linux"
ARCH="x64"
CHANNEL="main"
WEB_UI="ellamaka-app"
OUT_DIR="$PROJECT_ROOT/dist/ci"
NO_WAIT=false
FORCE=false
TARGETS=()

show_help() {
  cat <<'EOF'
Usage: build-on-github.sh [desktop|cli] [options]

Build the Ellamaka Desktop and/or CLI via CI, without publishing,
then download the artifact(s). With no subcommand, both are built.

Subcommands:
  desktop        Build Desktop
  cli            Build CLI
  (none)         Build both Desktop and CLI

Options:
  --os <os>         Target OS: linux or windows (default: linux)
  --arch <arch>     Architecture: x64 or arm64 (default: x64; Windows: x64 only)
  --out <dir>       Download directory (default: <repo>/dist/ci)
  --no-wait         Trigger the workflow and exit without waiting
  --force           Skip the interactive working-tree / push confirmation
  -h, --help        Show this help

Desktop-only options:
  --channel <name>  Desktop channel: main, beta, or prod (default: main)

CLI-only options:
  --web-ui <value>  Embedded web UI for CLI (default: ellamaka-app)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    desktop|cli)
      TARGETS+=("$1")
      shift
      ;;
    --os)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--os requires linux or windows" >&2
        exit 1
      fi
      OS="$2"
      shift 2
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

# No subcommand → build both.
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=(desktop cli)
fi

case "$OS" in
  linux)
    OS_LABEL="Linux"
    DESKTOP_RUNNER="ubuntu-latest"
    ;;
  windows)
    OS_LABEL="Windows"
    DESKTOP_RUNNER="windows-latest"
    ;;
  *)
    echo "Unsupported OS: $OS (expected linux or windows)" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x64) ;;
  arm64)
    if [[ "$OS" != "linux" ]]; then
      echo "Unsupported architecture: arm64 (Windows builds support x64 only)" >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported architecture: $ARCH (expected x64 or arm64)" >&2
    exit 1
    ;;
esac

case "$CHANNEL" in
  main|beta|prod) ;;
  *)
    echo "Unsupported channel: $CHANNEL (expected main, beta, or prod)" >&2
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

source "$SCRIPT_DIR/lib/version.sh"

# ── Build one target ───────────────────────────────────────

build_one() {
  local target="$1"
  local workflow artifact_name version
  local -a workflow_args

  if [[ "$target" == "desktop" ]]; then
    workflow="publish-ellamaka-desktop.yml"
    artifact_name="desktop-$DESKTOP_RUNNER"
    version="$(resolve_build_version "ellamaka-desktop" "$CHANNEL" "$PROJECT_ROOT")"

    # The desktop workflow maps these inputs and github.sha to the same values
    # remotely, ensuring electron-builder produces the requested artifact name.
    export OPENCODE_VERSION="$version"
    export OPENCODE_CHANNEL="$CHANNEL"
    export OPENCODE_BUILD_ID="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"

    workflow_args=(
      -f "channel=$CHANNEL"
      -f "os=$OS"
      -f "version=$version"
      -f "publish=false"
    )
    echo "Building $OS_LABEL Desktop (arch: $ARCH, channel: $CHANNEL, version: $version, branch: $BRANCH)"
  else
    workflow="publish-ellamaka-cli.yml"
    version="$(resolve_build_version "ellamaka-cli" "main" "$PROJECT_ROOT")"
    workflow_args=(
      -f "version=$version"
      -f "web_ui=$WEB_UI"
      -f "platform=$OS"
      -f "publish=false"
    )
    echo "Building $OS_LABEL CLI (arch: $ARCH, web UI: $WEB_UI, version: $version, branch: $BRANCH)"
  fi

  echo "Dispatching $workflow (ref=$BRANCH, version=$version, publish=false)"
  if ! gh workflow run "$workflow" -R "$REPO" --ref "$BRANCH" "${workflow_args[@]}"; then
    echo "Failed to dispatch workflow" >&2
    return 1
  fi

  # The dispatch response does not include a run id; poll the run list for the
  # newest run on this branch. Sleep briefly so the new run appears first.
  sleep 3
  local run_id
  run_id="$(gh run list --workflow "$workflow" -R "$REPO" --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  if [[ -z "$run_id" ]]; then
    echo "Could not determine the workflow run id. Check https://github.com/$REPO/actions" >&2
    return 1
  fi
  local run_url="https://github.com/$REPO/actions/runs/$run_id"
  echo "Workflow run: $run_url"

  if [[ "$target" == "cli" ]]; then
    local head_sha
    head_sha="$(gh run view "$run_id" -R "$REPO" --json headSha -q '.headSha' 2>/dev/null || true)"
    if [[ -z "$head_sha" ]]; then
      echo "Could not determine the workflow commit for CLI artifact download" >&2
      return 1
    fi
    artifact_name="cli-preview-$head_sha"
  fi

  if $NO_WAIT; then
    echo "--no-wait: run triggered, not waiting. Download later with:"
    echo "  gh run download $run_id -R $REPO --name $artifact_name --dir $OUT_DIR"
    echo "Download links:"
    echo "  Run: $run_url"
    echo "  Artifacts: $run_url/artifacts"
    return 0
  fi

  if ! gh run watch "$run_id" -R "$REPO" --exit-status >/dev/null 2>&1; then
    echo "Workflow run $run_id failed. Failed step logs:" >&2
    gh run view "$run_id" -R "$REPO" --log-failed 2>/dev/null | tail -50 >&2 || true
    echo "Full logs: gh run view $run_id -R $REPO --log" >&2
    return 1
  fi

  mkdir -p "$OUT_DIR"
  echo "Downloading $artifact_name to $OUT_DIR"
  if ! gh run download "$run_id" -R "$REPO" --name "$artifact_name" --dir "$OUT_DIR"; then
    echo "Artifact download failed" >&2
    return 1
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

  if [[ "$target" == "desktop" ]]; then
    # electron-builder artifact prefix: beta channel gets -beta suffix.
    local primary_prefix="ellamaka-desktop"
    [[ "$CHANNEL" == "beta" ]] && primary_prefix="ellamaka-desktop-beta"
    local primary
    if [[ "$OS" == "linux" ]]; then
      primary="${primary_prefix}-linux-${ARCH}.AppImage"
    else
      primary="${primary_prefix}-win-${ARCH}.exe"
    fi

    local app
    app="$(flatten_artifact "$primary" || true)"
    if [[ -z "$app" ]]; then
      echo "$primary not found in downloaded artifact" >&2
      find "$OUT_DIR" -type f | head -20 >&2
      return 1
    fi

    local -a packages=("$app")
    if [[ "$OS" == "linux" ]]; then
      local deb_package
      deb_package="$(flatten_artifact "${primary_prefix}-linux-${ARCH}.deb" || true)"
      if [[ -n "$deb_package" ]]; then
        packages+=("$deb_package")
      fi
    fi

    local size
    size="$(du -h "$app" | cut -f1)"
    echo "$OS_LABEL Desktop build ready:"
    for package in "${packages[@]}"; do
      echo "  $package"
    done
    echo "  size: $size"
  else
    local cli_archive
    if [[ "$OS" == "linux" ]]; then
      cli_archive="$(flatten_artifact "ellamaka-linux-${ARCH}.tar.gz" || true)"
    else
      cli_archive="$(flatten_artifact "ellamaka-windows-x64.zip" || true)"
    fi
    if [[ -z "$cli_archive" ]]; then
      echo "CLI archive not found in downloaded artifact" >&2
      find "$OUT_DIR" -type f | head -20 >&2
      return 1
    fi

    local size
    size="$(du -h "$cli_archive" | cut -f1)"
    echo "$OS_LABEL CLI build ready:"
    echo "  $cli_archive"
    echo "  size: $size"
  fi

  echo "Download links:"
  echo "  Run: $run_url"
  echo "  Artifacts: $run_url/artifacts"
}

# ── Build all selected targets ─────────────────────────────

FAILED=()
for target in "${TARGETS[@]}"; do
  if ! build_one "$target"; then
    FAILED+=("$target")
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "Failed target(s): ${FAILED[*]}" >&2
  exit 1
fi
echo "All selected targets built successfully."

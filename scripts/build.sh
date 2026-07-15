#!/bin/bash
# ellamaka 编译脚本入口
# build.sh cli [options]      — 构建 CLI 二进制
# build.sh desktop [options]  — 构建 Electron 桌面应用

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY_NAME="ellamaka"

show_help() {
  cat <<'EOF'
Usage: build.sh <target> [options]

Targets:
  cli        Build CLI binary
  desktop    Build Desktop app

CLI options:
  --platform <mac|linux|win>
                          Target platform (comma-separated, e.g. "mac,linux")
  --arch <arm64|x64>      Target architecture (comma-separated)
  --all                   Build all 12 platform+arch combinations
  --web-ui <value>        Embedded web UI: "ellamaka-app" (default), "app", "none"
  --install               Install binary (symlink to ~/.wopal/bin)
  --sourcemaps            Generate sourcemaps

Desktop options:
  --channel <main|beta|prod>
                          Channel (default: main). Controls bundle ID, app name, icons.
  --install               Install .app to /Applications
EOF
  exit 0
}

TARGET="${1:-}"
shift 2>/dev/null || true

# ── CLI build ──────────────────────────────────────────────

function build_cli() {
  MODE="single"
  INSTALL=false
  BUILD_ARGS=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        ;;
      --all)
        MODE="all"
        shift
        ;;
      --platform)
        if [[ $# -lt 2 || "$2" == --* ]]; then
          echo "❌ --platform requires a value: mac, linux, win (comma-separated)"
          exit 1
        fi
        BUILD_ARGS+=("--platform" "$2")
        shift 2
        ;;
      --arch)
        MODE="arch"
        BUILD_ARGS+=("--arch" "$2")
        shift 2
        ;;
      --web-ui)
        if [[ $# -lt 2 || "$2" == --* ]]; then
          echo "❌ --web-ui requires a value: ellamaka-app, app, or none"
          exit 1
        fi
        BUILD_ARGS+=("--web-ui" "$2")
        shift 2
        ;;
      --install)
        INSTALL=true
        shift
        ;;
      --sourcemaps)
        BUILD_ARGS+=("--sourcemaps")
        shift
        ;;
      --single|--skip-deps|--skip-install)
        shift
        ;;
      *)
        BUILD_ARGS+=("$1")
        shift
        ;;
    esac
  done

  cd "$PROJECT_ROOT/packages/opencode"

  case "$MODE" in
    single)
      echo "🔨 Building CLI for current platform..."
      BUILD_ARGS+=("--single")
      ;;
    arch)
      echo "🔨 Building CLI with --arch filter..."
      ;;
    all)
      echo "🔨 Building CLI for all platforms..."
      ;;
  esac

  if [[ -z "${OPENCODE_VERSION:-}" ]]; then
    VERSION=$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 HEAD 2>/dev/null)
    VERSION="${VERSION#v}"
    if [[ -n "$VERSION" ]]; then
      export OPENCODE_VERSION="$VERSION"
    fi
  fi
  BINARY_NAME="$BINARY_NAME" bun "$PROJECT_ROOT/packages/ellamaka/build.ts" "${BUILD_ARGS[@]}"

  if $INSTALL; then
    PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m)"
    [[ "$ARCH" == "x86_64" ]] && ARCH="x64"

    DIST_DIR="$PROJECT_ROOT/dist/${BINARY_NAME}-${PLATFORM}-${ARCH}/bin"
    SRC="$DIST_DIR/$BINARY_NAME"

    if [[ ! -f "$SRC" ]]; then
      echo "❌ Binary not found: $SRC"
      exit 1
    fi

    mkdir -p "$HOME/.wopal/bin"
    SYMLINK="$HOME/.wopal/bin/${BINARY_NAME}-main"

    NEW_VER=$("$SRC" --version 2>/dev/null || echo "unknown")
    OLD_VER=$([[ -L "$SYMLINK" ]] && "$SYMLINK" --version 2>/dev/null || echo "none")
    echo "📦 $OLD_VER → $NEW_VER"

    rm -f "$SYMLINK" && ln -s "$SRC" "$SYMLINK"
    echo "✅ Symlinked: $SYMLINK → $SRC"
  fi
}

# ── Desktop build ──────────────────────────────────────────

function build_desktop() {
  INSTALL=false
  CHANNEL="main"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        ;;
      --channel)
        if [[ $# -lt 2 || "$2" == --* ]]; then
          echo "❌ --channel requires a value: main, beta, or prod"
          exit 1
        fi
        case "$2" in
          main|beta|prod) CHANNEL="$2" ;;
          *) echo "❌ Invalid channel: $2 (must be main, beta, or prod)"; exit 1 ;; 
        esac
        shift 2
        ;;
      --install)
        INSTALL=true
        shift
        ;;
      *)
        echo "❌ Unknown option: $1"
        exit 1
        ;;
    esac
  done

  export OPENCODE_CHANNEL="$CHANNEL"

  case "$CHANNEL" in
    main) APP_NAME="Ellamaka Main" ;;
    beta) APP_NAME="Ellamaka Beta" ;;
    prod) APP_NAME="Ellamaka" ;;
  esac

  DESKTOP_DIR="$PROJECT_ROOT/packages/ellamaka-desktop"

  if $INSTALL && [[ "$(uname -s)" == "Darwin" ]]; then
    if pgrep -f "${APP_NAME}.app/Contents/MacOS" >/dev/null 2>&1; then
      echo "❌ ${APP_NAME} is running. Quit it first, then retry."
      exit 1
    fi
  fi

  echo ""
  echo "🖥  Building Desktop (channel: $CHANNEL, app: $APP_NAME)..."

  cd "$DESKTOP_DIR"
  bun run build
  bun run package:mac

  APP_PATH=$(find "$DESKTOP_DIR/dist" -name "${APP_NAME}.app" -type d -maxdepth 3 2>/dev/null | head -1)

  if [[ -z "$APP_PATH" ]]; then
    echo "❌ .app not found in dist/"
    exit 1
  fi

  echo "✅ Desktop packaged: $APP_PATH"

  if $INSTALL && [[ "$(uname -s)" == "Darwin" ]]; then
    echo ""
    echo "📦 Installing to /Applications/${APP_NAME}.app..."
    rm -rf "/Applications/${APP_NAME}.app"
    cp -R "$APP_PATH" "/Applications/"
    echo "✅ Installed: /Applications/${APP_NAME}.app"
  elif $INSTALL; then
    echo "⚠️  Desktop install only supported on macOS"
  fi
}

# ── Dispatch ───────────────────────────────────────────────

case "$TARGET" in
  -h|--help|"")
    show_help
    ;;
  cli)
    build_cli "$@"
    ;;
  desktop)
    build_desktop "$@"
    ;;
  *)
    echo "❌ Unknown target: $TARGET"
    echo "   Usage: build.sh cli|desktop [options]"
    exit 1
    ;;
esac

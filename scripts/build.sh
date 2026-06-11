#!/bin/bash
# ellamaka 编译脚本入口
# 基于 packages/ellamaka/build.ts，默认构建本机架构目标

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY_NAME="ellamaka"

show_help() {
  cat <<'EOF'
Usage: build.sh [options]

Build ellamaka binary via build.ts. Default: current platform + host arch.

Options:
  -h, --help              Show this help message
  --all                   Build all 12 platform targets
  --arch <value>          Filter targets: "primary", "x64", "x64,arm64", etc.
  --install               Install binary after build
  --install-dir <dir>     Custom install directory (default: ~/.wopal/bin)
  --skip-embed-web-ui     Skip embedding web UI
  --sourcemaps            Generate sourcemaps
EOF
  exit 0
}

MODE="single"
INSTALL=false
INSTALL_DIR="$HOME/.wopal/bin"
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
    --arch)
      MODE="arch"
      BUILD_ARGS+=("--arch" "$2")
      shift 2
      ;;
    --install)
      INSTALL=true
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --single|--skip-deps|--skip-install)
      shift  # no-op (build.ts drives this via --single)
      ;;
    --skip-embed-web-ui|--sourcemaps)
      BUILD_ARGS+=("$1")
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
    echo "🔨 Building for current platform..."
    BUILD_ARGS+=("--single")
    ;;
  arch)
    echo "🔨 Building with --arch filter..."
    ;;
  all)
    echo "🔨 Building all platforms..."
    ;;
esac

if [[ -z "${OPENCODE_VERSION:-}" ]]; then
  VERSION=$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 2>/dev/null)
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
    echo "   (install requires --single or matching platform target)"
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  DST="$INSTALL_DIR/$BINARY_NAME"

  NEW_VER=$("$SRC" --version 2>/dev/null || echo "unknown")
  OLD_VER=$([[ -f "$DST" ]] && "$DST" --version 2>/dev/null || echo "none")
  echo "📦 $OLD_VER → $NEW_VER"

  cp -f "$SRC" "${DST}.tmp" && mv -f "${DST}.tmp" "$DST"
  echo "✅ Installed: $DST"
fi

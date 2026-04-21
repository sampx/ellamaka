#!/bin/bash
# darwin 编译脚本入口
# 自动切换到 packages/opencode 目录执行编译

show_help() {
  cat <<'EOF'
Usage: build.sh [options]

Build ellamaka binary for macOS (darwin).

Options:
  -h, --help              Show this help message
  --x64                   Build for x86_64 (default)
  --arm64                 Build for Apple Silicon
  --install               Create symlink to install directory
  --install-dir <dir>     Custom install directory (default: ~/.wopal/bin)
  --skip-embed-web-ui     Skip embedding web UI
  --skip-smoke-test       Skip smoke test after build
EOF
  exit 0
}

set -e
cd "$(dirname "$0")/../packages/opencode"

ARCH="x64"
INSTALL=false
INSTALL_DIR="$HOME/.wopal/bin"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    --x64|--arch=x64)
      ARCH="x64"
      shift
      ;;
    --arm64|--arch=arm64)
      ARCH="arm64"
      shift
      ;;
    --install)
      INSTALL=true
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --skip-embed-web-ui|--skip-smoke-test)
      EXTRA_ARGS+=("$1")
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# 执行编译
bun run script/build-darwin.ts --arch "$ARCH" "${EXTRA_ARGS[@]}"

# 安装（可选）
if $INSTALL; then
  BINARY_NAME="ellamaka"
  DIST_DIR="dist/opencode-darwin-$ARCH/bin"
  SRC="$DIST_DIR/$BINARY_NAME"
  
  if [[ ! -f "$SRC" ]]; then
    echo "❌ Binary not found: $SRC"
    exit 1
  fi
  
  mkdir -p "$INSTALL_DIR"
  DST="$INSTALL_DIR/$BINARY_NAME"
  
  # 检查是否已存在同名文件
  if [[ -f "$DST" && ! -L "$DST" ]]; then
    echo "⚠️  Existing binary found at $DST"
    read -p "   Replace? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      echo "   Skipped installation"
      exit 0
    fi
    rm -f "$DST"
  fi
  
  # 创建 symlink（不复制大文件）
  ln -sf "$(pwd)/$SRC" "$DST"
  echo "✅ Installed: $DST -> $(pwd)/$SRC"
  echo "   Run with: $BINARY_NAME"
fi
#!/usr/bin/env bash
set -euo pipefail
# dev.sh — One-click build & run for ellamaka-desktop
#
# Usage: ./scripts/dev.sh  (from any directory)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)"
export OPENCODE_CHANNEL="${OPENCODE_CHANNEL:-local}"

echo "==> Building sidecar (packages/opencode) ..."
cd "$REPO_DIR/packages/opencode"
bun script/build-node.ts

echo ""
echo "==> Building desktop ..."
cd "$DESKTOP_DIR"
bun run build

echo ""
echo "==> Starting desktop ..."
exec bun run dev

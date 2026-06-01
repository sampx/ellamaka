#!/usr/bin/env bash
set -euo pipefail
# check-cleanup.sh — Verify no upstream artifacts remain after merge
# See: docs/BRANDING.md §0 for the full cleanup spec and rationale
#
# Usage:
#   ./scripts/check-cleanup.sh          Report only
#   ./scripts/check-cleanup.sh --clean  Report and delete (rm -rf)
#
# Merge-protected files (NOT in cleanup — always keep ellamaka's version):
#   README.md, README.zh-CN.md, AGENTS.md, AGENTS.zh-CN.md
#   UPSTREAM-MERGE-LOG.md, docs/DESIGN.md, docs/DISTRIBUTION.md, docs/BRANDING.md
#   scripts/, .github/workflows/publish-ellamaka.yml, packages/ellamaka/
#
# During upstream merge conflicts on these files, always resolve in favor
# of ellamaka's version. See docs/UPSTREAM-MERGE-LOG.md for the full strategy.

cd "$(dirname "$0")/.."

CLEAN_MODE=false
if [[ "${1:-}" == "--clean" ]]; then
  CLEAN_MODE=true
fi

# Paths that should NOT exist in ellamaka.
# Listed by category — keep in sync with docs/BRANDING.md §0.
CLEANUP_PATHS=(
  # Desktop
  "packages/desktop"
  "desktop-electron"
  # SaaS / Cloud
  "packages/enterprise"
  "console"
  "function"
  # Docker
  "packages/containers"
  # Web
  "packages/web"
  # Extensions & branding assets
  "packages/extensions"
  "identity"
  # Slack bot
  "packages/slack"
  "zen"
  # SDKs
  "sdks"
  # GitHub Action (upstream)
  "github"
  # Infra
  "infra"
  # Nix
  "nix"
  "flake.nix"
  "flake.lock"
  # Specs
  "specs"
  "sst.config.ts"
  "sst-env.d.ts"
  # Upstream install script
  "install"
  # Upstream publish scripts (NOT scripts/)
  "script"
  # Upstream project dev config
  ".opencode"
  # Community docs (upstream versions only — ellamaka maintains its own)
  "CONTRIBUTING.md"
  "README.zh.md"
  "SECURITY.md"
  # GitHub — partial: keep publish-ellamaka.yml, TEAM_MEMBERS (runtime dep)
  ".github/ISSUE_TEMPLATE"
  ".github/workflows/publish.yml"
  ".github/workflows/deploy.yml"
)

violations=()
for path in "${CLEANUP_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    violations+=("$path")
  fi
done

if [[ ${#violations[@]} -eq 0 ]]; then
  echo "✓ Cleanup check passed — no upstream artifacts found."
  exit 0
fi

echo "✗ Found ${#violations[@]} path(s) that should be deleted per docs/BRANDING.md §0:"
for v in "${violations[@]}"; do
  if [[ -d "$v" ]]; then
    echo "  $v/"
  else
    echo "  $v"
  fi
done

if $CLEAN_MODE; then
  echo ""
  for v in "${violations[@]}"; do
    rm -rf "$v"
    echo "  deleted: $v"
  done
  echo ""
  echo "Done. Run 'git status' to review changes."
else
  echo ""
  echo "Run with --clean to remove these files."
  echo "After cleanup, verify with: git status"
fi

exit 1

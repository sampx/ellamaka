#!/usr/bin/env bash
set -euo pipefail

# merge-upstream.sh — 合并 opencode 上游变更到 main
# 用法: ./scripts/merge-upstream.sh [upstream-branch]
# 默认合并 upstream/dev

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="${1:-dev}"
TARGET_BRANCH="main"

# 已删除的路径前缀 — 合并冲突时自动保持删除
DELETED_PREFIXES=(
  "packages/desktop/"
  "packages/desktop-electron/"
  "packages/enterprise/"
  "packages/function/"
  "packages/slack/"
  "packages/web/"
  "packages/ellamaka/"
  "packages/console/"
  "packages/containers/"
  "packages/docs/"
  "packages/extensions/"
  "packages/identity/"
  "sdks/"
  "github/"
  "infra/"
  "nix/"
  "install"
  "script/"
  "specs/"
  ".github/"
  "sst.config.ts"
  "sst-env.d.ts"
  "flake.nix"
  "flake.lock"
)

echo "=== Fetching ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..."
git fetch "${UPSTREAM_REMOTE}" "${UPSTREAM_BRANCH}"

echo "=== Merging ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} into ${TARGET_BRANCH}..."
MERGE_RESULT=0
git merge "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" --no-edit || MERGE_RESULT=$?

if [ "${MERGE_RESULT}" -eq 0 ]; then
  echo "=== Merge clean, no conflicts."
  exit 0
fi

echo "=== Resolving conflicts: keeping deleted files deleted..."

# 获取所有冲突文件中属于已删除路径的
CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
if [ -z "${CONFLICTS}" ]; then
  echo "=== No file conflicts found. Manual resolution needed."
  exit 1
fi

RESOLVED=0
MANUAL=0

for file in ${CONFLICTS}; do
  MATCH=false
  for prefix in "${DELETED_PREFIXES[@]}"; do
    if [[ "${file}" == "${prefix}"* ]]; then
      MATCH=true
      break
    fi
  done

  if ${MATCH}; then
    git rm "${file}" 2>/dev/null || true
    RESOLVED=$((RESOLVED + 1))
  else
    MANUAL=$((MANUAL + 1))
    echo "  ⚠ Manual: ${file}"
  fi
done

echo "=== Auto-resolved: ${RESOLVED} files, Manual: ${MANUAL} files"

if [ "${MANUAL}" -eq 0 ]; then
  echo "=== All conflicts resolved. Committing..."
  git commit --no-edit
  echo "=== Done."
else
  echo "=== Manual conflicts remain. Resolve them then run:"
  echo "    git commit --no-edit"
  exit 1
fi

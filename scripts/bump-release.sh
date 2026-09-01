#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$REPO_ROOT/scripts/lib/version.sh"

die() {
  printf '错误: %b\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
$SCRIPT — 版本准备：bump 版本号并写入全部 workspace 包

按 docs/DISTRIBUTION.md §3.2，package.json（根 + 全部 workspace 包，版本恒等）
是产品版本的唯一写入源。本脚本只做版本准备：计算下一个版本、同步写入、
刷新 bun.lock、提交并推送当前分支。发布（tag + dispatch）由 release.sh 完成。

用法:
  $SCRIPT [--patch|--minor|--major|--rc|--beta] [--dry-run] [--no-push]
  $SCRIPT <version> [--dry-run] [--no-push]

选项:
  --patch     自增 patch（默认；丢弃 prerelease 后缀）
  --minor     自增 minor，patch 归零
  --major     自增 major，minor/patch 归零
  --rc        继续 -rc.N 序列（同 base 时 N+1），否则下一 patch 的 -rc.1
  --beta      继续 -beta.N 序列（同 base 时 N+1），否则下一 patch 的 -beta.1
  --dry-run   只打印计划，不写入、不提交、不推送
  --no-push   提交后不推送当前分支
  <version>   显式版本（如 2.0.4-rc.1）

示例:
  $SCRIPT --rc              # 2.0.3 → 2.0.4-rc.1
  $SCRIPT --rc              # 2.0.4-rc.1 → 2.0.4-rc.2
  $SCRIPT --patch           # 2.0.4-rc.1 → 2.0.5
  $SCRIPT 2.1.0 --dry-run   # 预览显式版本
EOF
  exit 0
}

# ── 参数解析 ──────────────────────────────────────────────

AUTO_BUMP=""
DRY_RUN=false
NO_PUSH=false
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --patch) AUTO_BUMP="patch"; shift ;;
    --minor) AUTO_BUMP="minor"; shift ;;
    --major) AUTO_BUMP="major"; shift ;;
    --rc) AUTO_BUMP="rc"; shift ;;
    --beta) AUTO_BUMP="beta"; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --no-push) NO_PUSH=true; shift ;;
    -*) die "未知选项: $1" ;;
    *)
      [ -n "$VERSION" ] && die "重复的版本参数: ${VERSION} 与 $1"
      VERSION="$1"
      shift
      ;;
  esac
done

if [ -n "$VERSION" ] && [ -n "$AUTO_BUMP" ]; then
  die "显式版本与自动 bump 选项互斥"
fi

# ── 版本计算 ──────────────────────────────────────────────

CURRENT="$(current_version "$REPO_ROOT")"

if [ -z "$VERSION" ]; then
  AUTO_BUMP="${AUTO_BUMP:-patch}"
  VERSION="$(bump_version "$AUTO_BUMP" "$REPO_ROOT")"
  echo "→ Auto-bump ($AUTO_BUMP): $CURRENT → $VERSION"
else
  echo "→ 显式版本: $CURRENT → $VERSION"
fi

# 版本形状校验（与 release.sh 的 validate_semver 同构）
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(rc|beta)\.[0-9]+)?$ ]]; then
  die "版本号格式无效: $VERSION (期望 X.Y.Z、X.Y.Z-rc.N 或 X.Y.Z-beta.N)"
fi

if [ "$VERSION" = "$CURRENT" ]; then
  die "目标版本与当前版本相同: $VERSION"
fi

# ── 工作区检查 ────────────────────────────────────────────

if ! git -C "$REPO_ROOT" diff --quiet -- . 2>/dev/null || ! git -C "$REPO_ROOT" diff --cached --quiet -- . 2>/dev/null; then
  echo "⚠️  工作区有未提交变更:"
  git -C "$REPO_ROOT" status --short
  die "请先提交或暂存现有变更，再执行版本 bump"
fi

# ── dry-run ───────────────────────────────────────────────

if $DRY_RUN; then
  echo "→ Dry-run: 将 bump 到 $VERSION"
  echo "  package.json: $CURRENT → $VERSION"
  echo "  写入范围: 根 + 全部 workspace 包（版本恒等）"
  echo "  bun.lock: 刷新 workspace 版本引用"
  echo "  commit: chore: bump version to $VERSION"
  if $NO_PUSH; then
    echo "  push: 跳过（--no-push）"
  else
    echo "  push: 当前分支"
  fi
  exit 0
fi

# ── 写入版本 ──────────────────────────────────────────────

echo "→ 写入版本 $VERSION 到全部 workspace 包..."
node -e "
const fs = require('fs')
const path = require('path')
const root = process.argv[1]
const version = process.argv[2]
const targets = ['package.json']
for (const d of fs.readdirSync(path.join(root, 'packages'))) {
  const p = path.join(root, 'packages', d, 'package.json')
  if (fs.existsSync(p)) targets.push(p)
}
const sdk = path.join(root, 'packages', 'sdk', 'js', 'package.json')
if (fs.existsSync(sdk)) targets.push(sdk)
let changed = 0
for (const rel of targets) {
  const pkg = JSON.parse(fs.readFileSync(rel, 'utf8'))
  if (pkg.version === version) continue
  pkg.version = version
  fs.writeFileSync(rel, JSON.stringify(pkg, null, 2) + '\n')
  changed++
}
console.log('  bumped ' + changed + ' package.json files')
" "$REPO_ROOT" "$VERSION"

echo "→ 刷新 bun.lock..."
(cd "$REPO_ROOT" && bun install --lockfile-only 2>/dev/null) || die "bun install --lockfile-only 失败"

# ── 提交与推送 ────────────────────────────────────────────

echo "→ 提交版本 bump"
git -C "$REPO_ROOT" add package.json packages/*/package.json packages/sdk/js/package.json bun.lock
git -C "$REPO_ROOT" commit -m "chore: bump version to $VERSION"

if $NO_PUSH; then
  echo "ℹ️  已提交但未推送（--no-push）。发布前请先推送当前分支。"
  exit 0
fi

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "→ 推送 $BRANCH"
git -C "$REPO_ROOT" push origin "$BRANCH"

echo ""
echo "✅ 版本准备完成: $VERSION"
echo "   下一步: ./scripts/release.sh cli|desktop [--dry-run]"

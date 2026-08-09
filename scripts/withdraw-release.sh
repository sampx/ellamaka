#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

# --- Utility ---
die() {
  echo "错误: $*" >&2
  exit 1
}

# --- Help ---
usage() {
  cat <<EOF
$SCRIPT — 整版撤回 ellamaka 产品版本

按 docs/DISTRIBUTION.md §7.3 与 DESIGN-distribution.md §2.4，撤回是
操作员显式决策：将目标版本登记到 release/withdrawn-versions.json
（提交并推送），再 dispatch cleanup-releases.yml withdraw 模式执行
远端删除（恢复 aliases → 删 R2 prefix → 删 Release 页面与 tag）。

version 省略时自动撤回该产品"上一个版本"：取跨渠道最高已发布版本
（stable 优先）确定渠道，再撤回该渠道低于当前最高版本的最高版本。
fallback 默认取同渠道当前最高版本。显式指定 version 时 fallback 默认
取该渠道当前最高已发布版本，也可用 --fallback 覆盖。撤回与回退
必须同渠道：stable 只回退 stable，beta 只回退 beta，禁止跨渠道。

用法:
  $SCRIPT <cli|desktop> [version] [--fallback <version>]

━━━ 参数 ━━━
  product     cli | desktop（必选，二选一，不能同时撤回两个产品）
  version     要撤回的版本号（可选；省略时自动选上一个版本）

━━━ 选项 ━━━
  -h, --help            显示此帮助
  --fallback <version>   健康回退版本（可选；默认取当前最高已发布版本）

━━━ 校验 ━━━
  1. product 必须为 cli 或 desktop
  2. version 必须已登记到 withdrawn-versions.json（脚本自动登记）
  3. fallback 必须存在、不等于 version，且与 version 同渠道
  4. 登记、提交、推送失败时中止（fail-closed）

━━━ 示例 ━━━
  # 自动撤回 CLI 上一个版本（fallback = 当前最高版本）
  $SCRIPT cli

  # 显式撤回 Desktop 版本（fallback = 当前最高版本）
  $SCRIPT desktop 1.16.2

  # 显式指定版本与回退版本
  $SCRIPT cli 2.0.2 --fallback 2.0.1
EOF
  exit 0
}

# --- Argument parsing ---
PRODUCT=""
VERSION=""
FALLBACK=""
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --fallback)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        die "--fallback 需要版本号"
      fi
      FALLBACK="$2"
      shift 2
      ;;
    cli|desktop)
      [ -n "$PRODUCT" ] && die "不能同时撤回两个产品（已指定 ${PRODUCT}，又收到 $1）"
      PRODUCT="$1"
      shift
      ;;
    -*) die "未知选项: $1" ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [ -z "$PRODUCT" ]; then
  echo "错误: 缺少产品参数（cli | desktop）" >&2
  echo "用法: $SCRIPT <cli|desktop> [version] [--fallback <version>]" >&2
  echo "试试: $SCRIPT --help" >&2
  exit 1
fi

VERSION="${ARGS[0]:-}"

# --- Product key mapping ---
# withdrawn-versions.json 与 cleanup workflow 使用全名 key
# （ellamaka-cli / ellamaka-desktop），cli|desktop 参数映射为全名。
case "$PRODUCT" in
  cli)     PRODUCT_KEY="ellamaka-cli" ;;
  desktop) PRODUCT_KEY="ellamaka-desktop" ;;
esac

# --- Locate repo ---
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WITHDRAWN_FILE="$REPO_ROOT/release/withdrawn-versions.json"

# --- Repo guard ---
REPO_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")"
if ! echo "$REPO_URL" | grep -qE '[/:]wopal-cn/ellamaka(\.git)?$'; then
  die "remote 'origin' 不是 wopal-cn/ellamaka\n  remote: $REPO_URL\n  仓库: $REPO_ROOT"
fi

# --- gh availability ---
HAVE_GH=false
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  HAVE_GH=true
fi

# --- Version helpers ---
# channel_of <version> — 输出 stable | beta（-beta.N 属于 beta，其余 stable）
channel_of() {
  if [[ "$1" == *-beta.* ]]; then echo "beta"; else echo "stable"; fi
}

# highest_released <product> <channel> — 该产品远端该渠道最高已发布版本
highest_released() {
  local product="$1" channel="$2"
  git -C "$REPO_ROOT" ls-remote --tags origin "ellamaka-${product}-v*" 2>/dev/null | node -e "
    const product = process.argv[1]
    const channel = process.argv[2]
    const cmp = (a, b) => {
      const pa = a.split('-'), pb = b.split('-')
      const ca = pa[0].split('.').map(Number), cb = pb[0].split('.').map(Number)
      for (let i = 0; i < 3; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i]
      const ba = pa[1] ? Number(pa[1].replace('beta.', '')) : Infinity
      const bb = pb[1] ? Number(pb[1].replace('beta.', '')) : Infinity
      return ba - bb
    }
    let best = null
    for (const line of require('fs').readFileSync(0, 'utf8').split('\n')) {
      const m = line.match(new RegExp('refs/tags/ellamaka-' + product + '-v(\\\\d+\\\\.\\\\d+\\\\.\\\\d+(?:-beta\\\\.\\\\d+)?)\\\$'))
      if (!m) continue
      const v = m[1]
      const isBeta = v.includes('-beta.')
      if (channel === 'beta' ? !isBeta : isBeta) continue
      if (!best || cmp(v, best) > 0) best = v
    }
    console.log(best || '')
  " "$product" "$channel"
}

# find_previous_version <product> <channel> <current> — 同渠道低于 current 的最高已发布版本
find_previous_version() {
  local product="$1" channel="$2" current="$3"
  git -C "$REPO_ROOT" ls-remote --tags origin "ellamaka-${product}-v*" 2>/dev/null | node -e "
    const product = process.argv[1]
    const channel = process.argv[2]
    const current = process.argv[3]
    const cmp = (a, b) => {
      const pa = a.split('-'), pb = b.split('-')
      const ca = pa[0].split('.').map(Number), cb = pb[0].split('.').map(Number)
      for (let i = 0; i < 3; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i]
      const ba = pa[1] ? Number(pa[1].replace('beta.', '')) : Infinity
      const bb = pb[1] ? Number(pb[1].replace('beta.', '')) : Infinity
      return ba - bb
    }
    let best = null
    for (const line of require('fs').readFileSync(0, 'utf8').split('\n')) {
      const m = line.match(new RegExp('refs/tags/ellamaka-' + product + '-v(\\\\d+\\\\.\\\\d+\\\\.\\\\d+(?:-beta\\\\.\\\\d+)?)\\\$'))
      if (!m) continue
      const v = m[1]
      const isBeta = v.includes('-beta.')
      if (channel === 'beta' ? !isBeta : isBeta) continue
      if (v === current || cmp(v, current) > 0) continue
      if (!best || cmp(v, best) > 0) best = v
    }
    console.log(best || '')
  " "$product" "$channel" "$current"
}

# is_withdrawn <product> <version> — 输出 yes/no
is_withdrawn() {
  local product="$1" version="$2"
  if [ ! -f "$WITHDRAWN_FILE" ]; then echo "no"; return 0; fi
  node -e "
const w = JSON.parse(require('fs').readFileSync('$WITHDRAWN_FILE', 'utf8'));
const arr = (w.products && w.products['$product']) || [];
process.stdout.write(arr.includes('$version') ? 'yes' : 'no');
" 2>/dev/null || echo "no"
}

# record_withdrawn <product> <version> — 登记（去重 + SemVer 排序）并提交推送
record_withdrawn() {
  local product="$1" version="$2"
  node -e "
    const fs = require('fs')
    const p = process.argv[1]
    const w = JSON.parse(fs.readFileSync(p, 'utf8'))
    const arr = w.products[process.argv[2]] || (w.products[process.argv[2]] = [])
    if (!arr.includes(process.argv[3])) {
      arr.push(process.argv[3])
      const cmp = (a, b) => {
        const pa = a.split('-'), pb = b.split('-')
        const ca = pa[0].split('.').map(Number), cb = pb[0].split('.').map(Number)
        for (let i = 0; i < 3; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i]
        const ba = pa[1] ? Number(pa[1].replace('beta.', '')) : Infinity
        const bb = pb[1] ? Number(pb[1].replace('beta.', '')) : Infinity
        return ba - bb
      }
      arr.sort(cmp)
    }
    fs.writeFileSync(p, JSON.stringify(w, null, 2) + '\n')
  " "$WITHDRAWN_FILE" "$product" "$version" || die "写入 withdrawn-versions.json 失败"
  git -C "$REPO_ROOT" add release/withdrawn-versions.json
  git -C "$REPO_ROOT" commit -m "chore(release): withdraw $product v$version" || die "提交 withdrawn-versions.json 失败"
  git -C "$REPO_ROOT" push origin main || die "推送 withdrawn-versions.json 失败"
  echo "  ✓ 已登记 $product v$version 到 withdrawn-versions.json 并推送"
}

# --- Resolve versions ---
echo "→ 解析 $PRODUCT 版本..."
LATEST_STABLE="$(highest_released "$PRODUCT" stable)"
LATEST_BETA="$(highest_released "$PRODUCT" beta)"
if [ -z "$LATEST_STABLE" ] && [ -z "$LATEST_BETA" ]; then
  die "远端没有 $PRODUCT 的已发布版本，无法撤回"
fi

if [ -z "$VERSION" ]; then
  # 省略 version：取跨渠道最高（stable 优先）确定渠道，再撤回该渠道上一版
  if [ -n "$LATEST_STABLE" ]; then
    CHANNEL="stable"
    LATEST="$LATEST_STABLE"
  else
    CHANNEL="beta"
    LATEST="$LATEST_BETA"
  fi
  echo "  当前最高已发布版本: v${LATEST}（channel=${CHANNEL}）"
  VERSION="$(find_previous_version "$PRODUCT" "$CHANNEL" "$LATEST")"
  if [ -z "$VERSION" ]; then
    die "没有低于 v$LATEST 的同渠道版本可撤回"
  fi
  echo "  自动选择上一个版本: v$VERSION"
else
  CHANNEL="$(channel_of "$VERSION")"
  echo "  指定撤回版本: v${VERSION}（channel=${CHANNEL}）"
  if [ "$CHANNEL" = "stable" ]; then
    LATEST="$LATEST_STABLE"
  else
    LATEST="$LATEST_BETA"
  fi
  if [ -z "$LATEST" ]; then
    die "远端没有 $PRODUCT 的 $CHANNEL 渠道已发布版本，无法撤回"
  fi
  echo "  该渠道当前最高已发布版本: v$LATEST"
fi

if [ -z "$FALLBACK" ]; then
  FALLBACK="$LATEST"
  echo "  fallback 默认取同渠道当前最高版本: v$FALLBACK"
else
  if [ "$(channel_of "$FALLBACK")" != "$CHANNEL" ]; then
    die "fallback v${FALLBACK} 与撤回版本 v${VERSION} 渠道不一致（${CHANNEL} 只能回退 ${CHANNEL}）"
  fi
  echo "  指定 fallback: v$FALLBACK"
fi

# --- Validation ---
if [ "$VERSION" = "$FALLBACK" ]; then
  die "撤回版本 v$VERSION 不能等于 fallback v$FALLBACK"
fi

if [ "$(is_withdrawn "$PRODUCT_KEY" "$VERSION")" = "yes" ]; then
  echo "→ $PRODUCT v$VERSION 已在 withdrawn-versions.json 中"
  echo "  如需重新执行撤回，请先确认远端状态（幂等重试）"
fi

# --- Record + dispatch ---
echo ""
echo "→ 撤回计划: $PRODUCT v${VERSION}（fallback: v${FALLBACK}）"
echo "  1. 登记 withdrawn-versions.json 并推送"
echo "  2. dispatch cleanup-releases.yml withdraw 模式（apply=true）"
echo ""

if [ "$HAVE_GH" = false ]; then
  echo "ℹ️  gh CLI 不可用或未认证，仅登记 withdrawn-versions.json。"
  echo "   请手动在 GitHub Actions 触发 cleanup-releases.yml（mode=withdraw）。"
  record_withdrawn "$PRODUCT_KEY" "$VERSION"
  exit 0
fi

record_withdrawn "$PRODUCT_KEY" "$VERSION"

echo "→ 触发 withdraw workflow ($PRODUCT v$VERSION → fallback v$FALLBACK)..."
gh workflow run cleanup-releases.yml -R wopal-cn/ellamaka \
  -f mode=withdraw \
  -f product="$PRODUCT_KEY" \
  -f withdraw-version="$VERSION" \
  -f fallback-version="$FALLBACK" \
  -f apply=true || echo "⚠️  withdraw workflow 触发失败（可手动触发）"

echo ""
echo "✅ 撤回已触发: $PRODUCT v${VERSION}（fallback: v${FALLBACK}）"

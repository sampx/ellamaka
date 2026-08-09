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
$SCRIPT — 创建 namespaced product tag 并 dispatch publish workflow

按 docs/DISTRIBUTION.md §4.1，tag-release 接收目标 product 和
Ellamaka product version（可省略自动建议），创建 ellamaka-{cli,desktop}-vX.Y.Z
格式的 namespaced tag，dispatch 对应 publish workflow，并在发布成功后自动
触发独立 cleanup workflow（retention 清理历史 release）。

版本号可省略：省略时按产品 tag 自动建议下一版本（CLI/Desktop stable
升 patch；Desktop beta 进行中升 N、否则新 base 的 -beta.1），交互
确认或输入覆盖后发布。显式输入仍可用（如 minor/beta 决策）：

  cli:     仅接受 X.Y.Z（每次发布递增 patch/minor）
  desktop: X.Y.Z（prod）或 X.Y.Z-beta.N（beta）

不支持：隐式 -N 自增、通用 vX.Y.Z tag、已提交 release 的 retag/覆盖。

用法:
  $SCRIPT <子命令> [version] [选项]

━━━ 子命令 ━━━
  cli        仅发布 CLI（dispatch publish-ellamaka）
  desktop    仅发布 Desktop（dispatch publish-ellamaka-desktop）
  all        双发：CLI + Desktop（需 --cli-version 和 --desktop-version）

━━━ 参数 ━━━
  version    产品版本号（可选；cli/desktop 子命令省略时自动建议并交互确认）

━━━ 选项 ━━━
  -h, --help            显示此帮助
  --channel             Desktop 发布渠道: beta | prod（仅 desktop/all，默认 prod）
  --cli-version         'all' 子命令的 CLI 版本（必填）
  --desktop-version     'all' 子命令的 Desktop 版本（必填）
  --no-cleanup          发布成功后跳过 cleanup workflow 触发（默认自动触发）

━━━ 校验 ━━━
  在写入前依次校验：
  1. 版本符合标准 SemVer 子集（cli: X.Y.Z；desktop: X.Y.Z 或 X.Y.Z-beta.N）
  2. version/channel 一致
  3. 目标版本未列入 release/withdrawn-versions.json
  4. 目标 namespaced tag 远端不存在（或仅存在无有效 manifest 的 failed attempt）
  5. 版本高于该产品 migration floor / 已发布最高标准版本

━━━ 示例 ━━━
  # CLI 正式版（省略版本 → 交互建议 next patch，如 2.0.2）
  $SCRIPT cli

  # CLI 正式版（显式 minor 决策）
  $SCRIPT cli 2.1.0

  # Desktop beta（省略版本 → 交互建议）
  $SCRIPT desktop --channel beta

  # Desktop beta（显式版本）
  $SCRIPT desktop 1.17.0-beta.2 --channel beta

  # Desktop 正式版
  $SCRIPT desktop 1.16.2 --channel prod

  # 双发（独立版本）
  $SCRIPT all --cli-version 1.17.1 --desktop-version 1.16.2

  # 发布但跳过自动清理
  $SCRIPT cli 1.17.2 --no-cleanup
EOF
  exit 0
}

# --- Argument parsing ---
SUBCOMMAND=""
CHANNEL="prod"
CLI_VERSION=""
DESKTOP_VERSION=""
NO_CLEANUP=""
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --no-cleanup) NO_CLEANUP="true"; shift ;;
    --channel)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        die "--channel 需要 beta 或 prod"
      fi
      CHANNEL="$2"
      shift 2
      ;;
    --cli-version)
      CLI_VERSION="$2"; shift 2
      ;;
    --desktop-version)
      DESKTOP_VERSION="$2"; shift 2
      ;;
    cli|desktop|all)
      [ -n "$SUBCOMMAND" ] && die "重复的子命令: $1（已指定 ${SUBCOMMAND}）"
      SUBCOMMAND="$1"
      shift
      ;;
    -*) die "未知选项: $1" ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [ -z "$SUBCOMMAND" ]; then
  echo "错误: 缺少子命令（cli | desktop | all）" >&2
  echo "用法: $SCRIPT <子命令> <version> [选项]" >&2
  echo "试试: $SCRIPT --help" >&2
  exit 1
fi

# --- Locate repo ---
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WITHDRAWN_FILE="$REPO_ROOT/release/withdrawn-versions.json"
LEGACY_INVENTORY_FILE="$REPO_ROOT/release/legacy-inventory.json"

# --- Shared version resolution ---
source "$REPO_ROOT/scripts/lib/version.sh"

# --- Inject CLI Version ---
if command -v jq >/dev/null 2>&1 && [ -f "$REPO_ROOT/.ci/versions.json" ]; then
  export MIN_WOPAL_CLI_VERSION=$(jq -r .minWopalCli "$REPO_ROOT/.ci/versions.json")
fi

# Map subcommand
case "$SUBCOMMAND" in
  cli)
    WATCH_CLI=true
    WATCH_DESKTOP=false
    ;;
  desktop)
    WATCH_CLI=false
    WATCH_DESKTOP=true
    ;;
  all)
    WATCH_CLI=true
    WATCH_DESKTOP=true
    CLI_VERSION="${CLI_VERSION:-}"
    DESKTOP_VERSION="${DESKTOP_VERSION:-}"
    if [ -z "$CLI_VERSION" ] || [ -z "$DESKTOP_VERSION" ]; then
      die "'all' 子命令需要 --cli-version 和 --desktop-version"
    fi
    ;;
esac

# Resolve versions per product
if [ "$SUBCOMMAND" = "all" ]; then
  CLI_VER_INPUT="$CLI_VERSION"
  DESKTOP_VER_INPUT="$DESKTOP_VERSION"
else
  VERSION="${ARGS[0]:-}"
  if [ -z "$VERSION" ]; then
    # Suggest next version from product tags and confirm interactively
    if [ "$SUBCOMMAND" = "cli" ]; then
      VERSION="$(suggest_release_version "ellamaka-cli" "stable" "$REPO_ROOT")"
    else
      VERSION="$(suggest_release_version "ellamaka-desktop" "$CHANNEL" "$REPO_ROOT")"
    fi
    [ -z "$VERSION" ] && die "无法自动建议版本号，请显式输入\n用法: $SCRIPT $SUBCOMMAND <version> [选项]"
    echo ""
    echo "→ 建议版本: $VERSION (按 Enter 确认，或输入其他版本号)"
    read -r -p "  版本号: " answer
    if [ -n "$answer" ]; then
      VERSION="$answer"
    fi
    echo ""
  fi
  if [ "$SUBCOMMAND" = "cli" ]; then
    CLI_VER_INPUT="$VERSION"
    DESKTOP_VER_INPUT=""
  else
    CLI_VER_INPUT=""
    DESKTOP_VER_INPUT="$VERSION"
  fi
fi

# Validate channel
case "$CHANNEL" in
  beta|prod) ;;
  *) die "无效 Desktop channel: $CHANNEL (只支持 beta 或 prod)" ;;
esac

# --- gh availability ---
HAVE_GH=false
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  HAVE_GH=true
fi

# --- Repo guard ---
REPO_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")"
if ! echo "$REPO_URL" | grep -qE '[/:]wopal-cn/ellamaka(\.git)?$'; then
  die "remote 'origin' 不是 wopal-cn/ellamaka\n  remote: $REPO_URL\n  仓库: $REPO_ROOT"
fi

# --- Version validation helpers ---
# validate_semver <version> <product-label>
# CLI releases are stable-only (X.Y.Z, monotonic patch/minor bumps).
# Desktop accepts stable X.Y.Z or beta X.Y.Z-beta.N via --channel beta.
# rc is not a release shape for either product (see DISTRIBUTION.md §3.1).
validate_semver() {
  local v="$1" label="$2"
  if [ "$label" = "CLI" ]; then
    if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      return 0
    fi
    die "CLI 版本号格式无效: $v (CLI 只发布 stable X.Y.Z，每次发布递增 patch/minor)"
  fi
  if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  elif [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
    return 0
  fi
  die "$label 版本号格式无效: $v (期望 X.Y.Z / X.Y.Z-beta.N)"
}

# validate_channel_version_consistency <channel> <version> <product-label>
validate_channel_version_consistency() {
  local channel="$1" v="$2" label="$3"
  if [ "$channel" = "stable" ] && [[ "$v" == *-* ]]; then
    die "$label stable 渠道版本不能含 prerelease: $v"
  fi
  if [ "$channel" = "beta" ]; then
    if ! [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
      die "$label beta 渠道需要 -beta.N 版本，得到: $v"
    fi
  fi
}

# channel_for_version <version> — derive channel from version.
# CLI is always stable (rc removed). Desktop: beta → beta, else stable.
channel_for_version() {
  local v="$1"
  if [[ "$v" == *-beta.* ]]; then echo "beta"
  else echo "stable"
  fi
}

# check_withdrawn <product> <version>
check_withdrawn() {
  local product="$1" version="$2"
  if [ ! -f "$WITHDRAWN_FILE" ]; then return 0; fi
  local listed
  listed=$(node -e "
const w = JSON.parse(require('fs').readFileSync('$WITHDRAWN_FILE', 'utf8'));
const arr = (w.products && w.products['$product']) || [];
process.stdout.write(arr.includes('$version') ? 'yes' : 'no');
" 2>/dev/null || echo "no")
  if [ "$listed" = "yes" ]; then
    die "版本 $version 已列入 withdrawn-versions.json，永久不得复用"
  fi
}

# check_migration_floor <product> <version>
# Per W-01: fail closed when inventory is missing or not frozen from a live
# capture. Fixture/dry-run inventories must NOT gate real releases.
check_migration_floor() {
  local product="$1" version="$2"
  if [ ! -f "$LEGACY_INVENTORY_FILE" ]; then
    die "legacy-inventory.json 缺失（$LEGACY_INVENTORY_FILE）；必须先用 capture-legacy-release-inventory.mjs 真实盘点并冻结后才能发布"
  fi
  node -e "
const inv = JSON.parse(require('fs').readFileSync('$LEGACY_INVENTORY_FILE', 'utf8'));
if (inv.source !== 'live') {
  console.error('legacy-inventory.json source=' + (inv.source || 'undefined') + ' 不是 live；fixture/dry-run inventory 不得用于真实发布门禁');
  process.exit(2);
}
const entries = inv.products && inv.products['$product'];
if (!entries) process.exit(0);
let highest = null;
for (const t of (entries.tags || [])) {
  const m = t.name.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)-(\d+)/);
  if (!m) continue;
  const key = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (!highest || key.join('.') > highest.join('.')) highest = key;
}
if (!highest) process.exit(0);
// Legacy shapes are X.Y.Z-N prereleases; per SemVer 2.0 the same-base
// stable X.Y.Z already sorts above them. Floor = base of the highest
// legacy version (e.g. 1.15.13-4 → 1.15.13), NOT (X).(Y+1).0. The exact
// same-base version is additionally guarded by tag/R2 occupancy checks.
const floor = [highest[0], highest[1], highest[2]];
const v = '$version'.split(/[.-]/).map(Number);
const vkey = [v[0], v[1], v[2]];
if (vkey.join('.') < floor.join('.')) {
  console.error('版本 ' + '$version' + ' 低于 migration floor ' + floor.join('.'));
  process.exit(1);
}
" || {
  local rc=$?
  if [ $rc -eq 2 ]; then
    die "legacy-inventory.json 不是 live capture（source != live）；不得用 fixture/dry-run inventory 门禁真实发布"
  fi
  die "版本 $version 低于 migration floor（见 $LEGACY_INVENTORY_FILE）"
}
}

# check_tag_absent <tag>
# Per §8/§9.2, a namespaced tag that exists remotely without an effective
# versioned manifest is a failed attempt; the operator must use an explicit
# retry after controlled cleanup. This script does not auto-delete committed
# tags. We only check that the tag is absent here; failed-attempt retry is
# handled by the cleanup scripts.
check_tag_absent() {
  local tag="$1"
  if git -C "$REPO_ROOT" ls-remote --tags origin "$tag" 2>/dev/null | grep -q "refs/tags/${tag}$"; then
    die "namespaced tag $tag 已存在于远端。若为 failed attempt，请先用 cleanup 脚本清理后再用显式 retry；已提交 release 的 tag 不可删除或覆盖。"
  fi
}

# check_min_wopal_cli_released
# Verifies that MIN_WOPAL_CLI_VERSION defined in .ci/versions.json is already
# released on the wopal-cli repository (git tag v<VERSION> exists on remote),
# preventing release of an Ellamaka version with an unreleased CLI dependency floor.
check_min_wopal_cli_released() {
  local req_ver="${MIN_WOPAL_CLI_VERSION:-}"
  if [ -z "$req_ver" ]; then
    return 0
  fi

  echo "→ 检查 minWopalCli (v${req_ver}) 是否已在 wopal-cli 仓库发布..."

  local tag_found=""
  local cli_repo="https://github.com/wopal-cn/wopal-cli.git"

  if git ls-remote --tags "$cli_repo" "refs/tags/v${req_ver}" 2>/dev/null | grep -q "refs/tags/v${req_ver}$"; then
    tag_found="yes"
  elif command -v gh &>/dev/null && gh release view "v${req_ver}" -R wopal-cn/wopal-cli &>/dev/null; then
    tag_found="yes"
  fi

  if [ "$tag_found" != "yes" ]; then
    die "终止发布: .ci/versions.json 要求的 minWopalCli (v${req_ver}) 尚未在 wopal-cli 仓库发布！\n  请先在 wopal-cn/wopal-cli 仓库发布 tag v${req_ver}，再发布 Ellamaka。"
  fi

  echo "  ✓ 已确认 wopal-cli v${req_ver} 存在于远端"
}

# --- Pre-flight checks ---
check_workspace_clean() {
  local dirty=0
  if ! git -C "$REPO_ROOT" diff --quiet HEAD -- . 2>/dev/null; then
    echo "⚠️  工作区有未提交变更:"
    git -C "$REPO_ROOT" status --short
    dirty=1
  fi
  if ! git -C "$REPO_ROOT" diff --cached --quiet HEAD -- . 2>/dev/null; then
    echo "⚠️  暂存区有未提交变更:"
    git -C "$REPO_ROOT" diff --cached --stat
    dirty=1
  fi
  if [ "$dirty" -eq 1 ]; then
    echo ""
    read -r -p "工作区不干净，未提交变更不会进入本次 release。继续发布？ [y/N] " answer
    case "$answer" in
      y|Y|yes|YES) echo "  继续发布..." ;;
      *) die "已取消" ;;
    esac
  fi
}

check_remote_main() {
  git -C "$REPO_ROOT" fetch origin main 2>/dev/null || true
  local remote_main
  remote_main=$(git -C "$REPO_ROOT" rev-parse "origin/main" 2>/dev/null || echo "")
  if [ -z "$remote_main" ]; then
    die "origin/main 不存在，请先 git push origin main"
  fi
  local unpushed
  unpushed=$(git -C "$REPO_ROOT" rev-list --count HEAD "^origin/main" 2>/dev/null)
  if [ "$unpushed" -gt 0 ]; then
    echo "local main 有 $unpushed 个 commit 未推送至 origin/main:"
    git -C "$REPO_ROOT" log --oneline "origin/main..HEAD"
    die "请先 git push origin main"
  fi
}

# --- Dispatch workflow ---
dispatch_workflow() {
  local wf="$1"
  local label="$2"
  local tag="$3"
  local plain_version="$4"
  local channel_arg=""

  if [[ "$wf" == publish-ellamaka-desktop.yml ]]; then
    channel_arg="-f channel=$CHANNEL -f publish=true"
  fi

  local output
  echo "→ dispatch $label workflow: $wf (ref=$tag, version=$plain_version, channel=$CHANNEL, publish=true)" >&2
  # shellcheck disable=SC2086
  if ! output=$(gh workflow run "$wf" -R wopal-cn/ellamaka \
    --ref "$tag" \
    -f "version=$plain_version" \
    $channel_arg 2>&1); then
    echo "$output" >&2
    return 1
  fi
  echo "$output" >&2

  if [[ "$output" =~ actions/runs/([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi

  echo "错误: dispatch 未返回 workflow run ID，已停止监控以避免匹配历史 run。" >&2
  return 1
}

# --- Poll workflow run ---
poll_run() {
  gh run view "$1" -R wopal-cn/ellamaka --json status,conclusion,jobs -q '
    "\(.status) \(.conclusion // "")",
    (.jobs // [] | map("       [\(.status)] \(.name): \(.conclusion // "running...")") | join("\n"))
  ' 2>/dev/null || echo "unknown"
}

# ============================================================
# Main
# ============================================================

echo "→ 检查工作区..."
check_workspace_clean

echo "→ 检查 remote main..."
check_remote_main

check_min_wopal_cli_released

# Resolve and validate per-product tags
CLI_TAG=""
DESKTOP_TAG=""
CLI_PLAIN=""
DESKTOP_PLAIN=""

if [ -n "$CLI_VER_INPUT" ]; then
  validate_semver "$CLI_VER_INPUT" "CLI"
  # CLI is stable-only; channel is always stable (rc mechanism removed).
  validate_channel_version_consistency "stable" "$CLI_VER_INPUT" "CLI"
  check_withdrawn "ellamaka-cli" "$CLI_VER_INPUT"
  check_migration_floor "ellamaka-cli" "$CLI_VER_INPUT"
  CLI_TAG="ellamaka-cli-v${CLI_VER_INPUT}"
  CLI_PLAIN="$CLI_VER_INPUT"
  check_tag_absent "$CLI_TAG"
  echo "  ℹ️  CLI tag: $CLI_TAG (channel=stable)"
fi

if [ -n "$DESKTOP_VER_INPUT" ]; then
  validate_semver "$DESKTOP_VER_INPUT" "Desktop"
  # Desktop channel: prod → stable, beta → beta
  if [ "$CHANNEL" = "beta" ]; then
    validate_channel_version_consistency "beta" "$DESKTOP_VER_INPUT" "Desktop"
  else
    validate_channel_version_consistency "stable" "$DESKTOP_VER_INPUT" "Desktop"
    # prod channel must not carry beta/rc
    if [[ "$DESKTOP_VER_INPUT" == *-beta.* ]]; then
      die "Desktop beta 版本必须指定 --channel beta"
    fi
  fi
  check_withdrawn "ellamaka-desktop" "$DESKTOP_VER_INPUT"
  check_migration_floor "ellamaka-desktop" "$DESKTOP_VER_INPUT"
  DESKTOP_TAG="ellamaka-desktop-v${DESKTOP_VER_INPUT}"
  DESKTOP_PLAIN="$DESKTOP_VER_INPUT"
  check_tag_absent "$DESKTOP_TAG"
  echo "  ℹ️  Desktop tag: $DESKTOP_TAG"
fi

# Create + push tags
if [ -n "$CLI_TAG" ]; then
  echo "→ 创建 tag: $CLI_TAG"
  git -C "$REPO_ROOT" tag -d "$CLI_TAG" 2>/dev/null || true
  git -C "$REPO_ROOT" tag -a "$CLI_TAG" -m "Release $CLI_TAG"
fi
if [ -n "$DESKTOP_TAG" ]; then
  echo "→ 创建 tag: $DESKTOP_TAG"
  git -C "$REPO_ROOT" tag -d "$DESKTOP_TAG" 2>/dev/null || true
  git -C "$REPO_ROOT" tag -a "$DESKTOP_TAG" -m "Release $DESKTOP_TAG"
fi

echo "→ 原子推送 main 和 tags"
PUSH_REFS=("main")
[ -n "$CLI_TAG" ] && PUSH_REFS+=("$CLI_TAG")
[ -n "$DESKTOP_TAG" ] && PUSH_REFS+=("$DESKTOP_TAG")
git -C "$REPO_ROOT" push origin "${PUSH_REFS[@]}"

# Dispatch workflows
echo ""
if [ "$HAVE_GH" = false ]; then
  echo "ℹ️  gh CLI 不可用或未认证，跳过 dispatch + watch。"
  echo "   tag 已推送，可手动在 GitHub Actions 页面触发 workflow。"
  exit 0
fi

DESKTOP_WF=".github/workflows/publish-ellamaka-desktop.yml"
DESKTOP_WF_EXISTS=false
if [ -f "$REPO_ROOT/$DESKTOP_WF" ]; then
  DESKTOP_WF_EXISTS=true
fi

DO_WATCH_CLI=$WATCH_CLI
DO_WATCH_DESKTOP=false
if [ "$DESKTOP_WF_EXISTS" = true ] && [ "$WATCH_DESKTOP" = true ]; then
  DO_WATCH_DESKTOP=true
fi

RUN_CLI=""
RUN_DESKTOP=""

if [ "$DO_WATCH_CLI" = true ]; then
  if ! RUN_CLI="$(dispatch_workflow publish-ellamaka.yml "CLI" "$CLI_TAG" "$CLI_PLAIN")"; then
    die "无法确定本次 CLI workflow run"
  fi
  echo "  CLI run id: $RUN_CLI"
fi

if [ "$DO_WATCH_DESKTOP" = true ]; then
  if ! RUN_DESKTOP="$(dispatch_workflow publish-ellamaka-desktop.yml "Desktop" "$DESKTOP_TAG" "$DESKTOP_PLAIN")"; then
    die "无法确定本次 Desktop workflow run"
  fi
  echo "  Desktop run id: $RUN_DESKTOP"
fi

# Watch runs
echo "→ Watching runs (Ctrl+C 中断)..."
POLL_INTERVAL=15
i=0
while true; do
  i=$((i + 1))

  CLI_STATUS="skipped"
  if [ "$DO_WATCH_CLI" = true ] && [ -n "$RUN_CLI" ]; then
    CLI_FULL="$(poll_run "$RUN_CLI")"
    CLI_STATUS="$(echo "$CLI_FULL" | head -n 1)"
    echo "  [CLI #$i] $CLI_STATUS"
    echo "$CLI_FULL" | tail -n +2
  fi

  DESKTOP_STATUS="skipped"
  if [ "$DO_WATCH_DESKTOP" = true ] && [ -n "$RUN_DESKTOP" ]; then
    DESKTOP_FULL="$(poll_run "$RUN_DESKTOP")"
    DESKTOP_STATUS="$(echo "$DESKTOP_FULL" | head -n 1)"
    echo "  [Desktop #$i] $DESKTOP_STATUS"
    echo "$DESKTOP_FULL" | tail -n +2
  fi

  case "$CLI_STATUS" in
    "completed failure"|"completed cancelled")
      echo "⚠️  CLI Workflow 失败或取消 (conclusion: ${CLI_STATUS#completed })"
      exit 1 ;;
  esac
  if [ "$DESKTOP_STATUS" = "completed failure" ] || [ "$DESKTOP_STATUS" = "completed cancelled" ]; then
    echo "⚠️  Desktop Workflow 失败或取消 (conclusion: ${DESKTOP_STATUS#completed })"
    exit 1
  fi

  CLI_DONE=true
  [ "$DO_WATCH_CLI" = true ] && [ "$CLI_STATUS" != "completed success" ] && [ "$CLI_STATUS" != "skipped" ] && CLI_DONE=false
  DESKTOP_DONE=true
  [ "$DO_WATCH_DESKTOP" = true ] && [ "$DESKTOP_STATUS" != "completed success" ] && [ "$DESKTOP_STATUS" != "skipped" ] && DESKTOP_DONE=false

  if [ "$CLI_DONE" = true ] && [ "$DESKTOP_DONE" = true ]; then
    break
  fi

  sleep $POLL_INTERVAL
done

# Output URLs
echo ""
echo "✅ Release complete"
[ -n "$CLI_TAG" ] && echo "   CLI Release:      https://github.com/wopal-cn/ellamaka/releases/tag/${CLI_TAG}"
[ -n "$DESKTOP_TAG" ] && echo "   Desktop Release:  https://github.com/wopal-cn/ellamaka/releases/tag/${DESKTOP_TAG}"
[ -n "$CLI_TAG" ] && echo "   CLI R2:      https://download.coursedao.com/ellamaka/v${CLI_PLAIN}/"
[ -n "$DESKTOP_TAG" ] && [ "$CHANNEL" = "prod" ] && echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/v${DESKTOP_PLAIN}/"
[ -n "$DESKTOP_TAG" ] && [ "$CHANNEL" = "beta" ] && echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/beta/v${DESKTOP_PLAIN}/"
[ -n "$CLI_TAG" ] && echo "   Gitee:       https://gitee.com/wopal-cn/ellamaka/releases/tag/${CLI_TAG}"

# --- Auto-trigger retention cleanup (separate workflow) ---
# Per docs/DISTRIBUTION.md §7.2, cleanup uses the protection model and
# lives in its own workflow. After a successful release, dispatch it for
# the released product(s) so historical releases are pruned automatically
# (mirrors the old inline cleanup convention). --no-cleanup skips this.
if [ "$HAVE_GH" = true ] && [ "$NO_CLEANUP" != "true" ]; then
  if [ -n "$CLI_TAG" ]; then
    echo "→ 触发 cleanup workflow (ellamaka-cli, retention apply)..."
    gh workflow run cleanup-releases.yml -R wopal-cn/ellamaka \
      -f mode=retention \
      -f product=ellamaka-cli \
      -f apply=true \
      -f keep-stable=5 || echo "⚠️  cleanup workflow 触发失败（可手动触发）"
  fi
  if [ -n "$DESKTOP_TAG" ]; then
    echo "→ 触发 cleanup workflow (ellamaka-desktop, retention apply)..."
    gh workflow run cleanup-releases.yml -R wopal-cn/ellamaka \
      -f mode=retention \
      -f product=ellamaka-desktop \
      -f apply=true \
      -f keep-stable=3 \
      -f keep-beta=2 || echo "⚠️  cleanup workflow 触发失败（可手动触发）"
  fi
fi

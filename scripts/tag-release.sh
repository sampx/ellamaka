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
$SCRIPT — 打 tag 并推送，按需 dispatch publish-ellamaka / publish-ellamaka-desktop，并 watch 至完成

用法:
  $SCRIPT <子命令> <version> [选项]

━━━ 子命令 ━━━
  cli        仅发布 CLI（dispatch publish-ellamaka）
  desktop    仅发布 Desktop（dispatch publish-ellamaka-desktop）
  all        双发：CLI + Desktop

━━━ 参数 ━━━
  version    版本号（必填）
               CLI / prod Desktop: 任意版本号，如 0.0.1-p1-test、1.15.14
               beta Desktop:       X.Y.Z 或 X.Y.Z-beta.N（见下方自动行为）

━━━ 选项 ━━━
  -h, --help        显示此帮助
  --channel         Desktop 发布渠道: beta | prod（仅 desktop / all 有效，默认 prod）
  --retag           强制复用已存在的远程 tag（CI 失败后重试）
                      不加此选项时，远程 tag 已存在则自动递增

━━━ 自动行为 ━━━
  tag 自增规则:
    prod 通道 — 自动递增 -N 后缀（v1.15.13 → v1.15.13-1 → v1.15.13-2 …）
    beta 通道 — 自动递增 beta 序号（v1.15.14-beta.1 → v1.15.14-beta.2 …）

  beta 版本号自动补全:
    当 --channel beta 且版本号不含 -beta.N 后缀时（如 1.15.14），
    自动查询远程已有的 v1.15.14-beta.* tag，取最大序号 +1。
    若远程无任何 beta tag，则从 beta.1 开始。
    ⚠️ --retag 模式下必须显式指定完整 beta 版本号，不能自动补全。

  beta 版本号校验:
    手动指定 -beta.N 时，必须符合 X.Y.Z-beta.N 格式，否则报错。

  版本号 v 前缀自动补齐（输入 1.15.14 等价于 v1.15.14）

━━━ 示例 ━━━
  # CLI 测试版
  $SCRIPT cli 0.0.1-p1-test

  # CLI 正式版
  $SCRIPT cli 1.15.14

  # Desktop beta（自动补全 beta 序号）
  $SCRIPT desktop 1.15.14 --channel beta

  # Desktop beta（手动指定序号）
  $SCRIPT desktop 1.15.14-beta.3 --channel beta

  # Desktop 正式版
  $SCRIPT desktop 1.15.14 --channel prod

  # 双发 prod
  $SCRIPT all 1.15.14

  # CI 失败后重试（显式指定完整版本号）
  $SCRIPT desktop 1.15.14-beta.1 --channel beta --retag
EOF
  exit 0
}

# --- Argument parsing ---
SUBCOMMAND=""
RETAG=false
CHANNEL="prod"
CHANNEL_EXPLICIT=false
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --channel)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        die "--channel 需要 beta 或 prod"
      fi
      CHANNEL="$2"
      CHANNEL_EXPLICIT=true
      shift 2
      ;;
    --retag) RETAG=true; shift ;;
    cli|desktop|all)
      [ -n "$SUBCOMMAND" ] && die "重复的子命令: $1（已指定 ${SUBCOMMAND}）"
      SUBCOMMAND="$1"
      shift
      ;;
    -*) die "未知选项: $1" ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

# Validate subcommand
if [ -z "$SUBCOMMAND" ]; then
  echo "错误: 缺少子命令（cli | desktop | all）" >&2
  echo "用法: $SCRIPT <子命令> <version> [选项]" >&2
  echo "试试: $SCRIPT --help" >&2
  exit 1
fi

# Map subcommand to watch flags
case "$SUBCOMMAND" in
  cli)
    WATCH_CLI=true
    WATCH_DESKTOP_AUTO=false
    ;;
  desktop)
    WATCH_CLI=false
    WATCH_DESKTOP_AUTO=true
    ;;
  all)
    WATCH_CLI=true
    WATCH_DESKTOP_AUTO=true
    ;;
esac

VERSION="${ARGS[0]:-}"

[ -z "$VERSION" ] && die "缺少版本参数\n用法: $SCRIPT $SUBCOMMAND <version> [选项]\n试试: $SCRIPT --help"

# Normalize v prefix
case "$VERSION" in
  v*) ;;
  *) VERSION="v$VERSION" ;;
esac
TAG="$VERSION"

# Validate channel
case "$CHANNEL" in
  beta|prod) ;;
  *) die "无效 Desktop channel: $CHANNEL (只支持 beta 或 prod)" ;;
esac

# Validate beta version format
PLAIN_VERSION="${TAG#v}"
if [ "$CHANNEL" = "beta" ]; then
  if ! [[ "$PLAIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && \
     ! [[ "$PLAIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
    die "beta 版本号格式无效: $PLAIN_VERSION (期望 X.Y.Z 或 X.Y.Z-beta.N)"
  fi
elif [[ "$PLAIN_VERSION" == *-beta.* ]]; then
  die "beta 版本号必须指定 --channel beta"
fi

# --channel scope check: only desktop / all support channel
if [ "$SUBCOMMAND" = "cli" ] && [ "$CHANNEL_EXPLICIT" = true ]; then
  die "--channel 仅适用于 desktop / all 子命令，cli 子命令不支持"
fi

# --- gh availability ---
HAVE_GH=false
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  HAVE_GH=true
fi

# --- Locate repo ---
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Inject CLI Version ---
if command -v jq >/dev/null 2>&1 && [ -f "$REPO_ROOT/.ci/versions.json" ]; then
  export MIN_WOPAL_CLI_VERSION=$(jq -r .minWopalCli "$REPO_ROOT/.ci/versions.json")
fi

# --- Repo guard ---
REPO_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")"
if ! echo "$REPO_URL" | grep -qE '[/:]wopal-cn/ellamaka(\.git)?$'; then
  die "remote 'origin' 不是 wopal-cn/ellamaka\n  remote: $REPO_URL\n  仓库: $REPO_ROOT"
fi

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

# --- Beta version auto-completion ---
resolve_beta_version() {
  local base_tag="$1"  # e.g. v1.15.14
  local max_n=0

  while IFS= read -r line; do
    if [[ "$line" =~ refs/tags/${base_tag}-beta\.([0-9]+)$ ]]; then
      local n="${BASH_REMATCH[1]}"
      [ "$n" -gt "$max_n" ] && max_n="$n"
    fi
  done < <(git -C "$REPO_ROOT" ls-remote --tags origin "refs/tags/${base_tag}-beta.*" 2>/dev/null)

  echo "${base_tag}-beta.$((max_n + 1))"
}

# --- Tag resolution ---
# Resolves the final tag to use. If the tag already exists remotely:
#   --retag: delete remote tag and reuse the name
#   default: auto-increment (-N for prod, beta.N for beta)
resolve_tag() {
  local base_tag="$1"

  # Remote doesn't exist → use directly
  if ! git -C "$REPO_ROOT" ls-remote --tags origin "$base_tag" | grep -q "refs/tags/${base_tag}$"; then
    echo "$base_tag"
    return 0
  fi

  # Remote exists
  if [ "$RETAG" = true ]; then
    echo "  ℹ️  --retag 模式：删除远程旧 tag $base_tag" >&2
    git -C "$REPO_ROOT" push origin ":refs/tags/$base_tag" >&2
    echo "$base_tag"
    return 0
  fi

  local base separator start
  if [ "$CHANNEL" = "beta" ] && [[ "$base_tag" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+-beta\.)([0-9]+)$ ]]; then
    base="${BASH_REMATCH[1]}"
    separator=""
    start=$(( ${BASH_REMATCH[2]} + 1 ))
  elif [[ "$base_tag" =~ ^(.*)-([0-9]+)$ ]]; then
    base="${BASH_REMATCH[1]}"
    separator="-"
    start=$(( ${BASH_REMATCH[2]} + 1 ))
  else
    base="$base_tag"
    separator="-"
    start=1
  fi

  local n=$start
  while [ "$n" -le 999 ]; do
    local candidate="${base}${separator}${n}"
    if ! git -C "$REPO_ROOT" ls-remote --tags origin "$candidate" | grep -q "refs/tags/${candidate}$"; then
      echo "$candidate"
      return 0
    fi
    n=$((n + 1))
  done

  die "无法为 $base_tag 找到可用的递增 tag (已达上限 999)"
}

# --- Dispatch workflow ---
dispatch_workflow() {
  local wf="$1"
  local label="$2"
  local plain_version="${RESOLVED_TAG#v}"
  local channel_arg=""

  if [[ "$wf" == publish-ellamaka-desktop.yml ]]; then
    channel_arg="-f channel=$CHANNEL"
  fi

  local output
  echo "→ dispatch $label workflow: $wf (ref=$RESOLVED_TAG, version=$plain_version${channel_arg:+, channel=$CHANNEL})" >&2
  # shellcheck disable=SC2086
  if ! output=$(gh workflow run "$wf" -R wopal-cn/ellamaka \
    --ref "$RESOLVED_TAG" \
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

# Beta auto-completion
if [ "$CHANNEL" = "beta" ] && [[ "$PLAIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  if [ "$RETAG" = true ]; then
    die "--retag 需要显式指定完整 beta 版本号 (如 1.15.14-beta.3)，不能自动补全"
  fi
  RESOLVED_BETA="$(resolve_beta_version "$TAG")"
  echo "  ℹ️  自动检测 beta 版本: $TAG → $RESOLVED_BETA"
  TAG="$RESOLVED_BETA"
  PLAIN_VERSION="${TAG#v}"
fi

# Resolve tag
echo "→ 解析最终 tag: $TAG"
RESOLVED_TAG="$(resolve_tag "$TAG")"
RESOLVED_VERSION="${RESOLVED_TAG#v}"
if [ "$RESOLVED_TAG" != "$TAG" ] && [ "$RETAG" = false ]; then
  echo "  ℹ️  $TAG 已存在，自动递增为 $RESOLVED_TAG"
fi

# Clean local tag
echo "→ 检查本地 tag: $RESOLVED_TAG"
if git -C "$REPO_ROOT" tag -l "$RESOLVED_TAG" | grep -q "$RESOLVED_TAG"; then
  echo "  本地 tag 已存在，删除..."
  git -C "$REPO_ROOT" tag -d "$RESOLVED_TAG"
fi

# Create tag + push
echo "→ 创建 tag: $RESOLVED_TAG"
git -C "$REPO_ROOT" tag "$RESOLVED_TAG"

echo "→ 原子推送 main 和 $RESOLVED_TAG"
git -C "$REPO_ROOT" push origin main "$RESOLVED_TAG"

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
if [ "$DESKTOP_WF_EXISTS" = true ] && [ "$WATCH_DESKTOP_AUTO" = true ]; then
  DO_WATCH_DESKTOP=true
fi

RUN_CLI=""
RUN_DESKTOP=""

if [ "$DO_WATCH_CLI" = true ]; then
  if ! RUN_CLI="$(dispatch_workflow publish-ellamaka.yml "CLI")"; then
    die "无法确定本次 CLI workflow run"
  fi
  echo "  CLI run id: $RUN_CLI"
fi

if [ "$DO_WATCH_DESKTOP" = true ]; then
  if ! RUN_DESKTOP="$(dispatch_workflow publish-ellamaka-desktop.yml "Desktop")"; then
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
echo "   Release:     https://github.com/wopal-cn/ellamaka/releases/tag/${RESOLVED_TAG}"
[ "$DO_WATCH_CLI" = true ] && echo "   CLI R2:      https://download.coursedao.com/ellamaka/${RESOLVED_TAG}/"
[ "$DO_WATCH_DESKTOP" = true ] && [ "$CHANNEL" = "prod" ] && echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/${RESOLVED_TAG}/"
[ "$DO_WATCH_DESKTOP" = true ] && [ "$CHANNEL" = "beta" ] && echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/beta/${RESOLVED_TAG}/"
[ "$DO_WATCH_CLI" = true ] && echo "   Ontology:    https://github.com/wopal-cn/wopal-space-ontology/releases/tag/ellamaka-v${RESOLVED_VERSION}"
[ "$DO_WATCH_DESKTOP" = true ] && echo "   Ontology Desktop: https://github.com/wopal-cn/wopal-space-ontology/releases/tag/ellamaka-desktop-v${RESOLVED_VERSION}"
[ "$DO_WATCH_CLI" = true ] && echo "   Gitee:       https://gitee.com/wopal-cn/ellamaka/releases/tag/${RESOLVED_TAG}"
#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

usage() {
  cat <<EOF
$SCRIPT — 打 tag 并推送，按需 dispatch publish-ellamaka / publish-ellamaka-desktop，并 watch 至完成

用法:
  $SCRIPT <version> [remote] [--channel <beta|prod>] [--retag] [--cli|--desktop]

参数:
  version   版本号（必填），如 0.0.1-p1-test（v 前缀自动补齐）
  remote    Git remote 名（可选，默认 origin）

选项:
  -h, --help   显示此帮助信息
  --channel    Desktop channel（默认 prod）；beta 版本必须使用 X.Y.Z-beta.N
  --retag      复用已存在的远程 tag（覆盖同版本 R2 路径，用于 CI 失败后重试）
               不加此选项时，远程 tag 已存在则自动递增 -N 后缀
  --cli        仅发布 CLI（仅 dispatch publish-ellamaka）
  --desktop    仅发布 Desktop（仅 dispatch publish-ellamaka-desktop）
               不加 --cli/--desktop 时默认双发

行为:
  1. 解析最终 tag：
       - prod：若远程同名 tag 已存在，自动递增 -N 后缀（如 v1.15.13 → v1.15.13-1）
       - beta：若远程同名 tag 已存在，递增 beta 序号（如 v1.15.14-beta.1 → v1.15.14-beta.2）
       - --retag：强制复用传入的 tag，若远程已存在则先删除远程 + 本地旧 tag 再重建
  2. 若本地 tag 已存在 → 删除（处理上次脚本中途失败残留）
  3. 在当前 HEAD 创建新 tag
  4. 原子推送 main 和 tag（tag 供 dispatch 时 --ref 引用，不再自动触发 workflow）
  5. 按需 dispatch workflow：
       - --cli      → 仅 dispatch publish-ellamaka
       - --desktop  → 仅 dispatch publish-ellamaka-desktop
       - 默认       → 两者都 dispatch
  6. Watch 选定的 workflow 至全部完成（Ctrl+C 可中断）
  7. 打印发布 URL

示例:
  $SCRIPT 0.0.1-p1-test
  $SCRIPT 0.0.2-alpha upstream
  $SCRIPT 0.0.2-alpha --retag        # CI 失败后重试，复用同一 tag
  $SCRIPT 1.15.14-beta.1 --channel beta --desktop
  $SCRIPT 1.15.14 --channel prod --desktop
  $SCRIPT 0.0.2-alpha --cli         # 仅发布 CLI，跳过桌面端构建
  $SCRIPT 0.0.2-alpha --desktop     # 仅发布 Desktop，跳过 CLI 构建
EOF
  exit 0
}

# --- 参数解析 ---
RETAG=false
CHANNEL="prod"
CHANNEL_EXPLICIT=false
WATCH_CLI=true
WATCH_DESKTOP_AUTO=true   # 由文件存在性 + --cli/--desktop 共同决定
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --channel)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "错误: --channel 需要 beta 或 prod"
        exit 1
      fi
      CHANNEL="$2"
      CHANNEL_EXPLICIT=true
      shift 2
      ;;
    --retag) RETAG=true; shift ;;
    --cli) WATCH_CLI=true; WATCH_DESKTOP_AUTO=false; shift ;;
    --desktop) WATCH_CLI=false; WATCH_DESKTOP_AUTO=true; shift ;;
    -*) echo "未知选项: $1"; exit 1 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

VERSION="${ARGS[0]:-}"
REMOTE="${ARGS[1]:-origin}"

if [ -z "$VERSION" ]; then
  echo "错误: 缺少版本参数"
  echo "用法: $SCRIPT <version> [remote] [--channel <beta|prod>] [--retag] [--cli|--desktop]"
  echo "试试: $SCRIPT --help"
  exit 1
fi

# 规范化 tag：确保 v 前缀（dispatch 时 --ref 需引用该 tag）
case "$VERSION" in
  v*) ;;
  *) VERSION="v$VERSION" ;;
esac
TAG="$VERSION"

case "$CHANNEL" in
  beta|prod) ;;
  *) echo "错误: 无效 Desktop channel: $CHANNEL（只支持 beta 或 prod）"; exit 1 ;;
esac

PLAIN_VERSION="${VERSION#v}"
if [ "$CHANNEL" = "beta" ]; then
  if ! [[ "$PLAIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
    echo "错误: beta 版本必须使用 X.Y.Z-beta.N 格式"
    exit 1
  fi
elif [[ "$PLAIN_VERSION" == *-beta.* ]]; then
  echo "错误: beta 版本必须指定 --channel beta"
  exit 1
fi

if [ "$WATCH_DESKTOP_AUTO" = false ] && [ "$CHANNEL_EXPLICIT" = true ] && [ "$CHANNEL" != "prod" ]; then
  echo "错误: --channel beta 仅适用于包含 Desktop 的发布"
  exit 1
fi

# --- gh 可用性检测 ---
HAVE_GH=false
if command -v gh &>/dev/null; then
  if gh auth status &>/dev/null 2>&1; then
    HAVE_GH=true
  fi
fi

# --- 定位仓库 ---
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- 仓库守卫 ---
REPO_URL="$(git -C "$REPO_ROOT" remote get-url "$REMOTE" 2>/dev/null || echo "")"
if ! echo "$REPO_URL" | grep -qE '[/:]wopal-cn/ellamaka(\.git)?$'; then
  echo "错误: remote '$REMOTE' 不是 wopal-cn/ellamaka"
  echo "  remote: $REPO_URL"
  echo "  仓库: $REPO_ROOT"
  exit 1
fi

# --- 解析最终 tag ---
# 默认：prod 递增 -N revision，beta 递增 beta.N（旧 tag 保留不删除）
# --retag：强制复用传入的 tag，远程已存在则先删除远程 + 本地旧 tag
resolve_tag() {
  local base_tag="$1"

  # 远程不存在 → 直接使用
  if ! git -C "$REPO_ROOT" ls-remote --tags "$REMOTE" "$base_tag" | grep -q "$base_tag"; then
    echo "$base_tag"
    return 0
  fi

  # 远程已存在
  if [ "$RETAG" = true ]; then
    echo "  ℹ️  --retag 模式：删除远程旧 tag $base_tag" >&2
    git -C "$REPO_ROOT" push "$REMOTE" ":refs/tags/$base_tag" >&2
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
    if ! git -C "$REPO_ROOT" ls-remote --tags "$REMOTE" "$candidate" | grep -q "$candidate"; then
      echo "$candidate"
      return 0
    fi
    n=$((n + 1))
  done

  echo "错误: 无法为 $base_tag 找到可用的递增 tag（已达上限 999）" >&2
  return 1
}

# --- 执行 ---

# 0. 发布前检查：变更必须先提交并 push 到 remote
if ! git -C "$REPO_ROOT" diff --quiet HEAD -- . 2>/dev/null; then
  echo "错误: 工作区有未提交变更，请先提交或 stash"
  git -C "$REPO_ROOT" status --short
  exit 1
fi
if ! git -C "$REPO_ROOT" diff --cached --quiet HEAD -- . 2>/dev/null; then
  echo "错误: 暂存区有未提交变更，请先提交"
  git -C "$REPO_ROOT" diff --cached --stat
  exit 1
fi
git -C "$REPO_ROOT" fetch "$REMOTE" main 2>/dev/null || true
REMOTE_MAIN=$(git -C "$REPO_ROOT" rev-parse "$REMOTE/main" 2>/dev/null || echo "")
if [ -z "$REMOTE_MAIN" ]; then
  echo "错误: $REMOTE/main 不存在，请先 git push $REMOTE main"
  exit 1
fi
UNPUSHED=$(git -C "$REPO_ROOT" rev-list --count HEAD "^$REMOTE_MAIN" 2>/dev/null)
if [ "$UNPUSHED" -gt 0 ]; then
  echo "错误: local main 有 $UNPUSHED 个 commit 未推送至 $REMOTE/main:"
  git -C "$REPO_ROOT" log --oneline "$REMOTE_MAIN..HEAD"
  echo "请先 git push $REMOTE main"
  exit 1
fi

# 1. 解析最终 tag
echo "→ 解析最终 tag: $TAG"
RESOLVED_TAG="$(resolve_tag "$TAG")"
RESOLVED_VERSION="${RESOLVED_TAG#v}"
if [ "$RESOLVED_TAG" != "$TAG" ] && [ "$RETAG" = false ]; then
  echo "  ℹ️  $TAG 已存在，自动递增为 $RESOLVED_TAG"
fi

# 2. 清理本地可能残留的（上次脚本中途失败）同名 tag
echo "→ 检查本地 tag: $RESOLVED_TAG"
if git -C "$REPO_ROOT" tag -l "$RESOLVED_TAG" | grep -q "$RESOLVED_TAG"; then
  echo "  本地 tag 已存在，删除..."
  git -C "$REPO_ROOT" tag -d "$RESOLVED_TAG"
fi

# 3. 创建 tag + 原子推送
echo "→ 创建 tag: $RESOLVED_TAG"
git -C "$REPO_ROOT" tag "$RESOLVED_TAG"

echo "→ 原子推送 main 和 $RESOLVED_TAG"
git -C "$REPO_ROOT" push "$REMOTE" main "$RESOLVED_TAG"

# 4. 按需 dispatch workflow
echo ""
if [ "$HAVE_GH" = false ]; then
  echo "ℹ️  gh CLI 不可用或未认证，跳过 dispatch + watch。"
  echo "   tag 已推送，可手动在 GitHub Actions 页面触发 workflow。"
  exit 0
fi

# 检测 desktop workflow 是否存在（不存在则优雅降级为仅 dispatch CLI）
DESKTOP_WF=".github/workflows/publish-ellamaka-desktop.yml"
DESKTOP_WF_EXISTS=false
if [ -f "$REPO_ROOT/$DESKTOP_WF" ]; then
  DESKTOP_WF_EXISTS=true
fi

# 根据文件存在性 + --cli/--desktop 标志决定实际 dispatch 范围
DO_WATCH_CLI=$WATCH_CLI
DO_WATCH_DESKTOP=false
if [ "$DESKTOP_WF_EXISTS" = true ] && [ "$WATCH_DESKTOP_AUTO" = true ]; then
  DO_WATCH_DESKTOP=true
fi

# dispatch_workflow: 触发指定 workflow 并返回本次 dispatch 的 run id
#   $1 = workflow 文件名（如 publish-ellamaka.yml）
#   $2 = run 名称标签（如 "CLI" / "Desktop"）
#   stdout = run id
# 通过 --ref 指向刚推送的 tag，让 workflow checkout 到对应 commit；
# 通过 -f version=... 传入版本号（workflow 内 inputs.version 优先）。
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

RUN_CLI=""
RUN_DESKTOP=""

if [ "$DO_WATCH_CLI" = true ]; then
  if ! RUN_CLI="$(dispatch_workflow publish-ellamaka.yml "CLI")"; then
    echo "错误: 无法确定本次 CLI workflow run。"
    exit 1
  fi
  echo "  CLI run id: $RUN_CLI"
fi

if [ "$DO_WATCH_DESKTOP" = true ]; then
  if ! RUN_DESKTOP="$(dispatch_workflow publish-ellamaka-desktop.yml "Desktop")"; then
    echo "错误: 无法确定本次 Desktop workflow run。"
    exit 1
  fi
  echo "  Desktop run id: $RUN_DESKTOP"
fi

poll_run() {
  gh run view "$1" -R wopal-cn/ellamaka --json status,conclusion,jobs -q '
    "\(.status) \(.conclusion // "")",
    (.jobs // [] | map("       [\(.status)] \(.name): \(.conclusion // "running...")") | join("\n"))
  ' 2>/dev/null || echo "unknown"
}

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

# 5. 输出发布 URL
echo ""
echo "✅ Release complete"
echo "   Release:     https://github.com/wopal-cn/ellamaka/releases/tag/${RESOLVED_TAG}"
[ "$DO_WATCH_CLI" = true ] && echo "   CLI R2:      https://download.coursedao.com/ellamaka/${RESOLVED_TAG}/"
[ "$DO_WATCH_DESKTOP" = true ] && [ "$CHANNEL" = "prod" ] && echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/${RESOLVED_TAG}/"
[ "$DO_WATCH_DESKTOP" = true ] && [ "$CHANNEL" = "beta" ] && echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/beta/${RESOLVED_TAG}/"
[ "$DO_WATCH_CLI" = true ] && echo "   Ontology:    https://github.com/wopal-cn/wopal-space-ontology/releases/tag/ellamaka-v${RESOLVED_VERSION}"
[ "$DO_WATCH_DESKTOP" = true ] && echo "   Ontology Desktop: https://github.com/wopal-cn/wopal-space-ontology/releases/tag/ellamaka-desktop-v${RESOLVED_VERSION}"
[ "$DO_WATCH_CLI" = true ] && echo "   Gitee:       https://gitee.com/wopal-cn/ellamaka/releases/tag/${RESOLVED_TAG}"

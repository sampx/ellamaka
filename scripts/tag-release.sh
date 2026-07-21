#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

usage() {
  cat <<EOF
$SCRIPT — 打 tag 并推送，触发 publish-ellamaka + publish-ellamaka-desktop 双 CI，并 watch 至完成

用法:
  $SCRIPT <version> [remote]

参数:
  version   版本号（必填），如 0.0.1-p1-test（v 前缀自动补齐）
  remote    Git remote 名（可选，默认 origin）

选项:
  -h, --help  显示此帮助信息

行为:
  1. 解析最终 tag：若远程同名 tag 已存在，自动递增 -N 后缀（如 v1.15.13 → v1.15.13-1），旧 tag 保留不删除
  2. 若本地 tag 已存在 → 删除（处理上次脚本中途失败残留）
  3. 在当前 HEAD 创建新 tag
  4. 原子推送 main 和 tag → 同 tag 双发，同时触发 publish-ellamaka 与 publish-ellamaka-desktop 两个 CI workflow
  5. Watch 两个 workflow 至全部完成（Ctrl+C 可中断）；若 desktop workflow 不存在则仅 watch CLI
  6. 打印发布 URL（含 Desktop R2 路径）

示例:
  $SCRIPT 0.0.1-p1-test
  $SCRIPT 0.0.2-alpha upstream
EOF
  exit 0
}

# --- 参数解析 ---
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage ;;
    -*) echo "未知选项: $arg"; usage ;;
    *) ARGS+=("$arg") ;;
  esac
done

VERSION="${ARGS[0]:-}"
REMOTE="${ARGS[1]:-origin}"

if [ -z "$VERSION" ]; then
  echo "错误: 缺少版本参数"
  echo "用法: $SCRIPT <version> [remote]"
  echo "试试: $SCRIPT --help"
  exit 1
fi

# 规范化 tag：确保 v 前缀（publish-ellamaka.yml 仅由 v* tag 触发）
case "$VERSION" in
  v*) ;;
  *) VERSION="v$VERSION" ;;
esac
TAG="$VERSION"

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

# --- 解析最终 tag（自动递增 -N 后缀）---
# 若远程同名 tag 已存在，则追加 -1 / -2 / ... 直到找到一个不存在的。
# 旧 tag 一律保留，不删除（避免 R2 CDN 缓存冲突与 install 幂等性失效）。
resolve_tag() {
  local base_tag="$1"

  # 远程不存在 → 直接使用
  if ! git -C "$REPO_ROOT" ls-remote --tags "$REMOTE" "$base_tag" | grep -q "$base_tag"; then
    echo "$base_tag"
    return 0
  fi

  # 拆分 base 与 suffix：有 -N 后缀时从 N+1 起，否则从 1 起
  local base suffix start
  if [[ "$base_tag" =~ ^(.*)-([0-9]+)$ ]]; then
    base="${BASH_REMATCH[1]}"
    start=$(( ${BASH_REMATCH[2]} + 1 ))
  else
    base="$base_tag"
    start=1
  fi

  local n=$start
  while [ "$n" -le 999 ]; do
    local candidate="${base}-${n}"
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

# 1. 解析最终 tag（自动递增 -N 后缀）
echo "→ 解析最终 tag: $TAG"
RESOLVED_TAG="$(resolve_tag "$TAG")"
if [ "$RESOLVED_TAG" != "$TAG" ]; then
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

# 3. Watch workflows（CLI + Desktop 双发）
echo ""
if [ "$HAVE_GH" = false ]; then
  echo "ℹ️  gh CLI 不可用或未认证，跳过 watch。"
  exit 0
fi

# 检测 desktop workflow 是否存在（不存在则优雅降级为仅 watch CLI）
DESKTOP_WF=".github/workflows/publish-ellamaka-desktop.yml"
WATCH_DESKTOP=false
if [ -f "$REPO_ROOT/$DESKTOP_WF" ]; then
  WATCH_DESKTOP=true
fi

COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"

find_run() {
  local wf="$1"
  local run_id=""
  for _ in $(seq 1 12); do
    run_id=$(gh run list -R wopal-cn/ellamaka --workflow "$wf" --commit "$COMMIT" --status in_progress,queued --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
    if [ -n "$run_id" ]; then echo "$run_id"; return 0; fi
    run_id=$(gh run list -R wopal-cn/ellamaka --workflow "$wf" --commit "$COMMIT" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
    if [ -n "$run_id" ]; then echo "$run_id"; return 0; fi
    sleep 5
  done
  echo ""
  return 0
}

echo "→ 等待 publish-ellamaka workflow 启动..."
RUN_CLI="$(find_run publish-ellamaka.yml)"
if [ -z "$RUN_CLI" ]; then
  echo "⚠️  60 秒内未找到 CLI workflow run。"
  exit 0
fi

RUN_DESKTOP=""
if [ "$WATCH_DESKTOP" = true ]; then
  echo "→ 等待 publish-ellamaka-desktop workflow 启动..."
  RUN_DESKTOP="$(find_run publish-ellamaka-desktop.yml)"
  if [ -z "$RUN_DESKTOP" ]; then
    echo "⚠️  60 秒内未找到 Desktop workflow run，仅 watch CLI。"
    WATCH_DESKTOP=false
  fi
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

  CLI_FULL="$(poll_run "$RUN_CLI")"
  CLI_STATUS="$(echo "$CLI_FULL" | head -n 1)"
  echo "  [CLI #$i] $CLI_STATUS"
  echo "$CLI_FULL" | tail -n +2

  DESKTOP_STATUS="skipped"
  if [ "$WATCH_DESKTOP" = true ] && [ -n "$RUN_DESKTOP" ]; then
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

  CLI_DONE=false
  [ "$CLI_STATUS" = "completed success" ] && CLI_DONE=true
  DESKTOP_DONE=true
  [ "$WATCH_DESKTOP" = true ] && [ "$DESKTOP_STATUS" != "completed success" ] && DESKTOP_DONE=false

  if [ "$CLI_DONE" = true ] && [ "$DESKTOP_DONE" = true ]; then
    break
  fi

  sleep $POLL_INTERVAL
done

# 4. 输出发布 URL
echo ""
echo "✅ Release complete"
echo "   Release:     https://github.com/wopal-cn/ellamaka/releases/tag/${RESOLVED_TAG}"
echo "   CLI R2:      https://download.coursedao.com/ellamaka/${RESOLVED_TAG}/"
echo "   Desktop R2:  https://download.coursedao.com/ellamaka-desktop/${RESOLVED_TAG}/"
echo "   Ontology:    https://github.com/wopal-cn/wopal-space-ontology/releases/tag/ellamaka-${VERSION#v}"
echo "   Gitee:       https://gitee.com/wopal-cn/ellamaka/releases/tag/${RESOLVED_TAG}"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

usage() {
  cat <<EOF
$SCRIPT — 打 tag 并推送，触发 publish-ellamaka CI，并 watch 至完成

用法:
  $SCRIPT <version> [remote]

参数:
  version   版本号（必填），如 0.0.1-p1-test（v 前缀自动补齐）
  remote    Git remote 名（可选，默认 origin）

选项:
  -h, --help  显示此帮助信息

行为:
  1. 检测重发：若远程 tag 已存在，跳过重复操作
  2. 若本地 tag 已存在 → 删除
  3. 在当前 HEAD 创建新 tag
  4. 原子推送 main 和 tag → 触发 publish-ellamaka workflow
  5. Watch release workflow 至完成（Ctrl+C 可中断）
  6. 打印发布 URL

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

# --- 执行 ---

# 1. 检测重发 & 清理
echo "→ 检查远程 tag: $TAG"
if git -C "$REPO_ROOT" ls-remote --tags "$REMOTE" "$TAG" | grep -q "$TAG"; then
  echo "  检测到重发，删除远程 tag..."
  git -C "$REPO_ROOT" push "$REMOTE" ":$TAG"
fi

echo "→ 检查本地 tag: $TAG"
if git -C "$REPO_ROOT" tag -l "$TAG" | grep -q "$TAG"; then
  echo "  本地 tag 已存在，删除..."
  git -C "$REPO_ROOT" tag -d "$TAG"
fi

# 2. 创建 tag + 原子推送
echo "→ 创建 tag: $TAG"
git -C "$REPO_ROOT" tag "$TAG"

echo "→ 原子推送 main 和 $TAG"
git -C "$REPO_ROOT" push "$REMOTE" main "$TAG"

# 3. Watch workflow
echo ""
if [ "$HAVE_GH" = false ]; then
  echo "ℹ️  gh CLI 不可用或未认证，跳过 watch。"
  exit 0
fi

echo "→ 等待 publish-ellamaka workflow 启动..."

COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
RUN_ID=""

for i in $(seq 1 12); do
  RUN_ID=$(gh run list -R wopal-cn/ellamaka --workflow publish-ellamaka.yml --commit "$COMMIT" --status in_progress,queued --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
  if [ -n "$RUN_ID" ]; then
    break
  fi
  RUN_ID=$(gh run list -R wopal-cn/ellamaka --workflow publish-ellamaka.yml --commit "$COMMIT" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
  if [ -n "$RUN_ID" ]; then
    break
  fi
  sleep 5
done

if [ -z "$RUN_ID" ]; then
  echo "⚠️  60 秒内未找到 workflow run。"
  exit 0
fi

echo "→ Watching run $RUN_ID (Ctrl+C 中断)..."

POLL_INTERVAL=15
i=0
while true; do
  i=$((i + 1))
  FULL=$(gh run view "$RUN_ID" -R wopal-cn/ellamaka --json status,conclusion,jobs -q '
    "\(.status) \(.conclusion // "")",
    (.jobs // [] | map("       [\(.status)] \(.name): \(.conclusion // "running...")") | join("\n"))
  ' 2>/dev/null || echo "unknown")

  STATUS=$(echo "$FULL" | head -n 1)
  echo "  [$i] $STATUS"
  echo "$FULL" | tail -n +2

  case "$STATUS" in
    "completed success") break ;;
    "completed failure"|"completed cancelled")
      echo "⚠️  Workflow 失败或取消 (conclusion: ${STATUS#completed })"
      exit 1
      ;;
  esac
  sleep $POLL_INTERVAL
done

# 4. 输出发布 URL
echo ""
echo "✅ Release complete"
echo "   Release:   https://github.com/wopal-cn/ellamaka/releases/tag/${TAG}"
echo "   R2:        https://download.coursedao.com/ellamaka/${TAG}/"
echo "   Ontology:  https://github.com/wopal-cn/wopal-space-ontology/releases/tag/ellamaka-${VERSION#v}"
echo "   Gitee:     https://gitee.com/wopal-cn/ellamaka/releases/tag/${TAG}"

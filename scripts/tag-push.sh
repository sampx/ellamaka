#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

usage() {
  cat <<EOF
$SCRIPT — 打 tag 并推送 main，触发 publish-ellamaka CI

用法:
  $SCRIPT <tag> [remote]

参数:
  tag       版本 tag（必填），如 v0.0.1-p1-test
  remote    Git remote 名（可选，默认 origin）

选项:
  -h, --help  显示此帮助信息

行为:
  1. 若远程 tag 已存在 → 删除
  2. 若本地 tag 已存在 → 删除
  3. 在当前 HEAD 创建新 tag
  4. 推送 main 分支
  5. 推送 tag → 触发 publish-ellamaka workflow

示例:
  $SCRIPT v0.0.1-p1-test
  $SCRIPT v0.0.2-alpha upstream
EOF
  exit 0
}

# --- 参数解析 ---
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage ;;
    -*) echo "未知选项: $arg"; usage ;;
  esac
done

TAG="${1:-}"
REMOTE="${2:-origin}"

if [ -z "$TAG" ]; then
  echo "错误: 缺少 tag 参数"
  echo "用法: $SCRIPT <tag> [remote]"
  echo "试试: $SCRIPT --help"
  exit 1
fi

# --- 执行 ---
echo "→ 检查远程 tag: $TAG"
if git ls-remote --tags "$REMOTE" "$TAG" | grep -q "$TAG"; then
  echo "  远程 tag 已存在，删除..."
  git push "$REMOTE" ":$TAG"
fi

echo "→ 检查本地 tag: $TAG"
if git tag -l "$TAG" | grep -q "$TAG"; then
  echo "  本地 tag 已存在，删除..."
  git tag -d "$TAG"
fi

echo "→ 创建 tag: $TAG"
git tag "$TAG"

echo "→ 推送 main"
git push "$REMOTE" main

echo "→ 推送 tag: $TAG"
git push "$REMOTE" "$TAG"

echo "✅ 完成"

#!/usr/bin/env bash
set -euo pipefail

# merge-upstream.sh — 合并 opencode 上游变更到 ellamaka
# 用法:
#   ./scripts/merge-upstream.sh              # 合并 upstream/dev
#   ./scripts/merge-upstream.sh main-branch # 合并 upstream/main-branch
#   ./scripts/merge-upstream.sh --no-isolate # 直接在当前分支合并（不推荐）
#
# 固化的通用流程:
#   1. 检查工作区干净
#   2. 创建隔离分支 merge/upstream-<version>
#   3. 执行合并，自动解决 DELETED_PREFIXES 冲突
#   4. 运行构建验证 (typecheck + test)
#   5. 提示后续步骤
#
# 不固化: 具体冲突文件的解决策略（每次合并不同，参考 Plan 文档）

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="${1:-dev}"
ISOLATE=true
MERGE_NAME=""

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --no-isolate) ISOLATE=false ;;
    --name=*) MERGE_NAME="${arg#*=}" ;;
    --name)   MERGE_NAME="${2:-}" ;;
  esac
done

if [[ "${UPSTREAM_BRANCH}" == "--no-isolate" ]] || [[ "${UPSTREAM_BRANCH}" == "--name" ]]; then
  ISOLATE=false
  UPSTREAM_BRANCH="${2:-dev}"
fi

# 确定合并分支名称
# 优先级: 1. 用户指定 --name  2. 上游最近 tag  3. 分支名 + 短 commit hash
resolve_merge_name() {
  if [ -n "${MERGE_NAME}" ]; then
    MERGE_BRANCH="merge/upstream-${MERGE_NAME}"
    return
  fi

  # 尝试获取上游最近的 tag
  LATEST_TAG=$(git describe --tags "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>/dev/null || true)
  if [ -n "${LATEST_TAG}" ]; then
    # 清理 tag 前缀 (v1.2.3-0-gabc -> v1.2.3)
    CLEAN_TAG="${LATEST_TAG%%-*}"
    MERGE_BRANCH="merge/upstream-${CLEAN_TAG}"
    return
  fi

  # 无 tag，用分支名 + 短 commit hash
  SHORT_HASH=$(git rev-parse --short "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>/dev/null || echo "unknown")
  MERGE_BRANCH="merge/upstream-${UPSTREAM_BRANCH}-${SHORT_HASH}"
}

# 已删除的路径前缀 — 合并冲突时自动保持删除
# ellamaka fork 中已移除或从未使用的上游组件
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
  "packages/zen/"
  "sdks/"
  "github/"
  "infra/"
  "nix/"
  "install"
  "script/"
  "specs/"
  ".github/"
  ".github/workflows/"
  "sst.config.ts"
  "sst-env.d.ts"
  "flake.nix"
  "flake.lock"
)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}==>${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*"; }

check_clean_workspace() {
  if ! git diff --quiet HEAD 2>/dev/null; then
    error "工作区有未提交的变更，请先提交或暂存"
    git status --short
    exit 1
  fi
}

create_merge_branch() {
  if ! $ISOLATE; then
    warn "跳过隔离分支创建（--no-isolate）"
    return
  fi

  if git show-ref --verify --quiet "refs/heads/${MERGE_BRANCH}"; then
    warn "分支 ${MERGE_BRANCH} 已存在"
    read -r -p "删除并重新创建？(y/N) " response
    if [[ "${response}" =~ ^[Yy]$ ]]; then
      git branch -D "${MERGE_BRANCH}"
    else
      error "无法继续，分支已存在"
      exit 1
    fi
  fi

  info "创建隔离分支: ${MERGE_BRANCH}"
  git checkout -b "${MERGE_BRANCH}"
}

fetch_upstream() {
  info "Fetching ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..."
  git fetch "${UPSTREAM_REMOTE}" "${UPSTREAM_BRANCH}"
}

do_merge() {
  info "Merging ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..."
  MERGE_RESULT=0
  git merge "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" --no-commit --no-ff || MERGE_RESULT=$?

  if [ "${MERGE_RESULT}" -eq 0 ]; then
    success "合并无冲突"
    return 0
  fi
  return 1
}

auto_resolve_deleted() {
  info "自动解决 DELETED_PREFIXES 冲突..."

  CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
  if [ -z "${CONFLICTS}" ]; then
    warn "未发现文件冲突"
    return 0
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
      echo "  ${YELLOW}⟹${NC} 已删除: ${file}"
    else
      MANUAL=$((MANUAL + 1))
      echo "  ${RED}✗${NC} 需手动: ${file}"
    fi
  done

  echo ""
  success "自动解决: ${RESOLVED} 个文件"

  if [ "${MANUAL}" -eq 0 ]; then
    return 0
  fi

  warn "需手动解决: ${MANUAL} 个文件"
  return 1
}

run_verification() {
  echo ""
  info "运行构建验证..."

  cd packages/opencode

  info "安装依赖..."
  bun install --frozen-lockfile 2>/dev/null || bun install

  info "类型检查..."
  if bun run typecheck; then
    success "类型检查通过"
  else
    error "类型检查失败"
    return 1
  fi

  info "运行测试..."
  if bun test 2>/dev/null; then
    success "测试通过"
  else
    warn "部分测试失败，请检查是否影响核心功能"
  fi

  cd - > /dev/null
  return 0
}

show_next_steps() {
  echo ""
  info "=========================================="
  info "后续步骤:"
  echo ""

  if $ISOLATE; then
    echo "  1. 解决剩余冲突（如有）: git diff --name-only --diff-filter=U"
    echo "  2. 标记已解决: git add <file>"
    echo "  3. 运行验证: ./scripts/merge-upstream.sh --verify"
    echo "  4. 提交合并: git commit -m \"merge: upstream ${UPSTREAM_BRANCH} $(date +%Y-%m-%d)\""
    echo "  5. 验证通过后合并回 main:"
    echo ""
    echo "     git checkout main"
    echo "     git merge ${MERGE_BRANCH}"
    echo "     git branch -d ${MERGE_BRANCH}"
    echo ""
    echo "  6. 推送: git push origin main"
  else
    echo "  1. 解决剩余冲突（如有）"
    echo "  2. 提交合并: git commit -m \"merge: upstream ${UPSTREAM_BRANCH} $(date +%Y-%m-%d)\""
    echo "  3. 推送: git push origin main"
  fi

  echo ""
  info "具体冲突解决策略参考: docs/products/ellamaka/plans/done/"
  info "=========================================="
}

main() {
  echo ""
  info "=========================================="
  info "ellamaka 上游合并工具"
  info "目标: ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
  info "=========================================="
  echo ""

  check_clean_workspace
  fetch_upstream
  resolve_merge_name

  if $ISOLATE; then
    info "隔离分支: ${MERGE_BRANCH}"
  fi
  create_merge_branch

  if do_merge; then
    run_verification
    show_next_steps
    exit 0
  fi

  if auto_resolve_deleted; then
    run_verification
    show_next_steps
    exit 0
  fi

  echo ""
  warn "手动冲突文件列表:"
  git diff --name-only --diff-filter=U | while read -r f; do
    echo "  - ${f}"
  done

  show_next_steps
  exit 1
}

# 子命令
if [[ "$*" == *"--verify"* ]]; then
  run_verification
  exit $?
fi

if [[ "$*" == *"--help"* ]] || [[ "$*" == *"-h"* ]]; then
  echo "用法: $0 [upstream-branch] [options]"
  echo ""
  echo "参数:"
  echo "  upstream-branch  上游分支名（默认: dev）"
  echo ""
  echo "选项:"
  echo "  --name=<name>    自定义合并分支名称（默认自动从 tag 获取）"
  echo "  --no-isolate     不创建隔离分支，直接在当前分支合并"
  echo "  --verify         仅运行构建验证"
  echo "  --help           显示帮助"
  echo ""
  echo "分支命名规则:"
  echo "  1. --name 指定 → merge/upstream-<name>"
  echo "  2. 上游有 tag  → merge/upstream-v1.2.3"
  echo "  3. 无 tag      → merge/upstream-dev-abc123"
  echo ""
  echo "示例:"
  echo "  $0                       # 合并 upstream/dev，自动命名"
  echo "  $0 main                   # 合并 upstream/main"
  echo "  $0 --name=v1.5.0          # 合并 dev，分支名 merge/upstream-v1.5.0"
  echo "  $0 dev --no-isolate       # 直接在当前分支合并"
  exit 0
fi

main
#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

# 设置引擎上下文后进入共享发布主流程
SUBCOMMAND="cli"
PRODUCT="ellamaka-cli"
LABEL="CLI"
WORKFLOW="publish-ellamaka-cli.yml"
CHANNEL_LABEL="stable"
PRERELEASE_KIND="rc"
ALLOWED_BUMPS="--patch --minor --major --rc"

AUTO_BUMP=""
DRY_RUN=false
NO_PUSH=false
NO_WATCH=false
NO_CLEANUP=""
VERSION=""
REMOTE="origin"

usage() {
  cat <<EOF
$SCRIPT — 发布 CLI版本：版本线推断 → bump → 提交 → tag → push（tag 触发 workflow）→ watch

版本线模型（docs/DISTRIBUTION.md §3.2/§4.1）：
  根 package.json = 产品版本线 base（唯一真相源）；CLI 锚点承载通道状态。
  目标 base 永远等于版本线 base，两个产品共享同一条版本线：
    CLI     → packages/ellamaka-cli/package.json      (X.Y.Z / X.Y.Z-rc.N)
    Desktop → packages/ellamaka-desktop/package.json  (X.Y.Z / X.Y.Z-beta.N)

用法:
  $SCRIPT [选项] [--] [version]

Bump 类型:
  --patch      稳定发布：版本线 base 本身（2.0.4-rc.2 → 2.0.4）
  --minor      开新版本线：minor +1（2.0.4 → 2.1.0），通道重置
  --major      开新版本线：major +1（2.0.4 → 3.0.0），通道重置
  --rc         继续 CLI -rc.N 序列（同 base 时 N+1），否则新 base 的 -rc.1
  （默认 --patch）

选项:
  --dry-run    只打印发布计划，不写入、不 tag、不 push、不 dispatch
  --no-push    bump 并提交 + 本地 tag，但不 push（留待人工检查）
  --no-watch   不 watch workflow 运行结果
  --no-cleanup 发布成功后跳过历史清理 workflow（默认自动触发）
  -h, --help   显示本帮助

分支渠道约束（branch-channel policy）：
  main 分支可发布全部版本；非 main 分支（poc-* 等）只允许 prerelease ——
  CLI X.Y.Z-rc.N，且 prerelease base 必须高于已发布 prod/stable 的最高版本。

re-release（幂等）：目标 tag 已在远端存在时——
  tag 有有效 R2 manifest → 拒绝（发布不可变），请用更高版本号；
  tag 无 manifest（failed attempt）→ 以该 tag 重新 dispatch workflow，不重复 bump。

示例:
  $SCRIPT --rc            # 2.0.4-rc.1 → 2.0.4-rc.2（续发候选）
  $SCRIPT --patch         # 版本线 2.0.4 → stable 2.0.4（候选转正）
  $SCRIPT --minor         # 开新版本线 2.1.0（根 + 依赖包镜像同步）
  $SCRIPT --dry-run       # 预览
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --dry-run) DRY_RUN=true; shift ;;
    --no-push) NO_PUSH=true; shift ;;
    --no-watch) NO_WATCH=true; shift ;;
    --no-cleanup) NO_CLEANUP="true"; shift ;;
    --patch) AUTO_BUMP="stable"; shift ;;
    --minor) AUTO_BUMP="minor"; shift ;;
    --major) AUTO_BUMP="major"; shift ;;
    --rc) AUTO_BUMP="rc"; shift ;;
    --channel|--beta) die "CLI 只支持 --patch/--minor/--major/--rc；beta 渠道属于 Desktop" ;;
    -*) die "未知选项: $1" ;;
    *)
      [ -z "$VERSION" ] || die "重复的版本参数: ${VERSION} 与 $1"
      VERSION="$1"
      shift
      ;;
  esac
done

[ -n "$AUTO_BUMP" ] || AUTO_BUMP="stable"

SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$REPO_ROOT/scripts/lib/release.sh"
run_release

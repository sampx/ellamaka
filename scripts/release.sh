#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"

die() {
  printf '错误: %b\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
$SCRIPT — 发布一个 CLI 或 Desktop 版本

用法:
  $SCRIPT <cli|desktop> [version] [选项]

选项:
  --channel <beta|prod>   Desktop 渠道（默认 prod；cli 固定 stable）
  --dry-run               只检查并打印发布计划，不创建 tag、不 dispatch
  --no-cleanup            发布成功后跳过历史清理 workflow（默认自动触发）
  -h, --help              显示本帮助

版本省略时读取 package.json 当前版本（版本源唯一，见 docs/DISTRIBUTION.md
§3.2）；显式版本必须与 package.json 一致（防止 bump 漏提交）。版本准备由
scripts/bump-release.sh 完成，本脚本只读取版本、创建 tag 并 dispatch。

分支渠道约束（branch-channel policy）：
  main 分支可发布全部版本；非 main 分支（poc-* 等）只允许 prerelease ——
  CLI X.Y.Z-rc.N、Desktop X.Y.Z-beta.N，且 prerelease base 必须高于该产品
  已发布 prod/stable 的最高版本。

示例:
  $SCRIPT cli                    # 版本来自 package.json
  $SCRIPT cli 2.0.4-rc.1         # 显式版本（须与 package.json 一致）
  $SCRIPT desktop --channel beta # beta 渠道
  $SCRIPT cli --dry-run          # 只打印计划
EOF
  exit 0
}

# ── 参数解析 ──────────────────────────────────────────────

SUBCOMMAND=""
CHANNEL="prod"
CHANNEL_SET=false
DRY_RUN=false
NO_CLEANUP=""
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --dry-run) DRY_RUN=true; shift ;;
    --no-cleanup) NO_CLEANUP="true"; shift ;;
    --channel)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        die "--channel 需要 beta 或 prod"
      fi
      CHANNEL="$2"
      CHANNEL_SET=true
      shift 2
      ;;
    cli|desktop)
      [ -n "$SUBCOMMAND" ] && die "重复的子命令: $1（已指定 ${SUBCOMMAND}）"
      SUBCOMMAND="$1"
      shift
      ;;
    -*) die "未知选项: $1" ;;
    *)
      [ -n "$VERSION" ] && die "重复的版本参数: ${VERSION} 与 $1"
      VERSION="$1"
      shift
      ;;
  esac
done

if [ -z "$SUBCOMMAND" ]; then
  die "缺少子命令（cli 或 desktop）\n试试: $SCRIPT --help"
fi

# ── 产品上下文 ────────────────────────────────────────────

# DSH runtime manifest 新鲜度门禁在 CI 的真实 build job 中执行
# （publish-ellamaka-{cli,desktop}.yml 的 `--check` 前置步骤）；本脚本仅
# dispatch，不负责生成/校验 manifest。

SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WITHDRAWN_FILE="$REPO_ROOT/release/withdrawn-versions.json"
LEGACY_INVENTORY_FILE="$REPO_ROOT/release/legacy-inventory.json"

source "$REPO_ROOT/scripts/lib/version.sh"

if [ "$SUBCOMMAND" = "cli" ]; then
  if $CHANNEL_SET; then
    die "--channel 仅用于 desktop；cli 固定 stable 渠道（rc 候选同流发布）"
  fi
  PRODUCT="ellamaka-cli"
  LABEL="CLI"
  WORKFLOW="publish-ellamaka-cli.yml"
  CHANNEL="stable"
else
  PRODUCT="ellamaka-desktop"
  LABEL="Desktop"
  WORKFLOW="publish-ellamaka-desktop.yml"
  case "$CHANNEL" in
    beta|prod) ;;
    *) die "无效 Desktop channel: $CHANNEL (只支持 beta 或 prod)" ;;
  esac
fi

# ── 版本校验 ──────────────────────────────────────────────

validate_semver() {
  local v="$1"
  if [ "$SUBCOMMAND" = "cli" ]; then
    if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]]; then
      return 0
    fi
    die "CLI 版本号格式无效: $v (期望 X.Y.Z 或 X.Y.Z-rc.N)"
  fi
  if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  elif [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]; then
    return 0
  fi
  die "Desktop 版本号格式无效: $v (期望 X.Y.Z 或 X.Y.Z-beta.N)"
}

check_withdrawn() {
  local version="$1"
  [ -f "$WITHDRAWN_FILE" ] || return 0
  local listed
  listed=$(node -e "
const w = JSON.parse(require('fs').readFileSync('$WITHDRAWN_FILE', 'utf8'));
const arr = (w.products && w.products['$PRODUCT']) || [];
process.stdout.write(arr.includes('$version') ? 'yes' : 'no');
" 2>/dev/null || echo "no")
  if [ "$listed" = "yes" ]; then
    die "版本 $version 已列入 withdrawn-versions.json，永久不得复用"
  fi
}

check_migration_floor() {
  local version="$1"
  [ -f "$LEGACY_INVENTORY_FILE" ] || die "legacy-inventory.json 缺失；必须先用 packages/ellamaka-release/src/cli/inventory.ts 真实盘点并冻结后才能发布"
  node -e "
const inv = JSON.parse(require('fs').readFileSync('$LEGACY_INVENTORY_FILE', 'utf8'));
if (inv.source !== 'live') {
  console.error('legacy-inventory.json source=' + (inv.source || 'undefined') + ' 不是 live；fixture/dry-run inventory 不得用于真实发布门禁');
  process.exit(2);
}
const entries = inv.products && inv.products['$PRODUCT'];
if (!entries) process.exit(0);
// Numeric tuple comparison — lexicographic string comparison of dotted
// version strings misorders components of different widths.
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; if (d) return d; } return 0; };
let highest = null;
for (const t of (entries.tags || [])) {
  const m = t.name.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)-(\d+)/);
  if (!m) continue;
  const key = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (!highest || cmp(key, highest) > 0) highest = key;
}
if (!highest) process.exit(0);
const floor = [highest[0], highest[1], highest[2]];
const v = '$version'.split(/[.-]/).map(Number);
const vkey = [v[0], v[1], v[2]];
if (cmp(vkey, floor) < 0) {
  console.error('版本 ' + '$version' + ' 低于 migration floor ' + floor.join('.'));
  process.exit(1);
}
" || {
  local rc=$?
  if [ $rc -eq 2 ]; then
    die "legacy-inventory.json 不是 live capture；不得用 fixture/dry-run inventory 门禁真实发布"
  fi
  die "版本 $version 低于 migration floor（见 $LEGACY_INVENTORY_FILE）"
}
}

# ── Failed-attempt 判定（§7.1 manifest-last 协议）──────────

manifest_url() {
  if [ "$PRODUCT" = "ellamaka-cli" ]; then
    echo "https://download.coursedao.com/ellamaka/v${1}/manifest.json"
  elif [ "$CHANNEL" = "beta" ]; then
    echo "https://download.coursedao.com/ellamaka-desktop/beta/v${1}/manifest.json"
  else
    echo "https://download.coursedao.com/ellamaka-desktop/v${1}/manifest.json"
  fi
}

has_effective_manifest() {
  command -v curl >/dev/null 2>&1 || die "curl 不可用，无法判定远端 tag 是否为 failed attempt"
  local url code
  url="$(manifest_url "$1")"
  code=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 15 "$url" 2>/dev/null || echo "000")
  [ "$code" = "200" ]
}

# ensure_tag_releasable <tag> <version>
#   tag 不存在 → 放行；tag 有 manifest → 拒绝（不可变）；tag 无 manifest
#   （failed attempt）→ 确认后移动远端 tag 到当前 HEAD 重发。
ensure_tag_releasable() {
  local tag="$1" version="$2"
  if ! git -C "$REPO_ROOT" ls-remote --tags origin "$tag" 2>/dev/null | grep -q "refs/tags/${tag}$"; then
    return 0
  fi
  if has_effective_manifest "$version"; then
    die "tag $tag 已存在且已发布有效 manifest —— 已提交 release 不可移动。请使用更高版本号。"
  fi
  if $DRY_RUN; then
    echo "⚠️  tag $tag 存在但无 manifest（failed attempt）——正式执行时将移动远端 tag 重发"
    return 0
  fi
  read -r -p "  tag $tag 无有效 manifest（failed attempt）。移动远端 tag 到当前 HEAD 并重发？ [y/N] " answer || true
  case "$answer" in
    y|Y|yes|YES) ;;
    *) die "已取消（可手动清理：git push origin --delete $tag，或换其他版本号）" ;;
  esac
  git -C "$REPO_ROOT" push origin --delete "$tag" || die "删除远端 tag 失败: $tag"
  echo "  ✓ 已删除远端 failed-attempt tag: $tag"
}

# ── 发布前置检查 ──────────────────────────────────────────

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
  if [ "$dirty" -eq 0 ]; then
    return 0
  fi
  if $DRY_RUN; then
    echo "⚠️  dry-run 仅提示：未提交变更不会进入发布。"
    return 0
  fi
  read -r -p "工作区不干净，未提交变更不会进入本次 release。继续发布？ [y/N] " answer || true
  case "$answer" in
    y|Y|yes|YES) echo "  继续发布..." ;;
    *) die "已取消" ;;
  esac
}

check_remote_branch() {
  local branch remote_branch unpushed
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
  git -C "$REPO_ROOT" fetch origin "$branch" 2>/dev/null || true
  remote_branch=$(git -C "$REPO_ROOT" rev-parse "origin/$branch" 2>/dev/null || echo "")
  if [ -z "$remote_branch" ]; then
    die "origin/$branch 不存在，请先 git push origin $branch"
  fi
  unpushed=$(git -C "$REPO_ROOT" rev-list --count HEAD "^origin/$branch" 2>/dev/null)
  if [ "$unpushed" -gt 0 ]; then
    echo "local $branch 有 $unpushed 个 commit 未推送至 origin/$branch:"
    git -C "$REPO_ROOT" log --oneline "origin/$branch..HEAD"
    die "请先 git push origin $branch"
  fi
}

# check_branch_channel_policy <version>
#
# Branch-channel policy (docs/DISTRIBUTION.md §4.1): non-main branches may
# only release prereleases (CLI -rc.N, Desktop -beta.N), and the prerelease
# base must be strictly above the highest released prod/stable version of
# the product.
check_branch_channel_policy() {
  local version="$1" branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
  [ "$branch" = "main" ] && return 0

  local is_prerelease=false
  if [ "$SUBCOMMAND" = "cli" ]; then
    [[ "$version" =~ -rc\.[0-9]+$ ]] && is_prerelease=true
  else
    [[ "$version" =~ -beta\.[0-9]+$ ]] && is_prerelease=true
  fi
  if ! $is_prerelease; then
    die "分支 $branch 不是 main：只允许发布 prerelease（CLI X.Y.Z-rc.N / Desktop X.Y.Z-beta.N），禁止裸 X.Y.Z"
  fi

  local base highest_stable
  base="${version%%-*}"
  highest_stable=$(highest_release_tag "$PRODUCT" "stable" "$REPO_ROOT")
  if [ -n "$highest_stable" ]; then
    node -e "
      const cmp = (a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
        return 0
      }
      process.exit(cmp(process.argv[1], process.argv[2]) > 0 ? 0 : 1)
    " "$base" "$highest_stable" || die "prerelease base $base 必须高于已发布 stable 最高版本 $highest_stable"
  fi
}

# check_version_matches_package <version>
#
# The package.json version is the single version source (docs/DISTRIBUTION.md
# §3.2). The release version must equal it — a mismatch means the bump was
# not committed.
check_version_matches_package() {
  local version="$1" pkg_version
  pkg_version=$(current_version "$REPO_ROOT")
  [ "$version" = "$pkg_version" ] || die "版本 $version 与 package.json 版本 $pkg_version 不一致；请先运行 scripts/bump-release.sh 完成版本准备并提交"
}

check_min_wopal_cli_released() {
  local req_ver="${MIN_WOPAL_CLI_VERSION:-}"
  if [ -z "$req_ver" ]; then
    return 0
  fi
  echo "→ 检查 minWopalCli (v${req_ver}) 是否已在 wopal-cli 仓库发布..."
  local tag_found=""
  if git ls-remote --tags "https://github.com/wopal-cn/wopal-cli.git" "refs/tags/v${req_ver}" 2>/dev/null | grep -q "refs/tags/v${req_ver}$"; then
    tag_found="yes"
  elif command -v gh &>/dev/null && gh release view "v${req_ver}" -R wopal-cn/wopal-cli &>/dev/null; then
    tag_found="yes"
  fi
  [ "$tag_found" = "yes" ] || die "终止发布: .ci/versions.json 要求的 minWopalCli (v${req_ver}) 尚未在 wopal-cli 仓库发布！"
  echo "  ✓ 已确认 wopal-cli v${req_ver} 存在于远端"
}

# Release must not mutate the workspace: the dependency floor sync happens
# during dev builds (build.sh / dev.sh). Here we only verify the committed
# dep floor already covers the config floor.
check_dep_floor_synced() {
  local dep_floor="" config_floor=""
  dep_floor=$(node -e "
    const pkg = require('$REPO_ROOT/packages/opencode/package.json')
    const range = pkg.dependencies && pkg.dependencies['@wopal/cli-capability-schema']
    if (!range) { console.log(''); process.exit(0) }
    const m = String(range).match(/(\d+)\.(\d+)\.(\d+)/)
    console.log(m ? m[1] + '.' + m[2] + '.' + m[3] : '')
  " 2>/dev/null || true)
  config_floor=$(node -e "
    const v = require('$REPO_ROOT/.ci/versions.json')
    console.log(typeof v.minWopalCli === 'string' ? v.minWopalCli : '')
  " 2>/dev/null || true)
  [ -n "$dep_floor" ] && [ -n "$config_floor" ] || return 0
  node -e "
    const norm = (s) => { const m = String(s).match(/(\d+)\.(\d+)\.(\d+)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null }
    const na = norm(process.argv[1]), nb = norm(process.argv[2])
    if (!na || !nb) process.exit(0)
    const cmp = na[0]-nb[0] || na[1]-nb[1] || na[2]-nb[2]
    process.exit(cmp > 0 ? 1 : 0)
  " "$config_floor" "$dep_floor" || die "依赖下界未同步：@wopal/cli-capability-schema (^$dep_floor) 低于 .ci/versions.json minWopalCli ($config_floor)。请先运行 ./scripts/build.sh cli 或 dev.sh 完成同步并提交。"
}

# ── dispatch / 监控 ────────────────────────────────────────

dispatch_workflow() {
  local -a extra_args=(-f "version=$VERSION" -f "publish=true")
  [ "$SUBCOMMAND" = "desktop" ] && extra_args+=(-f "channel=$CHANNEL")
  local output
  echo "→ dispatch $WORKFLOW (ref=$TAG, version=$VERSION, publish=true)" >&2
  if ! output=$(gh workflow run "$WORKFLOW" -R wopal-cn/ellamaka --ref "$TAG" "${extra_args[@]}" 2>&1); then
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

poll_run() {
  # 判定完成以 jobs 为准：run 级 status/conclusion 在最后一个 job 完成后
  # 有短暂翻转延迟，若只看 run 字段会多等一轮造成"watch 不结束"的错觉。
  gh run view "$1" -R wopal-cn/ellamaka --json status,conclusion,jobs -q '
    . as $r | ($r.jobs // []) as $jobs |
    if $r.status == "completed" then
      "completed \($r.conclusion // "unknown")"
    elif ($jobs | length > 0) and all($jobs[]; .status == "completed") then
      if any($jobs[]; .conclusion == "failure") then "completed failure"
      elif any($jobs[]; .conclusion == "cancelled") then "completed cancelled"
      else "completed success" end
    else
      "\($r.status) \($r.conclusion // "")"
    end,
    ($jobs | map("       [\(.status)] \(.name): \(.conclusion // "running...")") | join("\n"))
  ' 2>/dev/null || echo "unknown"
}

# ── 主流程 ────────────────────────────────────────────────

echo "→ 检查工作区..."
check_workspace_clean

echo "→ 检查 remote 分支..."
check_remote_branch

if command -v jq >/dev/null 2>&1 && [ -f "$REPO_ROOT/.ci/versions.json" ]; then
  export MIN_WOPAL_CLI_VERSION=$(jq -r .minWopalCli "$REPO_ROOT/.ci/versions.json")
fi
check_min_wopal_cli_released
check_dep_floor_synced

# 版本解析：package.json 是唯一版本源；显式版本必须与之一致
if [ -z "$VERSION" ]; then
  VERSION="$(current_version "$REPO_ROOT")"
  echo "→ 版本来自 package.json: $VERSION"
fi

validate_semver "$VERSION"
if [ "$SUBCOMMAND" = "cli" ]; then
  :
elif [ "$CHANNEL" = "beta" ]; then
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]] || die "beta 渠道需要 -beta.N 版本，得到: $VERSION"
else
  if [[ "$VERSION" == *-beta.* ]]; then
    die "Desktop beta 版本必须指定 --channel beta"
  fi
fi
check_version_matches_package "$VERSION"
check_branch_channel_policy "$VERSION"
check_withdrawn "$VERSION"
check_migration_floor "$VERSION"

TAG="${PRODUCT}-v${VERSION}"
ensure_tag_releasable "$TAG" "$VERSION"
echo "  ℹ️  tag: $TAG (channel=${CHANNEL})"

if $DRY_RUN; then
  echo ""
  echo "── dry-run 发布计划 ──"
  echo "  product:  $PRODUCT"
  echo "  version:  $VERSION"
  echo "  channel:  $CHANNEL"
  echo "  tag:      $TAG (将打在 HEAD $(git -C "$REPO_ROOT" rev-parse --short HEAD))"
  echo "  workflow: $WORKFLOW (ref=$TAG, version=$VERSION, publish=true$([ "$SUBCOMMAND" = "desktop" ] && echo ", channel=$CHANNEL"))"
  [ "$NO_CLEANUP" = "true" ] || echo "  cleanup:  发布成功后自动触发历史清理"
  echo ""
  echo "dry-run：未创建 tag、未 push、未 dispatch。"
  exit 0
fi

HAVE_GH=false
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  HAVE_GH=true
fi

echo "→ 创建 tag: $TAG"
git -C "$REPO_ROOT" tag -d "$TAG" 2>/dev/null || true
git -C "$REPO_ROOT" tag -a "$TAG" -m "Release $TAG"

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "→ 推送 $BRANCH 和 tag"
git -C "$REPO_ROOT" push origin "$BRANCH" "$TAG"

if [ "$HAVE_GH" = false ]; then
  echo "ℹ️  gh CLI 不可用或未认证，跳过 dispatch + watch。tag 已推送，可手动触发 workflow。"
  exit 0
fi

if ! RUN_ID="$(dispatch_workflow)"; then
  die "无法确定本次 workflow run"
fi
echo "  run id: $RUN_ID"

echo "→ Watching run (Ctrl+C 中断)..."
POLL_INTERVAL=15
i=0
while true; do
  i=$((i + 1))
  FULL="$(poll_run "$RUN_ID")"
  STATUS="$(echo "$FULL" | head -n 1)"
  echo "  [#$i] $STATUS"
  echo "$FULL" | tail -n +2
  case "$STATUS" in
    "completed failure"|"completed cancelled")
      echo "⚠️  Workflow 失败或取消 (conclusion: ${STATUS#completed })"
      exit 1 ;;
    "completed success")
      break ;;
  esac
  sleep $POLL_INTERVAL
done

echo ""
echo "✅ Release complete"
echo "   GitHub Release: https://github.com/wopal-cn/ellamaka/releases/tag/${TAG}"
if [ "$SUBCOMMAND" = "cli" ]; then
  echo "   R2:             https://download.coursedao.com/ellamaka/v${VERSION}/"
else
  if [ "$CHANNEL" = "beta" ]; then
    echo "   R2:             https://download.coursedao.com/ellamaka-desktop/beta/v${VERSION}/"
  else
    echo "   R2:             https://download.coursedao.com/ellamaka-desktop/v${VERSION}/"
  fi
fi

# 发布成功后自动触发 retention 清理（--no-cleanup 跳过）
if [ "$HAVE_GH" = true ] && [ "$NO_CLEANUP" != "true" ]; then
  echo "→ 触发 cleanup workflow ($PRODUCT, retention apply)..."
  if [ "$SUBCOMMAND" = "cli" ]; then
    gh workflow run cleanup-releases.yml -R wopal-cn/ellamaka \
      -f mode=retention -f product=ellamaka-cli -f apply=true -f keep-stable=2 \
      || echo "⚠️  cleanup workflow 触发失败（可手动触发）"
  else
    gh workflow run cleanup-releases.yml -R wopal-cn/ellamaka \
      -f mode=retention -f product=ellamaka-desktop -f apply=true -f keep-stable=2 -f keep-beta=2 \
      || echo "⚠️  cleanup workflow 触发失败（可手动触发）"
  fi
fi

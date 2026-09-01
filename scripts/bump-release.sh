#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$REPO_ROOT/scripts/lib/version.sh"

WITHDRAWN_FILE="$REPO_ROOT/release/withdrawn-versions.json"
LEGACY_INVENTORY_FILE="$REPO_ROOT/release/legacy-inventory.json"

die() {
  printf '错误: %b\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
$SCRIPT — 一步发布：bump 版本 → 提交 → tag → push（tag 触发 workflow）→ watch

产品版本真相源 = 产品锚点包 package.json（docs/DISTRIBUTION.md §3.2）：
  CLI     → packages/ellamaka-cli/package.json      (X.Y.Z / X.Y.Z-rc.N)
  Desktop → packages/ellamaka-desktop/package.json  (X.Y.Z / X.Y.Z-beta.N)
CLI 发布时其余依赖包同步写入 prerelease base（纯 x.y.z 镜像，从不出 rc/beta）。

用法:
  $SCRIPT <cli|desktop> [选项] [--] [version]

Bump 类型:
  --patch      自增 patch（默认；丢弃 prerelease 后缀）
  --minor      自增 minor，patch 归零
  --major      自增 major，minor/patch 归零
  --rc         继续 CLI -rc.N 序列（同 base 时 N+1），否则下一 patch 的 -rc.1
  --beta       继续 Desktop -beta.N 序列（同 base 时 N+1），否则下一 patch 的 -beta.1

选项:
  --channel <beta|prod>  Desktop 渠道（默认 prod）；cli 固定 stable，不接受本选项
  --dry-run    只打印发布计划，不写入、不 tag、不 push、不 dispatch
  --no-push    bump 并提交 + 本地 tag，但不 push（留待人工检查）
  --no-watch   不 watch workflow 运行结果
  --no-cleanup 发布成功后跳过历史清理 workflow（默认自动触发）
  -h, --help   显示本帮助

分支渠道约束（branch-channel policy）：
  main 分支可发布全部版本；非 main 分支（poc-* 等）只允许 prerelease ——
  CLI X.Y.Z-rc.N、Desktop X.Y.Z-beta.N，且 prerelease base 必须高于该产品
  已发布 prod/stable 的最高版本。

re-release（幂等）：目标 tag 已在远端存在时——
  tag 有有效 R2 manifest → 拒绝（发布不可变），请用更高版本号；
  tag 无 manifest（failed attempt）→ 以该 tag 重新 dispatch workflow，不重复 bump。

示例:
  $SCRIPT cli --rc            # 2.0.3 → 2.0.4-rc.1（依赖包同步 2.0.4）
  $SCRIPT cli --rc            # 2.0.4-rc.1 → 2.0.4-rc.2（依赖包已在 base）
  $SCRIPT cli --patch         # 发 stable
  $SCRIPT desktop --channel beta --beta   # Desktop X.Y.Z-beta.N
  $SCRIPT cli --dry-run       # 预览
EOF
  exit 0
}

# ── 参数解析 ──────────────────────────────────────────────

SUBCOMMAND=""
AUTO_BUMP=""
CHANNEL="prod"
CHANNEL_SET=false
DRY_RUN=false
NO_PUSH=false
NO_WATCH=false
NO_CLEANUP=""
VERSION=""
REMOTE="origin"

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --dry-run) DRY_RUN=true; shift ;;
    --no-push) NO_PUSH=true; shift ;;
    --no-watch) NO_WATCH=true; shift ;;
    --no-cleanup) NO_CLEANUP="true"; shift ;;
    --patch) AUTO_BUMP="patch"; shift ;;
    --minor) AUTO_BUMP="minor"; shift ;;
    --major) AUTO_BUMP="major"; shift ;;
    --rc) AUTO_BUMP="rc"; shift ;;
    --beta) AUTO_BUMP="beta"; shift ;;
    --channel)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        die "--channel 需要 beta 或 prod"
      fi
      CHANNEL="$2"
      CHANNEL_SET=true
      shift 2
      ;;
    cli|desktop)
      [ -z "$SUBCOMMAND" ] || die "重复子命令: $1（已指定 ${SUBCOMMAND}）"
      SUBCOMMAND="$1"
      shift
      ;;
    -*) die "未知选项: $1" ;;
    *)
      [ -z "$VERSION" ] || die "重复的版本参数: ${VERSION} 与 $1"
      VERSION="$1"
      shift
      ;;
  esac
done

[ -n "$SUBCOMMAND" ] || die "缺少子命令（cli 或 desktop）\n试试: $SCRIPT --help"

# ── 产品上下文 ────────────────────────────────────────────

if [ "$SUBCOMMAND" = "cli" ]; then
  if $CHANNEL_SET; then
    die "--channel 仅用于 desktop；cli 固定 stable 渠道（rc 候选同流发布）"
  fi
  if [ "$AUTO_BUMP" = "beta" ]; then
    die "CLI 没有 beta 渠道；rc 候选请用 --rc"
  fi
  PRODUCT="ellamaka-cli"
  LABEL="CLI"
  WORKFLOW="publish-ellamaka-cli.yml"
  CHANNEL_LABEL="stable"
else
  if [ "$AUTO_BUMP" = "rc" ]; then
    die "Desktop 没有 rc 渠道；beta 候选请用 --beta"
  fi
  PRODUCT="ellamaka-desktop"
  LABEL="Desktop"
  WORKFLOW="publish-ellamaka-desktop.yml"
  CHANNEL_LABEL="$CHANNEL"
  case "$CHANNEL" in
    beta|prod) ;;
    *) die "无效 Desktop channel: $CHANNEL (只支持 beta 或 prod)" ;;
  esac
fi

# ── 版本计算 ─────────────────────────────────────────────

CURRENT="$(current_version "$SUBCOMMAND" "$REPO_ROOT")"

if [ -z "$VERSION" ]; then
  AUTO_BUMP="${AUTO_BUMP:-patch}"
  VERSION="$(bump_version "$SUBCOMMAND" "$AUTO_BUMP" "$REPO_ROOT")"
  echo "→ Auto-bump ($AUTO_BUMP): $CURRENT → $VERSION"
else
  echo "→ 显式版本: $CURRENT → $VERSION"
fi

# 注意：re-release 路径的版本与锚点相同是预期（首次尝试已 bump）。
# 相同性拦截放在 fresh 路径（re-release 分支之后）。
if [ "$SUBCOMMAND" = "cli" ]; then
  if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]]; then
    die "CLI 版本号格式无效: $VERSION (期望 X.Y.Z 或 X.Y.Z-rc.N)"
  fi
else
  if [[ "$CHANNEL" = "beta" ]]; then
    [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]] || die "beta 渠道需要 X.Y.Z-beta.N 版本，得到: $VERSION"
  else
    [[ "$VERSION" =~ -beta\.[0-9]+$ ]] && die "Desktop beta 版本必须指定 --channel beta"
    [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Desktop 版本号格式无效: $VERSION (期望 X.Y.Z 或 X.Y.Z-beta.N)"
  fi
fi

BASE="${VERSION%%-*}"
TAG="${PRODUCT}-v${VERSION}"

# ── 检查函数（沿用原 release.sh 语义）────────────────────

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
  [ "$dirty" -eq 0 ] || die "请先提交或暂存现有变更，再执行发布"
}

check_remote_branch() {
  local branch remote_branch unpushed
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
  git -C "$REPO_ROOT" fetch "$REMOTE" "$branch" 2>/dev/null || true
  remote_branch=$(git -C "$REPO_ROOT" rev-parse "$REMOTE/$branch" 2>/dev/null || echo "")
  if [ -z "$remote_branch" ]; then
    die "$REMOTE/$branch 不存在，请先 git push $REMOTE $branch"
  fi
  unpushed=$(git -C "$REPO_ROOT" rev-list --count HEAD "^$REMOTE/$branch" 2>/dev/null)
  if [ "$unpushed" -gt 0 ]; then
    echo "local $branch 有 $unpushed 个 commit 未推送至 $REMOTE/$branch:"
    git -C "$REPO_ROOT" log --oneline "$REMOTE/$branch..HEAD"
    die "请先 git push $REMOTE $branch"
  fi
}

check_branch_channel_policy() {
  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
  [ "$branch" = "main" ] && return 0

  local is_prerelease=false
  if [ "$SUBCOMMAND" = "cli" ]; then
    [[ "$VERSION" =~ -rc\.[0-9]+$ ]] && is_prerelease=true
  else
    [[ "$VERSION" =~ -beta\.[0-9]+$ ]] && is_prerelease=true
  fi
  if ! $is_prerelease; then
    die "分支 $branch 不是 main：只允许发布 prerelease（CLI X.Y.Z-rc.N / Desktop X.Y.Z-beta.N），禁止裸 X.Y.Z"
  fi

  local highest_stable
  highest_stable=$(highest_release_tag "$PRODUCT" "stable" "$REPO_ROOT")
  if [ -n "$highest_stable" ]; then
    node -e "
      const cmp = (a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
        return 0
      }
      process.exit(cmp(process.argv[1], process.argv[2]) > 0 ? 0 : 1)
    " "$BASE" "$highest_stable" || die "prerelease base $BASE 必须高于已发布 stable 最高版本 $highest_stable"
  fi
}

check_withdrawn() {
  [ -f "$WITHDRAWN_FILE" ] || return 0
  local listed
  listed=$(node -e "
const w = JSON.parse(require('fs').readFileSync('$WITHDRAWN_FILE', 'utf8'));
const arr = (w.products && w.products['$PRODUCT']) || [];
process.stdout.write(arr.includes('$VERSION') ? 'yes' : 'no');
" 2>/dev/null || echo "no")
  [ "$listed" != "yes" ] || die "版本 $VERSION 已列入 withdrawn-versions.json，永久不得复用"
}

check_migration_floor() {
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
const v = '$VERSION'.split(/[.-]/).map(Number);
const vkey = [v[0], v[1], v[2]];
if (cmp(vkey, floor) < 0) {
  console.error('版本 ' + '$VERSION' + ' 低于 migration floor ' + floor.join('.'));
  process.exit(1);
}
" || {
  local rc=$?
  if [ $rc -eq 2 ]; then
    die "legacy-inventory.json 不是 live capture；不得用 fixture/dry-run inventory 门禁真实发布"
  fi
  die "版本 $VERSION 低于 migration floor（见 ${LEGACY_INVENTORY_FILE}）"
}
}

manifest_url() {
  echo "https://download.coursedao.com/ellamaka/v${VERSION}/manifest.json"
}

has_effective_manifest() {
  command -v curl >/dev/null 2>&1 || die "curl 不可用，无法判定远端 tag 是否为 failed attempt"
  local url code
  url="$(manifest_url)"
  code=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 15 "$url" 2>/dev/null || echo "000")
  [ "$code" = "200" ]
}

check_min_wopal_cli_released() {
  local req_ver="${MIN_WOPAL_CLI_VERSION:-}"
  [ -n "$req_ver" ] || return 0
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

# ── dispatch / 监控 ───────────────────────────────────────

HAVE_GH=false
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  HAVE_GH=true
fi

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

watch_run() {
  local RUN_ID="$1" i=0
  echo "→ Watching run (Ctrl+C 中断)..."
  POLL_INTERVAL=15
  while true; do
    i=$((i + 1))
    FULL="$(poll_run "$RUN_ID")"
    STATUS="$(echo "$FULL" | head -n 1)"
    echo "  [#$i] $STATUS"
    echo "$FULL" | tail -n +2
    case "$STATUS" in
      "completed failure"|"completed cancelled")
        echo "⚠️  Workflow 失败或取消 (conclusion: ${STATUS#completed })"
        return 1 ;;
      "completed success")
        break ;;
    esac
    sleep $POLL_INTERVAL
  done
}

trigger_cleanup() {
  [ "$HAVE_GH" = true ] || return 0
  [ "$NO_CLEANUP" != "true" ] || return 0
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
}

# ── 主流程 ────────────────────────────────────────────────

echo "→ 检查工作区..."
check_workspace_clean

if command -v jq >/dev/null 2>&1 && [ -f "$REPO_ROOT/.ci/versions.json" ]; then
  export MIN_WOPAL_CLI_VERSION=$(jq -r .minWopalCli "$REPO_ROOT/.ci/versions.json")
fi
check_min_wopal_cli_released
check_dep_floor_synced
check_branch_channel_policy
check_withdrawn
check_migration_floor

# ── re-release 判定（幂等，与 wopal-cli 同构）──────────────
# 远端 tag 存在：manifest 有效 → 拒绝（不可变）；否则 failed attempt，
# 直接以该 tag 重新 dispatch。判定在 bump 之前，避免二次写入版本文件。
RE_RELEASE=false
if git ls-remote --tags "$REMOTE" "$TAG" 2>/dev/null | grep -q "refs/tags/${TAG}$"; then
  if has_effective_manifest; then
    die "版本 $VERSION 已发布（tag $TAG 存在且有有效 manifest）—— 已发布 release 不可变，请使用更高版本号。"
  fi
  echo "→ 远端 tag $TAG 存在但无 manifest（failed attempt），以该 tag 重新发布。"
  RE_RELEASE=true
fi

if $RE_RELEASE; then
  # 文件真相源：重发版本必须与锚点文件一致（bump 属于首次尝试的提交）
  ANCHOR_CURRENT="$(current_version "$SUBCOMMAND" "$REPO_ROOT")"
  [ "$ANCHOR_CURRENT" = "$VERSION" ] || die "重发版本 $VERSION 与锚点文件版本 $ANCHOR_CURRENT 不一致；首次尝试的 bump commit 不在此分支？"
  check_remote_branch
  if $DRY_RUN; then
    echo ""
    echo "── dry-run 重发计划 ──"
    echo "  product:  $PRODUCT"
    echo "  version:  $VERSION (tag 已存在，failed attempt)"
    echo "  channel:  $CHANNEL_LABEL"
    echo "  action:   workflow_dispatch (ref=$TAG)"
    exit 0
  fi
  if [ "$HAVE_GH" = false ]; then
    echo "ℹ️  gh CLI 不可用或未认证，跳过 dispatch + watch。"
    echo "    手动重发: gh workflow run $WORKFLOW -R wopal-cn/ellamaka --ref $TAG -f version=$VERSION -f publish=true$([ "$SUBCOMMAND" = "desktop" ] && echo " -f channel=$CHANNEL")"
    exit 0
  fi
  RUN_ID="$(dispatch_workflow)" || die "无法确定本次 workflow run"
  [ "$NO_WATCH" = "true" ] || watch_run "$RUN_ID"
  trigger_cleanup
  exit 0
fi

# fresh 路径：版本 == 锚点 → 跳过 bump（锚点已在前序 commit 各就位，
# 与 wopal-cli 同构：直接以当前 HEAD 打 tag 发布当前版本）。
SKIP_BUMP=false
[ "$VERSION" = "$CURRENT" ] && SKIP_BUMP=true

# ── dry-run 发布计划 ──────────────────────────────────────

if $DRY_RUN; then
  if $SKIP_BUMP; then
    VERSION_LINE="锚点已就位，跳过 bump"
  else
    VERSION_LINE="$CURRENT → $VERSION"
  fi
  echo ""
  echo "── dry-run 发布计划 ──"
  echo "  product:   $PRODUCT ($CHANNEL_LABEL)"
  echo "  version:   $VERSION_LINE"
  echo "  tag:       $TAG (打在 HEAD bump commit 上)"
  if $SKIP_BUMP; then
    echo "  写入:      无（锚点已就位）"
  else
    if [ "$SUBCOMMAND" = "cli" ]; then
      echo "  依赖包:     同步 base ${BASE}（根 + 全部 workspace 包，除两个产品锚点之外）"
    else
      echo "  依赖包:     不动（Desktop 版本线独立）"
    fi
    echo "  commit:    chore: bump $PRODUCT version to $VERSION"
  fi
  echo "  push:      $REMOTE 分支 + ${TAG}（tag 触发 ${WORKFLOW}）"
  echo "  watch:     $([ "$NO_WATCH" = "true" ] && echo 跳过 || echo 自动)"
  echo "  cleanup:   $([ "$NO_CLEANUP" = "true" ] && echo 跳过 || echo 自动触发)"
  exit 0
fi

# ── bump 写入（跳过 bump 时直接进入 tag/push）──────────────

if ! $SKIP_BUMP; then
echo "→ 写入产品锚点版本 $VERSION..."
node -e "
const fs = require('fs')
const path = require('path')
const root = process.argv[1]
const version = process.argv[2]
const base = process.argv[3]
const sub = process.argv[4]

const anchor = sub === 'cli' ? path.join(root, 'packages/ellamaka-cli/package.json')
  : path.join(root, 'packages/ellamaka-desktop/package.json')

const write = (p, v) => {
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (pkg.version === v) return false
  pkg.version = v
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
  return true
}

let changed = 0
if (write(anchor, version)) changed++

if (sub === 'cli') {
  // 依赖包镜像 CLI base：全部 workspace 包里除两个产品锚点外都写纯 base
  for (const d of fs.readdirSync(path.join(root, 'packages'))) {
    const p = path.join(root, 'packages', d, 'package.json')
    if (!fs.existsSync(p)) continue
    if (d === 'ellamaka-cli' || d === 'ellamaka-desktop') continue
    if (write(p, base)) changed++
  }
  const sdk = path.join(root, 'packages', 'sdk', 'js', 'package.json')
  if (fs.existsSync(sdk) && write(sdk, base)) changed++
  if (write(path.join(root, 'package.json'), base)) changed++
}
console.log('  bumped ' + changed + ' package.json files')
" "$REPO_ROOT" "$VERSION" "$BASE" "$SUBCOMMAND"

echo "→ 刷新 bun.lock..."
(cd "$REPO_ROOT" && bun install --lockfile-only 2>/dev/null) || die "bun install --lockfile-only 失败"

echo "→ 提交版本 bump"
git -C "$REPO_ROOT" add package.json packages/*/package.json packages/sdk/js/package.json bun.lock
git -C "$REPO_ROOT" commit -m "chore: bump $PRODUCT version to $VERSION"
else
echo "→ 锚点已是 ${VERSION}，跳过 bump 与提交（直接以当前 HEAD 打 tag）"
fi

# ── tag、push ─────────────────────────────────────────────

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "→ 创建 tag: $TAG"
git -C "$REPO_ROOT" tag -d "$TAG" 2>/dev/null || true
git -C "$REPO_ROOT" tag -a "$TAG" -m "Release $TAG"

if $NO_PUSH; then
  echo "ℹ️  已 bump、提交、创建本地 tag ${TAG}（--no-push，未推送）。"
  echo "    推送发布: git push $REMOTE $BRANCH $TAG"
  exit 0
fi

echo "→ 推送 $BRANCH 和 tag ${TAG}（tag push 触发 ${WORKFLOW}）"
git -C "$REPO_ROOT" push "$REMOTE" "$BRANCH" "$TAG"

# ── watch（tag push 已触发 workflow，按 commit 找 run）───

if [ "$NO_WATCH" = "true" ] || [ "$HAVE_GH" = false ]; then
  if [ "$HAVE_GH" = false ]; then
    echo "ℹ️  gh CLI 不可用或未认证，跳过 dispatch + watch。tag 已推送，workflow 应已触发。"
  fi
else
  COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  echo "→ 等待 workflow 启动..."
  RUN_ID=""
  for i in $(seq 1 12); do
    RUN_ID=$(gh run list -R wopal-cn/ellamaka --workflow "$WORKFLOW" --commit "$COMMIT" --status in_progress,queued --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
    [ -n "$RUN_ID" ] && break
    RUN_ID=$(gh run list -R wopal-cn/ellamaka --workflow "$WORKFLOW" --commit "$COMMIT" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
    [ -n "$RUN_ID" ] && break
    sleep 5
  done
  if [ -z "$RUN_ID" ]; then
    echo "⚠️  60s 内未找到 workflow run（可能需要手动检查 actions 页）。"
  else
    watch_run "$RUN_ID"
  fi
fi

trigger_cleanup

echo ""
echo "✅ Release complete"
echo "   GitHub Release: https://github.com/wopal-cn/ellamaka/releases/tag/${TAG}"
if [ "$SUBCOMMAND" = "cli" ]; then
  echo "   R2:             https://download.coursedao.com/ellamaka/v${VERSION}/"
else
  echo "   R2:             https://download.coursedao.com/ellamaka-desktop$([ "$CHANNEL" = "beta" ] && echo "/beta")/v${VERSION}/"
fi
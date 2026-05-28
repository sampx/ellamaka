# chore-ellamaka-merge-upstream-dev-v11428

## Metadata

- **Type**: chore
- **Target Project**: ellamaka
- **Created**: 2026-04-27
- **Status**: done

## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## Goal

Merge upstream opencode v1.14.28 changes into ellamaka while preserving fork-specific customizations.

## Technical Context

### 仓库状态

- **ellamaka main**: 已合并上游 v1.14.25 (merge-base `f2d4d816f`)
- **上游 sst/dev**: `61eabfc60` (v1.14.28+)
- **合并目标**: merge-base → `e578c442b` (v1.14.28 sync commit)
- **上游变更规模**: 91 commits, ~155 files, +7505/-3394 lines

### ellamaka Fork 定制功能

ellamaka 在上游基础上增加了以下定制（本次合并需全部保留）：

| # | 定制功能 | 文件 | 改动内容 |
|---|----------|------|----------|
| 1 | WOPAL_HOME 路径系统 | `packages/core/src/global.ts` | 整体替换路径逻辑，支持 `WOPAL_HOME` env + tilde 展开 |
| 2 | DISABLE_AGENTS_SKILLS Flag | `packages/core/src/flag/flag.ts` | 新增独立开关控制 `.agents` 目录技能 |
| 3 | WOPAL_SPACE Flag | `packages/core/src/flag/flag.ts` | 新增 wopal-space mode 开关 |
| 4 | .wopal/bin 检测 | `packages/opencode/src/installation/index.ts` | method() 检测 `.wopal/bin` 而非 `.opencode/bin` |
| 5 | ellamaka-main early-return | `packages/opencode/src/installation/index.ts` | latest() 和 upgrade() 对 ellamaka-main channel 提前返回 |
| 6 | wopal-space config injection | `packages/opencode/src/config/config.ts` + `wopal-space.ts` | wopal-workspace 自动检测和配置注入，early return 替代后续逻辑 |
| 7 | OPENCODE_LOG_LEVEL env | `packages/opencode/src/cli/cmd/tui/worker.ts` | Worker 进程继承主进程 log level |
| 8 | DISABLE_AGENTS_SKILLS 条件判断 | `packages/opencode/src/skill/index.ts` | skill 扫描时独立控制 .agents/.claude 目录 |
| 9 | .wopal 路径替换 | `packages/opencode/src/cli/cmd/uninstall.ts` | `.opencode` → `.wopal` 路径引用 |

### 上游 v1.14.25→v1.14.28 主要变更

| 变更类别 | 影响范围 | 说明 |
|----------|----------|------|
| **Installation 重构** | `installation/index.ts` | `result: Interface` 对象结构 + `makeRuntime` standalone exports + `NpmConfig.registry` |
| **Shell 配置** | `config.ts` | 新增 `shell` schema + `writableGlobal` 函数 |
| **HttpAPI bridge** | 40+ 文件 | session/workspace/PTY/TUI/MCP/sync 路由 |
| **Package 重构** | 多文件 | 模块移入 core 包、import 路径统一 |
| **Model 修复** | `provider/models.ts` | DeepSeek/GPT-5.5 修复 |
| **OpentUI 升级** | TUI 组件 | 0.1.104 → 0.1.105 |
| **其他** | 测试、文档、nix 等 | 大量测试文件更新 |

### 合并冲突分类（基于 `git merge-tree --write-tree` 验证）

#### 第一类：Content Conflict — 需手动解决（2 个文件）

| 文件 | 冲突原因 | 解决策略 |
|------|----------|----------|
| `bun.lock` | 双方都更新了依赖锁文件 | 接受上游版本 |
| `packages/opencode/src/installation/index.ts` | 上游重构为 `result: Interface` 结构，ellamaka 改了 `methodImpl`+`latestImpl`+`upgradeImpl` | 手动解决：基于上游新结构，移植 `.wopal/bin` 检测 + ellamaka-main early-return |

#### 第二类：Auto-merge — 无需手动干预（含 ellamaka 定制的文件）

| 文件 | ellamaka 定制 | 上游变更 | 为什么能 auto-merge |
|------|---------------|----------|---------------------|
| `packages/core/src/global.ts` | WOPAL_HOME 替换整个路径逻辑 | 0 行变更（v1.14.25→v1.14.28 未改） | ellamaka 是唯一改动方 |
| `packages/core/src/flag/flag.ts` | 新增 DISABLE_AGENTS_SKILLS + WOPAL_SPACE | 0 行变更 | ellamaka 是唯一改动方 |
| `packages/opencode/src/config/config.ts` | wopal-space injection（524-561 行） | shell schema（101 行）+ writableGlobal（324 行） | 改动行范围不重叠 |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | OPENCODE_LOG_LEVEL env | 0 行变更 | ellamaka 是唯一改动方 |
| `packages/opencode/src/skill/index.ts` | DISABLE_AGENTS_SKILLS 条件判断 | 0 行变更（`.agents` 在 v1.14.25 已采纳） | ellamaka 是唯一改动方 |
| `packages/opencode/src/cli/cmd/uninstall.ts` | `.opencode` → `.wopal` 路径 | import 路径重构 | 改动行范围不重叠 |

#### 第三类：Modify/Delete Conflict — 接受删除（71 个文件）

ellamaka fork 精简掉了上游 SaaS/Cloud 功能的文件，上游仍在维护这些文件。合并时直接接受 "删除" 状态。

涉及目录：`packages/web/`（多语言文档）、`packages/console/`（SaaS 控制台）、`packages/enterprise/`（企业功能）、`sdks/vscode/`、`infra/`、`nix/` 等。

#### 第四类：上游新增/无冲突变更 — 直接接受

上游新增的 HttpAPI bridge、NpmConfig、makeRuntime、provider 修复、TUI 组件更新等 300+ 文件变更，ellamaka 未修改这些文件，auto-merge 安全。

## In Scope

- Merge upstream v1.14.25→v1.14.28 (91 commits)
- 手动解决 1 个真正冲突文件：`installation/index.ts`
- 接受 71 个 modify/delete 冲突（保持删除）
- Build 和 typecheck 验证

## Out of Scope

- HttpAPI bridge features（ellamaka CLI/TUI 不使用 HTTP API）
- Desktop settings UI（ellamaka 无 desktop app）
- Zen coupons（cloud feature）
- Model pricing updates（无功能影响）

## Affected Files

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/opencode/src/installation/index.ts` | **手动解决** | 唯一真正冲突：移植 .wopal/bin + early-return 到 `result` 结构 |
| `bun.lock` | **接受上游** | 依赖锁文件 |
| 71 个 modify/delete 文件 | **接受删除** | ellamaka 精简的 SaaS/Cloud 文件 |
| 其余 ~330 个文件 | **自动合并** | 上游变更，ellamaka 未触碰 |

## Risks

### R1: installation/index.ts 结构重构（唯一真正风险）

**风险**: 上游重构为 `result: Interface` 对象 + `makeRuntime` standalone exports + `NpmConfig`，ellamaka 的 3 个定制（`.wopal/bin` 检测、latest early-return、upgrade early-return）需要从旧函数位置移植到新结构。

**策略**: 手动解决冲突
1. 接受上游 `result: Interface` 结构
2. 在 `result.method()` 开头改为检测 `.wopal/bin`
3. 在 `result.latest()` 开头插入 `ellamaka-main` early-return
4. 在 `result.upgrade()` 开头插入 `ellamaka-main` early-return
5. 接受上游新增的 `makeRuntime` exports + `NpmConfig`

**验证**: typecheck + build

## Implementation

### Task 1: Create worktree

- [x] Step 1: `cd projects/ellamaka && git worktree add .worktrees/ellamaka-merge-v11428 main`
- [x] Step 2: 验证 worktree clean + `git branch -r` 显示 sst remote

### Task 2: Execute merge

- [x] Step 1: `cd .worktrees/ellamaka-merge-v11428 && git merge sst/dev --no-commit`
- [x] Step 2: `git status` 确认冲突文件列表

**解决 content conflict**：

- [x] Step 3: `git checkout --theirs bun.lock`（接受上游）
- [x] Step 4: **`installation/index.ts` 手动解决**：
  - 查看三方对比：`git checkout --conflict=diff3 packages/opencode/src/installation/index.ts`
  - 接受上游 `result: Interface` 对象结构
  - 接受上游 `import { makeRuntime }` + `import { NpmConfig }`
  - 在 `result.method()` 开头：将 `.opencode/bin` 改为 `.wopal/bin`
  - 在 `result.latest()` 开头插入：
    ```typescript
    if (InstallationChannel === "ellamaka-main") {
      return InstallationVersion
    }
    ```
  - 在 `result.upgrade()` 开头插入：
    ```typescript
    if (InstallationChannel === "ellamaka-main") {
      return yield* new UpgradeFailedError({
        stderr: "ellamaka-main requires manual rebuild. Run: git pull && bun run script/build-darwin.ts",
      })
    }
    ```
  - 接受底部新增的 `makeRuntime` + standalone exports

**解决 modify/delete conflict**：

- [x] Step 5: 对所有 modify/delete 冲突文件执行 `git rm`（保持删除）

**验证 auto-merge 结果**：

- [x] Step 6: `git diff --cached -- packages/opencode/src/config/config.ts` — 确认 wopal-space injection 保留
- [x] Step 7: `git diff --cached -- packages/core/src/global.ts` — 确认 WOPAL_HOME 保留
- [x] Step 8: `git diff --cached -- packages/core/src/flag/flag.ts` — 确认 DISABLE_AGENTS_SKILLS + WOPAL_SPACE 保留
- [x] Step 9: `git diff --cached -- packages/opencode/src/skill/index.ts` — 确认条件判断保留
- [x] Step 10: `git diff --cached -- packages/opencode/src/cli/cmd/tui/worker.ts` — 确认 OPENCODE_LOG_LEVEL 保留
- [x] Step 11: `git diff --cached -- packages/opencode/src/cli/cmd/uninstall.ts` — 确认 .wopal 路径保留。若 auto-merge 失败，手动合并策略：接受上游 import/调用变更 + 保留 .wopal 替换

- [x] Step 12: `git add -u && git status` 确认无冲突

### Task 3: Build verification

- [x] Step 1: `cd packages/opencode && bun typecheck`
- [x] Step 2: `bun run script/build-darwin.ts`

## Test Plan

#### Regression Tests

##### Case R1: CLI startup after merge
- Goal: Verify merged CLI starts without crash
- Fixture: Built binary in worktree
- Execution:
  - [x] Step 1: Run `./ellamaka --version`
  - [x] Step 2: Verify version shows v1.14.28+
- Expected Evidence: Version string displayed, no error

##### Case R2: wopal-space config injection
- Goal: Verify ellamaka-specific wopal-space feature preserved
- Fixture: wopal-workspace with `.wopal/` directory
- Execution:
  - [x] Step 1: Run `./ellamaka --log-level info`
  - [x] Step 2: Check INFO log for "wopal-space" detection message
- Expected Evidence: INFO log shows wopal-space config mode enabled

## Acceptance Criteria

### Agent Verification

- [x] `bun typecheck` passes in packages/opencode
- [x] `bun run script/build-darwin.ts` succeeds
- [x] No merge conflicts remaining
- [x] git status clean
- [x] 8 customizations preserved (verified via git diff --cached)

### User Validation

#### Scenario 1: CLI runs correctly after merge
- Goal: Confirm merged CLI functions without error
- Precondition: Binary built in worktree
- User Actions:
  1. Run `./ellamaka` in test directory
  2. Verify startup succeeds, TUI appears
- Expected Result: CLI starts normally

#### Scenario 2: wopal-space feature preserved
- Goal: Confirm fork-specific wopal-space feature works
- Precondition: Running in wopal-workspace
- User Actions:
  1. Start ellamaka in wopal-workspace
  2. Check log for wopal-space detection
- Expected Result: INFO log confirms wopal-space config mode enabled

- [x] 用户已完成上述功能验证并确认结果符合预期

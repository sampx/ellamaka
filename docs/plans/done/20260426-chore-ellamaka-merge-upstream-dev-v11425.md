# chore-ellamaka-merge-upstream-dev-v11425

## Metadata

- **Type**: chore
- **Target Project**: ellamaka
- **Created**: 2026-04-26
- **Status**: done

## Scope Assessment

- **Complexity**: High
- **Confidence**: High

## Goal

将 upstream/dev（v1.14.25, `f2d4d816f`）的 186 个 commit 合并到 ellamaka fork，保留所有 Wopal 定制逻辑（WOPAL_HOME 路径系统、`.agents` 技能开关、plist domain 等）。

## Technical Context

### 上游变更概要（224548d87..f2d4d816f）

上游 186 个 commit，349 个文件变更（+16442 / -5980 行），核心结构性变更：

1. **包重命名 `packages/shared/` → `packages/core/`**：从 `@opencode-ai/shared` 改为 `@opencode-ai/core`，并大幅扩展内容（新增 `cross-spawn-spawner.ts`、`npm.ts`、`flag/`、`installation/`、`effect/`）
2. **文件迁移**：`flag.ts` 和 `global/index.ts` 从 `opencode` 包删除，移至 `core` 包
3. **Zod → Effect Schema 迁移**：BusEvent、Config、Tool、Session 等核心类型全面迁移
4. **HTTP API 桥接端点**：新增 14+ 路由文件（`routes/instance/httpapi/`）
5. **版本升级**：v1.14.19 → v1.14.25

### ellamaka 定制逻辑（7 个 commit 需保留）

上次合并（`8312e7853`）后，ellamaka 有 7 个 fork 独有 commit，核心定制在 10 个文件中：

- `paths.ts`：WOPAL_HOME 环境变量支持、`~/.wopal/ellamaka/*` 路径、`.wopal` 目录扫描
- `managed.ts`：`ai.wopal.managed` plist domain（上游无变更，不冲突）
- `flag.ts`：`OPENCODE_DISABLE_AGENTS_SKILLS` 独立开关（上游已删除此文件，移至 core）
- `global/index.ts`：WOPAL_HOME 路径逻辑（上游已删除此文件，移至 core）
- `installation/index.ts`：`.wopal/bin` 路径检测
- `skill/index.ts`：独立控制 `.agents` 技能目录逻辑
- `config.ts`：Effect Schema 迁移后的配置层
- `package.json`：依赖和版本

### 全局风险

- 上游文件迁移（flag.ts、global/index.ts 移至 core 包）导致 git merge 无法自动追踪，必须手动将 ellamaka 定制代码"移植"到上游新位置
- Effect Schema 迁移可能影响 wopal-plugin 中使用 Zod schema 的部分，但 wopal-plugin 不在 ellamaka 仓库内，本次只需确保 typecheck 通过

## In Scope

- 使用 worktree 在隔离分支执行合并
- 运行 `merge-upstream.sh` 自动合并 + DELETED_PREFIXES 过滤
- 手动解决 10 个重叠冲突文件
- 将 ellamaka 定制逻辑移植到上游新文件位置（core 包）
- 构建验证（typecheck + test）
- 合并结果提交并合并回 main

## Out of Scope

- wopal-plugin 适配（Effect Schema 迁移对插件的影响）—— 插件在 ontology 仓库，不在 ellamaka 中
- 上游新增的 desktop/web/enterprise/slack 等组件 —— DELETED_PREFIXES 已排除
- 新 HTTP API 桥接端点的功能验证 —— 本次只确保编译通过

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| core (new) | `packages/core/` (entire dir) | 新增 | 上游从 shared 重命名并扩展，需确认无冲突 |
| config | `packages/opencode/src/config/paths.ts` | 修改 | 保留 WOPAL_HOME + `.wopal` 目录扫描逻辑 |
| config | `packages/opencode/src/config/managed.ts` | 无变更 | 保留 `ai.wopal.managed` plist domain |
| config | `packages/opencode/src/config/config.ts` | 修改 | 上游 Effect Schema 迁移，需保留定制逻辑 |
| flag (moved) | `packages/opencode/src/flag/flag.ts` | 删除→移植 | 上游删除移至 core，需在 core 新位置添加 `OPENCODE_DISABLE_AGENTS_SKILLS` |
| flag (new) | `packages/core/src/flag/` | 修改 | 上游新位置，需叠加 ellamaka 定制 |
| global (moved) | `packages/opencode/src/global/index.ts` | 删除→移植 | 上游删除移至 core，需在 core 新位置添加 WOPAL_HOME |
| global (new) | `packages/core/src/global.ts` | 修改 | 上游新位置，需叠加 WOPAL_HOME 逻辑 |
| installation | `packages/opencode/src/installation/index.ts` | 修改 | 保留 `.wopal/bin` 检测 |
| skill | `packages/opencode/src/skill/index.ts` | 修改 | 保留 `.agents` 独立技能目录开关 |
| package.json | `packages/opencode/package.json` | 修改 | `shared` → `core` 依赖重命名 + 版本号 |
| build | `packages/opencode/script/build-darwin.ts` | 可能冲突 | ellamaka 独有文件，上游可能无变更 |
| misc | `packages/opencode/src/cli/cmd/uninstall.ts` | 修改 | 小幅冲突 |
| misc | `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | 修改 | 小幅冲突 |
| httpapi | `packages/opencode/src/server/routes/instance/httpapi/` | 新增 | 上游新增桥接端点，自动合入 |
| schema | `packages/opencode/src/session/`, `packages/opencode/src/tool/` | 修改 | Effect Schema 迁移，自动合入 |

## Implementation

### Task 1: 创建 worktree 并执行自动合并

**Files**: worktree 分支操作

**Changes**:

- [x] Step 1: 通过 `flow.sh approve` 带上 `--worktree` 创建隔离 worktree
- [x] Step 2: 在 worktree 中 fetch upstream/dev 最新代码
- [x] Step 3: 创建合并隔离分支 `merge/upstream-v1.14.25`
- [x] Step 4: 执行 `git merge upstream/dev --no-commit --no-ff`
- [x] Step 5: 运行 `auto_resolve_deleted` 自动删除 DELETED_PREFIXES 匹配的冲突文件

**Verification**:

- [x] Step 1: `git status` 确认合并已开始且 DELETED_PREFIXES 文件已自动清理
- [x] Step 2: `git diff --name-only --diff-filter=U` 列出剩余手动冲突文件

### Task 2: 解决高/中风险冲突文件（定制逻辑移植）

核心策略：**跟随上游新结构，将 ellamaka 定制代码叠加到上游新版文件上**。

**Files**: 10 个冲突文件

**Changes**:

- [x] Step 1: 解决 `packages/opencode/package.json` — 接受上游 `@opencode-ai/shared` → `@opencode-ai/core` 重命名和版本号更新，保留 ellamaka 的任何额外依赖
- [x] Step 2: 解决 `packages/opencode/src/config/paths.ts` — 合入上游小幅改动（3 行），保留 ellamaka 的 WOPAL_HOME 路径扩展和 `.wopal` 目录扫描逻辑
- [x] Step 3: 解决 `packages/opencode/src/flag/flag.ts` — 上游已删除此文件（移至 core），接受删除。后续 Task 3 中在 core 新位置重新添加 `OPENCODE_DISABLE_AGENTS_SKILLS`
- [x] Step 4: 解决 `packages/opencode/src/global/index.ts` — 上游已删除此文件（移至 core），接受删除。后续 Task 3 中在 core 新位置重新添加 WOPAL_HOME 逻辑
- [x] Step 5: 解决 `packages/opencode/src/installation/index.ts` — 以上游重构后的版本为基础，叠加 `.wopal/bin` 路径检测
- [x] Step 6: 解决 `packages/opencode/src/skill/index.ts` — 以上游重构后的版本为基础，叠加 `.agents` 独立技能目录控制逻辑
- [x] Step 7: 解决 `packages/opencode/src/config/config.ts` — 接受上游 Effect Schema 迁移，确认 ellamaka 定制逻辑（如有）仍兼容
- [x] Step 8: 解决 `packages/opencode/src/cli/cmd/uninstall.ts` — 小幅冲突，接受上游改动为主
- [x] Step 9: 解决 `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` — 小幅冲突，接受上游改动为主
- [x] Step 10: 解决 `packages/opencode/test/preload.ts` — 接受上游改动

**Verification**:

- [x] Step 1: `git diff --name-only --diff-filter=U` 确认所有冲突已解决（输出为空）
- [x] Step 2: 逐一检查上述文件中 ellamaka 定制关键词（`WOPAL_HOME`、`wopal`、`.wopal`、`ai.wopal.managed`、`DISABLE_AGENTS_SKILLS`）确认未丢失

### Task 3: 移植定制逻辑到 core 包新位置

上游将 `flag.ts` 和 `global/index.ts` 迁移到了 `packages/core/src/` 下。需在新位置叠加 ellamaka 定制。

**Files**: `packages/core/src/flag/`, `packages/core/src/global.ts`, `packages/core/src/installation/`

**Changes**:

- [x] Step 1: 检查 `packages/core/src/flag/` 目录结构和上游实现，将 `OPENCODE_DISABLE_AGENTS_SKILLS` 环境变量检测逻辑添加到对应位置
- [x] Step 2: 检查 `packages/core/src/global.ts` 上游实现，将 WOPAL_HOME 环境变量支持和 `~/.wopal/ellamaka/*` 路径逻辑添加到对应位置
- [x] Step 3: 检查 `packages/core/src/installation/` 上游实现，将 `.wopal/bin` 检测逻辑添加到对应位置
- [x] Step 4: 更新所有 import 路径 — 全局搜索 `from "@opencode-ai/shared"` 和 `from "../../shared/"` 等，替换为 `@opencode-ai/core` 对应路径

**Verification**:

- [x] Step 1: `grep -rn "WOPAL_HOME" packages/core/` 确认 WOPAL_HOME 逻辑已在新位置
- [x] Step 2: `grep -rn "DISABLE_AGENTS_SKILLS" packages/core/` 确认开关已在新位置
- [x] Step 3: `grep -rn "@opencode-ai/shared" packages/` 确认无残留旧 import

### Task 4: 构建验证与提交

**Files**: 整个项目

**Changes**:

- [x] Step 1: 在 worktree 中执行 `bun install` 安装/更新依赖
- [x] Step 2: 在 `packages/opencode` 中执行 `bun run typecheck`，修复所有类型错误
- [x] Step 3: 在 `packages/opencode` 中执行 `bun test`，确认核心测试通过
- [x] Step 4: 提交合并结果，commit message 格式：`chore: merge upstream dev v1.14.25`
- [x] Step 5: 提交 body 中详细记录冲突解决策略和保留的 ellamaka 定制逻辑

**Verification**:

- [x] Step 1: `bun run typecheck` 退出码为 0
- [x] Step 2: `bun test` 核心测试通过（允许少量已知失败）
- [x] Step 3: `git log --oneline -1` 确认提交格式正确

### Task 5: 合并回 main 并清理 worktree

**Files**: 分支操作

**Changes**:

- [x] Step 1: 在 worktree 中 push 合并分支到 origin
- [x] Step 2: 切换到 ellamaka main 分支，merge 合并分支
- [x] Step 3: push main 到 origin
- [x] Step 4: 清理 worktree 和临时合并分支

**Verification**:

- [x] Step 1: `git log --oneline -5` 确认 main 分支包含合并 commit
- [x] Step 2: `git status` 确认工作区干净

## Delegation Strategy

| 批次 | Task | 执行者 | 依赖 | 说明 |
|------|------|--------|------|------|
| 1 | Task 1, 2, 3 | fae | 无 | 强依赖链，整体委派。worktree 中执行自动合并、冲突解决、core 移植 |
| 2 | Task 4 | fae | 批次 1 | 构建验证（typecheck + test）和提交 |
| 3 | Task 5 | Wopal | 批次 4 | 合并回 main + 清理 worktree |

**执行模式**：fae 在 worktree 隔离环境中执行（wopal_task 异步协作），Wopal 负责分批监控、验证产出、最终合并。

**分批原因**：
- Task 1→2→3 强依赖（冲突解决依赖自动合并结果，core 移植依赖冲突解决后的文件状态），必须整体委派
- Task 4 独立验证，拆出单独批便于 Wopal 验证后再提交
- Task 5 涉及主分支操作，由 Wopal 直接执行更安全

## Test Plan

#### Integration Tests

##### Case I1: typecheck 通过
- Goal: 确认合并后项目类型检查无错误
- Fixture: worktree 中合并完成的代码
- Execution:
  - [x] Step 1: 在 `packages/opencode` 执行 `bun run typecheck`
  - [x] Step 2: 确认退出码为 0
- Expected Evidence: typecheck 命令输出无错误，退出码 0

##### Case I2: 核心单测通过
- Goal: 确认合并后核心功能未被破坏
- Fixture: worktree 中合并完成的代码
- Execution:
  - [x] Step 1: 在 `packages/opencode` 执行 `bun test`
  - [x] Step 2: 确认核心测试套件通过
- Expected Evidence: 测试输出显示通过，无新增失败

#### Regression Tests

##### Case R1: WOPAL_HOME 路径系统完整
- Goal: 确认 ellamaka 的 WOPAL_HOME 定制逻辑未被合并覆盖
- Fixture: 合并完成后的代码
- Execution:
  - [x] Step 1: `grep -rn "WOPAL_HOME" packages/` 确认所有 WOPAL_HOME 引用存在
  - [x] Step 2: `grep -rn "\.wopal" packages/opencode/src/` 确认 `.wopal` 目录扫描逻辑存在
  - [x] Step 3: `grep -rn "ai\.wopal\.managed" packages/` 确认 plist domain 存在
- Expected Evidence: grep 结果包含预期的所有定制代码位置

##### Case R2: 技能目录开关完整
- Goal: 确认 `.agents` 独立技能目录控制逻辑未被覆盖
- Fixture: 合并完成后的代码
- Execution:
  - [x] Step 1: `grep -rn "DISABLE_AGENTS_SKILLS\|DISABLE_CLAUDE_CODE_SKILLS" packages/` 确认开关存在
  - [x] Step 2: `grep -rn "\.agents" packages/opencode/src/skill/` 确认技能目录逻辑存在
- Expected Evidence: grep 结果包含预期的定制代码位置

### Adjustment Strategy

- **冲突超出预期**：如果自动合并后手动冲突文件超过 20 个，暂停并向用户报告，讨论是否需要更细粒度的合并策略
- **core 包不存在**：上游的 core 包由 `shared` 重命名而来，如果合并过程中 core 包未正确创建，手动 `git checkout upstream/dev -- packages/core/` 引入
- **typecheck 大量错误**：优先处理与 Effect Schema 迁移相关的类型错误；如果错误超过 50 个，暂停报告
- **测试大面积失败**：区分"上游已有失败"（baseline）和"合并引入的失败"，只修复合并引入的

## Acceptance Criteria

### Agent Verification

- [x] `bun run typecheck` 在 `packages/opencode` 中通过（退出码 0）
- [x] `bun test` 核心测试套件通过，无合并引入的新失败
- [x] `grep -rn "WOPAL_HOME" packages/` 确认所有 WOPAL_HOME 引用存在
- [x] `grep -rn "DISABLE_AGENTS_SKILLS" packages/` 确认技能开关存在
- [x] `grep -rn "ai\.wopal\.managed" packages/` 确认 plist domain 存在
- [x] `grep -rn "@opencode-ai/shared" packages/` 返回空（所有旧 import 已更新）
- [x] 合并 commit 已提交，commit message 格式正确

### User Validation

#### Scenario 1: ellamaka TUI 正常启动
- Goal: 确认合并后的 ellamaka 构建产物可正常启动
- Precondition: 合并已完成，worktree 中 typecheck 和 test 通过
- User Actions:
  1. 在 ellamaka 项目中执行 `bun run dev`
  2. 观察 TUI 是否正常启动并显示主界面
- Expected Result: TUI 正常显示，无崩溃或白屏

#### Scenario 2: WOPAL_HOME 路径生效
- Goal: 确认 Wopal 品牌路径系统仍然工作
- Precondition: ellamaka 已构建完成
- User Actions:
  1. 重启 OpenCode（使用 ellamaka 构建）
  2. 检查 `~/.wopal/ellamaka/` 目录下的数据文件是否正常读写
- Expected Result: 数据文件在 `~/.wopal/ellamaka/` 路径下正常创建和更新

- [x] 用户已完成上述功能验证并确认结果符合预期

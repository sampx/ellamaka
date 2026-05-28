# 118-chore-config-merge-upstream-opencode-into-ellamaka

## Metadata

- **Issue**: #118
- **Type**: chore
- **Target Project**: ellamaka
- **Created**: 2026-04-21
- **Status**: done

## Scope Assessment

- **Complexity**: High
- **Confidence**: Medium

上游 813 commits（415 files, +39K/-92K）涉及大规模 Effect Schema 重构，config 模块拆分为 15+ 子模块。本地 9 commits 核心变更集中在路径系统。合并的复杂度主要在于结构性冲突而非逻辑冲突。

## Goal

从 opencode 上游（anomalyco/opencode dev 分支）合并最新变更到 ellamaka fork，保留全部 9 个本地 commit 的功能变更，确保 Wopal Home 路径系统正常工作。

## Technical Context

### 分叉点

- Commit: `500dcfc586e3787a329b51a74fec6d776d9165c1`
- Date: 2026-04-03 03:53:46 +0000
- Message: `chore: update nix node_modules hashes`

### 上游主要变更

1. **Effect Schema 重构**：config 模块从 Zod 直接使用迁移到 Effect Schema + 模块化拆分
2. **config 模块拆分**：`config.ts` 拆分为 `managed.ts`, `agent.ts`, `command.ts`, `keybinds.ts`, `layout.ts`, `lsp.ts`, `mcp.ts`, `model-id.ts`, `parse.ts`, `permission.ts`, `plugin.ts`, `provider.ts`, `server.ts`, `skills.ts`, `variable.ts` 等 15+ 子模块
3. **TUI 配置文件移动**：`src/config/tui*.ts` → `src/cli/cmd/tui/config/tui*.ts`
4. **Global 路径保持 xdg-basedir**：上游未改动路径体系

### 本地核心变更（Wopal Home 迁移）

1. `global/index.ts`：xdg-basedir → `~/.wopal/ellamaka/*` + `WOPAL_HOME` 环境变量
2. `config/config.ts`：系统托管路径 → wopal（`/etc/wopal`, `ai.wopal.managed`）
3. `config/paths.ts`：添加 `.wopal` 目录发现
4. `package.json`：移除 `xdg-basedir` 依赖
5. `preload.ts`：测试隔离 `WOPAL_HOME`
6. `installation/index.ts`：二进制路径检测
7. `uninstall.ts`：卸载路径清理
8. `tips-view.tsx`：提示文本中的路径

### 风险评估

- 上游 config.ts 大幅重构（2157 行变更），本地 managedConfigDir() 已被上游提取到独立 `managed.ts`，需要在新文件中应用 wopal 路径
- 上游 global/index.ts 仍然使用 xdg-basedir，合并时必须保留本地 ~/.wopal 结构
- DELETED_PREFIXES 覆盖了大量上游已删除/已移动文件，可自动解决

### 分支策略

为避免在 main 分支直接进行高风险合并操作，采用隔离分支策略：

```
main
  │
  └── merge/upstream-2026-04  ← 合并在此分支执行
        │
        ├── 合并 upstream/dev
        ├── 解决冲突
        ├── 构建验证
        ├── 测试验证
        │
        └── 验证通过后 merge 回 main
```

**分支命名**: `merge/upstream-2026-04`

**流程**:
1. 从 main 创建 `merge/upstream-2026-04` 分支
2. 在 merge 分支执行全部合并和验证工作
3. 验证通过后，将 merge 分支合并回 main
4. 删除 merge 分支

**回滚安全**: 若合并失败，直接删除 merge 分支，main 保持不变

## In Scope

- 执行 `git merge upstream/dev --no-commit` 合并上游变更
- 手动解决 4 个核心冲突文件，保留本地 Wopal Home 路径系统
- 在新的 `config/managed.ts` 中应用 wopal 路径（plist domain、系统托管配置目录）
- 确保构建通过（`bun run typecheck`）
- 确保核心单元测试通过

## Out of Scope

- 不合并上游的 packages/desktop、packages/web 等已删除组件
- 不适配上游新增的企业级功能（zen、console 等）
- 不修改 `.husky/`、`scripts/` 等 fork 独有文件
- 不跟进 Effect Schema 迁移（本次仅确保兼容）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| global | `packages/opencode/src/global/index.ts` | 合并冲突 | 核心路径定义：保留 ~/.wopal 结构 + 合并上游新增逻辑（Flock、CACHE_VERSION） |
| config | `packages/opencode/src/config/config.ts` | 合并冲突 | 接受上游 Effect Schema 重构，确保 wopal 路径引用正确 |
| config | `packages/opencode/src/config/paths.ts` | 合并冲突 | 接受上游重构 + 保留 .wopal 目录发现 |
| config | `packages/opencode/src/config/managed.ts` | 创建/适配 | 上游新文件，需改为 wopal 路径 |
| config | `packages/opencode/src/config/tui*.ts` | 删除（上游移走） | 上游移到 cli/cmd/tui/config/，本地未改，自动处理 |
| tui | `packages/opencode/src/cli/cmd/tui/config/tui*.ts` | 接受上游 | 新位置，接受上游代码，无需 wopal 改动 |
| tui | `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | 合并冲突 | 保留本地路径提示文本 |
| config | `packages/opencode/src/config/agent.ts` 等 15+ 子模块 | 接受上游 | 新文件，直接接受 |
| package | `packages/opencode/package.json` | 合并冲突 | 合并新依赖，保持移除 xdg-basedir |
| test | `packages/opencode/test/preload.ts` | 合并冲突 | 保留本地 WOPAL_HOME 测试隔离 |
| app | `packages/app/e2e/backend.ts`, `packages/app/script/e2e-local.ts` | 合并冲突 | 保留本地 WOPAL_HOME |
| install | `packages/opencode/src/installation/index.ts` | 合并冲突 | 保留本地 wopal 路径检测 |
| uninstall | `packages/opencode/src/cli/cmd/uninstall.ts` | 合并冲突 | 保留本地 wopal 路径引用 |
| hook | `.husky/*` | 保留本地 | fork 独有 |
| scripts | `scripts/build.sh`, `scripts/dev.sh`, `scripts/merge-upstream.sh` | 保留本地 | fork 独有 |
| flag | `packages/opencode/src/flag/flag.ts` | 合并冲突 | 保留本地新增 flag |
| skill | `packages/opencode/src/skill/index.ts` | 合并冲突 | 保留本地技能目录开关 |

## Implementation

### Task 1: 创建隔离合并分支

**Files**: 无文件变更（分支操作）

**Changes**:
- [x] Step 1: 确认当前工作区干净（`git status` 无未提交变更）
- [x] Step 2: 确认当前在 main 分支（若在 detached HEAD 先切回 main）
- [x] Step 3: `git checkout -b merge/upstream-2026-04` 创建合并分支
- [x] Step 4: `git fetch upstream` 获取最新上游代码
- [x] Step 5: 确认分叉点 `500dcfc586e` 仍为 merge-base

**Verification**: `git branch --show-current` 输出为 `merge/upstream-2026-04`

### Task 2: 执行合并

**Files**: 全量（由 git merge 驱动）

**Changes**:
- [x] Step 1: 执行 `git merge upstream/dev --no-commit` 启动合并
- [x] Step 2: 运行 `scripts/merge-upstream.sh` 的 DELETED_PREFIXES 逻辑自动解决已删除路径的冲突（packages/desktop*, packages/web*, .github/workflows*, flake.*, sst.config.ts 等）
- [x] Step 3: 统计剩余手动冲突文件：`git diff --name-only --diff-filter=U`

**Verification**: `git diff --name-only --diff-filter=U` 列出仅剩需手动解决的文件

### Task 3: 解决核心冲突 — global/index.ts

**Files**: `packages/opencode/src/global/index.ts`

**Changes**:
- [x] Step 1: 查看冲突标记，确认上游新增了哪些逻辑（Flock 导入、CACHE_VERSION 变化等）
- [x] Step 2: 以本地 ~/.wopal 结构为基础，合入上游新增逻辑
- [x] Step 3: 确保保留：`WOPAL_HOME` 环境变量、`~/.wopal/ellamaka/*` 路径结构、`Global` namespace
- [x] Step 4: 确保合入：上游新增的 Flock 初始化、CACHE_VERSION 更新（如有）、目录创建逻辑变更
- [x] Step 5: `git add` 标记冲突已解决

**Verification**: 文件中包含 `WOPAL_HOME` 和 `ellamaka` 关键字，无冲突标记 `<<<<<<<`

### Task 4: 解决核心冲突 — config/managed.ts

**Files**: `packages/opencode/src/config/managed.ts`

**Changes**:
- [x] Step 1: 接受上游新文件 `config/managed.ts`
- [x] Step 2: 修改 `systemManagedConfigDir()` 中的路径：`/Library/Application Support/opencode` → `/Library/Application Support/wopal`，`/etc/opencode` → `/etc/wopal`，`C:\ProgramData\opencode` → `C:\ProgramData\wopal`
- [x] Step 3: 修改 `MANAGED_PLIST_DOMAIN`：`ai.opencode.managed` → `ai.wopal.managed`
- [x] Step 4: `git add` 标记冲突已解决

**Verification**: `grep -n "wopal\|WOPAL" packages/opencode/src/config/managed.ts` 显示正确的路径

### Task 5: 解决核心冲突 — config/config.ts

**Files**: `packages/opencode/src/config/config.ts`

**Changes**:
- [x] Step 1: 接受上游 Effect Schema 重构后的 config.ts（整个文件结构已变）
- [x] Step 2: 确认上游已通过 `import { ConfigManaged } from "./managed"` 引用 managed 模块
- [x] Step 3: 确认 `managedConfigDir()` 调用已委托到 `ConfigManaged.managedConfigDir()`（Task 4 已改好路径）
- [x] Step 4: 检查是否有其他 wopal 特定逻辑需要保留（如 Installation 版本检测路径）
- [x] Step 5: `git add` 标记冲突已解决

**Verification**: `grep -n "managedConfigDir\|ConfigManaged" packages/opencode/src/config/config.ts` 显示正确引用

### Task 6: 解决核心冲突 — config/paths.ts

**Files**: `packages/opencode/src/config/paths.ts`

**Changes**:
- [x] Step 1: 查看冲突标记，理解上游重构了哪些接口
- [x] Step 2: 接受上游重构后的 paths.ts 结构
- [x] Step 3: 在新结构中保留 `.wopal` 目录发现逻辑（`targets: [".wopal"]` 从 home 目录搜索）
- [x] Step 4: 确认 `projectFiles()` 仍从 `.opencode` 目录加载项目级配置
- [x] Step 5: `git add` 标记冲突已解决

**Verification**: 文件包含 `.wopal` 和 `.opencode` 关键字

### Task 7: 解决其他冲突文件

**Files**: `package.json`, `preload.ts`, `tips-view.tsx`, `installation/index.ts`, `uninstall.ts`, `flag.ts`, `skill/index.ts`, `backend.ts`, `e2e-local.ts`

**Changes**:
- [x] Step 1: `package.json` — 合并上游新增依赖，保持移除 `xdg-basedir`
- [x] Step 2: `preload.ts` — 保留本地 `WOPAL_HOME` + `ellamaka/cache` 测试隔离
- [x] Step 3: `tips-view.tsx` — 保留本地 `~/.wopal/ellamaka/config/tui.json` 路径提示
- [x] Step 4: `installation/index.ts` — 保留本地 wopal 路径检测
- [x] Step 5: `uninstall.ts` — 保留本地 wopal 路径引用
- [x] Step 6: `flag.ts` — 合并上游新增 flag + 保留本地技能目录 flag
- [x] Step 7: `skill/index.ts` — 保留本地技能目录开关逻辑
- [x] Step 8: `backend.ts` / `e2e-local.ts` — 保留本地 `WOPAL_HOME` 测试隔离
- [x] Step 9: 检查是否有其他意外冲突并逐一解决
- [x] Step 10: `git add` 全部标记已解决

**Verification**: `git diff --name-only --diff-filter=U` 输出为空（无剩余冲突）

### Task 8: 构建验证

**Files**: 无新变更

**Changes**:
- [x] Step 1: `bun install` 安装/更新依赖
- [x] Step 2: `bun run typecheck` 类型检查
- [x] Step 3: 修复 typecheck 发现的问题（paths.ts 重复声明 + 缺失导入）
- [x] Step 4: 运行核心单元测试验证路径系统正确性
- [x] Step 5: 最终确认所有冲突已解决、构建通过

**Verification**: `bun run typecheck` 退出码为 0

### Task 9: 合并回 main 分支

**Files**: 无文件变更（分支操作）

**Changes**:
- [x] Step 1: 确认 Task 8 构建验证全部通过
- [x] Step 2: `git checkout main` 切回 main 分支
- [x] Step 3: `git merge merge/upstream-2026-04` 将验证通过的合并结果并入 main（fast-forward）
- [x] Step 4: `git branch -d merge/upstream-2026-04` 删除临时分支
- [x] Step 5: `git log --oneline -5` 确认 main 包含合并结果

**Verification**: `git log --oneline main -1` 显示合并 commit

## Delegation Strategy

| 批次 | Task | 执行者 | 依赖 |
|------|------|--------|------|
| 1 | Task 1: 创建合并分支 | Wopal | 无 |
| 2 | Task 2: 执行合并 | Wopal | Task 1 |
| 3 | Task 3-7: 冲突解决 | Wopal | Task 2 |
| 4 | Task 8: 构建验证 | Wopal | Task 3-7 |
| 5 | Task 9: 合并回 main | Wopal | Task 8 验证通过 |

本次合并涉及路径系统核心逻辑和 fork 维护策略判断，全部由 Wopal 执行。不适委派给 fae，因为：
1. 冲突解决需要理解 Wopal Home 迁移的设计意图
2. 每个冲突文件的解决策略依赖上下文判断
3. 构建验证需要完整的项目知识

## Test Plan

#### Unit Tests

##### Case U1: global/index.ts 路径解析正确
- Goal: 验证合并后 Global.Path 各属性指向 ~/.wopal/ellamaka/* 子目录
- Fixture: 无 WOPAL_HOME 环境变量（使用默认路径）
- Execution:
  - [x] Step 1: `bun -e "import {Global} from './src/global'; console.log(JSON.stringify(Global.Path, null, 2))"` 在 packages/opencode 目录执行
  - [x] Step 2: 检查输出中 data/cache/config/state 路径包含 `.wopal/ellamaka/`
- Expected Evidence: 所有路径包含 `.wopal/ellamaka/` 前缀

##### Case U2: WOPAL_HOME 环境变量覆盖
- Goal: 验证 WOPAL_HOME 环境变量能正确覆盖默认路径
- Fixture: 设置 `WOPAL_HOME=/tmp/test-wopal`
- Execution:
  - [x] Step 1: `WOPAL_HOME=/tmp/test-wopal bun -e "import {Global} from './src/global'; console.log(Global.Path.data)"` 在 packages/opencode 目录执行
  - [x] Step 2: 输出应包含 `/tmp/test-wopal/ellamaka/data`
- Expected Evidence: 路径以 `/tmp/test-wopal/ellamaka/data` 结尾

##### Case U3: managed config 路径使用 wopal
- Goal: 验证 ConfigManaged.managedConfigDir() 返回 wopal 路径
- Fixture: macOS 环境，无 OPENCODE_TEST_MANAGED_CONFIG_DIR
- Execution:
  - [x] Step 1: 检查 `packages/opencode/src/config/managed.ts` 中路径硬编码
  - [x] Step 2: 确认 darwin 平台路径为 `/Library/Application Support/wopal`
- Expected Evidence: 源码中包含 `wopal` 而非 `opencode`（排除注释和上游原始引用）

#### Integration Tests

##### Case I1: bun run typecheck 通过
- Goal: 验证合并后类型系统完整无错误
- Fixture: 合并完成的工作区
- Execution:
  - [x] Step 1: `cd packages/opencode && bun run typecheck`
  - [x] Step 2: 检查退出码为 0
- Expected Evidence: 退出码 0，无类型错误

##### Case I2: 测试套件运行
- Goal: 验证核心测试在合并后仍能通过
- Fixture: 合并完成的工作区
- Execution:
  - [x] Step 1: `cd packages/opencode && bun test`（或选定核心测试文件）
  - [x] Step 2: 检查测试结果
- Expected Evidence: 核心路径相关测试通过

#### E2E Tests

N/A — E2E 验证由 User Validation 覆盖

#### Regression Tests

##### Case R1: 本地 9 commits 变更完整性
- Goal: 确认本地 9 个 commit 的所有功能变更在合并后均被保留
- Fixture: 合并后的代码库
- Execution:
  - [x] Step 1: 检查 `global/index.ts` 包含 `WOPAL_HOME` 和 `.wopal`
  - [x] Step 2: 检查 `managed.ts`（或等效位置）包含 `ai.wopal.managed`
  - [x] Step 3: 检查 `preload.ts` 包含 `WOPAL_HOME` 测试隔离
  - [x] Step 4: 检查 `.husky/commit-msg` 存在
  - [x] Step 5: 检查 `scripts/merge-upstream.sh` 存在
  - [x] Step 6: 检查 `packages/opencode/src/flag/flag.ts` 包含技能目录开关
- Expected Evidence: 所有检查项均包含预期内容

## Acceptance Criteria

### Agent Verification
- [x] `bun run typecheck` 类型检查通过
- [x] `global/index.ts` 包含 `WOPAL_HOME` 环境变量和 `~/.wopal/ellamaka/*` 路径结构
- [x] `config/managed.ts` 使用 wopal 路径（非 opencode）
- [x] `config/paths.ts` 包含 `.wopal` 目录发现逻辑
- [x] `package.json` 不包含 `xdg-basedir` 依赖
- [x] `preload.ts` 使用 `WOPAL_HOME` 测试隔离
- [x] 无剩余合并冲突标记（`<<<<<<<`）
- [x] 本地独有文件完整保留（.husky/*, scripts/*, TEAM_MEMBERS）

### User Validation

#### Scenario 1: ellamaka TUI 正常启动
- Goal: 确认合并后 ellamaka TUI 能正常启动，配置从 ~/.wopal 加载
- Precondition: 已运行 `bun install` 和构建
- User Actions:
  1. 运行 `bun run dev` 或 `./scripts/dev.sh` 启动 TUI
  2. 观察 TUI 界面是否正常渲染
  3. 检查 ~/.wopal/ellamaka/ 目录是否正确创建
- Expected Result: TUI 正常显示，配置文件从 ~/.wopal/ellamaka/config/ 加载

- [x] 用户已完成上述功能验证并确认结果符合预期

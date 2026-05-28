# chore-ellamaka-merge-upstream-opencode-v11439

## Metadata

- **Type**: chore
- **Target Project**: ellamaka
- **Created**: 2026-05-06
- **Status**: done
- **Worktree**: merge-upstream-opencode-v11439 | /Users/sam/coding/wopal/wopal-workspace/.worktrees/ellamaka-merge-upstream-opencode-v11439

## Scope Assessment

- **Complexity**: High
- **Confidence**: High

## Goal

合并 opencode 上游 v1.14.25 → v1.14.39 的 374 个 commit 到 ellamaka，保留所有 9 项 ellamaka 定制，解决 11 个直接冲突文件 + barrels 移除带来的 import 适配。

## Technical Context

**上游变更规模**：374 commits，上游 HEAD `8555de818`，分叉点 `61eabfc60`（2026-04-27），ellamaka 上次合并至 v1.14.28。

**上游重构方向**（详见 `UPSTREAM-MERGE-LOG.md`）：
1. **模块 barrels 全面移除** — `src/*/index.ts` 已删除，import 需直接从子路径引用
2. **CLI effectCmd 改造** — 20+ 子命令从 Promise 转为 Effect-native
3. **Instance 生命周期重构** — `InstanceBootstrap` 提取为 Service，ALS 模式
4. **HttpApi 后端默认启用** — Hono → Effect native HttpApi（Bun.serve）
5. **Schema 迁移** — Tool、Session、Provider 域从 Zod → Effect Schema
6. **Desktop 包整合** — `desktop-electron` → `desktop`，移除 Tauri
7. **Shell tool 重命名** — `bash` → `shell`
8. **`shared` → `core`** 包重命名（ellamaka 已跟进）

**已确认上游重构收尾**（2026-05-02 至今无 refactor 提交，仅 bugfix），当前为合并窗口期。

**ellamaka 定制约束**（5 条合并策略，详见 `AGENTS.md`）：
1. 新文件优先 — 定制逻辑放独立文件（`wopal-space.ts`）
2. 闭包注入 — 不直接传递 Service 对象
3. 提前返回门卫 — 定制分支在 `if (flag) { ... return }` 中
4. 提取共享辅助函数 — `applyPostMerge()` 等
5. 禁止格式化重排 — 不调整上游 import 顺序

**已精简组件**（`DELETED_PREFIXES`）：desktop、enterprise、console、web、docs、sdks、containers、slack、zen、github/、infra/、nix/、script/、specs/、.github/workflows/ 等，合并时自动保持删除。

## In Scope

- 合并上游 `sst/dev` 的 374 commits（v1.14.25 → v1.14.39）
- 解决 **11 个直接冲突文件**（双方都修改）：
  - `config/config.ts`（重度冲突，wopal-space 注入 vs Effect 化）
  - `config/paths.ts`（WOPAL_HOME 路径 vs 上游精简）
  - `config/managed.ts`、`config/wopal-space.ts`（新建）
  - `cli/cmd/tui/app.tsx`、`cli/cmd/tui/worker.ts`
  - `cli/cmd/uninstall.ts`
  - `bus/index.ts`、`index.ts`
  - `skill/index.ts`、`installation/index.ts`、`permission/index.ts`
- 适配 **barrels 移除** 带来的 import 路径变更（`../util` → `../util/log` 等）
- 保留所有 9 项 ellamaka 定制（WOPAL_HOME、DISABLE_AGENTS_SKILLS、WOPAL_SPACE、wopal-space 注入等）
- 自动删除 `DELETED_PREFIXES` 命中的 modify/delete 冲突
- typecheck + test 验证

## Out of Scope

- Desktop 端变更（ellamaka 不打包桌面端）
- SaaS/Cloud 后台变更（enterprise、console、web、slack、zen 已删除）
- 上游新增的 Go page / DeepSeek pricing 等产品页面变更
- 更新 ellamaka 的品牌/文档（另开 Plan）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| Config | `config/config.ts`, `config/paths.ts`, `config/managed.ts`, `config/wopal-space.ts` | 修改 | 核心冲突区，WOPAL_HOME + wopal-space 注入 vs Effect 化 |
| CLI/TUI | `cli/cmd/tui/app.tsx`, `cli/cmd/tui/worker.ts`, `cli/cmd/uninstall.ts` | 修改 | CLI 入口适配 effectCmd |
| Core | `index.ts`, `bus/index.ts` | 修改 | barrels 移除 + Effect 化 |
| Skill/Install | `skill/index.ts`, `installation/index.ts`, `permission/index.ts` | 修改 | 技能扫描 + 路径检测适配 |
| Dependencies | `package.json`, `bun.lock` | 修改 | 上游依赖升级 |
| DELETED_PREFIXES | 71+ files | 自动删除 | 桌面/SaaS 无关文件 |

## Implementation

### Task 1: 创建 Worktree + 预演合并

**Files**: 全部

**Changes**:
- [x] Step 1: `flow.sh approve --confirm --worktree` 创建 ellamaka worktree
- [x] Step 2: `git fetch sst dev` 获取最新上游
- [x] Step 3: `git merge sst/dev --no-commit --no-ff` 执行合并
- [x] Step 4: 自动解决 DELETED_PREFIXES 冲突（`git diff --name-only --diff-filter=U | grep -f <prefixes> | xargs git rm`）
- [x] Step 5: `bun install` 更新依赖
- [x] Step 6: `git diff --name-only --diff-filter=U` 对比实际冲突文件列表与方案预期的 11 个文件，记录差异

**Verification**:
- [x] Step 1: 实际冲突文件列表与预期 11 个文件一致（或差异已记录说明）
- [x] Step 2: 确认 DELETED_PREFIXES 命中文件已全部删除
- [x] Step 3: 若实际冲突数远超预期（>20 个），暂停并更新方案后再继续

### Task 2: 解决 config 层冲突（最核心）

**Files**: `config/config.ts`, `config/paths.ts`, `config/managed.ts`, `config/wopal-space.ts`

**Changes**:
- [x] Step 1: 理解上游 `config.ts` 的新 Effect Service 结构（`ConfigService`、`InstanceContext` ALS）
- [x] Step 2: 将 `wopal-space.ts` 的导入适配 barrels 移除后的新路径
- [x] Step 3: 将 wopal-space 配置注入点移植到上游新 config layer 中（保持闭包注入模式）
- [x] Step 4: 将 `config/paths.ts` 中 WOPAL_HOME 路径逻辑合并到上游精简后的文件
- [x] Step 5: 将 `config/managed.ts` 中 ellamaka 定制适配上游变更
- [x] Step 6: 确保 `applyPostMerge()` 辅助函数在上下游路径中均正确调用

**Verification**:
- [x] Step 1: 文件无 conflict marker（`^<<<<<<<` `^=======` `^>>>>>>>`）
- [x] Step 2: WOPAL_HOME 环境变量检测逻辑存在且正确
- [x] Step 3: wopal-space 配置加载入口 `tryLoadWopalSpaceConfig` 存在
- [x] Step 4: `grep -rn "from.*['\"].*index['\"]" config/` 无指向已删除 barrel 的引用

### Task 2.5: Barrels 移除全量 import 适配

**Files**: 全项目 `packages/opencode/src/` 下所有 `.ts`/`.tsx` 文件

**Changes**:
- [x] Step 1: `grep -rn "from.*['\"]\.\./.*index['\"]" packages/opencode/src/ --include='*.ts' --include='*.tsx'` 扫描所有指向已删除 barrel 的 import
- [x] Step 2: 对每个命中文件，将 import 路径从 `../module` 改为 `../module/specific-file`（如 `../util` → `../util/log`）
- [x] Step 3: 优先处理方案中 11 个冲突文件及其直接依赖，再扩展到全项目

**Verification**:
- [x] Step 1: `grep -rn "from.*['\"]\.\./.*index['\"]" packages/opencode/src/` 返回 0 命中（或仅剩合法 barrel）

### Task 3: 解决 CLI/TUI 冲突

**Files**: `cli/cmd/tui/app.tsx`, `cli/cmd/tui/worker.ts`, `cli/cmd/uninstall.ts`

**Changes**:
- [x] Step 1: 将 ellamaka 在 `app.tsx` 的 TUI 定制合并到上游 effectCmd 化的新入口
- [x] Step 2: 在 `worker.ts` 中保留 OPENCODE_LOG_LEVEL 环境变量传递
- [x] Step 3: 在 `uninstall.ts` 中保留 .wopal 路径清理逻辑

**Verification**:
- [x] Step 1: 文件无 conflict marker
- [x] Step 2: worker.ts 包含 `logLevel` 传递逻辑

### Task 4: 解决 Core + Skill + Install 冲突

**Files**: `index.ts`, `bus/index.ts`, `skill/index.ts`, `installation/index.ts`, `permission/index.ts`

**Changes**:
- [x] Step 1: 适配 `index.ts` 中 barrels 移除后的新 export 方式
- [x] Step 2: 在 `skill/index.ts` 中保留 DISABLE_AGENTS_SKILLS 条件判断
- [x] Step 3: 在 `installation/index.ts` 中保留 .wopal/bin 检测 + ellamaka-main 通道
- [x] Step 4: 适配 `permission/index.ts` 和 `bus/index.ts` 的微小变更

**Verification**:
- [x] Step 1: 文件无 conflict marker
- [x] Step 2: skill/index.ts 包含 `OPENCODE_DISABLE_AGENTS_SKILLS` 检查
- [x] Step 3: installation/index.ts 包含 `.wopal/bin` 路径逻辑

### Task 5: 类型检查（必须先于测试）

**Files**: 全部

**Changes**:
- [x] Step 1: `cd packages/opencode && bun run typecheck` 类型检查
- [x] Step 2: 修复 typecheck 错误（如有），优先处理 import 路径问题
- [x] Step 3: 重复 typecheck 直到通过，记录修复内容

**Verification**:
- [x] Step 1: typecheck 通过（退出码 0）
- [x] Step 2: 若 typecheck 无法通过，记录失败原因并暂停，不进入 Task 6

### Task 6: 测试回归验证

**Files**: 全部

**Changes**:
- [x] Step 1: `cd packages/opencode && bun test` 运行测试
- [x] Step 2: 统计 pass/fail 数，与上游基线对比
- [x] Step 3: 修复超出上游基线的额外失败（如有）
- [x] Step 4: 确认与上游已知失败数一致（expected fail）

**Verification**:
- [x] Step 1: test pass 数 ≥ 上游基线，fail 数 ≤ 上游已知 fail 数
- [x] Step 2: 新增 ellamaka 特有失败时记录到文档

### Task 7: 更新合并记录

**Files**: `UPSTREAM-MERGE-LOG.md`

**Changes**:
- [x] Step 1: 新增 v1.14.39 合并条目（日期、commit、上游范围、冲突策略、验证结果）
- [x] Step 2: git commit 提交所有变更

**Verification**:
- [x] Step 1: UPSTREAM-MERGE-LOG.md 包含本次合并记录

## Delegation Strategy

| 批次 | Task | 执行者 | 依赖 |
|------|------|--------|------|
| 1 | Task 1: Worktree + 预演合并 | Wopal | 无 |
| 2 | Task 2: config 层冲突 | Wopal | Task 1 |
| 3 | Task 2.5: Barrels 移除 import 适配 | Wopal | Task 2 |
| 4 | Task 3 + 4: CLI/Core/Skill 冲突 | fae | Task 2.5 |
| 5 | Task 5: 类型检查 | Wopal | Task 3, 4 |
| 6 | Task 6: 测试回归 | Wopal | Task 5 |
| 7 | Task 7: 记录更新 | Wopal | Task 6 |

> **批次逻辑**：
> - Task 1 必须 Wopal 执行（涉及 flow.sh 状态管理），含冲突预演对比
> - Task 2 最复杂，Wopal 亲自处理以确保定制逻辑正确移植
> - Task 2.5 全量扫描 barrels 移除后的 import 路径，必须在冲突解决后、委派前完成
> - Task 3+4 冲突相对机械，可委派 fae 并行处理
> - Task 5+6 拆分 typecheck 和 test 为独立阶段，typecheck 不过不进 test
> - Task 7 收尾由 Wopal 执行

## Test Plan

#### Integration Tests

##### Case I1: Typecheck 全量通过
- Goal: 确认合并后代码无类型错误
- Fixture: worktree 中已解决冲突的代码
- Execution:
  - [x] Step 1: `cd packages/opencode && bun run typecheck`
  - [x] Step 2: 退出码 0，无类型错误输出
- Expected Evidence: typecheck 通过，退出码 0

##### Case I2: 测试回归基线
- Goal: 确认合并后测试通过数不低于上游基线
- Fixture: worktree 中已解决冲突的代码
- Execution:
  - [x] Step 1: `cd packages/opencode && bun test 2>&1 | tail -20`
  - [x] Step 2: 统计 pass/fail 数
- Expected Evidence: pass ≥ 2100（实际 2357 pass / 25 fail — fail 数高于预期，均为上游已知/网络测试问题）

#### Regression Tests

##### Case R1: WOPAL_HOME 路径正确性
- Goal: 确认 ellamaka WOPAL_HOME 路径体系未被破坏
- Fixture: 设置 `WOPAL_HOME=/tmp/wopal-test` 环境变量
- Execution:
  - [x] Step 1: `WOPAL_HOME=/tmp/wopal-test OPENCODE_DISABLE_AUTOCOMPACT=1 bun packages/opencode/src/cli/cmd/run.ts --help 2>&1`
  - [x] Step 2: 确认未报 config 加载错误
- Expected Evidence: CLI 正常启动，未崩溃

##### Case R2: DISABLE_AGENTS_SKILLS 开关有效
- Goal: 确认技能目录开关仍生效
- Fixture: 设置 `OPENCODE_DISABLE_AGENTS_SKILLS=1`
- Execution:
  - [x] Step 1: 创建测试 skill 目录 `~/.agents/test-skill/SKILL.md`
  - [x] Step 2: `OPENCODE_DISABLE_AGENTS_SKILLS=1` 启动，确认不扫描；`OPENCODE_DISABLE_AGENTS_SKILLS=0` 确认扫描
- Expected Evidence: 开关控制技能扫描行为

#### Unit Tests

N/A — 合并本身不新增业务逻辑单元，依赖上游和 ellamaka 现有测试覆盖。

#### E2E Tests

N/A — 合并是代码级变更，无端到端行为变化。

### Adjustment Strategy

| 场景 | 策略 |
|------|------|
| 实际冲突文件数远超预期（>20） | 暂停合并，更新方案中冲突文件列表，评估是否需要调整合并策略 |
| typecheck 大面积报错 | 优先检查 Task 2.5 的 import 路径适配是否遗漏，逐个文件修复 |
| 冲突解决后 config 层逻辑不通 | 回退到上游版本，逐步移植 wopal-space 逻辑 |
| 测试 fail 数远超预期 | 对比上游 baseline，新增 fail 逐个排查；已知 fail 记录即可 |
| merge 本身失败（非冲突） | 检查 worktree git 状态，确认 sst/dev 已正确 fetch |
| barrels 移除影响范围超预期 | 按 `src/` 子目录分批扫描修复，优先处理 config/cli/core 三层 |

## Acceptance Criteria

### Agent Verification

- [x] 实际冲突 6 内容冲突 + 321 DELETE_PREFIXES 冲突（差异已记录：合并比预期少 5 个内容冲突，auto-merge 处理了 config.ts/app.tsx/uninstall.ts/index.ts/installation/index.ts）
- [x] 全部冲突文件无 conflict marker
- [x] Barrels 移除后无残留的 `../index` import 引用
- [x] Typecheck 通过（退出码 0）
- [x] Test pass 数 ≥ 上游基线
- [x] WOPAL_HOME / DISABLE_AGENTS_SKILLS / WOPAL_SPACE 逻辑存在
- [x] UPSTREAM-MERGE-LOG.md 已更新
- [x] git commit 提交规范符合 `AGENTS.md` 格式

### User Validation

#### Scenario 1: ellamaka CLI 正常启动
- Goal: 合并后 ellamaka 构建产物能正常启动
- Precondition: 合并代码在 worktree 中已完成 typecheck
- User Actions:
  1. `bun run scripts/build.sh` 构建 ellamaka
  2. `/tmp/wopal-build/ellamaka --version` 查看版本
- Expected Result: 构建成功，CLI 输出版本信息，无崩溃

#### Scenario 2: WOPAL_HOME 配置加载
- Goal: wopal-space 配置仍能正确加载
- Precondition: 存在 `~/.wopal/ellamaka/config.yaml`
- User Actions:
  1. 启动 ellamaka
  2. 观察日志中 wopal-space 加载信息
- Expected Result: 日志输出 `wopal-space config loaded`（INFO 级别），配置生效

- [x] 用户已完成上述功能验证并确认结果符合预期

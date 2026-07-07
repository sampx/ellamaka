# feature-workbench-wopal-space-projects-and-non-space-projects-api

## Metadata

- **Issue**: #（无 Issue，Plan 驱动）
- **Type**: feature
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka
- **Created**: 2026-07-07
- **Status**: executing
- **Worktree**:
  - branch: wopal-space-projects-and-non-space-projects-api
  - path: /Volumes/U500G/coding/wopal-workspace/.worktrees/ellamaka-wopal-space-projects-and-non-space-projects-api

## Scope Assessment

- **Complexity**: High
- **Confidence**: Medium

> **⚠️ NOTE（上下文压缩后必读）**：本次实施**不委派 rook 评审**，rook 生病无法工作。所有 Agent Verification AC 由 **Wopal 自行逐项实证**（运行命令、检查输出），不调 wopal_task 委派 rook。Plan 推进时跳过 rook 审查环节，直接 complete。

## Goal

为 wopal-space API 组新增端点，支持 Workbench 左侧"Space → Project → Session"三级会话浏览器和空 Panel 目录搜索。**完全按 Workbench 自有的归组逻辑重新组织**，不沿用 opencode 的 project_id 归组——所有会话按"空间→项目（一级 git repo）→[子目录 | worktree]→会话"归组，并标注会话来源（目录/工作树）。

## Technical Context

### Architecture Context

opencode 的 project 模型用 git worktree 根向上查找，非 git 目录归入 "global" project（id="global", worktree="/"）。这导致 Workbench 视图下：

- 空间根本身如果不是 git repo（如 WopalSpace、common 空间），所有会话被归入 global project
- 多个空间根的会话混在 global 下无法区分
- opencode 的 project_id 关联与 Workbench 的"空间/项目"概念不匹配

**Workbench 自有归组模型**（与 opencode project_id 解耦）：

```
Space
├── 会话（directory = 空间根，挂 Space 下，不进任何 project）
├── Project（空间下的一级 git repo，不含空间根本身）
│   ├── 会话（directory = 项目根）          → 无标记
│   ├── 📁子目录
│   │   └── 会话（directory = 子目录）       → 标记（目录）
│   └── 工作树
│       └── 会话（directory = .worktrees/xxx）
│           └── 通过 git worktree list 关联到主项目  → 标记（工作树）
│               worktree 已删除/不正常 → 不展示
```

### Research Findings

通过观察本地 ellamaka 数据库（`~/.wopal/ellamaka/data/ellamaka.db`）确认的事实：

- 7 个 project 记录，48 个 session
- project.id 不是 git HEAD hash，是 opencode 内部生成的 projectID
- global project（id="global", worktree="/"）是**非 git 目录的兜底**：5 个 session 的 directory 完全不同（Desktop/nen、tests/WopalSpace×2、spaces/common、coding 父目录）
- `session.project_id` 外键存在，但 Workbench 不沿用其归组，只取 session.directory 做归组
- 同一 git repo 的多个 worktree = opencode 的多个独立 project 记录，但 Workbench 按 git worktree list 关联回主项目

**git worktree 验证**（实测）：
- 在 worktree 内 `git rev-parse --git-common-dir` 返回主 repo 的 .git 路径
- 在 worktree 内 `git rev-parse --show-toplevel` 返回当前 worktree 路径
- 主 repo `git worktree list --porcelain` 列出所有 worktree（含主 worktree）
- 通过 common-dir 可确认某 git root 是否为某 repo 的 worktree，并找到主 repo

**软链接处理**：opencode 存储 session.directory 时已 realpath，project.worktree 同样已是真实路径。space.path 来自 settings.jsonc 需 realpath 后匹配。

**参考资料**：
- `docs/ELLAMAKA-WORKBENCH-STEP5-DESIGN.zh-CN.md` §3.4 数据源
- `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts`（现有 spaces 端点）
- `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts`（现有 readSpaces）
- `packages/opencode/src/session/session.ts` — Session.Service.list
- `packages/opencode/src/project/project.ts` — Project.Service.list

### Key Decisions

- D-01: 完全按 Workbench 自有归组，不沿用 opencode 的 project_id 归组逻辑
- D-02: Project = 空间下的一级 git repo（`projects/`, `labs/`, `.wopal/` 等顶层目录下的 git repo）；空间根本身是 git repo 也算一个 project
- D-03: 会话归组用 session.directory 匹配项目 worktree 或子目录，不用 session.project_id
- D-04: worktree 会话归主项目，通过 `git worktree list` 关联；worktree 已删除/状态不正常 → 会话不展示（归档语义，从视图层隐藏）
- D-05: 会话标记：无标记=directory=项目根；（目录）=子目录；（工作树）=worktree
- D-06: realpath 统一匹配：space.path realpath 后匹配，session.directory 已是真实路径直接用
- D-07: 后端 API 返回完整归组结构（含 session 列表摘要），不返回完整 session 详情（详情复用现有 session.get）
- D-08: 目录搜索端点限制返回前 50，模糊匹配空间下子目录
- D-09: 全部后端改造放在一个 Plan，不拆分

### Key Interfaces

```ts
// ============ 需求 A: 会话归组 ============

const WorkbenchSessionMarker = Schema.Literal("", "directory", "worktree")
// "" = 项目根会话; "directory" = 子目录会话; "worktree" = 工作树会话

const WorkbenchSessionSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  marker: WorkbenchSessionMarker,         // 标记来源
  agent: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
  timeArchived: Schema.optional(Schema.Number),
})

const WorkbenchDirectoryGroup = Schema.Struct({
  path: Schema.String,                    // 子目录路径
  sessionCount: Schema.Number,
  sessions: Schema.Array(WorkbenchSessionSummary),  // 子目录下的会话
})

const WorkbenchWorktreeGroup = Schema.Struct({
  worktreePath: Schema.String,            // worktree 真实路径
  branch: Schema.optional(Schema.String),  // 分支名
  stale: Schema.Boolean,                  // worktree 是否已删除/状态不正常
  sessionCount: Schema.Number,            // 始终为 0（stale 时不展示会话）
  sessions: Schema.Array(WorkbenchSessionSummary),  // 非 stale 时才填充
})

const WorkbenchProject = Schema.Struct({
  path: Schema.String,                    // 项目根真实路径
  displayPath: Schema.String,              // 显示路径（预留软链接友好显示）
  name: Schema.optional(Schema.String),    // 项目名（从目录名或 Project.Info.name 取）
  vcs: Schema.optional(Schema.Literal("git")),
  sessionCount: Schema.Number,             // 会话总数（含子目录和 worktree）
  rootSessions: Schema.Array(WorkbenchSessionSummary),  // directory=项目根的会话
  directories: Schema.Array(WorkbenchDirectoryGroup),   // 子目录分组
  worktrees: Schema.Array(WorkbenchWorktreeGroup),       // 工作树分组
})

const WorkbenchSpaceOverviewResponse = Schema.Struct({
  spaceName: Schema.String,
  spacePath: Schema.String,
  spaceRootSessionCount: Schema.Number,   // directory=spacePath 的会话数（空间根本身不是 git repo 时的兜底会话）
  spaceRootSessions: Schema.Array(WorkbenchSessionSummary),
  projects: Schema.Array(WorkbenchProject),
})

const WorkbenchNonSpaceOverviewResponse = Schema.Struct({
  // 不在任何空间下的 session，按 directory 分组
  orphanDirectories: Schema.Array({
    path: Schema.String,
    sessionCount: Schema.Number,
    sessions: Schema.Array(WorkbenchSessionSummary),
  }),
})

// ============ 需求 B: 目录搜索 ============

const WorkbenchSearchDirectory = Schema.Struct({
  path: Schema.String,                    // 真实路径
  displayPath: Schema.String,
  isGitRepo: Schema.Boolean,              // 是否 git repo（决定是否可作为 project）
})

const WorkbenchSearchDirectoriesResponse = Schema.Struct({
  directories: Schema.Array(WorkbenchSearchDirectory),
})

const WorkbenchRecentDirectoriesResponse = Schema.Struct({
  directories: Schema.Array(WorkbenchSearchDirectory),
})
```

## In Scope

- 新增 `wopal-space.spaceOverview({ spaceName })`：返回空间下完整归组结构（projects 含 rootSessions/directories/worktrees 分组 + 空间根会话）
- 新增 `wopal-space.nonSpaceOverview()`：返回不在任何空间下的 session 按 directory 分组
- 新增 `wopal-space.searchDirectories({ spaceName, query })`：模糊匹配空间下子目录，限制前 50
- 新增 `wopal-space.recentDirectories({ spaceName })`：返回最近开过 session 的目录
- 归组逻辑：用 session.directory 匹配 project（一级 git repo）+ git worktree list 关联 worktree 回主项目
- 会话标记：无标记=项目根；（目录）=子目录；（工作树）=worktree
- stale worktree 检测：worktree 路径不存在或 git 状态不正常 → sessionCount=0，sessions=[]（归档语义，视图层不展示）
- realpath 统一匹配
- 单元测试：覆盖空间内/非空间/worktree/stale/realpath/搜索边界

## Out of Scope

- 前端实现（属前端 Plan）
- 完整 session 详情（复用现有 session.get）
- worktree ↔ 主 repo 的"按 repo 归并视图"（第一阶段每个 worktree 会话归主项目节点下，不独立成节点）
- 修改 session.list 或 session.get（前端懒加载详情时复用现有 API）
- 修改数据库 schema（不新增字段，纯查询时归组）
- 快速 Terminal 入口（用户确认移除，降低复杂度）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| wopal-space API 组定义 | `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` | 修改 | 新增 4 个端点定义 + Workbench 归组 schema |
| wopal-space handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` | 修改 | 实现 4 个 handler：归组、搜索、最近 |
| 归组工具 | `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space-grouping.ts` | 创建 | 归组逻辑抽出独立模块：扫描一级 git repo、git worktree list、session 归组、stale 检测 |
| SDK 类型 | `packages/sdk/` | 重新生成 | `./packages/sdk/js/script/build.ts` |
| 单元测试 | `packages/opencode/test/server/wopal-space-overview.test.ts` | 创建 | 覆盖归组/搜索/stale/realpath 场景 |

## Acceptance Criteria

### Agent Verification

1. [x] `rg -c 'spaceOverview' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
2. [x] `rg -c 'nonSpaceOverview' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
3. [x] `rg -c 'searchDirectories' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
4. [x] `rg -c 'recentDirectories' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
5. [x] `rg -c 'WorkbenchProject' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
6. [ ] `rg -c 'git worktree list\|worktree.*list\|listWorktrees' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space-grouping.ts` ≥ 1
7. [ ] `rg -c 'realpath' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space-grouping.ts` ≥ 1
8. [ ] `rg -c 'stale' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space-grouping.ts` ≥ 1
9. [x] `cd packages/opencode && bun typecheck` 全部 pass
10. [ ] `cd packages/opencode && bun test --timeout 30000 test/server/wopal-space-overview.test.ts` 全部 pass
11. [ ] `rg -c 'wopalSpace\.spaceOverview\|wopalSpace\.searchDirectories' packages/sdk/` ≥ 1（SDK 已重新生成）

### User Validation

#### Scenario 1: 空间会话归组
- Goal: 确认 `wopal-space.spaceOverview({ spaceName: "wopal-workspace" })` 返回正确的归组结构
- Precondition: ellamaka serve 已启动，wopal-workspace 空间有多个 project 和 session
- User Actions:
  1. 调用 API 传入 wopal-workspace 空间名
  2. 观察返回的 projects 数组，每个含 path/rootSessions/directories/worktrees
  3. 确认 wopal-workspace 空间根的 36 个会话归到对应 project 的 rootSessions 或 spaceRootSessions
  4. 确认 ellamaka project 的 poc/web session 标记为 marker="directory"
- Expected Result: 会话按 Workbench 模型正确归组，marker 标记准确

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 2: 非空间会话
- Goal: 确认 `wopal-space.nonSpaceOverview()` 返回不在任何空间下的 session
- Precondition: 数据库有 global project 的 session（如 Desktop/nen、coding 父目录）
- User Actions:
  1. 调用 nonSpaceOverview API
  2. 观察返回的 orphanDirectories 数组
  3. 确认 Desktop/nen 和 coding 父目录的 session 都在
- Expected Result: 非空间 session 正确归组

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 3: 目录搜索
- Goal: 确认 `wopal-space.searchDirectories({ spaceName, query: "ellamaka" })` 返回匹配的目录
- Precondition: wopal-workspace 下有 projects/ellamaka 目录
- User Actions:
  1. 调用 searchDirectories 传入 query="ellamaka"
  2. 观察返回的 directories 数组含 projects/ellamaka
  3. 测试 query 为空或超短时仍能返回合理结果
- Expected Result: 模糊匹配正确，限制前 50

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: API 组定义 + Workbench 归组 schema

**Verification Intent**: AC#1-5

**Behavior**: 在 wopal-space API 组新增 4 个端点定义和完整 Workbench 归组 schema。

**Files**: `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts`

**Pre-read**: `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts`, `packages/opencode/src/server/routes/instance/httpapi/groups/project.ts`（端点定义风格）

**Design**:
在现有 wopal-space.ts 的 HttpApiGroup 中追加 4 个端点：
- `spaceOverview`：GET `/wopal-space/space-overview`，query={ spaceName }，success=WorkbenchSpaceOverviewResponse
- `nonSpaceOverview`：GET `/wopal-space/non-space-overview`，success=WorkbenchNonSpaceOverviewResponse
- `searchDirectories`：GET `/wopal-space/search-directories`，query={ spaceName, query }，success=WorkbenchSearchDirectoriesResponse
- `recentDirectories`：GET `/wopal-space/recent-directories`，query={ spaceName }，success=WorkbenchRecentDirectoriesResponse

新增所有 Workbench 归组 schema（见 Key Interfaces）：WorkbenchSessionMarker、WorkbenchSessionSummary、WorkbenchDirectoryGroup、WorkbenchWorktreeGroup、WorkbenchProject、WorkbenchSpaceOverviewResponse、WorkbenchNonSpaceOverviewResponse、WorkbenchSearchDirectory、WorkbenchSearchDirectoriesResponse、WorkbenchRecentDirectoriesResponse。

沿用 Authorization middleware，与 spaces 端点一致。

**TDD**: true

**Changes**:
1. 定义所有 Workbench 归组 schema（WorkbenchSessionMarker/Summary/DirectoryGroup/WorktreeGroup/Project 等）
2. 定义 4 个响应 schema（SpaceOverview/NonSpaceOverview/SearchDirectories/RecentDirectories）
3. 定义 query schema（spaceOverview={spaceName}, searchDirectories={spaceName,query}, recentDirectories={spaceName}）
4. 在 HttpApiGroup 追加 4 个端点定义，每个 annotateMerge OpenApi 元数据

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，AC#1-5 的 rg 命令全部 ≥ 1

**Done**:
任务产出：wopal-space API 组新增 4 个端点定义 + 完整 Workbench 归组 schema
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 2: 归组工具模块（git worktree list + session 归组 + stale 检测）

**Verification Intent**: AC#6, AC#7, AC#8

**Behavior**: 独立归组工具模块，实现"扫描一级 git repo、git worktree list 关联、session 按 directory 归组、stale 检测"逻辑。输入 spaceRealPath + 所有 session 列表 → 输出 WorkbenchProject[] + spaceRootSessions。

**Files**: `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space-grouping.ts`

**Pre-read**: `packages/opencode/src/session/session.ts`（Session.Info 结构）, `packages/opencode/src/project/project.ts`（Project.Service.list）

**Design**:
归组模块导出纯函数 `groupSessionsBySpace(spaceRealPath, sessions, projects)`，返回 `{ projects, spaceRootSessions }`。逻辑：

1. **扫描一级 git repo**：
   - 读 spaceRealPath 下一层目录列表（`fs.readdir`）
   - **跳过 spaceRealPath 本身**（不把空间根作为 project，即使它是 git repo）
   - 对每个子目录 `git -C <child> rev-parse --show-toplevel`：
     - 成功 → 是 git repo，toplevel 是 repo 根
     - 失败 → 非 git repo，跳过
   - 去重（多个子目录可能同属一个 repo 根）

2. **worktree 关联回主项目**：
   - 对每个 project（一级 git repo），执行 `git -C <repoRoot> worktree list --porcelain`
   - 解析输出得到所有 worktree（含主 worktree 和独立 worktree）
   - 主 worktree 即 repo 根，独立 worktree 是 `.worktrees/xxx` 等路径
   - 每个 worktree 作为 project 的 WorkbenchWorktreeGroup

3. **session 归组**：
   - 遍历所有 session（不限 project_id，用 session.directory）
   - **过滤已归档会话**：`session.timeArchived != null` 的 session 跳过，不进入任何归组（左侧树不展示归档会话）
   - 对每个 session，匹配其 directory：
     - directory === spaceRealPath → **始终归 spaceRootSessions**（不管空间根是否 git repo，空间根会话不进任何 project）
     - directory 落在某 project root 下（`dir === root || dir.startsWith(root + "/")`）：
       - dir === root → rootSessions，marker=""
       - dir 是子目录 → directories 分组，marker="directory"
     - directory 落在某 worktree 下：
       - dir === worktreePath → 该 worktree 的 sessions，marker="worktree"
       - dir 是 worktree 子目录 → 该 worktree 的 directories 分组（标记仍是 "worktree"）
     - directory 落在 spaceRealPath 下但不匹配任何 project/worktree → 归 spaceRootSessions（兜底）

4. **stale 检测**：
   - `fs.existsSync(worktreePath)` 为 false → stale=true
   - `git -C <worktreePath> status` 失败 → stale=true
   - stale=true 时 sessionCount=0, sessions=[]（归档语义，视图层不展示该 worktree 的会话）
   - stale project（project root 不存在）同样 stale=true，整个 project 不展示

5. **realpath 处理**：
   - space.path → `fs.realpath()` → spaceRealPath（失败回退原 path）
   - session.directory 和 project.worktree 已是真实路径直接用
   - 匹配用真实路径

6. **project name 取值**：
   - 优先从 Project.Info.name（opencode project 表）取
   - 为空时从目录名取（path.basename）

**TDD**: true

**Changes**:
1. 创建 `wopal-space-grouping.ts`，定义归组函数签名和类型
2. 实现 `scanFirstLevelGitRepos(spaceRealPath)`：扫描一级 git repo（用 git rev-parse 检测）
3. 实现 `listProjectWorktrees(repoRoot)`：`git worktree list --porcelain` 解析，返回 worktree 列表（含分支名）
4. 实现 `checkWorktreeStale(worktreePath)`：fs.existsSync + git status 检测
5. 实现 `groupSessionsBySpace(spaceRealPath, sessions, projects)`：主归组函数，组合上述工具，输出 WorkbenchProject[] + spaceRootSessions
6. 实现 `realpathSafe(p)`：realpath 包裹，失败回退原 path
7. 实现 `getProjectName(projectInfo, path)`：从 Project.Info.name 或 basename 取

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，AC#6-8 的 rg 命令全部 ≥ 1

**Done**:
任务产出：归组工具模块，含 git worktree list、session 归组、stale 检测、realpath
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 3: 4 个 handler 实现（spaceOverview/nonSpaceOverview/searchDirectories/recentDirectories）

**Verification Intent**: AC#9

**Behavior**: 实现 4 个端点的 handler 逻辑，组合归组工具模块和 Session.Service。

**Files**: `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts`

**Pre-read**: Task 1 groups/wopal-space.ts, Task 2 wopal-space-grouping.ts, `packages/opencode/src/session/session.ts`

**Design**:
在现有 wopal-space.ts handler 中追加 4 个 handler，引入 Session.Service 和归组模块：

**spaceOverview({ spaceName })**:
1. 读 spaces → 找 spaceName 对应 space.path → realpath → spaceRealPath
2. `Session.Service.list()` → 所有 session
3. `Project.Service.list()` → 所有 project（取 name 用）
4. 调 `groupSessionsBySpace(spaceRealPath, sessions, projects)` → 归组结果
5. 过滤 sessions 只保留 directory 落在 spaceRealPath 下的（归组函数内已做）
6. 构造 WorkbenchSpaceOverviewResponse 返回

**nonSpaceOverview()**:
1. 读所有 spaces → 所有 space.path realpath → spaceRealPaths 集合
2. `Session.Service.list()` → 所有 session
3. 过滤 session.directory 不在任何 spaceRealPaths 下的
4. 按 directory 分组 → orphanDirectories
5. 构造 WorkbenchNonSpaceOverviewResponse 返回

**searchDirectories({ spaceName, query })**:
1. 找 spaceName → spaceRealPath
2. 递归扫描 spaceRealPath 下子目录（限制深度 3-4 层，避免 labs 下成千上万目录）
3. 模糊匹配 query（路径片段包含 query 即可，大小写不敏感）
4. 限制返回前 50
5. 对每个结果 `git -C <path> rev-parse` 检测 isGitRepo
6. 构造 WorkbenchSearchDirectoriesResponse 返回

**recentDirectories({ spaceName })**:
1. 找 spaceName → spaceRealPath
2. `Session.Service.list()` → 过滤 directory 落在 spaceRealPath 下的
3. 按 directory 去重，按 timeCreated 倒序取前 20
4. 对每个 directory 检测 isGitRepo
5. 构造 WorkbenchRecentDirectoriesResponse 返回

**搜索递归深度**：默认 3 层，避免全量扫描。labs/ref-repos/ 下虽有上千 repo，但深度限制下只扫到 labs/ref-repos 这一层（不进入其子目录）。

**TDD**: true

**Changes**:
1. 引入 Session.Service、Project.Service、归组模块
2. 实现 spaceOverview handler
3. 实现 nonSpaceOverview handler
4. 实现 searchDirectories handler（含递归扫描 + 深度限制 + 模糊匹配 + 前 50 限制）
5. 实现 recentDirectories handler
6. 在 handlers.handle 链追加 4 个 handler

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，`rg -c 'spaceOverview' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` ≥ 1

**Done**:
任务产出：4 个 handler 实现，组合归组工具 + Session.Service + Project.Service
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 4: 单元测试

**Verification Intent**: AC#10

**Behavior**: 单元测试覆盖归组/搜索/stale/realpath 全场景。

**Files**: `packages/opencode/test/server/wopal-space-overview.test.ts`

**Pre-read**: `packages/opencode/test/server/`（现有 server 测试风格）, `packages/opencode/test/fixture/fixture.ts`（tmpdir）, Task 1-3 实现

**Design**:
用 tmpdir fixture 搭建测试目录结构（含 git init、worktree add、session 插入数据库），覆盖：

1. 空间内 project 归组：一级 git repo 的 session 归到 rootSessions
2. 子目录 session 归组：directory=project 子目录 → directories 分组，marker="directory"
3. worktree session 归组：worktree 下创建 session → 归主项目 worktrees 分组，marker="worktree"
4. stale worktree：删除 worktree 目录 → stale=true, sessions=[]
5. 空间根 session（空间根非 git repo）：directory=spacePath → spaceRootSessions
6. 非空间 session：directory 不在任何空间 → orphanDirectories
7. realpath：space.path 是软链接，realpath 后匹配
8. 搜索：query 匹配子目录，限制前 50
9. 搜索深度限制：深层子目录不被扫描
10. 边界：空间不存在、空 query、空 session 列表

用 `it.live(...)` + tmpdir（含 git 真实操作），避免 mock。

**TDD**: true

**Changes**:
1. 创建 `test/server/wopal-space-overview.test.ts`，用 tmpdir fixture 搭建测试结构
2. 编写测试用例 1-3（project/子目录/worktree 归组）
3. 编写测试用例 4-5（stale worktree、空间根 session）
4. 编写测试用例 6-7（非空间、realpath）
5. 编写测试用例 8-10（搜索、深度限制、边界）

**Verify**:
`cd packages/opencode && bun test --timeout 30000 test/server/wopal-space-overview.test.ts` 全部 pass

**Done**:
任务产出：归组/搜索/stale/realpath 全场景单元测试
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 5: SDK 重新生成

**Verification Intent**: AC#11

**Behavior**: 重新生成 SDK 类型，确保 wopalSpace.spaceOverview/nonSpaceOverview/searchDirectories/recentDirectories 可用。

**Files**: `packages/sdk/`（重新生成）

**Pre-read**: `packages/sdk/js/script/build.ts`, Task 1-3 完成

**Design**:
端点和 handler 实现完成后，运行 SDK 重新生成脚本。检查新类型存在。

**TDD**: false（脚本生成）

**Changes**:
1. 运行 `./packages/sdk/js/script/build.ts`
2. 检查生成的类型含 wopalSpace.spaceOverview/searchDirectories 等
3. 运行 `cd packages/opencode && bun typecheck` 确认无类型错误

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，AC#11 rg 命令 ≥ 1

**Done**:
任务产出：SDK 重新生成，4 个新端点类型可用
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | 端点定义 + schema 独立先建 |
| 1 | Task 2 | fae | 无 | 归组工具模块独立，不依赖端点定义 |
| 2 | Task 3 | fae | Task 1, 2 | handler 依赖端点 schema 和归组工具 |
| 3 | Task 4 | fae | Task 1, 2, 3 | 测试依赖实现完成 |
| 3 | Task 5 | fae | Task 1, 3 | SDK 生成依赖端点定义稳定 |

Wave 1 内 Task 1 和 Task 2 可并行。Wave 3 内 Task 4 和 Task 5 可并行。

不委派 rook 审查（用户指示 rook 不可用）。实施完成后由 Wopal 逐项实证 Agent Verification AC，再进入用户验证。
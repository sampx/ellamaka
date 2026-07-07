# feature-workbench-wopal-space-projects-and-non-space-projects-api

## Metadata

- **Issue**: #（无 Issue，Plan 驱动）
- **Type**: feature
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka
- **Created**: 2026-07-07
- **Status**: planning

## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## Goal

为 wopal-space API 组新增两个端点：`wopal-space.projects({ spaceName })` 返回指定空间下的项目目录列表（含会话数聚合），`wopal-space.nonSpaceProjects()` 返回不在任何已注册空间路径下的项目目录列表。为 Workbench 三级 Session Browser 提供后端数据能力。

## Technical Context

### Architecture Context

当前 `wopal-space` API 组只有 `spaces` 端点（`groups/wopal-space.ts`），返回 `~/.wopal/config/settings.jsonc` 里注册的所有空间。`project.list` 端点（`handlers/project.ts:14`）返回数据库里所有打开过的项目，**无空间过滤**，且 `Project.Info` 无 spaceName 字段，只有 `worktree` 路径。

Workbench 三级树需要"指定空间下的项目列表"，但 `project.list` 返回全局所有项目，前端过滤低效且逻辑分散。需要后端按空间路径过滤并聚合会话数。

session.list 已支持 `{ directory }` 过滤（`session.ts:290` ListInput），前端展开项目节点时复用此 API 懒加载会话，本 Plan 不涉及 session.list 改动。

### Research Findings

- `wopal-space` API 组位于 `groups/wopal-space.ts` + `handlers/wopal-space.ts`，已有 `spaces` 端点读 `settings.jsonc`
- `project.list` 的 `svc.list()` 无参数，返回 `Project.Info[]`，含 `worktree`（真实路径，opencode 存储时已 realpath）
- `session.list({ directory })` 已支持按目录过滤，返回 `Session.Info[]`，含 `directory` 字段
- 软链接处理：opencode 存储时已统一 realpath，后端匹配时用数据库里的真实路径；space.path 来自 settings.jsonc 需 realpath 后再匹配
- `WopalSpaceEntry` 类型已定义在 `groups/wopal-space.ts:7`：`{ name, path, type? }`

**参考资料**：
- `docs/ELLAMAKA-WORKBENCH-STEP5-DESIGN.zh-CN.md` §3.4 数据源章节
- `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts`
- `packages/opencode/src/project/project.ts` — Project.Info + Service
- `packages/opencode/src/session/session.ts` — Session.list + ListInput

### Key Decisions

- D-01: 新端点放在 `wopal-space` API 组下，不污染上游 `project` API（wopal 概念归 wopal-space）
- D-02: 返回项目目录列表（含会话数聚合），不返回 session 列表（session 懒加载复用 session.list）
- D-03: 项目目录来源是 project 表与 session 表的并集：project.worktree 落在 spacePath 下的，加上 session.directory 落在 spacePath 下的，去重
- D-04: 软链接统一 realpath 匹配：space.path 来自 settings.jsonc 需 realpath，project.worktree/session.directory 已是真实路径直接用
- D-05: 匹配规则 `worktree === spaceRealPath || worktree.startsWith(spaceRealPath + "/")`
- D-06: 非空间项目单独端点 `nonSpaceProjects`，返回不在任何已注册空间路径下的项目目录
- D-07: 返回结构含 `path`（真实路径，用于匹配和 session.list 参数）和 `displayPath`（原始路径，用于显示，当前阶段两者相同，为未来软链接友好显示预留）

### Key Interfaces

```ts
// 新增 schema（groups/wopal-space.ts）
const WopalSpaceProject = Schema.Struct({
  path: Schema.String,           // 真实路径（realpath 后，用于 session.list 的 directory 参数）
  displayPath: Schema.String,     // 显示路径（当前=真实路径，预留软链接友好显示）
  name: Schema.optional(Schema.String),   // 项目名（从 Project.Info.name 取，可能为空）
  hasSessions: Schema.Boolean,   // 是否有会话
  sessionCount: Schema.Number,   // 会话数
})

const WopalSpaceProjectsResponse = Schema.Struct({
  projects: Schema.Array(WopalSpaceProject),
})

const WopalSpaceProjectsQuery = Schema.Struct({
  spaceName: Schema.String,      // 空间名
})

// 新增端点
wopal-space.projects({ query: { spaceName } })  → WopalSpaceProjectsResponse
wopal-space.nonSpaceProjects()                   → WopalSpaceProjectsResponse
```

## In Scope

- 新增 `wopal-space.projects` 端点：按 spaceName 查 spacePath → realpath → 过滤 project.worktree + session.directory 落在该路径下的项目目录，聚合会话数，去重返回
- 新增 `wopal-space.nonSpaceProjects` 端点：返回不在任何已注册空间路径下的项目目录，含会话数聚合
- realpath 处理：space.path realpath 后匹配，project/session 路径已是真实直接用
- 按项目目录聚合会话数（session.directory 分组 count）
- 单元测试：覆盖空间内项目、非空间项目、边界（路径前缀匹配、realpath、空结果）

## Out of Scope

- session.list 改动（前端懒加载复用现有 API）
- 前端实现（属前端 Plan 的 Task 5）
- 数据库 schema 变更（不新增 spaceName 字段，纯路径匹配）
- 软链接友好显示（displayPath 当前=真实路径，仅预留字段）
- 空间与项目的显式数据库关联（后续如需再扩展）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| wopal-space API 组定义 | `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` | 修改 | 新增 projects/nonSpaceProjects 端点定义 + WopalSpaceProject schema |
| wopal-space handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` | 修改 | 实现 projects/nonSpaceProjects 逻辑：读空间、realpath、过滤、聚合 |
| SDK 类型 | `packages/sdk/` | 重新生成 | `./packages/sdk/js/script/build.ts` 重新生成 SDK 类型 |
| 单元测试 | `packages/opencode/test/server/wopal-space-projects.test.ts` | 创建 | 覆盖空间内/非空间/边界场景 |

## Acceptance Criteria

### Agent Verification

1. [ ] `rg -c 'projects' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1（端点已定义）
2. [ ] `rg -c 'nonSpaceProjects' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
3. [ ] `rg -c 'WopalSpaceProject' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1
4. [ ] `rg -c 'realpath' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` ≥ 1
5. [ ] `cd packages/opencode && bun typecheck` 全部 pass
6. [ ] `cd packages/opencode && bun test --timeout 30000 test/server/wopal-space-projects.test.ts` 全部 pass
7. [ ] `rg -c 'wopalSpace\.projects\|wopalSpace\.nonSpaceProjects' packages/sdk/` ≥ 1（SDK 已重新生成）

### User Validation

#### Scenario 1: 空间项目列表
- Goal: 确认 `wopal-space.projects({ spaceName: "main" })` 返回 main 空间下的项目目录
- Precondition: ellamaka serve 已启动，settings.jsonc 已注册 main 空间，数据库有项目记录
- User Actions:
  1. 调用 API（curl 或前端）传入 main 空间名
  2. 观察返回的 projects 数组，每个含 path/displayPath/hasSessions/sessionCount
  3. 确认返回的项目路径都在 main 空间路径下
- Expected Result: 返回正确的空间内项目列表，会话数正确

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 2: 非空间项目列表
- Goal: 确认 `wopal-space.nonSpaceProjects()` 返回不在任何空间下的项目
- Precondition: 数据库有不在任何已注册空间路径下的项目记录
- User Actions:
  1. 调用 nonSpaceProjects API
  2. 观察返回的项目都不在任何已注册空间路径下
- Expected Result: 返回游离项目列表

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: wopal-space.projects 和 nonSpaceProjects 端点定义

**Verification Intent**: AC#1, AC#2, AC#3

**Behavior**: 在 wopal-space API 组新增 projects 和 nonSpaceProjects 两个 GET 端点定义，含 WopalSpaceProject schema 和 query 参数。输入 HttpApiGroup 定义 → 输出含两个新端点的 WopalSpaceApi。

**Files**: `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts`

**Pre-read**: `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts`, `packages/opencode/src/server/routes/instance/httpapi/groups/project.ts`（参考端点定义风格）

**Design**:
在现有 wopal-space.ts 的 HttpApiGroup 中追加两个端点：
- `projects`：GET `/wopal-space/projects`，query 含 spaceName，success 为 WopalSpaceProjectsResponse
- `nonSpaceProjects`：GET `/wopal-space/non-space-projects`，无 query，success 为 WopalSpaceProjectsResponse

新增 schema：WopalSpaceProject（path/displayPath/name?/hasSessions/sessionCount）、WopalSpaceProjectsResponse（projects 数组）、WopalSpaceProjectsQuery（spaceName）。

遵循现有端点定义风格：`.annotateMerge(OpenApi.annotations({ identifier, summary, description }))`。沿用 Authorization middleware。

**TDD**: true

**Changes**:
1. 定义 WopalSpaceProject schema（path/displayPath/name?/hasSessions/sessionCount）
2. 定义 WopalSpaceProjectsResponse schema（projects 数组）
3. 定义 WopalSpaceProjectsQuery schema（spaceName）
4. 在 HttpApiGroup 中追加 `projects` 端点（GET /wopal-space/projects，query=spaceName，success=WopalSpaceProjectsResponse）
5. 在 HttpApiGroup 中追加 `nonSpaceProjects` 端点（GET /wopal-space/non-space-projects，success=WopalSpaceProjectsResponse）
6. 两个端点均 annotateMerge OpenApi 元数据（identifier/summary/description）

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，`rg -c 'projects' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1，`rg -c 'nonSpaceProjects' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1，`rg -c 'WopalSpaceProject' packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` ≥ 1

**Done**:
任务产出：wopal-space API 组新增 projects 和 nonSpaceProjects 端点定义 + schema
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 2: wopal-space handler 实现（projects + nonSpaceProjects）

**Verification Intent**: AC#4, AC#5

**Behavior**: 实现 projects 和 nonSpaceProjects 的 handler 逻辑。输入 spaceName → 输出该空间下的项目目录列表（含会话数聚合）；无参数 → 输出非空间项目列表。realpath 统一匹配。

**Files**: `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts`

**Pre-read**: `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts`（现有 readSpaces 逻辑）, `packages/opencode/src/project/project.ts`（Project.Service.list）, `packages/opencode/src/session/session.ts`（Session.Service.list）, Task 1 的 groups/wopal-space.ts

**Design**:
在现有 wopal-space.ts handler 中追加两个 handler：

**projects handler**:
1. 读 settings.jsonc 获取所有 spaces（复用现有 readSpaces）
2. 找到 spaceName 对应的 space，取 space.path
3. realpath(space.path) → spaceRealPath（用 Node fs.realpath 或 effect FileSystem）
4. 调 Project.Service.list() 获取所有项目，filter `worktree === spaceRealPath || worktree.startsWith(spaceRealPath + "/")`
5. 调 Session.Service.list() 获取所有 session，按 directory 聚合 count（Map<directory, count>），filter directory 落在 spaceRealPath 下
6. 合并两个来源的目录去重（Set），每个目录构造 WopalSpaceProject：path=真实路径，displayPath=真实路径，name=从 Project.Info.name 取（可能为空），hasSessions=sessionMap.has(path)，sessionCount=sessionMap.get(path) ?? 0
7. 返回 { projects: [...] }

**nonSpaceProjects handler**:
1. 读 settings.jsonc 获取所有 spaces，每个 space.path realpath → spaceRealPaths 集合
2. 调 Project.Service.list()，filter worktree 不在任何 spaceRealPath 下（`!spaceRealPaths.some(sp => worktree === sp || worktree.startsWith(sp + "/"))`）
3. 调 Session.Service.list()，按 directory 聚合 count，filter directory 不在任何 spaceRealPath 下
4. 同样合并去重，构造 WopalSpaceProject 返回

**realpath 处理**：用 `Effect.promise(() => fs.promises.realpath(p))` 或 effect FileSystem 的 realpath API。注意 space.path 可能不存在（已删除目录），realpath 失败时回退用原 path 匹配（容错）。

Project.Service 和 Session.Service 通过 `yield*` 获取，与现有 handler 风格一致。

**TDD**: true

**Changes**:
1. 引入 Project.Service 和 Session.Service（yield* 获取）
2. 实现 realpath 辅助函数（Effect 包裹，失败回退原 path）
3. 实现 `projects` handler：读 space → realpath → 过滤 project + session 聚合 → 去重 → 返回
4. 实现 `nonSpaceProjects` handler：读所有 spaces → realpath 集合 → 过滤不在任何空间下的 project + session 聚合 → 返回
5. 在 handlers.handle 链追加两个新 handler

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，`rg -c 'realpath' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` ≥ 1，`rg -c 'Project\.Service' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` ≥ 1，`rg -c 'Session\.Service' packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` ≥ 1

**Done**:
任务产出：projects 和 nonSpaceProjects handler 实现，含 realpath、project+session 聚合、去重
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 3: 单元测试

**Verification Intent**: AC#6

**Behavior**: 单元测试覆盖空间内项目、非空间项目、边界场景。输入测试 fixture → 输出正确的项目列表和会话数聚合。

**Files**: `packages/opencode/test/server/wopal-space-projects.test.ts`

**Pre-read**: `packages/opencode/test/server/`（参考现有 server 测试风格）, `packages/opencode/test/fixture/fixture.ts`（tmpdir 等 fixture）, Task 1 和 Task 2 实现

**Design**:
测试用 tmpdir fixture 创建临时目录结构模拟空间和项目：
- 临时目录下创建 spaceA/、spaceB/、nonSpace/ 三个目录
- spaceA/ 下创建 projectA1/、projectA2/ 两个项目目录
- spaceB/ 下创建 projectB1/
- nonSpace/ 下创建 orphanProject/
- settings.jsonc 模拟注册 spaceA 和 spaceB
- 数据库插入 project 记录（worktree 指向上述目录）和 session 记录（directory 指向上述目录，部分有多个 session）

测试用例：
1. `projects({ spaceName: "spaceA" })` 返回 projectA1 和 projectA2，sessionCount 正确
2. `projects({ spaceName: "spaceB" })` 返回 projectB1
3. `projects({ spaceName: "nonExist" })` 返回空数组
4. `nonSpaceProjects()` 返回 orphanProject
5. 边界：项目 worktree 正好等于 spacePath（非 startsWith），应包含
6. 边界：项目 worktree 为 spacePath 的兄弟目录（如 spaceA-sibling），不应包含（startsWith(spacePath + "/") 不匹配兄弟）
7. 软链接：space.path 是软链接指向真实目录，realpath 后应正确匹配

用 `it.instance(...)` 或 `it.live(...)` + tmpdir fixture，参考现有 server 测试。避免 mock，测真实实现。

**TDD**: true

**Changes**:
1. 创建 `test/server/wopal-space-projects.test.ts`，用 tmpdir fixture 搭建测试目录结构
2. 编写测试用例 1-3（空间内项目列表）
3. 编写测试用例 4（非空间项目）
4. 编写测试用例 5-6（边界：等于 spacePath、兄弟目录）
5. 编写测试用例 7（软链接 realpath）

**Verify**:
`cd packages/opencode && bun test --timeout 30000 test/server/wopal-space-projects.test.ts` 全部 pass

**Done**:
任务产出：wopal-space projects 和 nonSpaceProjects 的单元测试，覆盖空间内/非空间/边界/软链接
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 4: SDK 重新生成 + 类型检查

**Verification Intent**: AC#7

**Behavior**: 重新生成 SDK 类型，确保 wopalSpace.projects 和 wopalSpace.nonSpaceProjects 类型可用。输入新增端点 → 输出更新后的 SDK 类型文件。

**Files**: `packages/sdk/`（重新生成）

**Pre-read**: `packages/sdk/js/script/build.ts`, Task 1 和 Task 2 完成

**Design**:
端点和 handler 实现完成后，运行 SDK 重新生成脚本。生成后检查新类型 `wopalSpace.projects` 和 `wopalSpace.nonSpaceProjects` 是否存在。前端 Plan 的 Task 5 依赖这些 SDK 类型。

**TDD**: false（脚本生成，非逻辑代码）

**Changes**:
1. 运行 `./packages/sdk/js/script/build.ts` 重新生成 SDK
2. 检查生成的类型文件包含 wopalSpace.projects 和 wopalSpace.nonSpaceProjects
3. 运行 `cd packages/opencode && bun typecheck` 确认无类型错误

**Verify**:
`cd packages/opencode && bun typecheck` 全部 pass，`rg -c 'wopalSpace\.projects\|wopalSpace\.nonSpaceProjects' packages/sdk/` ≥ 1

**Done**:
任务产出：SDK 重新生成，wopalSpace.projects 和 nonSpaceProjects 类型可用
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | 端点定义独立，先建 schema 和 API 声明 |
| 1 | Task 2 | fae | Task 1 | handler 依赖端点定义的 schema 和参数 |
| 2 | Task 3 | fae | Task 1, 2 | 测试依赖实现完成 |
| 2 | Task 4 | fae | Task 1, 2 | SDK 生成依赖端点定义稳定 |

Wave 1 内 Task 1 和 Task 2 有依赖（Task 2 依赖 Task 1 的 schema），按 1→2 顺序执行。Wave 2 内 Task 3 和 Task 4 可并行。

不委派 rook 审查（用户指示 rook 不可用）。实施完成后由 Wopal 逐项实证 Agent Verification AC，再进入用户验证。
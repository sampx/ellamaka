# feature-workbench-panel-session-model-and-3-level-session-browser

## Metadata

- **Issue**: #（无 Issue，Plan 驱动）
- **Type**: feature
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka
- **Created**: 2026-07-07
- **Status**: reviewing

## Scope Assessment

- **Complexity**: High
- **Confidence**: High

## Goal

将 Workbench 的 Panel 从直接持有 PTY/directory 的模型重构为"Session 持久资源 + Panel 视图容器"模型，左侧导航升级为 Space→Project→Session 三级会话浏览器，Panel 头部引入可扩展视图注册表（TUI/Chat/Terminal），新增 Context Popup 与重组拆分菜单。

## Technical Context

### Architecture Context

当前 Workbench（`packages/ellamaka-app/src/pages/workbench/`）的 Panel 直接持有 mode/directory/ptyId，无"会话"抽象层。三个核心问题：

1. 关掉 Panel 就丢失对话上下文，无法在另一个 Panel 继续同一会话
2. 左侧只有空间列表（`sidebar.tsx` 单层 Space），无处查看项目目录和会话
3. Panel 创建即默认 TUI，无"空槽位"概念，多 Panel 场景易误覆盖

本次重构引入 Session 实体（持久资源）与 Panel（视图容器）分离模型，Panel 三态（empty/configuring/bound），左侧导航升级为三级树，Panel 头部通过 viewRegistry 动态渲染视图按钮。

涉及模块：`pages/workbench/` 全部（view.tsx、panel.tsx、sidebar.tsx、space-store.tsx）、新增 view-registry、session-store、panel-loader、session-tree、context-popup 组件。

### Research Findings

设计稿已落定：`docs/ELLAMAKA-WORKBENCH-STEP5-DESIGN.zh-CN.md`，含 10 项决策记录和 6 个实施阶段。

**参考资料**：
- `docs/ELLAMAKA-WORKBENCH-STEP5-DESIGN.zh-CN.md` — 本 Plan 的设计真相源
- `docs/ELLAMAKA-WORKBENCH.zh-CN.md` §12.1 — 原有 Chat 面板架构设计

### Key Decisions

- D-01: Session 是持久资源（idle/bound/archived 状态机），独立于 Panel 存在
- D-02: Panel 是视图容器（empty/configuring/bound 三态），持有 Session 引用而非拥有
- D-03: 同一 Session 同时只能绑一个 Panel（决策 A）
- D-04: Panel 关闭时 Session 解绑回 idle，TUI 进程 detach 不杀（决策 B）
- D-05: 新建会话落在第一个空 Panel（决策 C）
- D-06: 横向最多 3 Panel，每个可上下拆分内嵌终端，合计最多 6 视图（决策 C'，沿用 splitTerminal）
- D-07: 视图类型通过 viewRegistry 动态注册，第一阶段 TUI/Chat/Terminal，后续可加 file/diff（决策 D+4）
- D-08: Terminal 视图不绑 Session，复用 boundSession 目录开裸 PTY（决策 3）
- D-09: 新建会话默认 Chat，后续加配置项（决策 5）
- D-10: 第一阶段不设快捷键（决策 6）
- D-11: Context 以 Popup/Popover 展现，不占 Panel 布局（决策 1）
- D-12: 保留官方 `...` 展开菜单（决策 2）
- D-13: 去掉 Space 联动；保留 Project 点击推送目录到空 Panel 装载器（决策 E）

### Key Interfaces

```ts
// Session 实体（新增）
type SessionType = "tui" | "chat"
type Session = {
  id: string
  spaceName: string
  projectPath: string
  type: SessionType
  title: string
  status: "idle" | "bound" | "archived"
  boundPanelId?: string
  createdAt: number
  lastActiveAt: number
}

// Panel（重构）
type PanelSlotState = "empty" | "open" | "bound"
type PanelViewMode = string  // "tui" | "chat" | "terminal" | "context" | 可扩展
type WorkbenchPanel = {
  id: string
  slotState: PanelSlotState
  boundSessionId?: string  // bound 时指向 Session（open 时为空）
  viewMode?: PanelViewMode
  width: number
  tuiPtyId?: string
  termPtyId?: string
  splitTerminal?: boolean
  splitPtyId?: string
  splitHeight?: number
}

// 视图注册表（新增）
type PanelViewDef = {
  id: string
  label: string
  icon?: string
  requiresSession: boolean
  showContext: boolean
  availableInOpen: boolean  // open 状态（裸 Terminal 无 Session）下是否可用
  render: (ctx: PanelViewCtx) => JSX
}
const viewRegistry: PanelViewDef[] = []
```

## In Scope

- 引入 Session 实体与 session-store（CRUD、状态、与 Panel 绑定关系）
- Panel state 重构：empty/open/bound 三态，boundSessionId/viewMode
- viewRegistry 机制：注册 TUI/Chat/Terminal/Context 四种视图，头部按钮和菜单动态渲染
- 空 Panel 装载器（PanelLoader）：选择 Space/Project/Type 启动会话 + "快速打开当前空间 Terminal"快捷入口
- 拖放恢复：idle Session 拖入空/open Panel，TUI 走 `--continue`，Chat 走 resume API
- 关闭 Panel 确认对话框与资源释放（TUI PTY 正常关闭，serve 端状态保留）
- 视图切换：TUI/Chat/Terminal 单视图切换，过渡动画；open 状态下 TUI/Chat 灰显触发装载器
- Context Popup（圆环指示器 + popup，复用官方 session-context-usage 数据）+ Context 视图占位（注册到 viewRegistry，后续实现）
- 拆分菜单重组（Session/Panel/视图三组，禁用项灰显，无快捷键）
- 左侧 sidebar 重写为完整全景的三级树（所有 Space→Project→Session 始终可见）
- Space tab 与左侧树联动：切 tab 激活焦点到对应 Space 节点并展开，不过滤树；有 bound Panel 时弹确认（含"不再提示"勾选，偏好持久化）
- Project 点击推送目录到空 Panel 装载器，无空 Panel 时状态栏提示
- Session 右键菜单（重命名、归档、在新 Panel 中打开）
- Terminal 视图（open 用 Space 根目录，bound 用 boundSession 目录，不绑 Session）
- Chat 视图集成（对接官方 MessageTimeline + SessionComposerRegion）

## Out of Scope

- 移动端路由 `/m`（属 Step 6）
- file/diff 等后续扩展视图（本 Plan 只建 registry 机制，不实现具体扩展视图）
- 快捷键（决策 6，后续单独分析官方 app 快捷键架构）
- 后端 session 协议变更（CLI `--continue` 与 session resume API 已支持，本次只做前端）
- 修改 `packages/app` 上游组件（继续包装层方式）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| Panel 状态模型 | `packages/ellamaka-app/src/pages/workbench/view.tsx` | 修改 | Panel state 重构：slotState/boundSessionId/viewMode |
| Panel 渲染 | `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx` | 修改 | 三态渲染、头部重设计、拖放 drop zone、视图切换 |
| 左侧导航 | `packages/ellamaka-app/src/pages/workbench/parts/sidebar.tsx` | 重写 | 三级树、去联动、拖拽源、右键菜单 |
| Space store | `packages/ellamaka-app/src/pages/workbench/space-store.tsx` | 修改 | tabs 语义弱化，不联动 Panel |
| 视图注册表 | `packages/ellamaka-app/src/pages/workbench/view-registry.tsx` | 创建 | 视图定义注册，头部和菜单动态渲染 |
| Session store | `packages/ellamaka-app/src/pages/workbench/session-store.tsx` | 创建 | Session 实体管理：CRUD、状态、绑定关系 |
| Session store service | `packages/ellamaka-app/src/pages/workbench/services/session-store-service.ts` | 创建 | Session 持久化 |
| 空 Panel 装载器 | `packages/ellamaka-app/src/pages/workbench/parts/panel-loader.tsx` | 创建 | 空 Panel 装载器 UI |
| 三级树 | `packages/ellamaka-app/src/pages/workbench/parts/session-tree.tsx` | 创建 | Space→Project→Session 树渲染 |
| Context popup | `packages/ellamaka-app/src/pages/workbench/parts/context-popup.tsx` | 创建 | Context 指示器 + popup |
| Chat 视图 | `packages/ellamaka-app/src/pages/workbench/parts/panel-chat.tsx` | 创建 | Chat 视图容器 |
| Chat 头部 | `packages/ellamaka-app/src/pages/workbench/parts/panel-chat-header.tsx` | 创建 | Chat 视图头部 |
| Chat composer | `packages/ellamaka-app/src/pages/workbench/parts/panel-chat-composer.tsx` | 创建 | Chat 输入区适配 |
| Chat state hook | `packages/ellamaka-app/src/pages/workbench/hooks/use-panel-chat-state.ts` | 创建 | 面板级 Chat 状态 |

## Acceptance Criteria

### Agent Verification

1. [ ] `rg -c 'slotState' packages/ellamaka-app/src/pages/workbench/view.tsx` ≥ 1
2. [ ] `rg -c 'boundSessionId' packages/ellamaka-app/src/pages/workbench/view.tsx` ≥ 1
3. [ ] `rg -c 'viewRegistry' packages/ellamaka-app/src/pages/workbench/` ≥ 3
4. [ ] `rg -c 'PanelLoader' packages/ellamaka-app/src/pages/workbench/parts/` ≥ 2
5. [ ] `rg -c 'SessionTree' packages/ellamaka-app/src/pages/workbench/` ≥ 2
6. [ ] `rg -c 'ContextPopup' packages/ellamaka-app/src/pages/workbench/` ≥ 2
7. [ ] `rg -c 'slotState.*empty.*open.*bound' packages/ellamaka-app/src/pages/workbench/view.tsx` ≥ 1（三态 empty/open/bound）
8. [ ] `rg -c 'PanelChat' packages/ellamaka-app/src/pages/workbench/parts/panel-chat.tsx` ≥ 1
9. [ ] `cd packages/ellamaka-app && bun run typecheck` 全部 pass
10. [ ] `cd packages/ellamaka-app && bun run build` 全部 pass

### User Validation

#### Scenario 1: 空 Panel 装载会话
- Goal: 确认空 Panel 能选择 Space/Project/Type 并启动会话
- Precondition: Workbench 已加载，至少有一个空 Panel
- User Actions:
  1. 观察空 Panel 显示装载器（Space/Project/Type 选择 + 开始会话按钮）
  2. 选择 Space、Project、Type（Chat），点击开始会话
  3. 观察会话启动，Chat 视图渲染，左侧树出现该 Session 节点
- Expected Result: 空 Panel 成功装载会话，左侧树同步显示

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 2: 拖放恢复会话
- Goal: 确认 idle Session 可拖入空 Panel 恢复
- Precondition: 左侧树有 idle Session，有一个空 Panel
- User Actions:
  1. 从左侧树拖拽 idle Session 节点到空 Panel
  2. 观察 Session 恢复，Panel 显示会话内容
  3. 左侧树节点状态变绿（bound）
- Expected Result: 拖放恢复成功，Session 状态正确变化

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 3: 视图切换
- Goal: 确认 Panel 内 TUI/Chat/Terminal 三视图可切换
- Precondition: 一个 bound Panel 正在运行会话
- User Actions:
  1. 点击头部 TUI/Chat/Terminal 按钮切换视图
  2. 观察视图切换过渡动画，内容正确渲染
  3. 切到 Terminal，确认是裸 PTY，基于 boundSession 目录
- Expected Result: 三视图切换流畅，Terminal 不绑 Session

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 4: 关闭 Panel 确认
- Goal: 确认关闭 bound Panel 弹确认对话框，确认后资源释放
- Precondition: 一个 bound Panel 正在运行会话
- User Actions:
  1. 点击关闭 bound Panel
  2. 观察弹确认对话框，显示会话标题
  3. 确认关闭，观察 Panel 移除，左侧树节点变灰（idle）
- Expected Result: 确认对话框正常，资源正确释放，Session 回 idle

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 5: 三级 Session Browser
- Goal: 确认左侧树显示 Space→Project→Session 三级，Space 不联动 Panel
- Precondition: Workbench 有多个 Space 和已创建的 Session
- User Actions:
  1. 观察左侧树显示三级结构
  2. 点击不同 Space，观察右侧 Panel 不变（无联动）
  3. 点击 Project，观察空 Panel 装载器预填该目录
  4. 右键 Session，确认菜单项（重命名、归档、在新 Panel 中打开）
- Expected Result: 三级树正确，Space 无联动，Project 推送目录，右键菜单可用

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 6: Context Popup
- Goal: 确认 Context 指示器点击弹出 Popup，显示 token/usage/cost
- Precondition: 一个 bound Panel 正在 Chat 视图运行
- User Actions:
  1. 观察头部右侧有圆环指示器
  2. 点击指示器，观察 Popup 弹出，显示 token/usage/cost
  3. 点击外部或 Esc，观察 Popup 关闭
- Expected Result: Popup 正常弹出和关闭，数据正确显示

- [ ] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 7: 拆分菜单重组
- Goal: 确认 `...` 菜单分组合理，禁用项灰显
- Precondition: Workbench 已加载
- User Actions:
  1. 点击 bound Panel 的 `...` 菜单
  2. 观察 Session 操作组、Panel 操作组、视图组三组
  3. 测试上下拆分（添加/关闭内嵌终端）
  4. 测试向右添加 Panel（满 3 个后禁用）
- Expected Result: 菜单分组清晰，禁用项正确灰显，操作正常

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: Session 实体类型与 session-store 基础

**Verification Intent**: AC#1, AC#2

**Behavior**: Session 实体类型定义 + session-store 创建，提供 CRUD 和状态管理 API。输入 session 数据 → 输出 store 中新增/更新/删除的 session 实体。

**Files**: `packages/ellamaka-app/src/pages/workbench/session-store.tsx`, `packages/ellamaka-app/src/pages/workbench/services/session-store-service.ts`

**Pre-read**: `packages/ellamaka-app/src/pages/workbench/view.tsx`, `packages/ellamaka-app/src/pages/workbench/space-store.tsx`, `packages/ellamaka-app/src/utils/persist.ts`

**Design**:
Session 是持久资源，独立于 Panel。session-store 用 createStore 管理 Session 实体列表，提供 createSession、updateSession、deleteSession、bindPanel、unbindPanel、archiveSession 等 API。持久化用 Persist 工具按空间粒度存储，每个空间保留最近 50 条，超出自动清理。session-store-service 封装持久化读写逻辑，与 store 解耦。

session-store 与 view.tsx 的 WorkbenchState 解耦，独立 context，避免循环依赖。Panel 通过 boundSessionId 引用 Session，Session 通过 boundPanelId 引用 Panel，双向引用在 bind/unbind 时同步更新。

**TDD**: true

**Changes**:
1. 创建 `session-store.tsx`，定义 Session 类型、SessionStore context，实现 createSession/updateSession/deleteSession/bindPanel/unbindPanel/archiveSession API
2. 创建 `services/session-store-service.ts`，封装 Persist 读写，按空间粒度存储，最近 50 条限制
3. 在 `packages/ellamaka-app/src/pages/workbench/index.tsx`（或 view.tsx 的 provider 处）注入 SessionStoreProvider

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，且 `rg -c 'createSession' packages/ellamaka-app/src/pages/workbench/session-store.tsx` ≥ 1

**Done**:
任务产出：Session 实体类型与 session-store 基础，含 CRUD、状态管理、持久化
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 2: Panel 状态模型重构（empty/open/bound 三态）

**Verification Intent**: AC#1, AC#2, AC#7

**Behavior**: WorkbenchPanel 类型从 mode/direct 耦合改为 empty/open/bound 三态，boundSessionId/viewMode。输入旧 Panel state → 输出可迁移到新 state 的 Panel，保留旧字段兼容期。

**Files**: `packages/ellamaka-app/src/pages/workbench/view.tsx`

**Pre-read**: Task 1 的 session-store.tsx

**Design**:
WorkbenchPanel 增加 slotState（empty/open/bound）、boundSessionId、viewMode 字段。empty = 完全空显示装载器；open = 有裸 Terminal 无 Session（快速 Terminal 入口产生）；bound = 绑了 Session，三视图完整切换。保留 mode/directory 字段作为兼容期。addPanel 改为创建 empty Panel。新增 bindSessionToPanel、unbindSessionFromPanel、setPanelSlotState、setPanelViewMode、openTerminalInPanel（empty→open 转换）API。setPanelMode 废弃，用 setPanelViewMode 替代。

兼容策略：旧持久化数据中的 Panel（有 mode 无 slotState）在 ensureSpace 时迁移：有 tuiPtyId 则 bound，有 termPtyId 则 open，否则 empty。

**TDD**: true

**Changes**:
1. 修改 WorkbenchPanel 类型，增加 slotState（empty/open/bound）/boundSessionId/viewMode，保留 mode/directory 兼容
2. 修改 addPanel，创建 empty Panel（mode 置空）
3. 新增 bindSessionToPanel/unbindSessionFromPanel/setPanelSlotState/setPanelViewMode/openTerminalInPanel API
4. 新增旧 state 迁移逻辑（ensureSpace 中检测旧 Panel 并迁移 slotState：有 tuiPtyId→bound，有 termPtyId→open，否则 empty）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'slotState' packages/ellamaka-app/src/pages/workbench/view.tsx` ≥ 1，`rg -c 'boundSessionId' packages/ellamaka-app/src/pages/workbench/view.tsx` ≥ 1，`rg -c 'openTerminalInPanel' packages/ellamaka-app/src/pages/workbench/view.tsx` ≥ 1

**Done**:
任务产出：Panel 状态模型重构，三态 empty/open/bound + Session 引用 + 兼容迁移
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 3: viewRegistry 机制

**Verification Intent**: AC#3

**Behavior**: 视图注册表，注册 TUI/Chat/Terminal/Context 四种视图定义，头部按钮和菜单动态渲染。输入视图 id → 输出 PanelViewDef（label/icon/requiresSession/showContext/availableInOpen/render）。

**Files**: `packages/ellamaka-app/src/pages/workbench/view-registry.tsx`

**Pre-read**: `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx`, `packages/ellamaka-app/src/pages/workbench/view.tsx`

**Design**:
viewRegistry 是一个 PanelViewDef[] 数组，应用启动时注册 TUI/Chat/Terminal/Context。每个 PanelViewDef 包含 id/label/icon/requiresSession/showContext/availableInOpen/render。TUI/Chat/Context requiresSession=true，Terminal requiresSession=false。Terminal availableInOpen=true（open 状态可用），其他 availableInOpen=false（open 状态灰显，点击触发装载器）。TUI/Chat showContext=true，Terminal/Context showContext=false。头部视图切换按钮从 viewRegistry 遍历渲染，按 slotState 过滤可用视图。新增视图只需 registerView()，无需改头部和菜单逻辑。

render 函数接收 PanelViewCtx（panel、session、directory、sdk 等），返回 JSX。本 Task 建 registry 框架和 TUI/Terminal 的 render（复用现有 Terminal 组件），Chat render 留空壳由 Task 9 填充，Context render 留空壳（后续实现，本 Plan 只注册占位）。

**TDD**: true

**Changes**:
1. 创建 `view-registry.tsx`，定义 PanelViewDef/PanelViewCtx 类型（含 availableInOpen 字段），实现 viewRegistry 数组和 registerView/getView/listViews API
2. 注册 TUI 视图（requiresSession=true, availableInOpen=false, render 复用现有 Terminal + PTY 逻辑）
3. 注册 Terminal 视图（requiresSession=false, availableInOpen=true, render 复用现有 terminal mode 的 PTY 逻辑）
4. 注册 Chat 视图占位（requiresSession=true, availableInOpen=false, render 返回占位 UI，由 Task 9 填充）
5. 注册 Context 视图占位（requiresSession=true, availableInOpen=false, showContext=false, render 返回占位 UI，后续 Plan 实现）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'viewRegistry' packages/ellamaka-app/src/pages/workbench/view-registry.tsx` ≥ 1，`rg -c 'availableInOpen' packages/ellamaka-app/src/pages/workbench/view-registry.tsx` ≥ 1

**Done**:
任务产出：viewRegistry 机制 + TUI/Terminal 视图定义 + Chat/Context 占位
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 4: 空 Panel 装载器（PanelLoader + 快速 Terminal）

**Verification Intent**: AC#4

**Behavior**: empty Panel 显示装载器（Space/Project/Type 选择 + 开始会话）+ "快速打开当前空间 Terminal"快捷入口。输入空 Panel + 用户选择 → 输出 bound Panel with new Session；或输入空 Panel + 点快速 Terminal → 输出 open Panel with 裸 Terminal。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/panel-loader.tsx`

**Pre-read**: Task 1 session-store.tsx, Task 2 view.tsx 新 API, `packages/ellamaka-app/src/pages/workbench/space-store.tsx`

**Design**:
PanelLoader 是 empty Panel 的内容区组件，上半部分展示三个选择器（Space 下拉、Project 下拉、Type 分段按钮）和"开始会话"按钮；中间分隔线"── 或 ──"；下半部分"快速打开当前空间 Terminal"按钮（零摩擦入口）。

开始会话流程：调用 session-store.createSession（type=chat/tui, spaceName, projectPath）→ view.bindSessionToPanel(panelId, sessionId) → setSlotState("bound") → setViewMode(session.type)。

快速 Terminal 流程：view.openTerminalInPanel(panelId, spaceRootPath) → setSlotState("open") → setViewMode("terminal") → 创建裸 PTY（cwd=spaceRootPath）。不创建 Session，PTY 用当前 Space 根目录。

支持左侧 Project 点击推送目录预填（决策 E）：通过 context 或 prop 接收预填的 spaceName/projectPath，自动填入选择器。

**TDD**: false（UI 组件，人工验证）

**Changes**:
1. 创建 `panel-loader.tsx`，渲染 Space/Project/Type 选择器 + 开始会话按钮 + 分隔线 + 快速 Terminal 按钮
2. 实现开始会话逻辑：createSession → bindSessionToPanel → setSlotState(bound)/setViewMode
3. 实现快速 Terminal 逻辑：openTerminalInPanel → setSlotState(open)/setViewMode(terminal) → 创建裸 PTY
4. 实现预填机制：接收预填的 spaceName/projectPath 并填入选择器
5. 在 panel.tsx 的 empty 状态分支渲染 PanelLoader

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'PanelLoader' packages/ellamaka-app/src/pages/workbench/parts/panel-loader.tsx` ≥ 1，`rg -c '快速.*Terminal\|quickTerminal\|openTerminalInPanel' packages/ellamaka-app/src/pages/workbench/parts/panel-loader.tsx` ≥ 1

**Done**:
任务产出：空 Panel 装载器组件，支持会话装载 + 快速 Terminal 零摩擦入口
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 5: 左侧三级 Session Browser（完整全景 + tab 联动）

**Verification Intent**: AC#5, AC#7

**Behavior**: 左侧从单层 Space 列表升级为完整全景的三级树（所有 Space→Project→Session 始终可见），tab 切换激活焦点到对应 Space 节点并展开。输入 Space/Project/Session 数据 → 输出完整三级树，tab 切换高亮对应 Space，有 bound Panel 时弹确认。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/sidebar.tsx`, `packages/ellamaka-app/src/pages/workbench/parts/session-tree.tsx`

**Pre-read**: Task 1 session-store.tsx, `packages/ellamaka-app/src/pages/workbench/parts/sidebar.tsx`, `packages/ellamaka-app/src/pages/workbench/space-store.tsx`, `packages/ellamaka-app/src/pages/workbench/view.tsx`

**Design**:
sidebar.tsx 重写为三级树容器，内部渲染 SessionTree 组件。树始终展示所有 Space 的完整层级（Space → Project → Session），不按 tab 过滤。当前 tab 对应的 Space 节点高亮激活，Project 默认展开；其他 Space 节点也可见，用户可手动展开/收起浏览。

Tab 切换联动：切换 tab 时，左侧树激活焦点到对应 Space 节点（高亮 + 展开 Project + 滚动可见），其他 Space 节点保持展开/收起状态不变。若当前 tab 有 bound Panel，切换前弹确认对话框，提示"当前空间有会话正在运行，切换空间不会中断它们，切回此 Tab 可继续。是否不再提示？"，提供"不再提示"勾选框，勾选后偏好持久化到 workbench display state。

Space 节点点击：非当前 tab 的 Space 节点点击 = 切换 tab（触发确认）。当前 tab 的 Space 节点点击只展开/收起。

Project 节点点击：展开/收起 + 推送目录到第一个空 Panel 装载器（通过 view.tsx 的 API 或 context）。无空 Panel 时状态栏提示"请先添加 Panel"。

Session 节点：显示状态点（idle 灰/bound 绿/archived 暗灰），点击 idle Session 高亮但不自动装载，点击 bound Session 聚焦其 Panel。Session 节点右键：重命名、归档/取消归档、在新 Panel 中打开（自动创建空 Panel 并装载）。Project 节点右键：新建会话（创建 idle Session，默认 chat）。

Panel 不跨空间：当前 tab 的 Panel 只能装该 Space 的 Session，session-store.createSession 时校验 spaceName 必须等于当前 tab。

**TDD**: false（树渲染，人工验证）

**Changes**:
1. 创建 `session-tree.tsx`，实现完整全景的 Space→Project→Session 三级树渲染，含展开/收起、状态点、右键菜单
2. 重写 `sidebar.tsx`，渲染 SessionTree，保持所有 Space 可见，当前 tab Space 高亮激活
3. 实现 tab 切换联动：激活焦点到对应 Space 节点（高亮 + 展开 + 滚动可见），其他 Space 不变
4. 实现 tab 切换确认对话框（bound Panel 时弹，含"不再提示"勾选，偏好持久化）
5. 实现 Project 点击推送目录到空 Panel 装载器（通过回调或 context），无空 Panel 时状态栏提示
6. 实现 Session 右键菜单（重命名、归档、在新 Panel 中打开）
7. 实现 Project 右键菜单（新建会话，默认 chat，校验 spaceName=当前 tab）
8. 实现 Space 节点点击切换 tab 逻辑（非当前 tab Space 点击触发确认）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'SessionTree' packages/ellamaka-app/src/pages/workbench/parts/session-tree.tsx` ≥ 1，`rg -c '不再提示\|dontRemind\|suppressConfirm' packages/ellamaka-app/src/pages/workbench/parts/sidebar.tsx` ≥ 1

**Done**:
任务产出：完整全景三级 Session Browser + tab 联动 + 切换确认 + 右键菜单
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 6: 拖放恢复

**Verification Intent**: AC#4

**Behavior**: idle Session 拖入空 Panel 或 open Panel 恢复会话。输入拖拽 idle Session + drop 到空/open Panel → 输出 bound Panel with resumed Session，TUI 走 `--continue`，Chat 走 resume API。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx`, `packages/ellamaka-app/src/pages/workbench/parts/session-tree.tsx`

**Pre-read**: Task 1 session-store.tsx, Task 2 view.tsx 新 API, Task 3 view-registry.tsx, Task 5 session-tree.tsx

**Design**:
SessionTree 的 Session 节点设为 HTML5 drag source（draggable=true，dragstart 写入 sessionId）。Panel 设为 drop target（dragover preventDefault，drop 读取 sessionId）。Drop 时校验 Panel.slotState === "empty" 或 "open"，bound Panel 拒绝并提示"请先关闭当前会话或选择空 Panel"。

恢复逻辑：bindSessionToPanel → setSlotState("bound") → setViewMode(session.type) → TUI 启动 `--continue` PTY（连到 serve 恢复会话）；Chat 由 Task 9 实现真实 resume。

跨空间约束：拖拽时校验 Session.spaceName === 当前 tab 的 Space，不匹配则拒绝并提示"会话不属于当前空间，请切换到对应空间 tab"。

TUI 进程恢复：TUI PTY 正常关闭（退出 = PTY 关闭），serve 端状态保留，下次 `--continue` 重新连。Terminal PTY 和 split PTY 正常 kill。

**TDD**: false（拖放交互，人工验证）

**Changes**:
1. SessionTree 的 Session 节点增加 draggable=true 和 dragstart 处理（写入 sessionId + spaceName 到 dataTransfer）
2. Panel 增加 drop target 逻辑（dragover preventDefault、drop 读取 sessionId、校验 slotState=empty/open、校验 spaceName=当前 tab）
3. 实现恢复逻辑：bindSessionToPanel → setSlotState(bound) → setViewMode(session.type) → TUI 启动 `--continue` PTY
4. 二次拖入已 bound Session 时提示"已在 Panel #X 运行，是否移动？"（决策 A）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'draggable' packages/ellamaka-app/src/pages/workbench/parts/session-tree.tsx` ≥ 1

**Done**:
任务产出：拖放恢复机制，含 drag source、drop target、空/open 校验、跨空间拒绝、恢复逻辑
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 7: Panel 头部重设计（视图切换按钮 + 菜单重组 + 状态点 + 标题）

**Verification Intent**: AC#3, AC#10

**Behavior**: Panel 头部重设计，左侧状态点 + Session 标题，中间视图切换按钮（从 viewRegistry 动态渲染，按 slotState 过滤可用性），右侧 Context 指示器 + `...` 菜单。菜单分 Session/Panel/视图三组，禁用项灰显，无快捷键。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx`

**Pre-read**: Task 2 view.tsx 新 API, Task 3 view-registry.tsx, Task 6 拖放逻辑

**Design**:
头部布局：`[●状态点] Session标题(截断) [TUI|Chat|Terminal|...] [Context●] [⋯]`。视图切换按钮从 viewRegistry.listViews() 遍历渲染，按 slotState 过滤可用性：
- empty：无视图按钮（显示装载器）
- open：只显示 availableInOpen=true 的视图（terminal），tui/chat/context 灰显，点击触发装载器
- bound：显示所有 requiresSession 匹配的视图 + terminal

当前激活视图高亮。bound 状态显示 Session 标题（从 boundSession 获取）；open 状态显示目录路径；empty 状态显示 Panel 编号。

`...` 菜单三组：
- Session 组（仅 bound）：重命名、归档/取消归档、复制链接、在新 Panel 中打开
- Panel 组：上下拆分/关闭内嵌终端、向右添加 Panel、关闭此 Panel（bound 显示"关闭会话并移除"，open 显示"关闭 Terminal"，empty 显示"关闭 Panel"）
- 视图组（仅 open/bound）：切换为 TUI/Chat/Terminal（从 viewRegistry 遍历）

禁用项灰显保留原位。视图切换调 setPanelViewMode。empty 菜单只有 Panel 组（向右添加、关闭）。

视图切换过渡动画 150ms 淡入淡出（CSS transition）。

**TDD**: false（UI 重设计，人工验证）

**Changes**:
1. 重写 panel.tsx 头部布局，左侧状态点 + 标题（bound 显示 Session 标题，open 显示目录，empty 显示编号）
2. 中间视图切换按钮从 viewRegistry.listViews() 遍历渲染，按 slotState 过滤可用性（open 时 tui/chat 灰显）
3. 右侧 Context 指示器位置（Task 8 填充真实组件，仅 bound 且 showContext=true 时显示）
4. 重组 `...` 菜单为 Session/Panel/视图三组，按 slotState 显示/禁用
5. empty 状态头部简化为 `[空 Panel #N] [⋯]`
6. 视图切换过渡动画（CSS transition 150ms）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'viewRegistry' packages/ellamaka-app/src/pages/workbench/parts/panel.tsx` ≥ 1，`rg -c 'availableInOpen\|slotState' packages/ellamaka-app/src/pages/workbench/parts/panel.tsx` ≥ 1

**Done**:
任务产出：Panel 头部重设计，含三态视图可用性、状态点、标题、菜单重组、动画
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 8: Context Popup（指示器圆环 + popup）

**Verification Intent**: AC#6

**Behavior**: Panel 头部 Context 指示器圆环，点击弹出 Popup 显示 token/usage/cost。输入 boundSession 的 context 数据 → 输出圆环填充度 + Popup 详情。与 Context 视图（Task 3 注册占位）互补：Popup 快速瞄一眼，视图详细查看。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/context-popup.tsx`

**Pre-read**: `packages/ellamaka-app/src/components/session-context-usage.tsx`, Task 7 panel.tsx 头部, Task 3 view-registry.tsx

**Design**:
Context 指示器复用官方 `session-context-usage.tsx` 的圆环组件，填充度反映 token 使用率，颜色正常态灰/接近上限黄/超限红。点击弹出锚定式 popup/popover（用 @opencode-ai/ui/v2 的 Popover 或 Portal），显示 token 总量/上限、input/output/cache 分项、model、cost、压缩/清空按钮。点击外部或 Esc 关闭。仅 bound 且当前视图 showContext=true 时显示（terminal/context 视图隐藏，因为 terminal 无 session context，context 视图本身就是 context）。

数据获取复用官方 session-context-usage 的 hook 或 SDK 调用，包装为 popup 版本。

与 Task 3 注册的 Context 视图的区别：Popup 是头部圆环指示器 + 轻量弹出，不占 Panel 布局；Context 视图是注册到 viewRegistry 的主视图，占满 Panel，适合深度检查。本 Task 只做 Popup，Context 视图保持占位（后续 Plan 实现）。

**TDD**: false（UI 组件，人工验证）

**Changes**:
1. 创建 `context-popup.tsx`，实现圆环指示器（复用官方圆环组件）
2. 实现 Popup 内容（token/usage/cost 分项，从官方 session-context-usage 获取数据）
3. 实现点击弹出、外部/Esc 关闭逻辑
4. 在 panel.tsx 头部集成（仅 bound 且当前视图 showContext=true 时显示）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'ContextPopup' packages/ellamaka-app/src/pages/workbench/parts/context-popup.tsx` ≥ 1

**Done**:
任务产出：Context 指示器圆环 + Popup，复用官方数据，与 Context 视图互补
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 9: Chat 视图集成（PanelChat + 头部 + composer + state hook）

**Verification Intent**: AC#8

**Behavior**: Chat 视图容器，对接官方 MessageTimeline + SessionComposerRegion，包装为 Panel 内 Chat 视图。输入 boundSessionId → 输出 Chat 视图（消息时间线 + 输入区）。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/panel-chat.tsx`, `packages/ellamaka-app/src/pages/workbench/parts/panel-chat-header.tsx`, `packages/ellamaka-app/src/pages/workbench/parts/panel-chat-composer.tsx`, `packages/ellamaka-app/src/pages/workbench/hooks/use-panel-chat-state.ts`

**Pre-read**: `packages/app/src/pages/session/message-timeline.tsx`, `packages/app/src/pages/session/`, `packages/app/src/components/session-context-usage.tsx`, Task 3 view-registry.tsx

**Design**:
PanelChat 是 Chat 视图容器，编排内部布局（头部 → 消息区 → 输入区）。直接复用官方 `MessageTimeline` 渲染消息，复用 `SessionComposerRegion` 渲染输入。针对 Panel 上下文禁用居中布局、隐藏会话标题（由 Panel 头部替代），传递 Panel 的 directory 作为工作树上下文。

usePanelChatState 为每个 Panel 创建隔离的 Chat 状态：根据 boundSessionId 生成唯一会话键，使用官方 createSessionComposerState 工厂创建输入区状态，暴露 sessionKey/ready/composerState/inputRef/handleSubmit/handleResponse。挂载时确保会话存在（resume API 加载历史）。

PanelChatHeader 是 Panel 头部的一部分（与 Task 7 的头部协调），显示目录路径指示器、模型选择器、agent 选择器。PanelChatComposer 薄适配官方 SessionComposerRegion，禁用居中、inline 放置、传目录上下文。

最后填充 Task 3 view-registry 中 Chat 视图的 render 函数，指向 PanelChat。

**TDD**: false（UI 集成，人工验证）

**Changes**:
1. 创建 `hooks/use-panel-chat-state.ts`，实现面板级 Chat 状态隔离
2. 创建 `parts/panel-chat.tsx`，编排 MessageTimeline + 输入区，禁用居中、隐藏标题
3. 创建 `parts/panel-chat-header.tsx`，目录路径 + 模型/agent 选择器
4. 创建 `parts/panel-chat-composer.tsx`，薄适配 SessionComposerRegion
5. 填充 view-registry.tsx 中 Chat 视图的 render 函数指向 PanelChat
6. 确保 Chat 视图使用 v1 老设计（强制 newLayoutDesigns=false 上下文，见设计稿 §12.1.2）

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'PanelChat' packages/ellamaka-app/src/pages/workbench/parts/panel-chat.tsx` ≥ 1，`rg -c 'MessageTimeline' packages/ellamaka-app/src/pages/workbench/parts/panel-chat.tsx` ≥ 1

**Done**:
任务产出：Chat 视图集成，复用官方组件，面板级状态隔离
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

### Task 10: 关闭 Panel 确认对话框与资源释放

**Verification Intent**: AC#10

**Behavior**: 关闭 bound Panel 弹确认对话框，确认后释放资源。输入关闭 bound Panel 操作 → 输出确认对话框 → 确认后 PTY 释放、Session 解绑、Panel 移除。open Panel（裸 Terminal）关闭无需确认，直接释放 PTY 并移除。

**Files**: `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx`, `packages/ellamaka-app/src/pages/workbench/view.tsx`

**Pre-read**: Task 1 session-store.tsx, Task 2 view.tsx 新 API

**Design**:
关闭 bound Panel 时用 @opencode-ai/ui/v2 的 Dialog/AlertDialog 弹确认框，显示会话标题、提示"关闭后会话将解绑，可在左侧会话列表中恢复"。确认后：
1. TUI PTY 正常关闭（TUI 进程退出 = PTY 关闭，serve 端会话状态保留，下次 `--continue` 重新连）
2. Terminal PTY 和 split PTY 正常 kill（pty.remove）
3. session-store.unbindPanel（Session 回 idle）
4. view.removePanel（移除 Panel，编号顺移）
5. 若是最后一个 Panel，保留一个空 Panel

open Panel（裸 Terminal）关闭无需确认，直接：termPtyId kill → removePanel → 保留空 Panel 逻辑。empty Panel 关闭也无需确认，直接移除。

**TDD**: false（交互逻辑，人工验证）

**Changes**:
1. 在 panel.tsx 关闭逻辑中检测 slotState=bound，弹确认对话框；open/empty 直接关闭
2. 实现资源释放：bound 时 TUI PTY 正常关闭（不 pty.remove，让进程自然退出）、Terminal/split kill、Session 解绑、Panel 移除；open 时 termPtyId kill、Panel 移除
3. 处理最后一个 Panel 保留空 Panel 的逻辑

**Verify**:
`cd packages/ellamaka-app && bun run typecheck` 全部 pass，`rg -c 'unbindPanel\|unbindSessionFromPanel' packages/ellamaka-app/src/pages/workbench/` ≥ 1

**Done**:
任务产出：关闭 Panel 确认对话框与资源释放逻辑，bound 确认、open/empty 直接关闭
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | Session 基础设施，其他 Task 依赖它 |
| 1 | Task 3 | fae | 无 | viewRegistry 独立机制，不依赖 session-store |
| 2 | Task 2 | fae | Task 1 | Panel state 引用 Session，需 session-store 先就位 |
| 3 | Task 4 | fae | Task 1, 2, 3 | 装载器依赖 session-store + view 新 API + viewRegistry |
| 3 | Task 5 | fae | Task 1, 2 | 三级树依赖 session-store + view 新 API |
| 4 | Task 6 | fae | Task 1, 2, 3, 5 | 拖放依赖 session-tree + view + viewRegistry |
| 4 | Task 7 | fae | Task 2, 3 | 头部依赖 view 新 API + viewRegistry |
| 4 | Task 8 | fae | Task 3 | Popup 依赖 viewRegistry 的 showContext 判断 |
| 5 | Task 9 | fae | Task 3, 7 | Chat 视图填充 viewRegistry render，头部由 Task 7 完成 |
| 5 | Task 10 | fae | Task 1, 2 | 关闭逻辑依赖 session-store + view 新 API |

Wave 1 内 Task 1 和 Task 3 可并行（fae 分两个 task 执行）。Wave 3 内 Task 4 和 Task 5 可并行。Wave 4 内 Task 6/7/8 可并行。Wave 5 内 Task 9/10 可并行。

不委派 rook 审查（用户指示 rook 不可用）。实施完成后由 Wopal 逐项实证 Agent Verification AC，再进入用户验证。
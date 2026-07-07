# Workbench Step 5 补充设计：Session 与 Panel 模型重构

> 状态：待评审草稿
> 关联：`docs/ELLAMAKA-WORKBENCH.zh-CN.md` §Step 5 / §12.1
> 作用：在 Chat 面板集成之前，先重构 Panel 与 Session 的关系模型，并升级左侧导航为三级会话浏览器。
> 本文档为 Step 5 的前置设计补充，落地确认后应合并回主文档 §12.1。

---

## 1. 设计目标

当前 Workbench 的 Panel 直接持有 PTY 与目录，没有"会话"这一层抽象。这导致三个问题：

1. **会话无法跨 Panel 复用**——关掉 Panel 就丢失对话上下文，无法在另一个 Panel 继续同一会话。
2. **左侧只有空间列表**——空间下有哪些项目目录、每个目录下有哪些会话，无处可看，无处可回。
3. **Panel 创建即启动**——用户无法先准备一个空槽位再决定装载什么，多 Panel 场景下容易误覆盖正在运行的会话。

本次重构的目标是把"会话"提升为一等持久资源，把 Panel 降为可装载会话的视图容器，并把左侧导航升级为 Space → Project → Session 三级会话浏览器。

非目标：

- 不改变后端 session 协议（CLI `--continue <id>` 与 session resume API 已支持）。
- 不重构官方 `packages/app` 的 Chat 组件，继续以包装层方式复用。
- 不引入移动端 `/m` 路由相关改动（属 Step 6）。

---

## 2. 核心概念

### 2.1 Session（持久资源）

Session 是一次对话或终端会话的完整记录，独立于任何 Panel 存在。

```ts
type SessionType = "tui" | "chat"

type Session = {
  id: string                  // ellamaka session id
  spaceName: string           // 所属空间名
  projectPath: string          // 所属项目目录（绝对路径）
  type: SessionType            // 会话类型，创建后锁定
  title: string                // 显示名，默认取首条消息或目录名
  status: "idle" | "bound" | "archived"
  boundPanelId?: string        // 当前绑定的 Panel（idle 时为空）
  createdAt: number
  lastActiveAt: number
}
```

生命周期：

```
created → idle → bound(running) → idle → archived
                                  ↑
                              可被另一个 Panel 装载
```

- `created`：刚创建，尚未绑定任何 Panel。
- `idle`：未绑定 Panel，但可在左侧树中看到，随时可被拖入空 Panel 恢复。
- `bound`：正被某个 Panel 装载并运行。
- `archived`：归档，从默认列表折叠，不删除。

关键约束：

- 同一 Session 同一时刻只能绑定一个 Panel（决策 A）。
- Panel 关闭时 Session 解绑回 `idle`，TUI 进程 detach 不杀（决策 B）。
- Session 的 `type` 创建后锁定（tui 或 chat），但 Panel 内可在 TUI / Chat / Terminal 三种视图间切换（决策 2 + D）。

### 2.2 Panel（视图容器）

Panel 是工作区的视图槽位，本身不拥有会话，只持有对 Session 的临时引用。

```ts
type PanelSlotState = "empty" | "open" | "bound"

// 视图类型可扩展，第一阶段内置三种，后续可加 file/diff/context 等
type PanelViewMode = string   // "tui" | "chat" | "terminal" | "file" | "diff" | "context" | ...

type WorkbenchPanel = {
  id: string
  slotState: PanelSlotState
  boundSessionId?: string      // bound 时指向 Session（open 时为空）
  viewMode?: PanelViewMode     // 当前视图
  width: number
  // 运行时 PTY 句柄
  tuiPtyId?: string
  termPtyId?: string            // terminal 视图的裸 PTY
  splitTerminal?: boolean
  splitPtyId?: string
  splitHeight?: number
}
```

三种槽位状态：

| 状态 | 含义 | 视图能力 | boundSessionId |
|------|------|----------|----------------|
| `empty` | 完全空，无内容 | 显示装载器 + 快速 Terminal 按钮 | 无 |
| `open` | 有裸 Terminal（无 Session） | Terminal 视图为主；TUI/Chat 按钮可点，点击触发装载器 | 无 |
| `bound` | 绑了 Session | TUI/Chat/Terminal 三视图完整切换 | 有 |

状态转换：
- empty → 点"快速 Terminal" → open（Terminal 用当前 Space 根目录开裸 PTY）
- empty → 装载器选完 + 开始会话 → bound
- open → 切 TUI/Chat → 弹装载器 → 选完 Session → bound
- bound → 关闭/解绑 Session → empty
- open → 关闭 Terminal → empty

视图模式采用可扩展设计，通过视图注册表（View Registry）管理可用视图，而非硬编码联合类型。第一阶段内置三种视图，后续可扩展文件视图、diff 视图、context 视图等：

| 视图 id | 名称 | 数据来源 | 与 Session 关系 | 第一阶段 |
|---------|------|----------|-----------------|----------|
| `tui` | TUI | Session（ellamaka TUI 进程） | 绑定 Session，走 `--continue` 恢复 | ✅ |
| `chat` | Chat | Session（官方 MessageTimeline + Composer） | 绑定 Session，走 resume API | ✅ |
| `terminal` | Terminal | 不走 Session | 不绑 Session（open 状态用 Space 根目录，bound 状态用 boundSession 目录） | ✅ |
| `context` | Context | Session | 绑定 Session，封装官方 `SessionContextTab` 组件（token/usage/cost/breakdown/消息统计） | ✅（封装官方组件） |
| `file` | 文件 | 项目目录 | 不绑 Session，基于目录渲染文件树 | 后续 |
| `diff` | Diff | Session 或文件 | 可绑 Session 的 diff，也可独立文件 diff | 后续 |

Context 有两种展现方式共存：
- **Popup**（头部圆环指示器，快速瞄一眼）：保留，日常使用
- **Context 视图**（注册到 viewRegistry，占满 Panel 主视图）：详细查看 token 构成、消息历史统计、压缩历史等，适合深度检查

视图注册表设计：

```ts
type PanelViewDef = {
  id: string                   // "tui" | "chat" | "terminal" | "context" | "file" | ...
  label: string                // 头部按钮和菜单的显示名
  icon?: string                // 头部按钮图标
  requiresSession: boolean     // 是否必须绑 Session（tui/chat/context=true, terminal/file=false）
  showContext: boolean         // 是否显示 ContextPopup 指示器（tui/chat=true, terminal/context/file=false）
  availableInOpen: boolean     // open 状态（裸 Terminal 无 Session）下是否可用（terminal=true, tui/chat=false）
  render: (ctx: PanelViewCtx) => JSX   // 视图渲染函数
}

// 注册表，应用启动时填充
const viewRegistry: PanelViewDef[] = []
```

Panel 头部的视图切换按钮、菜单的视图组都从 `viewRegistry` 动态渲染：
- bound 状态：显示所有 `requiresSession` 匹配当前状态的视图
- open 状态：只显示 `availableInOpen=true` 的视图（terminal），TUI/Chat 按钮灰显，点击触发装载器

三种槽位状态：

| 状态 | 含义 | 可见内容 |
|------|------|----------|
| `empty` | 空 Panel，等待装载 | 装载器（选择 Space/Project/Type） |
| `configuring` | 用户在装载器中选择了配置，尚未确认启动 | 装载器（已填入选项） |
| `bound` | 已绑定 Session 并运行 | TUI 或 Chat 视图 |

### 2.3 层级关系

```
Space（工作区容器）
└── Project（项目目录）
    └── Session（持久会话资源）

Panel（视图容器，独立于层级树）
└── 装载一个 Session 的引用
```

- 左侧树承载 Space → Project → Session 的导航与浏览。
- 中央 Panel 区承载视图，与左侧树的浏览状态解耦。
- Panel 不出现在左侧树中；Session 在 Panel 中运行时，树节点显示"运行中"指示。

---

## 3. 左侧导航：三级 Session Browser

### 3.1 结构

左侧栏从"空间列表"升级为"会话浏览器"，呈现完整全景的三级树（所有 Space 始终可见）：

```
▾ wopal-workspace  ← 当前 tab 激活（高亮）
  ▾ ellamaka
      分析 Panel 会话展示方案          [Session · 运行中 #1]
      修复 Windows 插件加载失败        [Session]
  ▸ wopal-site
  ▸ space-flow
▸ gesp-workspace    ← 其他 Space 也可见，可展开浏览
  ▸ gesp
▸ other-space
```

### 3.2 交互语义

| 点击对象 | 行为 |
|----------|------|
| Space | 展开/收起其下 Project |
| Project | 展开/收起其下 Session；**同时**把该目录信息推送给第一个空 Panel 的装载器（决策 E） |
| Session（idle） | 选中高亮；不自动装载，需拖入空/open Panel |
| Session（bound） | 选中高亮并聚焦其所在 Panel；不改变 Panel 内容 |

关键原则：**点击 Session 不自动覆盖任何 Panel**。装载是显式操作（拖放或装载器选择）。

### 3.3 空间 Tab 与左侧树的联动

Workbench 以 Space Tab 为顶层工作上下文概念：

- 每个 Tab 对应一个 Space，持有独立的 `SpaceWorkbenchState`（panels、activePanelID 等）。
- **左侧树始终展示完整全景**：所有 Space → Project → Session 三级结构都可见，不按 tab 过滤。
- 切换 Tab = 切换 Space 工作上下文，左侧树同步：
  - 激活焦点到对应 Space 节点（高亮）
  - 自动展开该 Space 的 Project 子节点
  - 滚动到该 Space 节点可见位置
  - 其他 Space 节点保持当前展开/收起状态不变，不隐藏
- **Panel 不跨空间**：当前 Tab 的 Panel 只能装该 Space 的 Session，不允许跨空间装载。
- **Tab 切换确认**：如果当前 Tab 有 bound Panel（运行中的会话），切换到其他 Tab 时弹确认对话框，提示"当前空间有会话正在运行，切换空间不会中断它们，切回此 Tab 可继续。是否不再提示？"，提供"不再提示"勾选框，勾选后此偏好持久化。确认后切换，原 Tab 的 Panel 状态保留。
- 无 bound Panel 时切换 Tab 无需确认。

左侧树与 Tab 的关系：

- 树始终展示所有 Space 的完整层级（Space → Project → Session）。
- 当前 tab 对应的 Space 节点高亮激活，其 Project 默认展开。
- 其他 Space 节点也可见，用户可手动展开/收起浏览。
- Project 和 Session 的浏览不受 tab 限制，用户可在任何 Space 节点下浏览。
- 点击树中的 Space 节点（非当前 tab）= 切换 tab（触发上述确认逻辑）。

### 3.4 数据源（三个 API 均已存在）

| 树层级 | 数据源 | API | 参数 |
|--------|--------|-----|------|
| Space | `sdk.client.wopalSpace.spaces()` | wopal-space.spaces | 无，返回 `[{name, path, type}]` |
| Project | `sdk.client.project.list(...)` | project.list | `{ directory: <spacePath> }`，返回该 Space 下的项目目录 |
| Session | `sdk.client.session.list(...)` | session.list | `{ scope: "project", directory: <projectPath> }`，按项目目录过滤 |

数据加载策略：树节点展开时按需加载子节点（懒加载）。Space 节点展开 → 加载 Project 列表；Project 节点展开 → 加载 Session 列表。已加载节点缓存，避免重复请求。

session-store 中的本地 Session 实体与 session.list 返回的服务端 Session 合并去重：本地 Session 是 Workbench 创建的引用（boundPanelId 等运行时状态），服务端 Session 是 ellamaka serve 持有的真实记录（消息历史、上下文），两者通过 session id 关联。

### 3.4 Session 节点状态指示

每个 Session 节点显示一个状态点：

| 状态 | 颜色 | 含义 |
|------|------|------|
| idle | 灰 | 可拖入空/open Panel 恢复 |
| bound | 绿 | 正在某 Panel 运行，显示所在 Panel 编号 |
| archived | 暗灰 | 已归档，默认折叠 |

### 3.5 右键菜单（第一阶段最小集）

Session 节点右键菜单：

- 在新空 Panel 中打开（自动创建空 Panel 并装载）
- 重命名
- 归档 / 取消归档
- 删除（需二次确认）

Project 节点右键菜单：

- 新建会话（创建为 idle，不自动绑 Panel——决策 C 修正：创建为 idle，用户再拖入空 Panel）

Space 节点右键菜单（后续）：

- 刷新
- 折叠/展开所有

---

## 4. Panel 生命周期与装载器

### 4.1 空 Panel 装载器

`empty` 状态的 Panel 显示一个装载器组件 `PanelLoader`：

```
┌─────────────────────────────┐
│  [空 Panel 头部：Panel 编号 + 拆分/关闭菜单] │
├─────────────────────────────┤
│                              │
│   选择空间                    │
│   ▾ wopal-workspace          │
│                              │
│   选择项目目录                │
│   ▾ ellamaka                 │
│                              │
│   会话类型                    │
│   [ TUI ]  [ Chat ]          │
│                              │
│      [ 开始会话 ]             │
│                              │
│   ── 或 ──                   │
│                              │
│   [ 快速打开当前空间 Terminal ]│
│                              │
└─────────────────────────────┘
```

- 空间与项目目录可手动选择，也会被左侧 Project 点击预填（决策 E）。
- 类型选择 TUI 或 Chat，默认 Chat（决策 5）。
- 点击"开始会话"后：创建 Session → 绑定 Panel → 启动 PTY/Chat → Session 出现在左侧树 → Panel 进入 bound 状态。
- 点击"快速打开当前空间 Terminal"后：不创建 Session，用当前 Space 根目录开裸 PTY → Panel 进入 open 状态，viewMode=terminal。这是零摩擦入口，适合快速跑命令。

### 4.2 拖放恢复

- 左侧树中的 idle Session 节点可拖拽。
- 拖放目标：任意 `empty` Panel。
- 拖入 `bound` Panel 时拒绝，提示"请先关闭当前会话或选择空 Panel"。
- 拖入后：绑定 Session → 恢复（TUI 走 `opencode --continue <id>`，Chat 走 session resume）。

### 4.3 关闭 Panel（决策 C+用户补充）

关闭绑定会话的 Panel 时弹确认对话框：

```
┌──────────────────────────────┐
│  关闭此 Panel？                │
│                               │
│  Panel #2 正在运行会话：       │
│  "分析 Panel 会话展示方案"     │
│                               │
│  关闭后会话将解绑，可在左侧     │
│  会话列表中恢复。              │
│                               │
│  [ 取消 ]      [ 关闭 ]       │
└──────────────────────────────┘
```

确认后：

1. 释放 Panel 内 PTY 资源（TUI detach，split terminal kill）。
2. Session 状态回 `idle`。
3. 移除 Panel。
4. 若是最后一个 Panel，保留一个空 Panel（不允许零 Panel）。

### 4.4 Panel 编号

Panel 按从左到右顺序编号：

```
#1    #2    #3
```

- 默认 1 个 Panel（#1）。
- 向右添加 Panel 依次为 #2、#3，上限 3。
- 每个 Panel 内部上下拆分的内嵌终端与主视图共享同一 Panel 编号。
- 移除 Panel 后，右侧编号顺移（如移除 #2，原 #3 变 #2）。

---

## 5. 视图切换（决策 D）

### 5.1 模型

Session 有固定的 `type`（tui 或 chat），但 Panel 内可在多种视图间切换。视图类型由视图注册表（§2.2）管理，可扩展。第一阶段内置 TUI / Chat / Terminal 三种，后续可加 context / file / diff 等。

视图切换的可用性取决于 Panel 的 slotState：

| slotState | 可用视图 | 不可用视图（灰显，点击触发引导） |
|-----------|----------|-------------------------------|
| `empty` | 无（显示装载器） | 所有视图（用户需先装载或快速打开 Terminal） |
| `open` | `availableInOpen=true` 的视图（terminal） | tui/chat/context（灰显，点击弹装载器选 Session） |
| `bound` | 所有 `requiresSession` 匹配的视图 + terminal | — |

```ts
panel.viewMode: string   // 从 viewRegistry 中选一个
// panel.slotState 决定哪些视图可用
// panel.boundSessionId 指向的 Session.type 不变（bound 时）
// terminal 视图：open 状态用 Space 根目录，bound 状态用 boundSession 的 projectPath
```

### 5.2 切换体验

切换采用"单视图显式切换"，不同时显示两个视图（决策 D 用户要求）：

- Panel 头部提供视图切换分段按钮，按钮项从 `viewRegistry` 动态渲染（第一阶段为 TUI | Chat | Terminal，后续新增视图自动出现在按钮区）。
- 切换时有一个短暂的过渡动画（淡入淡出 150ms），避免突兀。
- 切换不重建 Session，只切换渲染层，调用目标视图的 `render` 函数：
  - TUI 视图：复用已有 PTY（若 TUI 进程已退出则重新 `--continue` 恢复，serve 端状态保留）。
  - Chat 视图：用 session id 加载官方 `MessageTimeline` + `SessionComposerRegion`。
  - Terminal 视图：基于当前目录（open 用 Space 根，bound 用 boundSession 的 projectPath）创建/复用裸 PTY，与 Session 无交互。
  - Context 视图（后续）：展示详细 token/usage/cost/压缩历史。
  - 后续视图（file/diff 等）：按各自 `render` 函数实现。

### 5.3 切换的约束

- TUI → Chat：TUI 进程正常退出（PTY 关闭），serve 端会话状态保留，Chat 接管 session。
- Chat → TUI：Chat 视图卸载，TUI 通过 `--continue` 重新连接 serve 恢复同一 session。
- 任意视图 → Terminal：保留原视图状态（TUI PTY 关闭或 Chat 卸载），Terminal 用独立 PTY。
- Terminal → 任意视图：释放或保留 Terminal PTY（保留可让用户切回继续用），恢复 TUI/Chat。
- bound → open：解绑 Session（回 idle），保留 Terminal PTY，Panel 退化为裸 Terminal。
- open → bound：通过装载器选 Session 后绑定，Terminal PTY 可保留或关闭。
- 切换期间 Session 的 `boundPanelId` 不变（bound 状态内切换），只是 `viewMode` 变化。
- 视图的 `showContext=false` 时（如 terminal/context/file），头部 Context Popup 指示器隐藏。

---

## 6. Context 状态 Popup（决策 1）

### 6.1 承载方式

不占用 Panel 布局，不做成独立面板。在 Panel 头部放一个紧凑指示器，点击弹出锚定式 popup/popover。

### 6.2 指示器

Panel 头部右侧显示一个小圆环或徽标：

- 圆环填充度反映 token 使用率（复用官方 `session-context-usage.tsx` 的圆环组件）。
- 颜色：正常态灰，接近上限变黄，超限变红。
- 无文字，纯图形，宽度约 16px。

### 6.3 Popup 内容

点击指示器弹出 popup，锚定在指示器下方：

```
┌──────────────────────────────┐
│  Context Usage                │
│                               │
│  Tokens     12,345 / 200,000  │
│  ████████░░░░░░░░░  6%        │
│                               │
│  Input      8,200             │
│  Output     3,845             │
│  Cache      300               │
│                               │
│  Model      claude-sonnet     │
│  Cost       $0.012            │
│                               │
│  [ 压缩上下文 ]  [ 清空 ]      │
└──────────────────────────────┘
```

- 点击 popup 外部或按 `Esc` 关闭。
- popup 是临时信息层，不持久化、不参与分屏、不进入 Panel 持久状态。
- 复用官方 `session-context-usage.tsx` 的数据获取逻辑，包装为 popup 版本。

---

## 7. Panel 布局与拆分

### 7.1 布局模型

沿用当前布局模型：**横向最多 3 个 Panel，每个 Panel 可上下拆分出内嵌终端**，合计最多 6 个视图。

```
┌──────────┬──────────┬──────────┐
│ #1 主视图 │ #2 主视图 │ #3 主视图 │
│ (TUI/Chat)│ (TUI/Chat)│ (TUI/Chat)│
├──────────┼──────────┼──────────┤
│ #1 内嵌   │ #2 内嵌   │ #3 内嵌   │
│ 终端      │ 终端      │ 终端      │
└──────────┴──────────┴──────────┘
```

- 横向 Panel 数量上限 3，默认 1 个。
- 每个 Panel 独立决定是否上下拆分（拆分后下方为内嵌终端，复用现有 `splitTerminal` 机制）。
- 上下拆分是 Panel 内部行为，不新增 Panel 编号；#1 主视图 + #1 内嵌终端仍属于同一个 Panel #1。
- 横向 Panel 之间共享列宽拖拽条；Panel 内主视图与内嵌终端之间共享行高拖拽条（复用现有 `handleSplitResizeStart`）。

### 7.2 拆分操作（菜单与快捷键重新设计）

当前问题：拆分操作藏在 `...` 菜单里且文案不清（"垂直拆分终端"实际是上下拆分），没有快捷键，用户难以发现和操作。重新设计如下。

**Panel 头部菜单（`...`）拆分相关项**：

| 菜单项 | 作用 | 禁用条件 |
|--------|------|----------|
| 上下拆分（添加内嵌终端） | 在当前 Panel 下方开启内嵌终端 | 已拆分时禁用 |
| 关闭内嵌终端 | 关闭下方内嵌终端，主视图占满 | 未拆分时禁用 |
| 向右添加 Panel | 在当前 Panel 右侧新增空 Panel | 已有 3 个 Panel 时禁用 |
| 关闭此 Panel | 关闭当前 Panel（bound 时需确认） | 仅剩 1 个 Panel 时禁用 |

**快捷键**：第一阶段不实现（决策 6）。后续需完整分析官方 app 现有快捷键架构，避免冲突后再补充 Workbench 快捷键。

**内嵌终端头部**：

内嵌终端已有独立小头部（当前 `panel.tsx` 第 336 行的 `Terminal (Split)` 标签），保留并优化：

- 显示终端标题（可改为显示当前目录或自定义标题）。
- 右侧关闭按钮（已有）。
- 可考虑后续加"在新窗口打开"按钮，本次不涉及。

### 7.3 列宽调整

横向 Panel 之间的垂直拖拽条调整列宽，复用现有 `setPanelWidth` 逻辑。当前 `panel.tsx` 用 `flex: width` 实现列宽分配，继续沿用。

### 7.4 内嵌终端行高调整

Panel 内主视图与内嵌终端之间的水平拖拽条调整行高，复用现有 `handleSplitResizeStart` / `setPanelSplitHeight` 逻辑。约束保留：内嵌终端最小 120px，主视图最小 200px。

---

## 8. Panel 头部与工具栏重新设计

### 8.1 当前问题

当前 `panel.tsx` 头部：
- mode 切换是三个并列按钮（TUI/Chat/Terminal），占据头部空间，但语义混乱：Terminal 是裸 shell 却和 TUI/Chat 并列为"模式"。
- `...` 菜单只有"垂直拆分终端"和"关闭"两项，功能太少，且"垂直拆分"文案误导（实为上下拆分）。
- 拆分操作没有快捷键，用户难以发现。
- 没有 Context 指示器。
- 没有 Session 标题。

### 8.2 新头部布局

```
┌──────────────────────────────────────────────────────────┐
│ [●] Session 标题(截断)  [TUI|Chat|Terminal|...] [Context●] [⋯] │
└──────────────────────────────────────────────────────────┘
```

- 左侧 `[●]`：Session 状态点（idle 灰/bound 绿）。
- `Session 标题`：截断显示，hover 显示完整标题。
- 视图切换分段按钮：从 `viewRegistry` 动态渲染，第一阶段为 `TUI | Chat | Terminal`，后续新增视图（file/diff 等）自动追加。当前激活视图高亮。
- `[Context●]`：Context 指示器圆环（仅 bound 且当前视图 `showContext=true` 时显示；terminal/file 等视图下隐藏）。
- `[⋯]`：菜单按钮，弹出菜单。

### 8.3 菜单项（`...` 展开）

保留官方 `...` 展开菜单的语义入口，Workbench 在此基础上补充并重组。第一阶段不设快捷键（决策 4），后续单独分析官方 app 快捷键架构后再补充：

**Session 操作组**：
- 重命名会话
- 归档会话 / 取消归档
- 复制会话链接
- 在新 Panel 中打开（自动创建空 Panel 并装载）

**Panel 操作组**：
- 上下拆分（添加内嵌终端） / 关闭内嵌终端
- 向右添加 Panel
- 关闭此 Panel（bound 时显示"关闭会话并移除 Panel"）

**视图组**：
- 切换为 TUI 视图
- 切换为 Chat 视图
- 切换为 Terminal 视图

视图组与头部的三段按钮功能重复，提供菜单入口是为了可发现性和未来快捷键扩展。禁用项灰显并保留在原位置，让用户知道操作存在但当前不可用。

### 8.4 空 Panel 头部

empty 状态头部简化：

```
┌──────────────────────────────────────────────────────────┐
│ [空 Panel #2]                              [⋯]         │
└──────────────────────────────────────────────────────────┘
```

- 只显示 Panel 编号和菜单。
- 菜单只有"向右添加 Panel"和"关闭 Panel"（无 Session 操作、无视图组、无拆分，因为空 Panel 无内容可拆分）。

### 8.5 Terminal 视图与内嵌终端的区别

新模型下有两个"终端"概念，需明确区分，避免混淆：

| 概念 | 定位 | 触发方式 | 生命周期 | 与 Session 关系 |
|------|------|----------|----------|-----------------|
| **Terminal 视图** | Panel 主视图的一种（与 TUI/Chat 并列） | 头部三段按钮切换 | 跟随 Panel 的 bound 状态 | 不绑 Session，复用 boundSession 的目录 |
| **内嵌终端** | Panel 内的辅助终端（split terminal） | `...` 菜单"上下拆分" | 跟随 Panel，可独立开关 | 与 Session 无关，复用 Panel 目录 |

两者独立，可共存：用户在 TUI 视图下可上下拆分出内嵌终端，形成"上 TUI + 下内嵌终端"的布局；也可切到 Terminal 视图，再上下拆分出内嵌终端，形成"上 Terminal + 下内嵌终端"。

---

## 9. 关键交互流程

### 9.1 新建会话（从空 Panel）

```
用户点击工具栏 "Add Panel"
  → 创建 empty Panel（#N）
  → Panel 显示装载器
  → 用户选择 Space + Project + Type
  → 用户点击 "开始会话"
  → 后端创建 Session（id 生成）
  → 前端 panel.boundSessionId = session.id, slotState = bound
  → 启动 PTY（TUI）或加载 Chat
  → Session 同步出现在左侧树对应 Project 下
```

### 9.2 新建会话（从左侧 Project）

```
用户右键 Project → "新建会话"
  → 创建 idle Session（type 默认 chat 或弹窗选择）
  → Session 出现在左侧树
  → 用户拖入空 Panel 或右键 "在新 Panel 中打开"
```

### 9.3 恢复会话

```
用户从左侧树拖拽 idle Session
  → 拖入空 Panel
  → 前端校验 Panel.slotState === empty
  → panel.boundSessionId = session.id, slotState = bound
  → TUI: opencode --continue <id> 恢复
  → Chat: session resume API 加载历史消息
  → Session 状态 bound，左侧树节点变绿
```

### 9.4 切换视图

```
用户在 bound Panel 头部点击 "Chat"（当前为 TUI）
  → TUI 进程 detach（不杀）
  → panel.viewMode = chat
  → 渲染 MessageTimeline + SessionComposerRegion
  → 淡入动画 150ms
```

### 9.5 关闭 Panel

```
用户点击关闭（bound Panel）
  → 弹确认对话框
  → 确认
  → 释放 PTY 资源（TUI detach, split kill）
  → session.boundPanelId = undefined, status = idle
  → 移除 Panel，编号顺移
  → 左侧树节点变灰
```

### 9.6 浏览 Space 不影响 Panel

```
用户在左侧树点击其他 Space
  → 树切换到该 Space 的 Project/Session
  → 右侧 Panel 不变（仍在运行原会话）
  → 状态栏无变化
```

---

## 10. 决策记录

| # | 议题 | 决策 | 备注 |
|---|------|------|------|
| A | 同一 Session 绑多 Panel | 禁止，二次拖入时提示"已在 Panel #X 运行，是否移动？" | 用户确认 |
| B | 关闭 Panel 时 TUI 进程 | detach 不杀，后台 serve 进程继续 | 用户确认 |
| C | 新建会话落点 | 落在第一个空 Panel；无空 Panel 时提示用户添加 | 用户确认（口误已纠正） |
| C' | Panel 布局与拆分 | 横向最多 3 Panel，每个可上下拆分内嵌终端，合计最多 6 视图 | 用户确认：复用 splitTerminal 机制，菜单重新设计 |
| D | 视图切换 | Panel 内单视图切换，可扩展；第一阶段 TUI/Chat/Terminal，后续加 file/diff 等 | 用户确认，扩展性要求追加 |
| E | 左侧联动 | 左侧树始终展示完整全景（所有 Space→Project→Session）；切换 tab 激活焦点到对应 Space 节点并展开，不过滤树；Project 点击推送目录到空 Panel 装载器；tab 切换有 bound Panel 时弹确认（含"不再提示"勾选，偏好持久化） | 用户确认：每空间一 tab 不交叉，树完整全景，切换确认可持久化 |
| 7 | Panel 三态 | empty/open/bound；open=有裸 Terminal 无 Session（快速入口）；bound=绑 Session 三视图完整切换；open 下 TUI/Chat 灰显触发装载器 | 用户确认：开 Terminal 不算 bound，其余视图应可用 |
| 1 | Context 展现 | Popup/Popover，不占 Panel 布局 | 用户确认 |
| 2 | 官方菜单 | 保留 `...` 展开菜单 | 用户确认 |
| 3 | Terminal 视图定位 | 第三种视图，不绑 Session，复用 boundSession 目录开裸 PTY | 用户确认：作为视图而非独立 Session type |
| 4 | 视图可扩展性 | 视图类型通过 viewRegistry 动态注册，头部和菜单动态渲染 | 用户确认：后续加 file/diff 等 |
| 5 | 新建会话默认类型 | 默认 Chat，后续加配置项可改 | 用户确认 |
| 6 | 快捷键 | 第一阶段不设，后续单独分析官方 app 快捷键架构再补充 | 用户确认 |

---

## 11. 组件影响与实施阶段

### 11.1 受影响组件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `view.tsx` | 重构 | Panel state 增加 slotState/boundSessionId/viewMode；移除 mode/directory 直接耦合；沿用横向 3 Panel + 上下拆分布局，重组添加/移除/拆分逻辑 |
| `panel.tsx` | 重构 | 新增 empty/configuring/bound 三态渲染；头部重设计（视图按钮从 viewRegistry 动态渲染）；拖放 drop zone；视图切换 |
| `sidebar.tsx` | 重写 | 单层 Space 列表 → Space→Project→Session 三级树；去掉 openTab 联动；拖拽源；右键菜单 |
| `space-store.tsx` | 扩展 | tabs 语义弱化（仅浏览上下文），不联动 Panel |
| 新增 `view-registry.tsx` | 新建 | 视图注册表：注册 TUI/Chat/Terminal 视图定义（id/label/icon/requiresSession/showContext/render）；头部按钮和菜单从此动态渲染，后续加 file/diff 等视图只需注册一项 |
| 新增 `session-store.tsx` | 新建 | Session 实体管理：CRUD、状态、与 Panel 绑定关系 |
| 新增 `parts/panel-loader.tsx` | 新建 | 空 Panel 装载器组件 |
| 新增 `parts/panel-chat.tsx` | 新建 | Chat 视图容器（原 §12.1.4 阶段 5.1） |
| 新增 `parts/panel-chat-header.tsx` | 新建 | Chat 视图头部（原 §12.1.4，调整为新头部的一部分） |
| 新增 `parts/session-tree.tsx` | 新建 | 三级树渲染组件 |
| 新增 `parts/context-popup.tsx` | 新建 | Context 指示器 + popup |
| 新增 `services/session-store-service.ts` | 新建 | Session 持久化（原 §12.1.4 PanelSessionService 升级） |

### 11.2 实施阶段建议

> 建议拆分为独立 Issue，走 dev-flow 流程。以下为阶段切分参考。

**阶段 5.0 — 模型重构（前置）**
- 引入 `session-store` 与 Session 实体类型。
- `view.tsx` Panel state 增加 `slotState`、`boundSessionId`、`viewMode`，保留旧字段兼容。
- 空 Panel 装载器组件（仅 UI，不含真实 Session 创建）。
- 不改变现有 TUI Panel 行为，确保平滑过渡。

**阶段 5.1 — 三级 Session Browser**
- 重写 `sidebar.tsx` 为三级树。
- 接入 session-store，渲染 Space/Project/Session。
- 去掉 openTab 联动。
- Session 右键菜单（重命名、归档、在新 Panel 打开）。

**阶段 5.2 — 装载与拖放**
- Panel 装载器接入真实 Session 创建。
- 拖放恢复（TUI `--continue`，Chat resume）。
- 关闭 Panel 确认对话框与资源释放。

**阶段 5.3 — 视图切换**
- Panel 头部 TUI/Chat 分段切换。
- TUI detach 与 Chat 加载的过渡动画。

**阶段 5.4 — Context Popup**
- Context 指示器圆环。
- Popup 内容与官方 `session-context-usage` 数据复用。

**阶段 5.5 — 拆分菜单与视图注册表**
- 重组 `...` 菜单（Session/Panel/视图三组，禁用项灰显）。
- 实现 viewRegistry 机制，注册 TUI/Chat/Terminal 三种视图。
- Panel 头部视图切换按钮从 viewRegistry 动态渲染。
- 优化内嵌终端头部（标题、关闭按钮）。
- 快捷键：本阶段不实现，留待后续单独分析官方 app 快捷键架构。

**阶段 5.6 — Chat 视图集成**
- 对接官方 `MessageTimeline` + `SessionComposerRegion`（原 §12.1.4 阶段 5.1-5.3）。

**阶段 5.7 — 后续扩展视图（非本 Step 范围）**
- file 视图、diff 视图等，通过 viewRegistry 注册，无需改 Panel 头部和菜单。

---

## 12. 待确认事项

所有关键决策已在 §10 记录并经用户确认。无待确认事项。

后续需单独分析的议题（不阻塞本 Step 实施）：

1. **快捷键架构**：需完整分析官方 app 现有快捷键设计，避免冲突，再补充 Workbench 快捷键。
2. **视图扩展规范**：file/diff 等视图的 `render` 函数契约、数据获取方式、与 Session/目录的关系，待具体视图需求出现时设计。
# Ellamaka Workbench 设计与状态管理规范

> **状态**：核心设计与开发规范。本项目的后续所有开发与重构工作必须严格遵循本文档。

---

## 核心约束

Ellamaka Workbench 是通过**官方 `packages/app` 并在其上进行外挂定制**来构建的。这是根本性的设计与开发规则：

- **绝不修改 `packages/app` 中的上游代码。**
- 所有 workbench 的代码和定制实现必须存放在 `packages/ellamaka-app` 的独立路径下。
- 定制是完全叠加式的：只能引入新组件、新路由和新状态，不得编辑任何上游原始文件。
- 其根本目标是保持**最小的侵入性**，以便后续可以无冲突地直接 merge 上游 `packages/app` 的更新。

---

## 1. 方向与核心理念

Workbench 是 Ellamaka 的主工作区，它独立于官方应用的外壳存在，并非官方应用壳内的子页面。

- **Space（空间）** 是 Workbench 的核心管理对象。每个 Space 拥有独立的标签页、面板排版、终端实例、对话状态和布局偏好。
- **对话界面** 包含两种核心内容模式：
  - **TUI**（终端用户界面）
  - **Chat**（聊天对话）
- **布局设计** 不再提供独立的 Split（分屏）模式，而是将 Split 融入为一种**多面板水平排版布局状态**。

---

## 2. 目标架构模型

```
Ellamaka App
├─ Official App（官方应用）
│  ├─ Home
│  └─ Session
└─ Workbench
   ├─ Workbench Shell
   ├─ Space Rail（左侧空间栏与会话浏览器）
   ├─ Space Tabs（顶部空间标签页）
   ├─ Panel Workspace（面板工作区：支持 1~3 个水平面板）
   ├─ Bottom Terminal Dock（底部空间级终端坞）
   └─ Workbench Statusbar（工作台状态栏）
```

面板工作区是产品的核心。每个激活的空间可以包含 1 到 3 个水平面板，每个面板支持独立的 TUI 或 Chat 视图，并且可以分别定位到 WopalSpace 内的任意目录中。

---

## 3. 壳与路由设计

### 3.1 路由定义

路径 `/workbench` 使用独立的 Workbench Shell 进行渲染。官方应用页面继续使用继承的 `Layout`。
在 `RouterRoot` 中通过条件 `Show` 判断，若当前路径以 `/workbench` 开头，则跳过 `Layout` 的外层包裹。

### 3.2 架构与目录结构

```
packages/ellamaka-app/           ← ellamaka 定制 web UI
  ├── src/pages/workbench/         ← 三栏 IDE 工作台
  │   ├── index.tsx                  主布局与事件总线连接
  │   ├── view.tsx                   视图状态管理（Space & Panel 状态与持久化 API）
  │   ├── space-store.tsx            空间列表与 space tabs 状态管理
  │   ├── session-store.tsx          Session 本地投影状态管理
  │   ├── view-registry.tsx          视图注册表（解耦 TUI/Chat/Terminal/Context 渲染）
  │   ├── surface-route.ts           路由与界面切换辅助逻辑
  │   ├── hooks/
  │   │   └── use-panel-chat-state.ts  面板级 Chat 独立状态钩子
  │   ├── services/
  │   │   └── session-store-service.ts 会话状态持久化基础服务
  │   └── parts/
  │       ├── top-bar.tsx            顶栏（品牌/活动空间/返回 Official App）
  │       ├── sidebar.tsx            侧边活动栏与空间栏外壳
  │       ├── session-tree.tsx       三级 Session 浏览器核心实现
  │       ├── workspace.tsx          工作区（1~3 个 Panel 容器渲染）
  │       ├── panel.tsx              通用面板骨架组件
  │       ├── panel-loader.tsx       空面板装载器（提供会话选择与快速终端）
  │       ├── panel-chat.tsx         面板级 Chat 视图容器（桥接官方 timeline/composer）
  │       ├── panel-chat-composer.tsx  面板上下文适配的输入区
  │       ├── bottom-dock.tsx        底部终端坞
  │       ├── status-bar.tsx         底栏状态与路径提示
  │       └── workbench-settings.tsx 工作台特有设置菜单
  ├── (其他目录完全继承 app/)
  └── AGENTS.md                    ← 包级开发规则
```

### 3.3 与上游同步策略

- **目录级 merge=ours**：在 `.gitattributes` 中将 `packages/app/` 标记为 `merge=ours`，上游合并时仅用上游代码作为合并对照，保护本地基线；`packages/ellamaka-app/` 不受保护，合并上游变更。
- **增量同步**：上游 `packages/app` 更新时，通过差异审查，将必要的变更重做或 pick 到 `packages/ellamaka-app/` 下。
- **依赖同步**：`package.json` 中的 `workspace:*` 依赖与上游保持同步。

---

## 4. 面板工作区与视图隔离

### 4.1 面板状态定义

每个面板通过 `slotState` 被抽象为以下三种槽位状态之一：

| 槽位状态 | 含义 | 视图能力 | boundSessionId |
|------|------|----------|----------------|
| `empty` | 槽位为空，等待装载 | 显示 `PanelLoader` 装载器和快速 Terminal 按钮 | 无 |
| `open` | 槽位激活了裸 Terminal | 仅支持 Terminal 视图；TUI/Chat 视图点击时会触发装载器 | 无 |
| `bound` | 槽位绑定了持久化 Session | 支持 TUI / Chat / Terminal / Context 视图间自由切换 | 有 |

每个面板的结构定义：

```ts
type PanelSlotState = "empty" | "open" | "bound"
type PanelViewMode = string // "tui" | "chat" | "terminal" | "context" | ...

type WorkbenchPanel = {
  id: string
  slotState: PanelSlotState
  boundSessionId?: string      // 绑定会话的 ID
  viewMode?: PanelViewMode     // 当前激活的主视图类型
  directory: string            // 面板当前的 CWD (工作路径)
  width: number                // flex 占比分配 (列宽)
  tuiPtyId?: string            // TUI 主进程的 PTY ID
  termPtyId?: string           // Terminal 视图的 PTY ID
  splitTerminal?: boolean      // 面板内嵌套终端是否打开
  splitPtyId?: string          // 嵌套终端的 PTY ID
  splitHeight?: number         // 嵌套终端的高度（像素值）
}
```

### 4.2 视图注册机制 (View Registry)

为保持视图的横向可扩展性（如后续追加 `file` 或 `diff` 视图），任何面板视图都必须通过 `view-registry.tsx` 进行注册：

```ts
type PanelViewCtx = {
  panel: WorkbenchPanel
  session?: Session
  directory: string
  sdk: any
  spaceName: string
  spacePath: string
}

type PanelViewDef = {
  id: string
  label: string
  requiresSession: boolean     // 渲染是否必须绑定 Session
  showContext: boolean         // 是否在面板头部呈现 Context 状态环
  availableInOpen: boolean     // 是否在裸 Terminal (open 状态) 下直接可用
  render: (ctx: PanelViewCtx) => JSX.Element
}
```

目前系统已默认注册 `tui`、`terminal`、`chat` 和 `context` 视图。面板头部工具栏和切换菜单会读取 `viewRegistry` 自动进行渲染，已禁用的视图在对应槽位状态下会置灰。

---

## 5. 状态管理与持久化设计 (关键机制)

Workbench 状态持久化的核心目标是保证**全局刷新不丢失面板布局与绑定状态**，并且在**高频对话生成期间界面和侧边栏树保持绝对稳定**。

### 5.1 空间路径 (Space Path) 与面板目录 (Panel Directory) 的语义隔离

在多 Panel 和目录定位的设计中，必须清晰区分以下两个核心概念：

- **Space Path (空间路径)**：这是 Workbench Store 的**主键**。对应 Space Tab 注册的绝对路径（如 `/Volumes/U500G/coding/wopal-workspace`）。用于在 `workbench.v2` 的 persisted store 中索引 `store.spaces[spacePath]` 下的数据结构。
- **Panel Directory (面板目录)**：这是具体面板当前的 **CWD 上下文**。面板在创建时初始值等于其所属的 Space Path，但用户可以通过定位目录功能将其更改为子项目路径。用于 PTY 进程启动的 `cwd` 或者是 Chat 提交时的工作树作用域。

> [!IMPORTANT]
> **绝对禁止**将 `panel.directory` 误作为 Space Path Key 传给 Workbench Store API（如 `bindSessionToPanel`、`unbindSessionFromPanel`、`setPanelSplitTerminal` 等）。
>
> 必须由 `workspace.tsx` 将 `activePath()`（当前空间路径）作为 `spacePath` 属性向下透传至 `Panel` 和 `PanelLoader`。所有的 Store 读写 API 必须固定使用 `props.spacePath` 作为第一个参数，以防面板目录变更导致持久化状态写入到错误的 store位置中。

### 5.2 状态双向同步与 Sync Bridge 竞态保护

面板内的会话状态由两个 Store 协同：
1. 服务端状态：`server-sync.tsx` 管理的 `sync.data.session`，代表远端会话数据事实。
2. 运行时状态：`session-store.tsx` 管理的本地投影，负责管理 `boundPanelId` 和 `status` 等 UI 级字段。

为使本地绑定状态能响应服务端的删除与归档，`PanelChat` 内部维护了 `sync.data.session → sessionStore` 的单向同步 Bridge。由于数据加载是异步的，必须警惕初始化竞态：

> [!WARNING]
> **初始化防擦除保护 (竞态保护)**：
> 页面刷新时，`sync.data.status` 初始为 `"loading"`，且 `sync.data.session` 的数组尚未从服务端同步完毕（暂时为空 `[]`）。
>
> **同步规则**：只有当 `sync.data.status === "complete"`（代表后台慢随数据加载，包括 `loadSessions` 已成功返回并 reconcile 完毕）时，才允许执行“会话是否在服务端缺失”的检测。如果在 `"complete"` 状态前执行此逻辑，初始的空列表会错误地判定绑定已失效，导致本地绑定状态被错误擦除（解绑并退回 empty 状态）。

### 5.3 左侧导航树的重绘与渲染优化

左侧 `session-tree.tsx` 展现 `Space -> Project -> Session` 的三级结构。为避免高频消息交互（SSE 的 `session.updated` 块事件）导致左侧树高频触发后端 API 刷新和界面闪烁，需遵循以下约束：

1. **副作用归口**：树组件中使用 `createEffect` 代替 `createMemo` 监听展开事件并触发 `loadSpaceOverview`。Memo 的重复评估在 Solid 中不应用于触发 API 请求等副作用。
2. **事件过滤**：`index.tsx` 连接 SSE 会话总线时，**仅**在 `session.created` 和 `session.deleted` 时触发 `sessionStore.triggerRefresh()`。活跃对话期间产生的 `session.updated` 事件不会引起整棵树的 API 刷新拉取。会话标题等细节改变，由 `panel-chat.tsx` 内的 Sync Bridge 局部的 effect 自动进行本地投影更新。

### 5.4 持久化配置项

- `workbench.v2`：保存主显示状态及各空间下的 `panels` 分布信息。
- `workbench.sessions`：保存本地投影的会话列表及对应的面板绑定（bound/idle/archived）与活动时间戳。每个空间默认只保留最后活跃的 50 条 Session，防止 localstorage 爆满。
- `workbench.spacetabs`：保存顶部打开 of Space Tabs 列表。
- `workbench.activespace`：记录当前正被激活渲染的 Space 名字。

---

## 6. 关键交互流程

### 6.1 开启新会话 (以 Empty 槽位为例)
1. 点击 "Add Panel" 新增面板，槽位为 `empty` 状态。
2. 显示 `PanelLoader`，用户选定 Project Path 及类型（默认为 Chat）。
3. 点击 "开始会话"，触发 SDK 创建 session 得到 ID。
4. 执行 `sessionStore.ensureSessionReference` 和 `wb.bindSessionToPanel(props.spacePath, panel.id, sessionId)`。
5. 槽位状态切为 `bound`，渲染对应的 `PanelChat` 并开始交互。

### 6.2 拖拽会话恢复
1. 左侧树的 idle 状态会话节点支持 Drag。
2. 拖入任意 `empty` 或 `open` 状态的 Panel 释放。
3. 执行 `sessionStore.bindPanel` 将会话与该面板 ID 绑定，并调用 `wb.bindSessionToPanel` 修改持久化槽位状态，恢复会话。

### 6.3 切换视图模式
1. 在 `bound` 状态的面板中，点击头部 `TUI | Chat | Terminal` 分段按钮。
2. 前端切换 `panel.viewMode`。
3. 若从 TUI 切到 Chat，PTY 会进行安全 `detach`，TUI 进程保持后台挂起，前端挂载 `PanelChat` 导入聊天数据；切回 TUI 时通过 `--continue <id>` 重连复用。

---

## 7. 实施路线图与当前状态

1. **步骤 1：独立壳与入口注入** (已完成)
2. **步骤 2：多面板容器与 Resize 列宽/行高** (已完成)
3. **步骤 4：TUI 视图集成** (已完成)
4. **步骤 5：Session/Panel 模型重构、三级树与 Chat 视图集成** (已完成)
   - 引入 View Registry 与三级会话浏览器。
   - 解决全局刷新状态丢失与 sync bridge 初始化解绑 bug。
   - 优化 SSE 事件更新导致的树组件刷新性能。
5. **步骤 6：移动端路由 `/m` 集成与触控键盘适配** (开发中)
6. **步骤 7：底部终端坞真实接线** (未开始)

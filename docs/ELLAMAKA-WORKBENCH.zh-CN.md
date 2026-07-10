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
- **Split Terminal** 面板内底部的辅助终端区域，不是独立面板，不能承载 Chat 会话，但拥有独立的状态保持。

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
   │  └─ 每个 Panel 可选包含 Split Terminal（底部辅助终端子区域）
   ├─ Bottom Terminal Dock（底部空间级终端坞）
   └─ Workbench Statusbar（工作台状态栏）
```

面板工作区是产品的核心。每个激活的空间可以包含 1 到 3 个水平面板，每个面板支持独立的 TUI 或 Chat 视图，并且可以分别定位到 WopalSpace 内的任意目录中。每个面板可选在底部展开一个 Split Terminal 辅助终端区域。

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
  │   ├── view-store.tsx              工作台视图与面板布局状态管理
  │   ├── space-store.tsx             Space 工作空间与 Tab 状态管理
  │   ├── session-store.tsx           会话实例及绑定投影状态管理
  │   ├── pty-manager.tsx             PTY 运行时管理器（非持久化，统一管理 PTY 生命周期）
  │   ├── space-workspace.tsx         Space Keep-Alive 容器（所有打开的 Space Tab 保持挂载）
  │   ├── view-registry.tsx           视图注册表（解耦 TUI/Chat/Terminal/Context 渲染）
  │   ├── surface-route.ts            路由与界面切换辅助逻辑
  │   ├── hooks/
  │   │   └── use-panel-chat-state.ts  面板级 Chat 独立状态钩子
  │   └── parts/
  │       ├── top-bar.tsx              顶栏（品牌/活动空间/返回 Official App）
  │       ├── sidebar.tsx              侧边活动栏与空间栏外壳
  │       ├── session-tree.tsx         三级 Session 浏览器核心实现
  │       ├── workspace.tsx            工作区（管理 Space Keep-Alive 容器）
  │       ├── panel.tsx                通用面板骨架组件
  │       ├── panel-loader.tsx        空面板装载器（提供会话选择与快速终端）
  │       ├── panel-chat.tsx           面板级 Chat 视图容器（桥接官方 timeline/composer）
  │       ├── panel-chat-composer.tsx  面板上下文适配的输入区
  │       ├── bottom-dock.tsx          底部终端坞
  │       ├── status-bar.tsx           底栏状态与路径提示
  │       └── workbench-settings.tsx  工作台特有设置菜单
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

每个面板通过 `slotState` 处于以下两种状态之一：

| 槽位状态 | 含义 | 主视图能力 | 绑定 Session |
|----------|------|-----------|--------------|
| `empty` | 槽位为空，等待装载 | 显示 `PanelLoader` 装载器 | 无 |
| `bound` | 槽位绑定了 Session | 支持 TUI / Chat / Context 主视图切换，可在面板底部展开 Split Terminal | 有 |

不存在"裸 Terminal 面板"状态。终端体验由 Split Terminal 子区域提供。

面板的持久化结构定义：

```ts
type PanelSlotState = "empty" | "bound"
type PanelViewMode = string // "tui" | "chat" | "context"

type WorkbenchPanel = {
  id: string
  slotState: PanelSlotState
  boundSessionId?: string     // 当 slotState === "bound" 时，绑定的 Session ID
  viewMode: PanelViewMode     // 当 slotState === "bound" 时，当前激活的主视图
  directory: string           // 面板当前的 CWD（工作路径）
  width: number               // flex 占比分配（列宽）
  splitTerminal: boolean      // 面板底部 Split Terminal 是否打开
  splitHeight?: number        // Split Terminal 的高度（像素值）
  // PTY IDs — 作为重连提示持久化，使用前必须由 PTY Manager 探测验证
  tuiPtyId?: string           // TUI 进程的 PTY ID
  splitPtyId?: string         // Split Terminal 的 PTY ID
}
```

### 4.2 Panel 子区域：Split Terminal

Split Terminal 是面板的**底部辅助终端子区域**，不是独立面板。它拥有以下特征：

- **从属关系**：Split Terminal 依附于其所属面板，生命周期随面板走。面板关闭时 Split Terminal 资源释放。
- **不可承载 Chat**：Split Terminal 只能运行裸 Shell 终端，不能放置 Chat 会话或 TUI 视图。
- **独立状态保持**：
  - 可见性（`splitTerminal` 布尔值）：持久化。
  - 高度（`splitHeight` 像素值）：持久化。
  - PTY 实例与终端渲染状态：由 PTY 运行时管理器管理，刷新后重建。
- **视图切换不释放**：在 `bound` 槽位中切换主视图（TUI ↔ Chat ↔ Context）时，Split Terminal 的 PTY 进程保持运行，只切换可见性。切回时复用同一终端连接。
- **操作行为**：头部 `TUI` 按钮左侧的终端图标切换 `splitTerminal` 开关。收起时只隐藏下方区域，保留 PTY 与终端上下文；再次展开时复用同一终端。

### 4.3 视图注册机制 (View Registry)

为保持视图的横向可扩展性（如后续追加 `file` 或 `diff` 视图），任何面板视图都必须通过 `view-registry.tsx` 进行注册：

```ts
type PanelViewCtx = {
  panel: WorkbenchPanel
  session?: Session
  directory: string
  sdk: any
  spaceName: string
  spacePath: string
  ptyManager: PtyManager    // 从运行时管理器获取 PTY，而非自行创建
}

type PanelViewDef = {
  id: string
  label: string
  requiresSession: boolean     // 渲染是否必须绑定 Session
  showContext: boolean         // 是否在面板头部呈现 Context 状态环
  render: (ctx: PanelViewCtx) => JSX.Element
}
```

系统已默认注册 `tui`、`chat` 和 `context` 视图。`bound` 槽位的头部呈现 `TUI / Chat / Context` 主视图按钮，并在 `TUI` 左侧提供终端图标，用于切换面板底部的 Split Terminal。

**视图组件不拥有 PTY 生命周期**。视图通过 `ctx.ptyManager` 获取或复用 PTY 实例。PTY 的创建、复用、释放由运行时管理器统一负责。视图的 `onCleanup` 只能断开前端连接（WebSocket 等），不得调用 `pty.remove` 杀止进程。

---

## 5. 状态管理与持久化设计 (关键机制)

Workbench 状态管理的核心目标是：

1. **全局刷新不丢失面板布局与绑定状态**。
2. **切换 Space Tab 不销毁 Panel 子树**——所有已打开 Tab 的 Panel、Chat 草稿、终端进程保持挂载，只是切换可见性。
3. **切换视图模式不释放 PTY**——TUI PTY、Split Terminal PTY 在视图切换时保持运行。
4. **高频对话生成期间左侧导航树保持绝对稳定**。

### 5.1 状态模型分层设计

Workbench 状态不进行强行合并，而是通过分层 Store 实现解耦并由统一门控协同。状态存入以下 Store：

- **Space Store** (`space-store.tsx`)：维护已打开的 Space Path 列表及当前激活的 Space Tab 状态。
- **View Store** (`view-store.tsx`)：维护显示设置（侧栏、标题栏状态等）及每个 Space 下的 Panel 布局（Panel 数组、宽度、工作目录、Session 绑定状态及 PTY ID 提示）。
- **Session Store** (`session-store.tsx`)：维护本地与服务端的会话列表缓存及其绑定投影。

PTY ID（`tuiPtyId`、`splitPtyId`）作为**重连提示**持久化在 Panel 布局中。PTY Manager 在使用前必须探测存活状态，存活则复用（保留 TUI 终端上下文），已死则创建新 PTY 并更新 ID。

### 5.2 水合门控与协同 (allStoresReady)

所有持久化 Store 分别声明 `ready` 状态。在 `index.tsx` 中使用 `allStoresReady` 汇合成统一的 **Workbench Bootstrap Gate**：

```tsx
const allStoresReady = () => spaceStore.ready() && viewStore.ready()
```

> [!IMPORTANT]
> **水合完成前（allStoresReady 为 false）禁止行为**：
> - 不渲染 `Workspace` 与侧栏/标题栏主体（渲染 Splash 占位）。
> - 不执行 `ensureSpace()`（避免写入默认布局覆盖持久化数据）。
> - 不创建 PTY，不连接终端。
> - 不处理任何可能引发布局或生命周期副作用的事件。
>
> **水合完成后**：
> - 一次性挂载并渲染恢复的布局。
> - PTY Manager 对持久化的 PTY ID 发起探测，存活的重连，已死的标记为待重建。视图挂载时通过 `ptyManager.ensure()` 按需创建或复用。

这消除了刷新后"先显示空 Panel 再跳变到恢复布局"的闪烁问题。

### 5.3 Space Keep-Alive 容器

`Workspace` 不再只渲染当前激活的 Space，而是为**每个已打开的 Tab** 建立稳定的 `SpaceWorkspace` 容器：

- 所有已打开的 Space Tab 保持挂载，Panel、PTY、Chat 草稿、滚动位置全部在内存中存活。
- 当前 Space 可见。非当前 Space 使用 `position: absolute; visibility: hidden; inert` 隐藏。
- **禁止使用 `display: none`** 隐藏终端容器（Ghostty 尺寸会归零，恢复时触发 reflow 和 fit）。
- 切换 Tab 只改变可见性，不销毁任何子组件或 PTY。
- 用户显式关闭 Tab 时才销毁该 Space 的全部 DOM、Chat 状态和 PTY。

每个 `SpaceWorkspace` 接收固定的 `spacePath` 作为身份，不读取动态的 `activeTab()` 作为自身 key。

### 5.4 PTY 运行时管理器

PTY 进程由 `pty-manager.tsx` 统一管理。PTY ID 作为重连提示持久化在 Panel 布局中，但使用前必须探测验证。

**资源键**：`spacePath + panelId + resourceKind`

`resourceKind` 为 `"tui" | "split"`。

**核心操作**：

| 操作 | 行为 |
|------|------|
| `ensure()` | 检查持久化的 PTY ID 是否存在。存在则**先探测**：向服务端验证该 PTY 是否存活。存活则复用（终端上下文完整保留）。已死则清除旧 ID、创建新 PTY、更新持久化 ID。不存在则直接创建。创建请求附带 generation token，异步返回时检查 generation 是否过期。 |
| `dispose(resource)` | 关闭指定 PTY 进程，清除持久化 ID，清理引用。 |
| `disposePanel(panelId)` | 关闭该面板的所有 PTY（TUI + Split），清除对应持久化 ID。 |
| `disposeSpace(spacePath)` | 关闭该 Space Tab 的全部 PTY，清除对应持久化 ID。 |
| `disposeAll()` | 退出 Workbench 时关闭所有 PTY。 |

**探测机制**：PTY Manager 在 `ensure()` 时，若持久化状态中存在 PTY ID，先向服务端发起探测请求（如 PTY 状态查询或轻量连接尝试）。探测成功 → 复用，TUI 终端的滚动位置、当前面板等本地状态完整保留。探测失败（404 或超时）→ 视为已死，创建新 PTY 并更新持久化 ID。

**生命周期规则**：

| 事件 | 行为 |
|------|------|
| 视图切换（TUI ↔ Chat ↔ Context） | **不释放 PTY**。TUI PTY 进程保持运行，前端只断开 WebSocket，切回时重新连接同一 PTY。 |
| Split Terminal 收起 | **不释放 PTY**。只隐藏 DOM，终端上下文保留。再次展开复用同一连接。 |
| Panel 关闭 | `disposePanel()`：释放该面板所有 PTY，清除持久化 ID。 |
| Space Tab 关闭 | `disposeSpace()`：释放该 Space 全部 PTY，清除持久化 ID。 |
| Workbench 退出 | `disposeAll()`：释放所有 PTY。 |
| 浏览器刷新 | PTY 进程在服务端可能仍存活。刷新后水合完成，PTY Manager 探测持久化的 PTY ID，存活则重连（TUI 状态保留），已死则创建新 PTY。 |
| Panel 绑定到新 Session | 释放旧 Session 的 TUI PTY，清除旧 ID，为新 Session 创建新 PTY。 |
| `beforeunload` | 清理所有可释放的 PTY 进程。 |

**异步安全**：创建 PTY 的 Promise 必须携带 generation token。若 Promise resolve 时 Panel 已关闭或 Session 已变更，立即释放该 PTY，禁止将失效 ID 写入持久化状态。

### 5.5 Session 状态收敛

服务端 Session 是 Session 标题、归档状态、消息内容的**唯一事实来源**。

本地持久化只保存：Panel 绑定了哪个 Session ID（存储在 Panel 布局状态中）。

不持久化：

- Session `status`（bound / idle / archived）——从 Panel 布局的 `sessionId` 绑定关系派生。
- Session `boundPanelId`——从 Panel 布局反向查找。
- Session title 副本——从服务端 `sync.data.session` 获取，本地只做临时 optimistic 缓存。
- Session 列表——从服务端 `spaceOverview` 获取。

**事件处理规则**：

| 事件 | 行为 |
|------|------|
| `session.created` | 按需刷新对应 Space 的 Session 树。 |
| `session.deleted` | 解绑所有引用该 Session 的 Panel，释放对应 TUI PTY。 |
| `session.updated`（含 `timeArchived`） | 同 `session.deleted`。 |
| `session.updated`（标题变更） | 仅更新对应 `PanelChat` 内的本地投影，不触发树级 API 刷新。 |
| `message.part.*` | 仅更新对应 `PanelChat` 的消息流，不触发树或其它 Panel 的更新。 |

远端数据加载完成前（`sync.data.status !== "complete"`）不执行"会话是否在服务端缺失"的解绑检测，避免初始空数组误判。

移除全局 `refreshKey` 信号，改为按 Space 定向的 Session 树失效。

### 5.6 响应式与副作用约束

- `createMemo` 必须是纯函数，**禁止**在 memo 内写 store 或触发 API 请求。副作用使用 `createEffect`。
- SSE 事件订阅只在结构性事件（`session.created` / `session.deleted`）时触发 Session 树定向刷新。高频属性变更（标题、消息流）由对应组件局部处理。
- Space Path 是所有 Store 操作的**主键**。Panel directory 是面板 CWD 上下文，禁止用 `panel.directory` 替代 Space Path 作为 Store 读写 key。`workspace.tsx` 或 `space-workspace.tsx` 必须将 `spacePath` 作为属性向下透传。

### 5.7 持久化性能优化

拖拽过程中的尺寸变更（Panel 宽度、Split Terminal 高度、Sidebar 宽度）只在内存 draft 中更新，`pointerup` 时一次性提交到持久化 Store。

持久化写入采用：

- 150ms trailing debounce。
- latest-wins 语义（同一 key 的新值覆盖旧未写出的值）。
- 串行写队列。
- `visibilitychange` / `pagehide` 时同步 flush 未写出的数据。

禁止每次 `mousemove` 序列化整个 Workbench 状态。

### 5.8 持久化配置项

- `workbench`：统一的 Workbench 状态快照。包含显示设置、已打开 Space Tabs、当前激活 Space Path、每个 Space 的 Panel 布局与 Session 绑定、Split Terminal 配置。

单一键，单一 Store，单一水合门控。

---

## 6. 关键交互流程

### 6.1 开启新会话 (以 Empty 槽位为例)
1. 点击 "Add Panel" 新增面板，槽位为 `empty` 状态。
2. 显示 `PanelLoader`，用户选定 Project Path 及类型（默认为 Chat）。
3. 点击 "开始会话"，触发 SDK 创建 session 得到 ID。
4. 通过 `viewStore.bindSession(spacePath, panel.id, sessionId)` 将绑定写入持久化布局。
5. 槽位状态切为 `bound`，渲染对应的 `PanelChat` 并开始交互。PTY 运行时管理器按需创建资源。

### 6.2 拖拽会话恢复
1. 左侧树的 idle 状态会话节点支持 Drag。
2. 拖入任意 `empty` 状态的 Panel 释放。
3. 通过 `viewStore.bindSession(spacePath, panel.id, sessionId)` 修改持久化槽位状态，恢复会话。目标 Panel 若已有 PTY 则先释放旧资源。

### 6.3 切换视图模式
1. 在 `bound` 槽位的面板中，点击头部 `TUI | Chat | Context` 主视图按钮，或点击 `TUI` 左侧的终端图标展开/收起下方 Split Terminal。
2. 主视图按钮仅切换 `panel.view`。终端图标仅切换 `panel.splitTerminal`，不会抢占当前主视图。
3. **切换视图不释放任何 PTY**：
   - 从 TUI 切到 Chat：前端断开 TUI 终端的 WebSocket，TUI 进程保持后台挂起。前端挂载 `PanelChat` 导入聊天数据。
   - 切回 TUI：重新连接同一 PTY 的 WebSocket，终端上下文恢复。
   - Split Terminal 收起时只隐藏 DOM 区域，PTY 进程和终端状态保留；再次展开时复用同一连接。

### 6.4 切换 Space Tab
1. 用户点击顶部 Space Tab 切换激活 Space。
2. 当前 Space 变为 `visibility: hidden; inert`，新激活 Space 变为可见。
3. **不销毁任何 Panel、PTY、Chat 状态**。切回原 Tab 即恢复全部上下文。
4. 若当前 Space 有正在运行的会话，切换不会中断它们。

### 6.5 关闭面板与会话解绑
1. 面板头部右侧提供直观的 "关闭" 按钮，取代复杂的菜单。
2. 当槽位处于 `bound`（绑定会话）时，展示关闭按钮。
3. 点击关闭按钮时：
   - 若为 `bound`：弹出二次确认框。确认后解绑 Session（在左侧树中保留可重新恢复），调用 `ptyManager.disposePanel(spacePath, panelId, sdk)` 释放该面板全部 PTY 并清除持久化 PTY ID，从布局中移除该 Panel。
   - 若移除的是空间内最后一个 Panel：保留该 Panel 并将其重置为 `empty` 状态，确保工作区不为 0。

### 6.6 关闭 Space Tab
1. 用户点击 Tab 上的关闭按钮。
2. 弹出确认框，列出资源释放清单：面板数量、绑定会话数量、终端实例。
3. 确认后：`ptyManager.disposeSpace(spacePath)` 释放该 Space 全部 PTY，解绑所有 Session，销毁 `SpaceWorkspace` DOM 及子组件，从持久化状态中移除该 Space 布局，关闭 Tab。

---

## 7. 实施路线图与当前状态

### 已完成
1. **独立壳与入口注入**
2. **多面板容器与 Resize 列宽/行高**
3. **TUI 视图集成**
4. **Session/Panel 模型重构、三级树与 Chat 视图集成**

### 待重构
5. **统一状态 Store 与水合门控** — 合并分散的 Store 为单 Store，建立 Bootstrap Gate，迁移旧持久化数据。
6. **Space Keep-Alive 容器** — 重构 `workspace.tsx`，所有 Tab 保持挂载，切换只改可见性。
7. **PTY 运行时管理器** — 从 `view-registry.tsx` 和 `panel.tsx` 中提取 PTY 生命周期，集中到 `pty-manager.tsx`。视图不持有 PTY 生命周期。
8. **Panel 状态模型简化** — 用 `slot` + `sessionId` 替代 `slotState` + `boundSessionId` + `mode`，移除 `terminal` 槽位，PTY ID 改为重连提示持久化。
9. **Session 状态收敛** — 移除本地持久化的 `status` / `boundPanelId` / title 副本，改为从布局派生。
10. **持久化性能优化** — 拖拽 debounce 提交、串行写队列、`visibilitychange` flush。

### 待开发
11. **移动端路由 `/m` 集成与触控键盘适配**
12. **底部终端坞真实接线**

### 测试与验证

每个阶段必须先写失败测试再实现：

- 异步水合期间不写入默认状态。
- Space A → B → A 不卸载 Panel、不释放 PTY。
- View 切换不释放 PTY（TUI PTY 复用验证）。
- Split Terminal 收起/展开复用同一 PTY。
- Panel 关闭只释放该 Panel 资源。
- Tab 关闭只释放该 Space 资源。
- resize 只在 pointerup 持久化一次。
- session.deleted/archived 精准解绑对应 Panel。
- 浏览器刷新后一次性恢复布局，不闪烁。
- 浏览器刷新后 TUI PTY 探测存活则重连，终端状态保留；已死则创建新 PTY。

开发环境加入生命周期诊断日志：Workbench mount、Panel mount/unmount、PTY create/reuse/dispose、hydration ready、persistence write。
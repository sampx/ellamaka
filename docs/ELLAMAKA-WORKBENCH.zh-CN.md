# Ellamaka Workbench 设计与状态管理规范

> **状态**：核心设计与开发规范。本项目的后续所有开发与重构工作必须严格遵循本文档。
> **更新时间**：2026-07-14
> **相关文档**：`DESKTOP.md`（Electron 桌面承载与共享 PTY 生命周期）

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
  │   ├── session-store.tsx           会话实例及绑定投影状态管理（含 limitSessions 工具函数）
  │   ├── pty-manager.tsx             PTY 运行时管理器（非持久化，统一管理 PTY 生命周期）
  │   ├── space-workspace.tsx         Space Keep-Alive 容器（所有打开的 Space Tab 保持挂载）
  │   ├── view-registry.tsx           视图注册表（createViewRegistry 工厂 + ViewId 枚举，Shell 初始化时注册）
  │   ├── workbench-actions.ts        跨所有者事务入口与 provider-scoped Actions
  │   ├── workbench-actions-ports.ts  Store/Pty/Session port 构造器（buildStorePort/buildPtyPort/buildSessionPort）
  │   ├── workbench-runtime.tsx       HTTP health / SSE 状态与恢复代次
  │   ├── surface-route.ts            路由与界面切换辅助逻辑
  │   └── parts/
  │       ├── top-bar.tsx              顶栏（品牌/活动空间/返回 Official App）
  │       ├── sidebar.tsx              侧边活动栏与空间栏外壳
  │       ├── session-tree.tsx         三级 Session 浏览器核心实现
  │       ├── workspace.tsx            工作区（管理 Space Keep-Alive 容器）
  │       ├── panel.tsx                通用面板骨架组件
  │       ├── panel-loader.tsx        空面板装载器（受控目录、Chat/TUI 初始视图）
  │       ├── panel-chat.tsx           面板级 Chat 视图容器（桥接官方 timeline/composer）
  │       ├── panel-chat-composer.tsx  面板上下文适配的输入区
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
type PanelMode = "tui" | "chat"
type PanelSlotState = "empty" | "bound"
type PanelViewMode = string // "tui" | "chat" | "context"

type WorkbenchPanel = {
  id: string
  slotState: PanelSlotState
  boundSessionId?: string     // 当 slotState === "bound" 时，绑定的 Session ID
  viewMode?: PanelViewMode    // 当前激活的主视图（可选，向前兼容）
  mode: PanelMode             // 面板模式，与 viewMode 同步但持久化必需
  directory: string           // 面板当前的 CWD（工作路径）
  width: number               // flex 占比分配（列宽）
  splitTerminal: boolean      // 面板底部 Split Terminal 是否打开
  splitHeight?: number        // Split Terminal 的高度（像素值）
  // PTY IDs — 作为重连提示持久化，使用前必须由 PTY Manager 探测验证
  tuiPtyId?: string           // TUI 进程的 PTY ID
  termPtyId?: string          // Terminal 模式 PTY ID
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
  - PTY 进程由 sidecar 管理。刷新后 Renderer 重建终端渲染状态，并在宽限期内重新连接原 PTY。
- **视图切换不释放**：在 `bound` 槽位中切换主视图（TUI ↔ Chat ↔ Context）时，Split Terminal 的 PTY 进程保持运行，只切换可见性。切回时复用同一终端连接。
- **操作行为与状态指示**：
  - 按钮交互：面板头部右侧的终端图标用于切换 `splitTerminal` 的开关。收起时只隐藏渲染区域，Terminal 连接继续作为 subscriber 存活，保留 PTY 进程与终端上下文；再次展开时复用同一终端。
  - 进程存活高亮：为了防止按钮区域视觉臃肿，该图标不采用右侧小绿点形式进行标记，而是**直接以图标本身的颜色进行状态指示**。终端图标的存活状态直接由 `panel.splitPtyId` 派生——当辅助终端 PTY 进程存活时，终端图标渲染为高亮绿（`text-v2-icon-icon-accent`）；当进程退出或被销毁时恢复为默认 muted 灰色。该颜色状态与 `splitTerminal` 本身的折叠/展开（`state="pressed"` 灰色背景）在视觉上解耦。

### 4.3 视图注册机制 (View Registry)

为保持视图的横向可扩展性（如后续追加 `file` 或 `diff` 视图），任何面板视图都必须通过 `view-registry.tsx` 进行注册：

```ts
type PanelViewCtx = {
  panel: WorkbenchPanel
  session?: Session
  directory: string
  sdk: DirectorySdk                 // 由 Panel 的唯一 Provider 注入
  spaceName: string
  spacePath: string
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

**视图组件不拥有 PTY 生命周期**。视图只把“确保、关闭、连接断开”的意图交给 `WorkbenchActions`；Action 再调用 `PtyManager` 和目录 SDK。PTY 的创建、复用、存活探测、释放、布局提交和视图回退必须是同一个 Action 的一致性边界。视图的 `onCleanup` 只能断开前端连接（WebSocket 等），不得直接调用 `pty.remove`、`PtyManager` 或 Workbench Store。

### 4.4 Canvas 终端的无缝贴边尺寸规则

Workbench 内嵌终端由 `ghostty-web` 的 canvas 渲染。canvas 只能按完整的字符列和字符行绘制，而 Panel 的可用宽高可以是任意像素值。因此，不能把 `FitAddon` 的默认尺寸结果直接作为 Workbench 的视觉尺寸：它会固定预留 canvas 滚动条宽度，并在按字符格向下取整后，于右侧或底部留下可见的深色空带。

**渲染约束**：

1. `<Terminal>` 容器必须是无 padding 的满尺寸、`overflow: hidden` 容器；不要用全局滚动条 CSS 或额外 margin 来遮挡空带。
2. 禁用 `ghostty-web` canvas 自带的滚动条绘制，并以容器的完整内容宽度计算列数，不保留默认的滚动条宽度。
3. 终端尺寸必须从容器实际 `clientWidth` / `clientHeight` 扣除 CSS padding 后计算，不允许写死字符宽高、滚动条宽度或补偿像素。
4. **TUI（`isTui`）采用 full-bleed 策略**：列数与行数向上取整（`ceil`）到完整字符网格。这样 canvas 的宽高始终覆盖容器；超出边缘的不足一格部分由容器裁切，右侧和底部不留下任何正向余量。
5. **普通 terminal 和 Split Terminal 采用 strict 策略**：列数与行数向下取整（`floor`），保证所有字符格完整可见。该策略不继承 TUI 的裁切行为。

用户也可以在普通 terminal 或 Split Terminal 内手动启动 `ellamaka`。此时该终端不能仅凭 alternate screen 判断为 TUI（vim、less 等也会使用 alternate screen）；必须同时满足：TUI 通过 OSC 标题将终端标为 `Ellamaka` / `ellamaka | …`，且 `ghostty-web` 当前 buffer 为 alternate。满足后动态切换为 full-bleed，并把滚轮映射为 TUI 的 `Ctrl+Alt+Y` / `Ctrl+Alt+E` 消息历史滚动命令；退出 TUI 切回 normal buffer 后立即恢复普通 terminal 行为。

该规则集中在 `src/components/terminal-scrollbar.ts`，并由 `src/components/terminal.tsx` 对 `FitAddon.proposeDimensions()` 注入。禁止在 Panel、TUI 视图或主题 CSS 中重复实现尺寸补偿。

**回归验收**：

- 打开 TUI 后，Panel 的右边和底边不得出现由字符网格或 canvas 滚动条预留造成的可见空带。
- 改变浏览器窗口、Panel 列宽、Split Terminal 高度后，TUI 仍贴齐右边与底边。
- 普通 terminal 与 Split Terminal 不出现横向/纵向滚动条，也不因 TUI 的满铺规则裁切字符行。
- 单元测试至少覆盖：默认滚动条预留被移除、TUI 在小于半格余量时仍向上补足一行/列，以及普通 terminal 保持向下取整。

---

## 5. 状态管理与持久化设计 (关键机制)

Workbench 状态管理的核心目标是：

1. **全局刷新不丢失面板布局与绑定状态，并在宽限期内重新连接仍然存活的 PTY**。
2. **切换 Space Tab 不销毁 Panel 子树**——所有已打开 Tab 的 Panel、Chat 草稿、终端进程保持挂载，只是切换可见性。
3. **切换视图模式不释放 PTY**——TUI PTY、Split Terminal PTY 在视图切换时保持运行。
4. **高频对话生成期间左侧导航树保持绝对稳定**。

### 5.1 状态模型分层设计

Workbench 不再把布局、服务端会话和运行时资源塞进一个控制器。每类状态只有一个规范所有者：

- **WorkbenchStore** (`workbench-store.ts`)：唯一持久化布局所有者，保存 Display、Space Tab、Panel 布局、活动 Panel、`boundSessionId`、Split Terminal 设置和 PTY 重连提示；它只做同步纯状态变更。
- **View Store adapter** (`view-store.tsx`)：负责水合、`localStorage` 写入和短暂 UI 消息；它不是第二个领域 Store，不能拥有 SDK、PTY、router、Dialog 或 Toast 副作用。
- **Workbench Runtime** (`workbench-runtime.tsx`)：在首次连接完成后组合 HTTP health 与 SSE 连接状态，表达 `online | degraded | recovering | offline`。`degraded` 表示 HTTP 仍可用但事件流正在重连，保留可写能力并显示状态；断线不清空已加载数据；从非 online 回到 online 时递增恢复代次，Space Store 与 Session Tree 各刷新一次。
- **WorkbenchActions** (`workbench-actions.ts` / `workbench-actions-ports.ts`)：唯一跨所有者事务入口。创建、装载、替换、fork、解绑、关闭 Panel/Space、PTY 创建、PTY 断连恢复都先由 Action 分配 generation，再执行资源副作用，最后一次性提交布局或 Projection。`createWorkbenchActions` 是纯逻辑函数；`WorkbenchActionsProvider` 为每个 Workbench provider tree 创建独立实例，禁止模块级缓存跨 server、重挂载或多实例复用。runtime gate 是写操作的唯一保护边界，离线时返回 typed `offline` 结果。port 构造逻辑（`buildStorePort`/`buildPtyPort`/`buildSessionPort`）提取到 `workbench-actions-ports.ts`，store port 由 `view-store.tsx` 暴露的 `wb` 直接实现。
- **Session Projection** (`session-store.tsx`)：只在内存中保存服务端会话的只读投影。Action 的服务端响应和 Shell/SessionTree 的 SSE 对账是唯一 writer；组件、Dialog、命令和持久化层只能读取。
- **Directory SDK/sync**：插件、MCP、LSP 和配置按规范化 directory 缓存，不持久化。Panel 使用该 Panel 的 directory；TopBar 与 StatusPopover 通过活动 `SpaceScope` 和活动 Panel selector 获得同一 directory。
- **Space Store** (`space-store.tsx`)：读取可打开 Space 的目录列表，用于校验和展示；已打开 Tab 及其布局归 WorkbenchStore 所有。

`SpaceScope` 在领域边界明确表示 General 或 Space；General 不能依赖空字符串真假判断。General 的 Panel directory 可以是后端生成的 General task 目录，但能力组成仍只来自全局配置。Space 的能力是全局能力与该 Space 定义能力的并集；验收必须核对完整来源路径，而非数量。

PTY ID（`tuiPtyId`、`splitPtyId`、`termPtyId`）作为**重连提示**随 Workbench 布局持久化。Sidecar 的 PTY Session Registry 是进程存活状态的真相源。刷新后 PTY Manager 先探测旧 ID：存活则重连，已回收则清除旧 ID 并按需创建新 PTY。浏览器 Tab 关闭后没有新连接，sidecar 在断连宽限期结束时终止对应 PTY；下次打开时持久化的旧 ID 会在探测阶段自然失效。

### 5.2 水合门控与协同 (allStoresReady)

WorkbenchStore 完成水合后，`index.tsx` 以 `wb.ready()` 作为唯一的 **Workbench Bootstrap Gate**：

```tsx
const allStoresReady = () => wb.ready()
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

Renderer 中的 PTY 关联由 `pty-manager.tsx` 统一管理，后台进程生命周期由 sidecar 的 PTY Service 统一管理。Web 与 Desktop 使用同一套创建、探测、重连、显式删除和断连宽限语义。

**资源键**：`spacePath + panelId + resourceKind`

`resourceKind` 为 `"tui" | "term" | "split"`。

**Renderer 核心操作**：

| 操作 | 行为 |
|------|------|
| `ensure()` | 检查持久化的 PTY ID 是否存在。存在则**先探测**：向服务端验证该 PTY 是否存活。存活则复用（终端上下文完整保留）。已死则清除旧 ID、创建新 PTY、更新 PTY ID。不存在则直接创建。创建请求附带 generation token，异步返回时检查 generation 是否过期。同时记录 PTY 真实 cwd（`ptyDirectories` Map），用于后续 DELETE 的正确路由。 |
| `delete()` | 从 Renderer 内存缓存移除 PTY 关联。该操作只管理前端引用，不把普通 WebSocket 断连解释为进程销毁。 |
| `disposePty()` / `disposePanel()` / `disposeSpace()` | 用户显式关闭 PTY、Panel 或 Space 时立即请求 sidecar 终止对应进程，并清除 `ptyDirectories` 与持久化 PTY ID。 |

**探测机制**：PTY Manager 在 `ensure()` 时，若持久化状态中存在 PTY ID，先向服务端发起探测请求（如 PTY 状态查询或轻量连接尝试）。探测成功 → 复用，TUI 终端的滚动位置、当前面板等本地状态完整保留。探测失败（404 或超时）→ 视为已死，创建新 PTY 并更新持久化 ID。

**PTY 真实目录追踪**：PTY 的 `x-opencode-directory` routing header 必须指向 PTY 在服务端的实际 cwd（如 `session.directory`），而非 workbench 的 spacePath（如 General space 的 `""`）。`ptyDirectories` Map 在 `ensure()` 时记录 `ptyId → cwd`，所有 DELETE 操作优先使用该映射的值。

**Sidecar 断连宽限机制**：

- 每个 PTY Session 维护当前 WebSocket subscribers 和一个可取消的回收任务。
- 新 PTY 创建后在第一个 subscriber 建立前处于 Grace，防止创建成功但页面来不及连接时产生孤儿进程。
- 最后一个 subscriber 断开时进入 10 秒 Grace，PTY 进程继续运行。
- 同一 PTY 在 Grace 内重新连接时取消回收任务并继续使用原进程。
- Grace 结束仍无 subscriber 时，sidecar 自动终止并删除该 PTY。
- 显式 DELETE 和 Instance finalizer 立即终止 PTY，不等待 Grace。
- 多个 subscribers 共享 PTY 时，单个连接断开不会启动回收。
- Workbench 对需要继续运行的隐藏 TUI 和收起的 Split Terminal 保持 subscriber 连接；普通视图切换不会误触发 Grace。

**生命周期规则**：

| 事件 | 行为 |
|------|------|
| 视图切换（TUI ↔ Chat ↔ Context） | **不释放 PTY**。已经挂载的 TUI Terminal 与 WebSocket subscriber 保持存活，切回时复用同一终端。 |
| Split Terminal 收起 | **不释放 PTY**。只隐藏渲染区域并保持 WebSocket subscriber，终端上下文保留。再次展开复用同一连接。 |
| Panel 关闭 | `disposePanel()`：释放该面板所有 PTY，清除持久化 ID。 |
| Space Tab 关闭 | `disposeSpace()`：释放该 Space 全部 PTY，清除持久化 ID。 |
| 浏览器或 Electron Renderer 刷新 | `pagehide` 只 flush 布局和 PTY ID 提示。WebSocket 断开后进入 Grace，新 Renderer 探测并重连原 PTY，取消回收任务。 |
| 浏览器 Tab 或桌面窗口关闭 | WebSocket 断开后进入 Grace。没有新连接时，sidecar 在 10 秒后自动终止 PTY。 |
| Electron 应用退出 | Main Process 停止 sidecar，Instance finalizer 立即终止全部 PTY。 |
| Panel 绑定到新 Session | 释放旧 Session 的 TUI PTY，清除旧 ID，为新 Session 创建新 PTY。 |

**异步安全**：创建 PTY 的 Promise 必须携带 generation token。若 Promise resolve 时 Panel 已关闭或 Session 已变更，立即释放该 PTY，禁止将失效 ID 写入持久化状态。

### 5.5 TUI 进程关闭与自愈机制

WebSocket 连接关闭与 PTY 进程退出是两个独立事件。前端先确认 sidecar 中的 PTY 状态，再决定重连或回退：

- **瞬时断连**：刷新、Renderer 重载或短暂网络中断只关闭 WebSocket。前端保留 PTY ID，sidecar 进入 Grace，Terminal 在宽限期内重新连接原 PTY。
- **进程退出**：用户在 TUI 或 Shell 中输入 `exit` 后，sidecar 发布 `pty.exited` / `pty.deleted` 并从 Session Registry 删除 PTY。前端探测得到 404 后清除 PTY ID，并将 TUI 主视图回退到 `chat`。
- **连接关闭处理**：`<Terminal>` 的普通 `onClose` 不直接调用 `pty.remove`。它进入断连状态并触发探测或重连；只有确认 PTY 已退出时才清理持久化关联。
- **原子状态回退**：确认 PTY 已退出后，前端通过 SolidJS `batch` 同步清除本地信号、PTY Manager 缓存和 Panel PTY ID，再更新视图模式，避免中间状态触发重复创建。
- **Effect 竞态守卫**：TUI 视图的 `createEffect` 继续使用 `ctx.panel.viewMode`、`ctx.panel.slotState` 和 generation token 拦截过期创建结果。
- **组件 Keyed 实例化隔离**：终端 `<Show>` 使用 `keyed`。PTY ID 变化时卸载旧 Terminal 实例并创建新实例，防止 WebSocket 与终端对象跨 PTY 复用。

### 5.6 Session 状态收敛

服务端 Session 是 Session 标题、归档状态、消息内容的**唯一事实来源**。

本地持久化只保存：Panel 绑定了哪个 Session ID（存储在 Panel 布局状态中）。Session Projection 只存在于内存中，刷新后必须从服务端和 SSE 重新构建。

不持久化：

- Session `status`（bound / idle / archived）——从 Panel 布局绑定和服务端归档字段派生。
- Session `boundPanelId`——从 Panel 布局反向查找。
- Session title、副本、目录、时间戳和状态——由服务端投影提供，UI 不做 optimistic 伪造。
- Session 列表——由 SessionTree 的服务端加载和 Shell SSE 对账写入内存 Projection。`GET /workbench/session-groups` 只返回 `time_archived IS NULL` 且 `parent_id IS NULL` 的未归档根会话；归档会话和子会话不得进入列表、`sessionCount` 或客户端 Projection。

**事件处理规则**：

| 事件 | 行为 |
|------|------|
| `session.created` | 使对应 Space 的 SessionTree 加载失效；服务器返回后写入 Projection。 |
| `session.deleted` | 通过 Action 解绑所有引用该 Session 的 Panel、释放对应 PTY，再删除 Projection。 |
| `session.updated`（含 `timeArchived`） | 将归档视为服务端权威状态变化：使 SessionTree 加载失效，通过 Action 解绑所有引用该 Session 的 Panel、释放对应 PTY、删除 Projection，并向用户显示状态变化提示。后续 SessionTree 查询会在服务端过滤该会话。 |
| `session.updated`（标题变更） | Shell SSE 只 patch 对应 Projection 项；不伪造 Session 或触发无关树级重载。 |
| `message.part.*` | 仅更新对应 `PanelChat` 的消息流，不触发树或其它 Panel 的更新。 |

Panel 绑定只能由显式的用户关闭/替换操作、服务器 `session.deleted` 事件或带归档时间的 `session.updated` 事件解除。外部删除或归档已经装载的 Session 时，Workbench 必须释放对应 PTY 和 Panel 绑定，并向用户显示状态变化提示。远端数据加载完成前不得根据空列表解绑 Panel，避免初始空数组误判。Projection 的失效信号只用于通知树重新拉取，不能承载会话领域数据，也不能写入持久化。

### 5.7 响应式与副作用约束

- `createMemo` 必须是纯函数，**禁止**在 memo 内写 store 或触发 API 请求。副作用使用 `createEffect`。
- SSE 事件订阅只在结构性事件（`session.created` / `session.deleted` / 含 `timeArchived` 的 `session.updated`）时触发 Session 树定向刷新。高频属性变更（标题、消息流）由对应组件局部处理。
- Space Path 是所有 Store 操作的**主键**。Panel directory 是面板 CWD 上下文，禁止用 `panel.directory` 替代 Space Path 作为 Store 读写 key。`workspace.tsx` 或 `space-workspace.tsx` 必须将 `spacePath` 作为属性向下透传。
- `SDKProvider` 在创建时捕获目录，不能依赖后续 prop 变化自动切换上下文。每个 Panel 的 Provider 边界必须以 `panelID + directory` 作为 keyed identity；Panel 绑定到不同目录的 Session 时，必须重建目录 SDK、消息 Store 与 SSE 订阅，禁止继续复用旧目录上下文。
- Titlebar 等 Workbench 外壳只能把目录 mode/capability 当作渐进增强信息。资源仍在 loading 时不得读取会触发根级 `Suspense` 的值；先显示保守状态，加载完成后再局部更新，避免切换 Session 时整页退回 splash。

### 5.8 持久化性能优化

拖拽过程中的尺寸变更（Panel 宽度、Split Terminal 高度、Sidebar 宽度）只在内存 draft 中更新，`pointerup` 时一次性提交到持久化 Store。

持久化写入采用：

- 150ms trailing debounce。
- latest-wins 语义（同一 key 的新值覆盖旧未写出的值）。
- 串行写队列。
- `visibilitychange` / `pagehide` 时同步 flush 未写出的数据。

禁止每次 `mousemove` 序列化整个 Workbench 状态。

### 5.9 持久化配置项

- `workbench`：统一的 Workbench 状态快照。使用 `localStorage` 持久化（区别于上游 `sessionStorage`），确保关 tab 重开时布局保持。包含显示设置、已打开 Space Tabs、当前激活 Space Path、每个 Space 的 Panel 布局、Session 绑定、Split Terminal 配置和 PTY ID 重连提示。

持久化 schema 当前为 **v2**：`activeTabPath` 是 Tab 身份，`tabs[].path` 与 `spaces[path]` 是唯一关联键；`activeSpaceName` 仅在水合旧数据时映射。名称映射不唯一或失效时回退到 General 的 `""`，不删除旧布局。General 必须以“是否存在 path 为 `""` 的 Tab”判断，禁止使用 path 的 truthy 判断。

存储引擎：`localStorage`（key: `"workbench"`）。

**PTY ID 重连提示**：`tuiPtyId`、`termPtyId` 和 `splitPtyId` 随布局一起写入 `localStorage`。`pagehide` 调用普通 `flushPersisted()`，不剥离 PTY ID，也不修改内存 store。水合后的 ID 必须先经过 `ptyManager.ensure()` 探测；sidecar 已回收的 ID 会被清除并按需替换，因此持久化 ID 不承担进程存活状态的权威职责。

单一键，单一 Store，单一水合门控。

### 5.10 侧栏会话浏览器 (Session Tree) 与常驻 Tab 体验优化

- **常驻通用 Tab (General Tab)**：
  - 工作台默认且常驻一个名为 `"General"` (会话) 的 Tab，其 `path` 标识为 `""`，此 Tab 不允许被用户关闭（UI 屏蔽关闭按钮，Store 层拦截删除请求）。
  - 当无任何物理项目空间打开时，工作台默认激活并展示此通用 Tab，提供 1~3 个可弹性伸缩的面板，用于装载和操作非物理项目空间关联的独立全局会话。
- **内置独立会话的工作目录 ($WOPAL_HOME/general_tasks/)**：
  - 后端 Session 存在关联物理目录的强约束限制（`directory` 为 `notNull()`）。
  - 通用 Tab 下新建会话由 `POST /workbench/sessions` 的服务端 provisioner 创建 `$WOPAL_HOME/general_tasks/` 下隔离目录；前端不推测 WOPAL_HOME、不拼接路径。每次请求携带 `requestID`，未知结果先按同一 ID reconcile。
- **三层树和直接切换**：
  - 新 UI 只消费 `GET /workbench/session-tree`，固定为 `Scope → 工作位置 → Session` 三层；worktree 与子目录只是 Session marker，不形成第四层。
  - Space 的点击直接切换，不显示“即将切换”的确认弹窗，也不读写 `workbench.suppressTabConfirm`。关闭 Space、覆盖 Panel、解绑与删除仍保留各自确认。
  - 创建 Space Session 前，PanelLoader 只显示 `GET /workbench/locations` 返回并经边界验证的目录候选；General 不显示目录选择。Chat/TUI 是 Panel 初始视图，不改变服务端 Session 领域类型；TUI PTY 创建失败会回退 Chat。
- **展开状态与树层级一致**：
  - 折叠状态仅以 Scope 的规范化 `path` 为键；Scope 展开后始终呈现其工作位置和会话，不把目录或 worktree 再拆成第四层。
  - 该状态只服务当前 Renderer 生命周期；刷新后的树以服务端投影和当前 Space 状态为准，不将滚动位置或已失效目录作为持久化契约。
- **P1/P2/P3 绑定徽章与置顶 (Pin)**：
  - 会话行左侧显示对应空间下绑定 Panel 序号的气泡徽章（如 `P1`、`P2`、`P3`）。徽章取消 `scale-90` 缩放以保持清晰无锯齿，文字大小放为 `text-[10px]` 并设置 `min-w-[20px] h-4.5`，使比例更协调挺拔。
  - 支持会话“置顶 (Pin/Unpin)”功能。已置顶的会话在行首展现大头针矢量图标，并在数据源合并时重排至分类的最顶端，支持右键快捷 Pin/Unpin 切换。
- **空间高亮与交互解耦**：
  - 点击左侧 Chevron 图标（包裹于 `size-5 flex items-center justify-center shrink-0` 容器中以防被挤压变形，并支持 duration-200 平滑旋转）只控制其展开/折叠，不切换激活空间；点击空间名称/整行其余区域则切换激活空间，两项职责完全解耦。
  - 区分选中与 hover 背景色：激活的空间背景为最纯粹且低调的 `bg-v2-background-bg-deep rounded-md px-2` 独立深色背景，与 hover 背景色 `hover:bg-v2-overlay-simple-overlay-hover` 明显拉开视觉梯度，取消左侧多余的竖条指示线以维护极简排版。
  - Space 切换没有确认过渡态；点击名称或行主体立即激活目标 Space。仅关闭、解绑、删除和覆盖仍按各自风险保留确认。

### 5.11 状态栏分区与多面板元数据智能层级链

- **状态栏分区结构**：
  - 状态栏划分左右分区：**左区**渲染当前激活面板的工作现场元数据层级链，**右区**渲染服务器连接状态与名称，中区弹性占位起两端拉伸对齐作用。
- **左区：现代紧凑层级链**：
  - 界面呈现格式为：`空间名 / P{激活面板序号}/{面板总数} / 会话标题 / 工作路径`
  - 样式规范：所有文本和层级段使用一致的字体粗细与颜色（`text-v2-text-text-muted`），不设任何背景色。会话标题无额外高亮，面板序号直接用无背景的文本显示。
  - 工作路径（CWD）在级联时自动去掉首字符的斜杠 `/`（例如 `/workspace/sub` 显示为 `workspace/sub`）以平滑融入斜杠链条，同时悬停时可通过 HTML title 属性呈现完整的绝对路径。
  - 若未激活面板，则层级链仅展示 `空间名`。若未绑定会话，层级链隐藏会话段。
- **右区：服务器状态**：
  - 渲染服务器连接指示器（小绿点 `bg-v2-icon-icon-accent`）和服务器名称，并在其左侧配置 `border-l` 竖分割线与左区层级链分隔开。
- **元数据洞察与响应式更新**：
  - 状态栏动态订阅当前活动空间下的聚焦激活面板 `space.activePanelID`、`panel.directory` 路径以及绑定会话标题。
  - 一旦发生面板点击切换、或者是 PTY 终端在后台通过命令变更了工作目录（CWD），层级链会立即响应式刷新最新现场。

### 5.12 浏览器生命周期与单 Tab 互斥

**单 Tab 互斥（Web Locks API）**：
- `WorkbenchSingletonGuard` 组件在 Workbench 初始化时通过 `navigator.locks.request(..., { ifAvailable: true })` 获取独占锁。
- 第二个 Tab 尝试打开同一 workbench 时，锁被占用，显示"工作台已在其他标签页打开"提示页，不初始化 workbench。
- Tab 关闭/刷新时浏览器自动释放锁，无需 `beforeunload` 参与（比心跳方案更可靠，不会因崩溃残留锁状态）。
- 浏览器不支持 `navigator.locks` 时降级为不限制（边缘场景，不影响功能）。

**页面生命周期**：

- Workbench 不使用 `beforeunload` 阻止刷新或关闭，也不推断浏览器离开的具体原因。
- `pagehide` 只调用 `wb.flushPersisted()`，把包含 PTY ID 重连提示的最新布局同步写入 `localStorage`。
- 页面销毁使 PTY WebSocket 自然断开。Sidecar 在最后一个 subscriber 断开后进入 10 秒 Grace。
- 刷新后的页面在 Grace 内探测并连接原 PTY，sidecar 取消回收任务。
- Tab 关闭后没有新连接，sidecar 在 Grace 结束时终止 PTY。
- Panel 和 Space 的显式关闭继续调用 `disposePty()` / `disposePanel()` / `disposeSpace()`，立即释放进程。

**刷新时序**：

1. `pagehide` 同步 flush Workbench 布局和 PTY ID 提示。
2. WebSocket 断开，sidecar 启动 PTY Grace。
3. 新页面水合布局并通过 `ptyManager.ensure()` 探测旧 ID。
4. 探测成功后重新连接，sidecar 取消 Grace 回收任务。

浏览器关闭、Renderer 崩溃和 Electron 窗口关闭使用相同的断连回收语义。桌面应用退出时由 Electron Main Process 停止 sidecar，立即释放全部 PTY。详见 `DESKTOP.md`。

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
   - 从 TUI 切到 Chat：已挂载的 TUI Terminal 保持隐藏和连接状态，前端同时挂载 `PanelChat` 导入聊天数据。
   - 切回 TUI：恢复同一 Terminal 的可见性，终端上下文保持不变。
   - Split Terminal 收起时只隐藏渲染区域并保留 WebSocket subscriber；再次展开时复用同一连接。

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

### 6.7 跨空间智能 Tab/Panel 分发与定位
- **重复绑定拦截**：
  - 在双击或单击会话的第一时间，优先检索该会话是否已在工作台的任何面板（包括当前或其它空间）中打开。
  - 若已打开，工作台拒绝发起重复绑定，而是自动执行跨空间 Tab 切换聚焦，并精准闪烁高亮对应的面板。
- **自适应 Tab 开辟**：
  - 双击 A 空间下的会话时，工作台自动寻找 A 空间的 Tab。
  - 若 A 空间 Tab 尚未在顶部打开，工作台自动在顶栏“开辟（创建并激活）”该 Tab 页，保证会话与空间的强隔离。
- **弹性扩容与兜底覆盖**：
  - 切换到正确的 Tab 后，优先在空间面板里分发至 `empty` 槽位。
  - 若全在忙，且当前面板数量未达最大值 3，自动横向“扩容”新增一个面板分栏并绑定。
  - 若 3 个面板已满载且都在忙，则询问用户覆盖：
    - 若有聚焦选中的面板，询问是否覆盖该聚焦面板。
    - 若无任何聚焦面板，询问是否覆盖第一个面板（Panel 1）。确认后方可安全覆盖装载。

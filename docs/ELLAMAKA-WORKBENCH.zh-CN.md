# Ellamaka Workbench 设计规范

> **状态**：核心设计规范。后续所有开发工作必须严格遵循本文档。

## 核心约束

Workbench 通过**复制官方 `packages/app` 并在其上进行外挂定制**来构建。
这是根本设计规则：

- **绝不修改 `packages/app`。**
- 所有 workbench 代码位于 `packages/ellamaka-app`。
- 定制是叠加式的：新组件、新路由、新状态 —— 绝不编辑上游文件。
- 目标是**最小侵入**，以便后续可以无冲突地合并上游 `packages/app` 的功能更新。

## 参考来源

- PoC 试点：`projects/ellamaka/poc/web` —— 验证了多 PTY TUI、基于 SSE 的 Chat、三栏 IDE 布局
- 官方应用技术栈：SolidJS + Vite + Tailwind，`@opencode-ai/ui` 组件库，server SDK 上下文
- Workbench 继承完整的官方应用技术栈并在此基础上扩展

## 1. 方向

Workbench 是 ellamaka 的主工作区。
它独立于官方应用存在。
它不是官方应用壳内的子页面。

核心对象是 **Space（空间）**。
每个空间拥有自己的标签页、面板、终端状态、对话状态和布局偏好。

对话界面只有两种内容模式：

- TUI
- Chat

不再有独立的 Split 模式。
Split 变成一种**多面板布局状态**。

## 2. 目标模型

```
Ellamaka App
├─ Official App（官方应用）
│  ├─ Home
│  └─ Session
└─ Workbench
   ├─ Workbench Shell
   ├─ Space Rail（空间栏）
   ├─ Space Tabs（空间标签页）
   ├─ Panel Workspace（面板工作区）
   ├─ Bottom Terminal Dock（底部终端坞）
   └─ Workbench Statusbar（状态栏）
```

面板工作区是产品的核心。
每个打开的空间可以包含一到三个水平面板。
每个面板可以显示 TUI 或 Chat。
每个面板可以指向当前 WopalSpace 内的任意目录。

## 3. 壳与路由

### 3.1 Workbench 路由

`/workbench` 使用专用的 workbench 壳。
官方应用页面继续使用继承的 `Layout`。

实现方式：`RouterRoot` 中使用条件 `Show`，当路径以 `/workbench` 开头时跳过 `Layout` 包裹。

### 3.2 入口流程

用户可以在两个应用界面之间显式切换。

入口点：

1. Home 页面：项目导航栏中的 `Workbench` 入口
2. 官方标题栏：显式的 `Workbench` 文字按钮
3. Workbench 标题栏：`Official App` 文字按钮，恢复上次官方路由

官方应用布局保持不变。
Workbench 集成在官方标题栏中添加一个显式的 `Workbench` 按钮，其余官方应用壳保持不变。

### 3.3 架构与目录结构

```
packages/ellamaka-app/           ← ellamaka 定制 web UI
  ├── src/pages/workbench/         ← 🆕 三栏 IDE 工作台
  │   ├── index.tsx                  主布局(top-bar/activity-bar/sidebar/workspace/status-bar)
  │   ├── view.tsx                   视图切换 Provider(面板状态管理，持久化到 localStorage)
  │   ├── space-store.tsx            空间列表 + tab 状态 Provider
  │   ├── surface-route.ts           路由与界面切换辅助逻辑
  │   └── parts/
  │       ├── top-bar.tsx            顶栏(品牌/活动空间摘要/返回 Official App)
  │       ├── sidebar.tsx            活动栏与空间栏(已注册空间、折叠、设置入口)
  │       ├── workspace.tsx          工作区(标签页管理与 1~3 个 Panel 容器)
  │       ├── panel.tsx              通用面板组件(模式切换、目录选择)
  │       ├── bottom-dock.tsx        底部终端坞组件
  │       ├── status-bar.tsx         底栏(状态/服务器/活动路径)
  │       └── workbench-settings.tsx 工作台特有设置菜单
  ├── (其他目录完全继承 app/)
  └── AGENTS.md                    ← 包级开发规则
```

### 3.4 与上游同步策略

| 策略 | 说明 |
|------|------|
| **目录级 merge=ours** | `.gitattributes` 将 `packages/app/` 标记为 `merge=ours`，上游合并时保留 ellamaka 基线作为对照；`packages/ellamaka-app/` 不受保护，可正常合并上游变更 |
| **增量同步工作流** | 上游 `packages/app` 有更新时，人工或脚本 review 差异 → 挑选变更 cherry-pick 或重做 → 在 `packages/ellamaka-app/` 同步落地 |
| **定制区域边界清晰** | 定制集中在新增的 `workbench/`、`view.tsx` 和入口注入；不修改 `app/` 原有结构 |
| **依赖同步** | `package.json` 中的 `workspace:*` 依赖指向共享包，与上游保持一致 |

### 3.5 从 PoC 正规化的能力

架构决策带入，代码不直接搬运：

| PoC 验证的能力 | ellamaka-app 中的承接 |
|---------------|----------------------|
| pty-bridge 独立子进程模式 | 现有：`packages/opencode/src/pty/`（完整 PTY系统，Effect Schema，WebSocket ticket 鉴权） |
| 多空间 TUI 标签 | 现有：`TerminalProvider` 支持最多 20 tabs；workbench 新增 `useSpaceStore` hook |
| TUI/Chat 融合视图 | 新增：`panel.tsx` 与面板模式多面板组合 |
| 命令面板三视图切换(⌘1/2/3) | 新增：注册到 `CommandProvider`，复用现有命令面板 UI |
| 空间侧栏 + 空间拾取器 | 新增：`sidebar.tsx` 空间列表与切换 |

### 3.6 与 wopal-cli 的协同

ellamaka-app 嵌入 ellamaka 二进制后，`ellamaka serve` 提供 API + Web UI 双能力（同一端口 4096）。`wopal start` 职责简化为：

```
wopal start
  ├─ startEngine()  → 启动 ellamaka serve (detached，端口 4096)
  ├─ open browser   → http://localhost:4096/workbench
  └─ process.exit(0)← 立即退出，wopal.exe 解锁
```

与现有 `startEngine()` 架构完全契合——只是从 `spawnSync(ellamaka attach)` 改为 `open browser + exit`。彻底解决 `wopal update` 的 Windows 文件锁问题。

### 3.7 与 poc/web 的关系

| 阶段 | PoC (poc/web) | ellamaka-app |
|------|--------------|--------------|
| 现状 | 原型验证中 | 骨架已实现并跑通空间侧栏 |
| 验证完成后 | 保留作为探索参考 | 承接产品化代码和架构决策 |
| 后续 | 逐步迁移能力到 ellamaka-app，最终归档 | 唯一 web UI 产品形态 |

**PoC 归档时机**：ellamaka-app 的 workbench 视图稳定运行、覆盖 PoC 全部场景（桌面 TUI、移动 Chat、分屏、命令面板）后，poc/web 进入归档状态。不再新增功能，仅保留为参考实现。

## 4. Workbench 布局

### 4.1 桌面布局

```
┌──────────────────────────────────────────────────────────────┐
│ Workbench Titlebar                                            │
│ Ellamaka · active space · Official App                        │
├──────────────────────┬───────────────────────────────────────┤
│ Space Rail           │ Stage Header                          │
│ collapse · settings  │ space tabs · add panel                │
│                      ├───────────────────────────────────────┤
│ Registered spaces    │ Panel Workspace                       │
│                      │ 1~3 horizontal panels                 │
│                      │ panel = TUI or Chat                   │
│                      ├───────────────────────────────────────┤
│                      │ Bottom Terminal Dock                  │
├──────────────────────┴───────────────────────────────────────┤
│ Workbench Statusbar                                           │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 区域职责

| 区域 | 职责 |
|------|------|
| 标题栏 | 品牌、活动空间摘要、界面切换 |
| 空间栏 | 已注册空间、打开状态、活动状态、刷新、折叠控制、设置入口 |
| 舞台头部 | 空间标签页、添加面板操作 |
| 面板工作区 | 一到三个水平面板，用于 TUI 和 Chat |
| 底部终端坞 | 活动空间的全局 Web 终端坞 |
| 状态栏 | 服务器、频道、活动空间、面板数量、布局提示 |

## 5. 空间标签页

空间标签页代表打开的 WopalSpace 工作区。
它们不代表对话会话或终端实例。

每个空间标签页显示：

- 空间名称
- 关闭操作

选择空间标签页会恢复该空间的布局状态。
这包括面板组成、活动面板、底部坞可见性和最近的目录目标。

关闭空间标签页会保留该空间的持久化布局状态，以便重新打开同一空间时恢复。

## 6. 面板工作区

### 6.1 面板规则

面板工作区最多支持三个水平面板。

每个面板拥有：

- 面板类型：`tui` 或 `chat`
- 当前空间内的目标目录
- 宽度比例
- 该面板类型拥有的本地状态

```ts
type WorkbenchPanel = {
  id: string
  mode: "tui" | "chat"
  directory: string
  width: number            // flex 比例（正数），多面板按比例分配宽度
  terminalOpen: boolean    // 面板内终端是否打开
  terminalHeight: number   // 终端区域高度比例 (0~1)，默认 0.35
}

type SpaceWorkbenchState = {
  panels: WorkbenchPanel[]
  activePanelID: string
  terminalDockOpen: boolean
}
```

### 6.2 面板操作

工作区支持以下操作：

- 添加面板
- 移除面板
- 在 TUI 和 Chat 之间切换面板模式
- 更改面板目录
- 调整面板宽度
- 聚焦面板

默认布局是一个面板。
第一个面板以 TUI 模式打开，指向空间根目录。

### 6.3 为什么这取代了 Split

这个模型使分屏成为打开多个面板的自然结果。
UI 保持一致：

- 一个面板 = 单界面
- 两个面板 = 分屏
- 三个面板 = 扩展的多界面工作区

用户永远不会切换到一个独立的概念模式。
他们只是组合面板。

### 6.4 面板宽度约束

| 约束 | 值 | 说明 |
|------|-----|------|
| 最小面板宽度 | `280px` | 低于此值 TUI 字符严重折行，Chat 消息不可读 |
| 最大面板数 | 3 | 已有约束，不变 |
| 视口宽度校验 | `280 × 面板数 + 空间栏宽度` | 添加面板时校验视口是否能容纳；不满足则禁止添加 |
| resize 手柄 | 面板间 `4px` 垂直分隔条 | 鼠标悬停时高亮，cursor 变为 `col-resize` |
| 双击手柄 | 等分所有面板宽度 | 快速恢复均匀布局 |

`width` 字段语义为 **flex 比例**（正数）。例如三个面板 width 分别为 `[1, 2, 1]`，则宽度比为 25%:50%:25%。resize 时按像素差值换算为比例增减。

### 6.5 面板内终端

每个面板（TUI 或 Chat）可以通过面板菜单打开一个**面板级内嵌终端**。

打开后面板垂直分割为两个区域：

```
┌─────────────────────────┐
│ Panel Header (mode/dir) │  固定高度
├─────────────────────────┤
│                         │
│   TUI 或 Chat 主内容    │  flex: 1 - terminalHeight
│                         │
├── resize handle ────────┤  4px 水平拖拽条
│   Panel Terminal        │  terminalHeight（默认 35%）
│   (独立 PTY 实例)       │
└─────────────────────────┘
```

#### 规则

| 操作 | 触发方式 | 行为 |
|------|---------|------|
| 打开终端 | 面板菜单 → "Open Terminal" | 创建独立 PTY 实例，设 `terminalOpen: true`，高度默认 35% |
| 关闭终端 | 终端区域标题栏 × 按钮 | 销毁 PTY，设 `terminalOpen: false` |
| 调整高度 | 拖拽水平 resize handle | 更新 `terminalHeight`，持久化 |
| 最小高度约束 | — | 终端区域最小 `120px`，主内容区最小 `200px` |

#### 技术实现

面板终端复用现有 `Terminal` 组件（`src/components/terminal.tsx`）。该组件是自包含的：

- 自动通过 WebSocket 连接独立的 PTY 实例
- 使用 ghostty-web WASM 终端，同一页面多实例无冲突
- `FitAddon` 自动适配容器尺寸变化
- 通过 `TerminalProvider` 的 `scope` 参数实现面板级会话隔离

不需要修改 `Terminal` 组件本身或后端 PTY 系统。

#### 与底部终端坞的关系

面板内终端是**面板级别**的，跟随面板的 `directory` 上下文。
底部终端坞是**空间级别**的，独立于面板组成。

二者覆盖不同场景：
- 面板终端：在 Chat 对话时随手执行相关命令（如 `git status`、`npm test`）
- 底部坞：快速全局操作（如 `wopal` 命令）

## 7. TUI 面板

TUI 面板拥有一个真实的终端界面。
它填满面板主体。
其头部显示目录、状态、重连和适配操作。

### 7.1 终端关闭语义

主要退出路径在终端内部。
用户通过 `/exit` 或终端自身的进程退出来结束终端会话。

主 UI 不在每个 TUI 面板上显示显眼的关闭 `X`。
这可以避免正常流程中的意外关闭。

头部在菜单内提供一个次要的 `Force close`（强制关闭）操作。

### 7.2 PTY 生命周期

当前官方 PTY 关闭行为已经会移除 PTY 并杀死后台进程。
移除路径是显式的，本身不表明存在确认的泄漏。

相关代码路径：

- `packages/ellamaka-app/src/context/terminal.tsx`
- `packages/opencode/src/pty/index.ts`

设计决策是 UX 优先，而非 bug 修复。

## 8. Chat 面板

Chat 面板拥有一个针对所选目录的对话界面。
它填满面板主体。
其头部拥有模型、智能体、会话和目录控制。

消息区域在全宽面板主体内使用可读的内容宽度。
输入框固定在面板底部。

每个空间可以为每个面板保持独立的对话状态，或按目录复用共享的活动会话。
实现可以从每个空间每个目录一个对话会话开始，后续再演进。

## 9. 底部终端坞

Workbench 在状态栏上方包含一个底部坞。
它复用现有的官方 Web 终端能力。

这个坞与面板 TUI 和面板内终端都是分开的。它是一个**空间级别**的快速终端。

它的职责是：

- 提供一个熟悉的快速终端
- 支持快速命令而不干扰面板组成
- 在面板工作区以 Chat 为主时仍然可用

**优先级**：面板内终端（§6.5）先做，底部坞后续迭代。两者并存不冲突。

## 10. 设置

Workbench 的设置入口位于空间栏底部。

设置体验有两个层次：

### 10.1 全局外观设置

复用现有设置对话框用于：

- 主题
- 配色方案
- 字体

### 10.2 Workbench 显示设置

Workbench 特定的开关：

- 显示标题栏
- 显示状态栏

空间栏使用自己的折叠控制，而不是设置中的隐藏开关。
这些控制属于 workbench 状态，不属于官方应用标题栏设置。

## 11. 目录定位

每个面板可以指向当前空间内的任意目录。

这意味着用户可以：

- 在空间根目录保持一个 TUI 面板
- 在项目目录打开第二个 TUI 面板
- 针对另一个项目目录打开一个 Chat 面板

目录选择器应从以下内容开始：

1. 空间根目录
2. 在空间内发现的已注册项目根目录
3. 该空间中最近使用的目录

第一次实现可以从空间根目录加上手动选择的目录列表开始。
交互契约应从第一天起就基于面板-目录。

## 12. 实现顺序

### 步骤 1 — 独立壳

- 将 `/workbench` 路由到官方 `Layout` 之外
- 向 workbench 添加官方应用入口点
- 向官方应用添加 workbench 返回入口

### 步骤 2 — 面板工作区骨架

- 用面板工作区状态替换全局 TUI/Chat/Split 切换
- 支持一到三个水平面板
- 添加面板头部和添加/移除操作
- 在状态栏上方添加底部终端坞插槽

### 步骤 3 — 设置和显示控制

- 添加 workbench 设置菜单
- 打开全局设置对话框以设置主题
- 添加标题栏和状态栏的开关
- 在空间栏上添加折叠和展开控制

### 步骤 4 — TUI 面板集成

- 将 TUI 面板绑定到真实的目录作用域终端状态
- 添加每个面板的目录定位
- 添加次要的 `Force close` 操作

### 步骤 5 — Chat 面板集成

- 将 Chat 面板绑定到目录作用域的对话状态
- 在面板头部添加智能体/模型/会话控制
- 按空间持久化活动对话状态

## 13. 第一个实现切片

第一个代码切片交付：

- 独立壳
- workbench 入口点
- 面板工作区骨架
- workbench 设置入口
- 底部终端坞占位插槽

这个切片首先修复壳和布局问题。
它为后续的真实 TUI 和 Chat 集成创建正确的容器。

## 14. 当前实现检查点

### 14.1 已实现

- `/workbench` 在官方 `Layout` 之外渲染
- 官方标题栏保持原有布局，并添加一个显式的 `Workbench` 入口按钮
- Workbench 标题栏暴露一个文字按钮：`Official App`
- 返回官方应用时恢复进入 workbench 前最后活动的官方路由
- Workbench 状态是空间优先的，并按空间持久化
- 面板工作区支持一到三个面板
- 每个面板持久化 `mode`、`directory` 和 `width` 基础
- TUI 面板移除使用次要菜单操作，而非直接的关闭按钮
- 底部终端坞占位位于右侧舞台列中，状态栏上方
- 空间栏始终存在，可以折叠为窄条
- Workbench 设置入口位于空间栏底部
- 标题栏和状态栏的可见性已可用户切换，并在刷新后持久化

### 14.2 尚未实现

- TUI 面板仍然是占位界面
- Chat 面板仍然是占位界面
- PoC 终端流程尚未迁移到面板模型中
- PoC 对话流程尚未迁移到面板模型中
- 面板目录选择 UI 尚未接线
- 面板宽度 resize 手柄尚未接线
- 面板宽度约束（最小 280px、视口校验）尚未实现
- 面板内垂直 Split 终端（§6.5）尚未实现
- 底部坞尚未使用真实终端

### 14.3 下次会话的续做点

从真实内容集成继续，而非更多壳工作。

1. 将 PoC 终端流程迁移到 TUI 面板
2. 将 PoC 对话流程迁移到 Chat 面板
3. 面板宽度约束 + resize 手柄
4. 面板内垂直 Split 终端（面板菜单 → Open Terminal）
5. 接线每个面板的目录定位
6. 将底部坞接线到真实终端实现

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

**PoC 归档时机**：ellamaka-app 的 workbench 视图稳定运行、移动端 `/m` 路由完成迁移（见步骤 6）、覆盖 PoC 全部场景（桌面 TUI、移动 Chat、分屏、命令面板）后，poc/web 进入归档状态。不再新增功能，仅保留为参考实现。

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
- 使用 ellamaka 隔离的包装组件，避免上游合并冲突（详见 §12.1）

### 步骤 6 — 移动端路由 `/m`

- 新增 `/m` 路由，提供手机专属 Chat 界面（详细设计见 §12.1.5）
- 从 poc/web 的 Chat 实现迁移核心交互逻辑并优化移动 UX
- 检测手机浏览器自动重定向到 `/m`
- 用户可手动切换回桌面版，偏好持久化

## 12.1 Chat 面板架构详细设计

### 12.1.1 组件隔离策略

为防止与上游 `packages/app` 产生合并冲突，所有 Workbench 级别的 Chat 适配代码存放在 ellamaka 专属目录中：

```
packages/ellamaka-app/src/pages/workbench/
├── parts/
│   ├── panel-chat.tsx              # Chat 面板容器
│   ├── panel-chat-header.tsx       # 面板级控制头部
│   └── panel-chat-composer.tsx     # 面板上下文适配的输入区
├── services/
│   └── panel-session-service.ts    # 面板级会话状态持久化
└── hooks/
    └── use-panel-chat-state.ts     # 面板作用域 Chat 状态钩子
```

**隔离原则：**

1. **零侵入**：不修改 `packages/app` 中的任何文件，所有适配均为叠加式包装
2. **复用官方组件**：直接从 `@app/pages/session/*` 导入 `MessageTimeline`、`SessionComposerRegion` 等核心组件，不做修改
3. **适配器模式**：薄包装层处理面板级关注点（目录作用域、布局适配、标题隐藏）
4. **边界清晰**：ellamaka 特有代码与继承的 app 代码在目录层面完全分离

### 12.1.2 官方 App Chat UI 设计版本分析

官方应用的 Chat 界面由同一个 `PromptInput` 组件（2155 行）通过全局设置 `settings.general.newLayoutDesigns()` 在两种视觉风格之间切换：

**两种设计对比：**

| 维度 | v1 老设计（`newLayoutDesigns = false`） | v2 新设计（`newLayoutDesigns = true`） |
|------|-------------------------------------|-------------------------------------|
| **UI 组件库** | `@opencode-ai/ui/*`（v1） | `@opencode-ai/ui/v2/*`（v2） |
| **视觉风格** | 传统边框，信息密度较高 | 圆角+阴影，视觉更简洁 |
| **模型选择器** | 底部 dock 工具栏中 | 嵌入 composer 工具栏内 |
| **Agent 显示** | 在会话头部和交互中可见 agent 名称 | 去掉了 agent 名称显示，界面过于简陋 |
| **新会话页** | Logo + 标题 + worktree 选择器 + 信息文本 | WordmarkV2 + 内联 composer，信息缺失 |
| **Session 头部** | 完整头部（文件树/搜索/终端切换、打开编辑器菜单） | 简化的控制栏，功能缺失 |
| **文件树** | 默认显示 | 默认隐藏 |

**UX 评估：**
- v1 老设计提供更完整的信息密度和功能性，agent 名称可见、头部功能完整、新会话页信息丰富
- v2 新设计过度精简，去掉了 agent 名称显示、简化了头部、新会话页信息不足，用户体验明显下降
- `showCustomAgents` 设置仅对 v2 生效，且默认关闭，进一步限制了 v2 的 agent 可见性

**结论：Workbench Chat 集成应以 v1 老设计为目标。**

**集成策略：**
- `PromptInput` 组件根据全局 `newLayoutDesigns` 设置切换渲染风格。Workbench 面板需要确保在嵌入场景下使用 v1 渲染路径
- 如果用户全局开启了 v2，Workbench 包装层需要强制覆盖为 v1 风格，或在包装层中显式设置 `newLayoutDesigns = false` 的上下文
- 核心复用组件 `MessageTimeline` 和 `SessionComposerRegion` 在两种设计下相同，差异仅在 `PromptInput` 的视觉包装

**上下文适配挑战：**

| 依赖 | 说明 | Workbench 挑战 |
|------|------|---------------|
| `useParams()` | 从路由获取 session ID | Workbench 面板不在 session 路由中 |
| `useSessionLayout()` | 获取 session 标签页和视图状态 | Workbench 有自己的面板状态管理 |
| `useLayout()` | 全局布局上下文 | Workbench 有独立布局 |
| `useSDK()` / `useServer()` | SDK 和服务器连接 | 可复用，但需确保正确初始化 |
| `usePrompt()` / `useLocal()` | 提示词和本地状态 | 需要面板级隔离 |

### 12.1.3 桌面与移动端 Chat 策略

ellamaka-app 统一承载桌面和移动端两套 Chat 界面，均位于同一应用内：

| 维度 | Workbench Chat（桌面/平板） | Mobile Chat（手机/小平板） |
|------|------------------------|--------------------------|
| **路由** | `/workbench`（面板内嵌） | `/m`（独立移动路由） |
| **目标设备** | 桌面浏览器、平板 | 手机、小平板 |
| **布局模型** | 多面板工作区（1~3 面板） | 单列全屏，触控优化 |
| **Chat 来源** | 官方应用组件（包装适配） | 基于 poc/web Chat 迁移并优化 |
| **功能完整度** | 100%（工具调用、权限、文件引用、差异对比） | 核心对话 + 移动 UX 优化 |
| **状态管理** | 面板级会话隔离 | 单一活动会话 |
| **路由切换** | 用户手动进入 | 检测手机浏览器自动重定向 |

**策略依据：**
- Workbench Chat 复用官方组件，继承生产级功能和架构一致性
- Mobile Chat 在 ellamaka-app 内独立实现，不依赖 poc/web 运行
- 两者共享同一后端和会话基础设施，但 UI 层完全独立
- 移动端路由 `/m` 允许针对触控和小屏做深度 UX 优化，不受桌面布局约束

### 12.1.4 实施计划

#### 阶段 5.1：核心包装组件

**PanelChat（面板 Chat 容器）** — `parts/panel-chat.tsx`

职责：作为 Chat 面板的顶层容器，编排内部布局（头部 → 消息区 → 输入区）。直接复用官方的 `MessageTimeline` 渲染消息时间线，复用 `SessionComposerRegion` 渲染输入区域。针对面板上下文禁用居中布局、隐藏会话标题（由面板头部替代），并将面板的 `directory` 作为工作树上下文传递给输入区。

**PanelChatHeader（面板控制头部）** — `parts/panel-chat-header.tsx`

职责：面板级的控制栏。左侧显示当前目录路径指示器；右侧提供模型选择器（下拉菜单）、智能体选择器（下拉菜单）和新建会话按钮。视觉风格与现有 workbench 面板头部保持一致。

**PanelChatComposer（面板输入区适配）** — `parts/panel-chat-composer.tsx`

职责：对官方 `SessionComposerRegion` 的面板级薄适配。禁用居中模式，将放置方式设为 `inline`，传递面板的目录上下文和提交回调。

**usePanelChatState（面板 Chat 状态钩子）** — `hooks/use-panel-chat-state.ts`

职责：为每个面板创建隔离的 Chat 状态。核心行为：
- 根据 `spaceId + panelId + directory` 组合生成唯一的会话键（session key），确保同一面板同一目录复用会话
- 使用官方 `createSessionComposerState` 工厂创建输入区状态
- 暴露响应式访问器：`sessionKey`、`ready`、`composerState`、`inputRef`
- 提供 `handleSubmit` 和 `handleResponse` 回调
- 挂载时确保会话存在（不存在则创建新会话）

#### 阶段 5.2：状态持久化层

**PanelSessionService（面板会话持久化服务）** — `services/panel-session-service.ts`

职责：管理面板级会话的持久化存储。每个面板+目录组合持久化以下信息：当前会话 ID、选中的模型、选中的智能体、最后活动时间。使用现有的 `Persist` 工具按空间粒度存储，每个空间保留最近 50 条会话记录，超出部分自动清理。

#### 阶段 5.3：与面板工作区集成

在 `view.tsx` 的面板渲染逻辑中，当面板模式为 `chat` 时，条件渲染 `PanelChat` 组件，传入面板 ID、目录访问器和当前空间 ID。此改动替换当前 Chat 面板的占位 UI。

### 12.1.5 移动端路由 `/m` 设计概要（步骤 6 范围）

移动端 Chat 不作为 Workbench 的一部分，而是在 ellamaka-app 内新增独立的 `/m` 路由，专为手机和小平板提供优化的 Chat 体验。

**路由与重定向：**
- 新增 `/m` 路由，使用独立的移动端壳（mobile shell），不包裹在 workbench 或官方 Layout 中
- 应用启动时检测用户代理（User-Agent）和视口宽度，手机浏览器自动重定向到 `/m`
- 用户可手动切换到桌面版（`/workbench`），偏好设置持久化

**Chat 功能来源：**
- 从 poc/web 的 Chat 实现迁移核心交互逻辑（SSE 流式响应、消息列表、输入框）
- 在此基础上进一步优化移动 UX：触控手势、虚拟键盘适配、安全区域感知
- 复用 ellamaka-app 的会话基础设施（与 Workbench Chat 共享后端）

**移动 UX 优化方向：**
1. **触控手势**：滑动切换会话、长按消息操作
2. **输入优化**：更大的触控目标、虚拟键盘弹起时自动调整布局
3. **安全区域**：适配刘海屏、底部安全区等移动端特殊区域
4. **性能**：针对移动网络优化首屏加载和消息流渲染

**代码隔离：**
- 移动端组件放在 `packages/ellamaka-app/src/pages/mobile/` 目录下
- 与 workbench 和官方 app 代码在目录层面完全分离

此部分属于后续步骤（步骤 6），不在当前步骤 5 的实施范围内。

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

- Chat 面板仍然是占位界面（详细设计见 §12.1）
- PoC 对话流程尚未迁移到面板模型中
- 面板目录选择 UI 尚未接线
- 底部坞尚未使用真实终端
- 移动端路由 `/m` 尚未实现（步骤 6，设计概要见 §12.1.5）

### 14.3 下次会话的续做点

1. **实现面板 Chat 包装组件**（§12.1.4，阶段 5.1）
   - 创建 `panel-chat.tsx`、`panel-chat-header.tsx`、`use-panel-chat-state.ts`
   - 与 `view.tsx` 中现有的面板工作区集成

2. **接线面板级目录定位**
   - 在面板头部添加目录选择器 UI
   - 对接空间的项目发现 API

3. **将底部坞接线到真实终端实现**
   - 复用官方应用的 Web 终端能力
   - 添加空间级终端状态管理

4. **移动端路由 `/m` 实现**（步骤 6）
   - 从 poc/web 迁移 Chat 核心逻辑到 `pages/mobile/`
   - 实现手机浏览器自动检测和重定向
   - 移动 UX 优化（触控、键盘、安全区域）

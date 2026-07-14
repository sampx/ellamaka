---
name: ellamaka-app 代理规则
description: 基于 SolidJS、Vite 和 Tailwind CSS 构建的 ellamaka Web UI 前端
---

# 代理开发规则

## 1. 权威参考

- 项目设计：`../../docs/DESIGN.md`
- Workbench 设计：`../../docs/ELLAMAKA-WORKBENCH.zh-CN.md`
- 父级规则：`../../AGENTS.md`
- 后端规则：`../opencode/AGENTS.md`
- UI 库：`../ui/`（`@opencode-ai/ui` workspace package）

## 2. 架构与目录

执行链：Vite dev server -> SolidJS SPA -> `@opencode-ai/sdk` -> backend（`packages/opencode`）HTTP/WS API。

本目录是 ellamaka/OpenCode 的 Web 前端。它不包含 engine runtime、CLI、server 或 storage 逻辑；后端能力通过 `@opencode-ai/sdk` 调用。

| 目录 | 职责 |
|---|---|
| `src/app.tsx` | 应用根组件、路由和全局 provider 装配 |
| `src/entry.tsx` | Vite entry，挂载 SolidJS app |
| `src/pages/` | 路由页面组件 |
| `src/pages/workbench/` | Workbench 专属实现，遵循本文件第 5 节的强制边界 |
| `src/components/` | 可复用 UI 组件 |
| `src/hooks/` | 自定义 SolidJS hooks 和 primitives |
| `src/context/` | SolidJS context 定义 |
| `src/i18n/` | 国际化文案和 locale 配置 |
| `src/utils/` | 纯工具函数 |
| `src/addons/` | 浏览器插件/扩展相关界面 |
| `src/constants/` | 应用级常量 |
| `e2e/` | Playwright e2e 测试 |
| `public/` | 静态资源 |
| `script/` | 构建、检查和开发辅助脚本 |

## 3. 开发命令

| 场景 | 命令 | 何时 |
|---|---|---|
| 开发服务 | `bun run dev` | 本地前端开发；需先启动 backend |
| 后端 | `bun run --conditions=browser ./src/index.ts serve --port 4096`（从 `packages/opencode` 运行） | 本地前端开发时的 API 后端 |
| 构建 | `bun run build` | 生产构建 |
| 预览 | `bun run serve` | 本地预览生产构建 |
| 类型检查 | `bun run typecheck` | 修改 TypeScript 后 |
| 单元测试 | `bun run test:unit` | 修改组件、hook 或 util 后 |
| 单元测试监听 | `bun run test:unit:watch` | 开发中持续运行 |
| 端到端测试 | `bun run test:e2e` | 修改页面、路由或用户流程后 |
| 端到端界面模式 | `bun run test:e2e:ui` | 调试 e2e 测试 |
| 端到端报告 | `bun run test:e2e:report` | 查看 e2e 测试报告 |
| 持续集成测试 | `bun run test:ci` | CI 环境 |

所有前端命令从 `packages/ellamaka-app` 目录运行。`opencode dev web` 会代理到线上 `https://app.opencode.ai`，本地 CSS/UI 修改不会生效；本地 UI 开发必须分离运行 backend 和 app dev server。

## 4. 通用实现规则

- 遵循父级 `../../AGENTS.md` 的 Bun、TypeScript 风格规则和并行工具偏好。
- 技术栈：SolidJS 1.x、Vite 7、Tailwind CSS 4、`@kobalte/core`、`@solidjs/router`、`@tanstack/solid-query`。
- SolidJS state 优先使用 `createStore`，避免用多个独立 `createSignal` 表达同一结构状态。
- JSX 使用 SolidJS 的 `jsxImportSource`；禁止引入 React JSX。
- 页面级组件放 `src/pages/`，可复用组件放 `src/components/`，跨 package 共享 UI 原语放 `packages/ui/`。
- 页面路由使用 `@solidjs/router`；新增页面时同步更新路由配置。
- 后端通信通过 `@opencode-ai/sdk`；禁止组件裸调 fetch 到 backend。
- 国际化文案放 `src/i18n/`，使用 `@solid-primitives/i18n` API。
- 样式优先使用 Tailwind CSS utility classes；必要的自定义样式放 `src/index.css`。
- 类型检查使用 `tsgo -b`，禁止直接运行 `tsc`。
- 构建使用 Vite，配置位于 `vite.config.ts`，生产 target 为 `esnext`。
- 上游共享代码优先通过 adapter、callback 或小型注入点扩展，禁止复制整段 Session、命令、Dialog 或导航流程。

## 5. 工作台强制边界

本节适用于 `src/pages/workbench/` 内全部代码，也适用于为了 Workbench 修改 `src/components/`、`src/context/` 和 `src/pages/session/` 时产生的适配代码。

首要目标是阻止状态边界继续恶化。任何修复或重构都必须先明确状态所有者、作用域和事务入口，不能以“先让界面看起来正常”为理由新增跨 Store 写入、隐式目录上下文或重复生命周期逻辑。

实施优先级固定为：

1. 保持服务端资源和数据真相正确。
2. 保持 General、Space、Panel 和 Session 身份不串位。
3. 保持单一状态所有者和单一事务入口。
4. 最后处理展示、交互和样式。

### 5.1 状态所有权

每类状态只能有一个权威所有者。缓存、投影和持久化副本不得反向覆盖权威数据。

| 状态 | 权威所有者 | Workbench 可保存内容 | 禁止事项 |
|---|---|---|---|
| Session 标题、目录、时间、状态 | 服务端 Session Projection | 内存只读投影、`boundSessionId` 引用 | 持久化完整 Session；由 UI 伪造 Session；用本地旧字段覆盖服务端结果 |
| Space、Tab、Panel 布局 | `WorkbenchStore` | Tab、Panel、activePanel、viewMode、slotState、必要的重连提示 | Store 内调用 SDK、释放 PTY、导航或弹 Toast |
| PTY 进程是否存在 | 后端 PTY registry | `PtyManager` 运行时句柄；布局中的 PTY ID 只能作为重连提示 | 用 UI 布尔值表示进程存活；只隐藏 UI 不释放明确关闭的 PTY |
| 插件、MCP、LSP、配置加载结果 | directory-bound SDK/同步层 | 当前 directory 的内存投影 | 持久化列表；跨 directory 复用结果；只比较数量不核对来源路径 |
| 瞬时提示和弹窗 | Workbench UI 状态 | 短生命周期、不可持久化状态 | 写入领域 Store；让提示状态参与业务判断 |

`sessionStore` 所谓“只读投影”是指 UI 只读。只有 Session Projection adapter 和 SSE reconciliation 可以写入；组件、Dialog、命令处理器和 Workbench Action 都不能伪造或直接修改服务端字段。

### 5.2 身份与目录作用域

General 不是空路径的别名。业务边界必须使用显式可辨识类型表达作用域：

```ts
type SpaceScope =
  | { kind: "general" }
  | { kind: "space"; name: string; path: string }
```

- 禁止用 `if (spacePath)`、`if (!spacePath)` 或 `path || fallback` 判断 General 与 Space。
- 禁止把 `spaceName`、`panel.directory` 或 falsy 字符串当作 Space 主键。
- `SpaceScope` 决定会话归属和插件组合；`panel.directory` 决定 Panel 内 SDK、文件、终端和会话请求的工作目录，两者不能互换。
- General 只加载全局插件、全局 MCP 和全局配置，不得继承最近访问 Space 的目录状态。
- Space 加载全局能力与本 Space 定义能力的并集，验收时必须核对每个来源的完整路径。
- 从路由、localStorage 或服务端读取字符串后，必须在边界处转换为 `SpaceScope`；内部代码不得继续传播“空字符串代表 General”的隐式契约。

### 5.3 依赖方向与共享边界

唯一允许的主依赖方向为：

```text
UI 组件 -> WorkbenchActions -> Store / PtyManager / directory-bound SDK / Projection adapter
```

- UI 组件只负责渲染、收集用户意图和调用 Action，不得自行拼接多步领域事务。
- 一个组件不得在同一操作中写两个 Store，也不得先写 Store 再直接调用 SDK 或 `PtyManager`。
- `WorkbenchStore` 只能执行同步、纯状态变更，不得 import SDK、`PtyManager`、router、Toast 或 Dialog。
- 所有跨状态所有者的操作必须进入 `WorkbenchActions`，包括 load、replace、fork、bind、unbind、closePanel、closeSpace 和 createSession。
- `src/components/` 与 `src/pages/session/` 的共享代码不得 import `src/pages/workbench/`，也不得暴露 `panelID`、`spacePath`、`spaceName` 等 Workbench 专属参数。
- 共享组件通过 `onCompleted`、`onForked` 等通用回调返回结果；Workbench adapter 再调用 Action。
- 迁移期兼容 adapter 必须位于 Workbench 目录，写明 owner、删除条件和对应 Plan Task，不得让新调用者继续依赖旧入口。

### 5.4 目录 SDK 与上下文

- 每个 Panel 子树只能消费与该 Panel `directory` 绑定的一个权威 `SDKProvider`。
- StatusPopover、TopBar 等 Workbench 全局表面必须通过当前活动 `SpaceScope` 和活动 Panel selector 获得目录上下文，不能读取最后挂载 Panel 的 Context。
- 组件内禁止调用 `serverSDK.createDirSdkContext()`；目录 client 只能由明确 Provider 或 Action 注入。
- Provider 的创建位置、所有者和销毁时机必须固定，禁止通过嵌套 Provider 修复状态串位。
- directory 改变时，旧目录请求的异步结果不得写入新目录投影。
- 插件、MCP 和配置状态必须以规范化 directory 为 key；不得使用组件挂载顺序或当前可见性作为作用域依据。

### 5.5 命令作用域

- Workbench 全局命令只允许在 Workbench Shell 注册一次。
- 命令执行时必须从权威 selector 读取活动 `SpaceScope`、Panel 和 Session，不能闭包捕获某个 Panel 挂载时的 props。
- 隐藏、keep-alive 或非活动 Panel 不得注册同名全局命令，也不得替换活动 Panel 的注册。
- 不支持的命令不注册，禁止用空函数占位后让命令看似可用。
- 共享 Session 命令只接受通用 action adapter，不得扩展 Workbench 专属参数污染共享接口。

### 5.6 事务、失败与异步竞态

跨 Store、SDK 和 PTY 的操作不是真正数据库原子事务。`WorkbenchActions` 必须显式实现一致性边界：

1. 校验 `SpaceScope`、Panel、Session 和 directory 前置条件。
2. 为 Panel 操作分配 generation 或取消令牌。
3. 执行资源释放和 SDK 副作用。
4. 确认操作仍是最新 generation 后，一次性提交 Store 状态。
5. 失败时清理本次新建资源，并保持或恢复可解释的旧状态。

- close、unbind 和 dispose 必须幂等，重复调用不能误杀新资源。
- Panel 关闭或 directory 切换后晚到的 PTY、Session、插件或 MCP 请求结果必须丢弃；晚到 PTY 仍需释放。
- Context hook、Store hook 和 router hook 必须在组件同步初始化阶段取得，禁止在 Promise、timer 或事件回调内部重新调用 hook。
- Action 不能依赖组件是否可见；隐藏 Panel 与可见 Panel 使用相同生命周期契约。
- 每个 Action 测试必须覆盖成功、失败、重复调用和 stale async result。

### 5.7 持久化规则

允许持久化：

- Space、Tab 和 Panel 布局。
- activePanel、viewMode、slotState 等恢复界面所需状态。
- PTY ID 重连提示，但它不是进程存活真相。

禁止持久化：

- 完整 Session、服务端标题或消息副本。
- 插件、MCP、LSP 和 directory 配置结果。
- 瞬时提示、请求中状态和错误 Toast。
- 可从服务端或 directory SDK 重新投影的数据。

持久化 schema 必须有版本和显式迁移。读取旧数据时只能迁移布局字段，不能把历史投影重新注入服务端领域状态。

### 5.8 已确立的展示与生命周期契约

- Panel 标题栏中 TUI 的存活标记直接由 `panel.tuiPtyId` 派生，不得另存 UI 标记。该 PTY ID 在启动时写入，关闭或断连时清空。
- Workbench 瞬时提示统一使用 `wb.statusMessage`，只能传入 i18n 文案，显示在左侧会话树底部并在 5 秒后自动消失；侧栏收缩时提示区完全隐藏。底部状态栏只呈现当前 Space、Panel、Session 和 server context，不承载操作帮助。
- Workbench Chat 历史区与输入 dock 共享 `bg-v2-background-bg-deep`；适配只位于 `PanelChatComposer`，不得改变通用 Session Composer 默认底色。
- 嵌入式 terminal/TUI 不显示 `ghostty-web` canvas 滚动条，也不能沿用 `FitAddon` 固定预留的滚动条宽度；终端列数按容器完整内容宽度计算。
- TUI 使用向上取整的完整字符网格并由容器裁边，避免右侧或底部 gutter。直接 TUI 使用 `isTui`；普通终端中启动的 Ellamaka TUI 必须同时通过 OSC 标题和 alternate buffer 识别，不能影响其他全屏终端程序。
- 禁止用全局滚动条 CSS 掩盖终端尺寸计算问题。

### 5.9 测试与验收证据

Workbench 行为变更严格执行 RED、GREEN、REFACTOR：

- 修 bug 前先写能复现该 bug 的失败测试，测试名称描述用户可见行为。
- 优先使用真实 Store、Provider、Action 和组件组合；只在 SDK 传输边界使用可控 fake，禁止 mock 掉正在验证的状态所有权。
- typecheck、静态 `rg` 和插件数量只能作为辅助证据，不能代替行为测试和路径核对。
- directory 状态验收必须断言插件和 MCP 的规范化完整路径及来源，不得只断言数量。
- 测试必须覆盖 `General -> Space A -> Space B -> General` 往返，确保 General 只含全局能力，Space 为全局与本 Space 能力的并集。
- 测试必须覆盖多 Panel、隐藏 Space、fork、命令目标、Session Projection 重连、PTY 关闭和晚到异步结果。
- 回归测试在修复前必须确认真实失败原因，修复后必须重新运行；不能把 harness error 误判为业务 RED。

最小验证链：

```bash
bun run check:workbench-boundaries
bun run test:unit --force-exit
bun run typecheck
```

`check:workbench-boundaries` 在对应重构 Plan 落地前可能尚不存在；加入 package scripts 后即成为所有 Workbench 变更的强制门禁。

### 5.10 修改纪律与禁止模式

- 修改前先写出本次行为的状态所有者、输入作用域和唯一事务入口；无法回答时不得开始改代码。
- 一个补丁只解决一个可验证行为。router 重建、命令注册、fork 绑定和 Store 重构必须分开验证，禁止打包成“顺手修复”。
- 发现现有代码违反本规范时，允许通过兼容 adapter 和显式技术债清单渐进迁移，但禁止新增或扩大债务。
- 不得重写、回滚或格式化与当前任务无关的未提交修改。
- Plan 必须先通过结构检查和强制审查，再由用户批准；没有批准不得借重构名义扩大源码修改范围。

以下模式出现即视为阻断问题：

- 用字符串真假判断 General 或 Space。
- Workbench 共享操作同时写多个 Store。
- 组件直接编排 `Store + SDK + PtyManager`。
- Store 内包含网络、PTY、router、Dialog 或 Toast 副作用。
- 共享组件 import Workbench Store 或 Workbench Context。
- 在异步回调中调用 Context hook 或 Store hook。
- 每个 Panel 重复注册同名全局命令。
- 隐藏 Panel 通过挂载顺序成为当前命令或 directory 状态所有者。
- 持久化完整 Session 或 directory 能力列表。
- 用静态匹配通过、typecheck 通过或数量一致宣称功能正确。

### 5.11 工作台完成定义

Workbench 变更只有同时满足以下条件才算完成：

1. 状态所有权和依赖方向符合本规范。
2. 新增回归测试在修复前失败、修复后通过。
3. 边界检查、相关单测、全量单测和 typecheck 均有真实输出证据。
4. General、Space A、Space B 的插件和 MCP 来源路径由用户可见流程核对正确。
5. 多 Panel、隐藏 Space、fork、命令和 PTY 生命周期没有作用域串位。
6. 中文规范和设计文档先完成用户审核，再同步英文正式规范。
7. 提交、Plan 状态推进和用户验收严格遵循空间 dev-flow 与用户确认门禁；不得跳过 rook、approve、complete 或用户确认。

## 6. 通用测试规则

- 代码类变更遵循 TDD：先写能失败的测试，再实现代码使其通过。
- Unit tests 使用 bun test 和 happydom preload（`./happydom.ts`）提供 DOM 环境。
- Unit tests 从 `packages/ellamaka-app` 运行，使用 `bun run test:unit`。
- E2E tests 使用 Playwright，配置在 `playwright.config.ts`，从 `packages/ellamaka-app` 运行 `bun run test:e2e`。
- E2E tests 覆盖用户可见流程，包括页面导航、交互和后端通信。
- 避免 mocks，优先测试真实组件行为。
- CI 使用 `bun run test:ci` 生成 junit output。

## 7. 用户补充规则

- 绝对不要尝试重启 app 或 server 进程。
- 适用时始终并行使用工具。

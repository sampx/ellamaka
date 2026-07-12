---
name: ellamaka-app 代理规则
description: 基于 SolidJS、Vite 和 Tailwind CSS 构建的 ellamaka Web UI 前端
---

# 代理开发规则

## 1. 权威参考

权威引用：

- Project DESIGN: `../../docs/DESIGN.md`
- Parent Rules: `../../AGENTS.md`
- Backend Rules: `../opencode/AGENTS.md`
- UI Library: `../ui/` (`@opencode-ai/ui` workspace package)

## 2. 架构与目录

执行链：Vite dev server → SolidJS SPA → `@opencode-ai/sdk` → backend (`packages/opencode`) HTTP/WS API。

本目录是 ellamaka/OpenCode 的 Web 前端。它不包含 engine runtime、CLI、server 或 storage 逻辑；后端能力通过 `@opencode-ai/sdk` 调用。

| 目录 | 职责 |
|---|---|
| `src/app.tsx` | 应用根组件、路由和全局 provider 装配 |
| `src/entry.tsx` | Vite entry，挂载 SolidJS app |
| `src/pages/` | 路由页面组件 |
| `src/components/` | 可复用 UI 组件 |
| `src/hooks/` | 自定义 SolidJS hooks 和 primitives |
| `src/context/` | SolidJS context 定义 |
| `src/i18n/` | 国际化文案和 locale 配置 |
| `src/utils/` | 纯工具函数 |
| `src/addons/` | 浏览器插件/扩展相关界面 |
| `src/constants/` | 应用级常量 |
| `e2e/` | Playwright e2e 测试 |
| `public/` | 静态资源 |
| `script/` | 构建和开发辅助脚本 |

## 3. 开发命令（构建 / 类型检查 / 测试）

| 场景 | 命令 | 何时 |
|---|---|---|
| Dev server | `bun run dev` | 本地前端开发；需先启动 backend |
| Backend | `bun run --conditions=browser ./src/index.ts serve --port 4096` (from `packages/opencode`) | 本地前端开发时的 API 后端 |
| Build | `bun run build` | 生产构建 |
| Preview | `bun run serve` | 本地预览生产构建 |
| Typecheck | `bun run typecheck` | 修改 TypeScript 后 |
| Unit test | `bun run test:unit` | 修改组件、hook 或 util 后 |
| Unit test watch | `bun run test:unit:watch` | 开发中持续运行 |
| E2E test | `bun run test:e2e` | 修改页面/路由或用户流程后 |
| E2E UI mode | `bun run test:e2e:ui` | 调试 e2e 测试 |
| E2E report | `bun run test:e2e:report` | 查看 e2e 测试报告 |
| CI test | `bun run test:ci` | CI 环境 |

所有前端命令从 `packages/ellamaka-app` 目录运行。`opencode dev web` 会 proxy 到线上 `https://app.opencode.ai`，本地 CSS/UI 修改不会生效；本地 UI 开发必须分离运行 backend 和 app dev server。

## 4. 实现规则

- 遵循父级 `../../AGENTS.md` 的 Bun、TypeScript 风格规则和并行工具偏好。
- 技术栈：SolidJS 1.x + Vite 7 + Tailwind CSS 4 + @kobalte/core + @solidjs/router + @tanstack/solid-query。
- SolidJS state：优先使用 `createStore`，避免多个独立 `createSignal` 调用。
- JSX 使用 solid-js 的 `jsxImportSource`；不要引入 React JSX。
- 组件拆分：页面级组件放 `src/pages/`，可复用组件放 `src/components/`，共享 UI 组件放 `packages/ui/`。
- 页面路由使用 `@solidjs/router`；新增页面需同步更新路由配置。
- 后端通信通过 `@opencode-ai/sdk`；不直接在组件中裸调 fetch 到 backend。
- 国际化文案放 `src/i18n/`；使用 `@solid-primitives/i18n` 的 API。
- 样式使用 Tailwind CSS utility classes；自定义样式放 `src/index.css`。
- 类型检查使用 `tsgo -b`（TypeScript native preview），不直接运行 `tsc`。
- 构建使用 Vite，配置在 `vite.config.ts`；生产构建 target 为 `esnext`。
- `packages/ui/` (`@opencode-ai/ui`) 是本项目的共享 UI 库；跨 package 复用的 UI 原语放在那里。
- Workbench 的 `session-store` 只拥有 UI 投影状态。会话标题等服务端字段必须回归后端真相，不能让持久化的本地状态长期覆盖服务端返回结果。
- Panel 标题栏中 TUI 的存活标记必须直接由 `panel.tuiPtyId` 派生；不得另存一个 UI 标记状态。该 PTY ID 会在启动时写入、关闭或断连时清空。
- Workbench 的瞬时提示统一使用 `wb.statusMessage`，只能传入 i18n 文案，显示在左侧会话树底部并在 5 秒后自动消失；侧栏收缩时提示区必须完全隐藏。底部状态栏重构为左侧层级链（使用斜杠 `/` 分隔 `空间名 / 面板序号P{index}/{count} / 会话标题 / 路径`，统一使用 `text-v2-text-text-muted` 颜色且无任何圆角底色背景块以保持绝对一致），右侧为带左分割线的服务器连接状态和名字。
- Workbench Chat 的历史区与输入 dock 必须共享 `bg-v2-background-bg-deep`；该适配只能位于 `PanelChatComposer`，不得改变通用会话 Composer 的默认底色。
- 嵌入式 terminal/TUI 不显示 `ghostty-web` 的 canvas 滚动条，也不能沿用 `FitAddon` 固定预留的滚动条宽度；终端列数必须按容器完整内容宽度计算。TUI 需要优先消除可见 gutter：始终向上取整到完整字符网格，并由容器裁掉超出边缘的部分，避免保留任何正向余量。直接 TUI 用 `isTui` 标记；用户在普通终端中启动的 Ellamaka TUI 必须同时通过 OSC 标题与 alternate buffer 识别，才能启用相同的满铺尺寸和滚轮消息历史映射，不能影响其它全屏终端程序；禁止用全局滚动条 CSS 掩盖尺寸预留问题。

## 5. 测试

- 代码类变更遵循 TDD：先写能失败的测试，再实现代码使其通过。
- Unit tests 使用 bun test + happydom preload（`./happydom.ts`），提供 DOM 环境。
- Unit tests 从 `packages/ellamaka-app` 运行，使用 `bun run test:unit`。
- E2E tests 使用 Playwright，配置在 `playwright.config.ts`；从 `packages/ellamaka-app` 运行 `bun run test:e2e`。
- E2E tests 覆盖用户可见流程：页面导航、交互、后端通信。
- 避免 mocks；测试真实组件行为。
- CI 环境使用 `bun run test:ci` 生成 junit output。

## 6. 用户补充规则

- 绝对不要尝试重启 app 或 server 进程，永远不要。
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

### 浏览器自动化

使用 `agent-browser` 进行 Web 自动化。运行 `agent-browser --help` 查看所有命令。

核心工作流：

1. `agent-browser open <url>` - 导航到页面
2. `agent-browser snapshot -i` - 获取可交互元素及其 refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - 使用 refs 进行交互
4. 页面变化后重新 snapshot

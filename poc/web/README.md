# Ellamaka Web PoC — TUI + Chat

验证目标：用单一 web server 同时提供桌面端多空间 TUI 嵌入和移动端聊天 UI，根据客户端 UA 自动路由。

## 架构

```
                ┌─ GET  /                → UA 分流（桌面 → desktop.html 选空间；手机 → index.html 配置 agent/model）
                │
                │  GET  /desktop         → 桌面空间选择页（卡片列表，点击 → /tui?space=<name>）
                │  GET  /tui             → xterm.js 多 tab 前端（每 tab 一个独立 PTY）
                │  GET  /api/spaces      → spawn `wopal space list --json` 返回空间列表
                │  POST /api/tui/stream  → SSE，按 ?space=<name> 路由到对应 PTY
Bun.serve       │  POST /api/tui/input   → 写入对应 space 的 PTY
(单端口 5174)   │  POST /api/tui/resize  → resize 对应 space 的 PTY
                │  POST /api/tui/kill    → kill 对应 space 的 PTY（关闭 tab 时调用）
                │
                │  GET  /m               → chat 移动端前端
                └─ GET  /api/chat/*      → EllamakaClient + ChatProjector（复用或自动启动 headless ellamaka）
```

**两种连接模型**：

- **TUI 模式**（桌面）：每个空间一个独立 PTY，用 `Map<space, PtySession>` 管理多实例并行。前端 tab 栏切换显示，输入/resize 仅作用于当前激活 tab。
- **Chat 模式**（移动）：复用已运行的 ellamaka server；如果默认端口不可达，自动从空间根目录启动 `ellamaka serve --port 4141`，再通过 ChatProjector 把 raw event 投影成 normalized chat 消息。

两个模式各自独立的 ellamaka 实例（PoC 阶段足够；session 共享是后续优化）。

## 运行

```bash
cd projects/ellamaka/poc/web
bun install
bun run start
```

- http://localhost:5174 → 自动路由（桌面看选空间页，手机看 Chat 配置页）
- 桌面空间选择：http://localhost:5174/desktop
- 桌面 TUI（直接进某空间）：http://localhost:5174/tui?space=wopal-workspace
- 手机 Chat：http://localhost:5174/m

**Chat 模式**默认会尝试连接 `localhost:4141`。如果不可达，PoC 会自动启动一个 headless ellamaka server。可用环境变量覆盖目标地址：

```bash
ELLAMAKA_URL=http://localhost:4141 bun run start
```

## 可配置项（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `5174` | web 端口 |
| `ELLAMAKA_CMD` | 自动探测 | TUI/Chat 模式 spawn 的命令（绝对路径优先 `~/.wopal/bin/ellamaka`，否则 `Bun.which`） |
| `ELLAMAKA_ARGS` | （空） | ellamaka 命令参数，空格分隔 |
| `ELLAMAKA_URL` | `http://localhost:4141` | Chat 模式连接的 ellamaka server |
| `ELLAMAKA_DIRECTORY` | 空间根目录 | ellamaka directory，默认指向当前 WopalSpace 根目录 |
| `CHAT_SERVE_CWD` | 空间根目录 | 自动启动 headless ellamaka server 时使用的 cwd |
| `CHAT_AGENT` | `wopal` | Chat 模式默认 agent；手机 UI 可覆盖 |
| `CHAT_MODEL` | （空） | Chat 模式默认模型，格式 `provider/model`；留空使用 agent/default 模型；手机 UI 可覆盖 |
| `CHAT_WELCOME` | `你好，请简单自我介绍一下。` | Chat 首次创建 session 的初始 prompt |

> **WOPAL_HOME 写死**：PoC 固定使用 `~/.wopal`，不读 `process.env.WOPAL_HOME`，避免开发机上的临时配置干扰。所有 spawn 子进程（ellamaka / wopal）都显式 `env.WOPAL_HOME=~/.wopal`，二进制路径优先 `~/.wopal/bin/`。

### 跑开发版 ellamaka（验证当前代码的 TUI）

```bash
ELLAMAKA_CMD=bun ELLAMAKA_ARGS="run --conditions=browser ./src/index.ts" bun run start
```

## 桌面 TUI 多 tab 模式

### 空间选择首页

`/desktop` 调用 `/api/spaces` 获取空间列表（`wopal space list --json`），渲染卡片网格。当前空间（启动 cwd 对应）标 "当前" badge。点击卡片跳 `/tui?space=<name>`。

### TUI 页面 tab 架构

`tui.html` 顶部 tab 栏 + 状态栏 + 内容区：

| 元素 | 行为 |
|---|---|
| tab 栏 | 已打开空间的 tab，点击切换，× 关闭 |
| `+` 按钮 | 弹出空间选择器（已打开的灰显） |
| 状态栏 | 当前 tab 的 space · 连接状态 · cwd |
| xterm 实例 | 每 tab 一个独立 Terminal + FitAddon，CSS `display` 切换显隐 |
| SSE 连接 | 每 tab 一个 EventSource，连接到 `/api/tui/stream?space=<name>` |

输入、Shift+Enter 换行、resize 仅作用于当前激活 tab。切换 tab 时触发 `fit + resize` 适配终端尺寸。

### PTY 生命周期

| 事件 | 行为 |
|---|---|
| 打开 tab | `ensurePtyForSpace(space, cwd)` spawn PTY（已存在则复用） |
| PTY 自己退出 | 服务端 broadcast `{type:"exited"}` → 前端立即 `sse.close()` 阻止 EventSource 自动重连 → 800ms 后自动关闭 tab |
| 关闭 tab（点 ×） | 前端 fire-and-forget `POST /api/tui/kill?space=<name>` → 服务端 `pty.kill(SIGTERM)` → `onExit` 回调清理 Map |
| 刷新页面 | PTY 保留（不 kill）；SSE 重连后看不到历史 buffer（PTY 不会重发已输出数据） |

服务端 PTY 通过 `Map<space, PtySession>` 索引，多 tab 打开不同空间 = 多 PTY 并行。每个 ellamaka TUI 进程约 150-300MB，建议按需打开。

## Chat 投影架构（参考 gesp）

Chat 模式复用 gesp 验证过的 ChatProjector 模式：

1. `EllamakaClient` 连接 ellamaka `/global/event` SSE（非 `/event`，因 instance 级 `/event` 用 isolated Bus）
2. `ChatProjector` 消费 raw event，过滤规则：
   - 只保留 `assistant` 角色的 `text` part
   - 丢弃 reasoning / tool / step / synthetic / ignored
3. partID → messageID 重组，多 part 文本按序拼接
4. 输出 NormalizedEvent（`snapshot` / `status` / `error` / `message_delta` / `user_echo`）
5. 断线自动重连（3s 退避）
6. 前端 EventSource 订阅，消息替换式（幂等，projector 每次发完整文本）

手机端通过 `GET /api/chat/options` 获取 agent/model 列表，通过 `POST /api/chat/session` 创建会话。`agent` 和 `model:{providerID,modelID}` 会按 ellamaka API 写入 `POST /session` 与后续 `POST /session/:id/prompt_async` payload。

## 移动端 UI 最佳实践

- `100dvh` 动态视口高度，键盘弹起自适应
- `env(safe-area-inset-*)` 刘海/底部安全区适配
- `viewport-fit=cover` 让 safe-area 生效
- `font-size: 16px` 输入框防 iOS 自动放大
- `touch-action: manipulation` 防双击缩放
- 输入框贴底 fixed，大触控目标（≥38px），Enter 发送 / Shift+Enter 换行
- textarea 自适应高度（最多 4 行）
- markdown 渲染（marked.js via CDN），代码块深色高对比

## 与 gsd-pi / gesp 的关系

- TUI 的 PTY + SSE 模式参照 gsd-pi 的 `web/lib/pty-manager.ts`，多 PTY 管理扩展为 `Map<space, PtySession>`
- Chat 的 EllamakaClient + ChatProjector 精简自 gesp 的 `packages/backend/src/services/ellamaka-client.ts` + `chat-projector.ts`，去掉业务逻辑（assessment/question/token/DB），保留通用聊天核心

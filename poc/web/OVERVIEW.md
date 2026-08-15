# Ellamaka Workbench — 产品化原型

> **⚠️ 已废弃**：本 PoC 已完成使命，不再维护。桌面 TUI 已进入 Workbench 产品线，移动 Chat 视图即将迁移合并。详见 [DEPRECATED.md](./DEPRECATED.md)。

> 从 POC 到产品形态的快速验证原型。把 PoC 里割裂的"桌面 TUI 嵌入"与"移动 Chat"融合成一个统一的 IDE 风格工作台，通过视图切换探索最终产品形态。

## 做了什么

在 `poc/web` 现有 PoC（单文件 `server.ts` + 4 个静态 HTML）基础上，新增 **产品化工作台原型** `workbench.html`，并扩展 `server.ts` 支持新路由与反馈收集。

### 核心决策：统一工作台

PoC 原本按 UA 把桌面/手机分流到两个割裂界面（`tui.html` / `m.html`）。产品化原型改为 **三栏 IDE 工作台**，把两个模式融合进一个连贯体验，并通过 **TUI / Chat / 分屏** 三视图切换让用户探索哪种形态最顺——这本身就是对"最终产品形态"的探索。

## 产品形态

```
┌─────────────────────────────────────────────────────────────┐
│ 顶栏：品牌 · 视图切换(TUI/Chat/分屏) · 空间 · 状态 · ⌘K · 反馈 │
├──────┬──────────────┬─────────────────────┬──────────────────┤
│ 活动栏│  空间列表     │   主工作区           │  上下文面板       │
│ ▦ ⌕ ◷│  · wopal-ws  │  ┌─tab─tab─tab─+┐   │  Agent ▾         │
│      │  · gesp      │  │ xterm TUI    │   │  Model ▾         │
│      │  · space-flow│  │ 或 Chat 消息  │   │  ─────────       │
│  ⚙ ✦│              │  │ 或 分屏并排   │   │  会话历史         │
│      │              │  └──────────────┘   │  ─────────       │
│      │              │  输入框 / 命令行      │  运行时 · 反馈    │
├──────┴──────────────┴─────────────────────┴──────────────────┤
│ 底栏：● 连接状态 · 空间 · 模型 · 快捷键提示                      │
└─────────────────────────────────────────────────────────────┘
```

## 功能清单

| 区域 | 功能 | 状态 |
|------|------|------|
| 顶栏 | 视图切换 (TUI/Chat/分屏) | ✅ |
| 顶栏 | 命令面板 ⌘K | ✅ |
| 顶栏 | 反馈入口 | ✅ |
| 活动栏 | 空间/搜索/历史/设置 导航 | ✅ |
| 侧栏 | 空间列表 + 在线状态 + 当前标记 | ✅ |
| 工作区 | 多 tab TUI (xterm.js + 每空间独立 PTY) | ✅ 复用 PoC |
| 工作区 | Chat 消息流 (markdown 渲染 + SSE 投影) | ✅ 复用 PoC |
| 工作区 | 分屏视图 (TUI + Chat 并排) | ✅ |
| 工作区 | 空状态 / 加载态 / 错误态 | ✅ |
| 上下文 | Agent / Model 选择 | ✅ |
| 上下文 | 会话历史 | ✅ |
| 上下文 | 运行时信息 | ✅ |
| 反馈 | 评分 + 文本 + 上下文捕获 → JSONL | ✅ |
| 快捷键 | ⌘K 命令 · ⌘1/2/3 视图 · ⇧↵ 换行 | ✅ |
| API | `/api/feedback` POST 收集 | ✅ 新增 |
| API | `/api/health` GET 探活 | ✅ 新增 |
| 路由 | `/workbench` + 桌面 UA 默认指向 | ✅ 新增 |

## 验证结果

本地启动 `bun run server.ts` 验证（端口 5174）：

| 端点 | 方法 | 结果 |
|------|------|------|
| `/workbench` | GET | ✅ 200, 48KB HTML |
| `/api/health` | GET | ✅ `{ok:true, tuiSessions, chatReady, spaces, uptime}` |
| `/api/feedback` | POST | ✅ `{saved:true}` → `feedback.jsonl` 持久化两条测试记录 |
| `/api/spaces` | GET | ✅ 返回 3 个空间（wopal-workspace/common/WopalSpace）|
| `/api/tui/stream` | SSE | ✅ connected 事件 + PTY 启动 + cwd 正确 |
| `/api/chat/*` | — | ⚠️ ellamaka server 报 SQLITE_READONLY / EPERM lock — 环境权限问题 |

> **环境依赖说明**：spaces 已修复（`listSpaces()` 先试 `--json`，失败自动回退解析 wopal 的 markdown 表格输出）。chat 的失败是 ellamaka server DB 权限问题，非原型代码缺陷——`ellamaka serve` 需对 `~/.wopal/ellamaka/data/` 有写权限。
>
> 当前环境已验证：页面渲染、路由、视图切换、命令面板、反馈收集、JSONL 持久化、**空间列表填充、TUI PTY 启动**均正常。

## 如何运行

```bash
cd projects/ellamaka/poc/web
bun install          # 依赖已装可跳过
bun run server.ts
```

浏览器打开：
- **http://localhost:5174/workbench** — 产品化工作台（推荐）
- http://localhost:5174 — UA 自动路由（桌面→workbench，手机→配置页）
- http://localhost:5174/desktop — 原 PoC 空间选择页（对照）
- http://localhost:5174/tui?space=xxx — 原 PoC TUI 页（对照）
- http://localhost:5174/m — 原 PoC 移动 Chat（对照）

## 技术栈

- **运行时**：Bun（复用 PoC）
- **前端**：单文件 HTML + 内联 CSS/JS（零构建，最快出活）
- **终端**：xterm.js 5.5 + addon-fit（CDN）
- **Markdown**：marked 17（CDN）
- **后端**：Bun.serve 单端口，PTY 用 bun-pty，Chat 用 EllamakaClient + ChatProjector
- **反馈持久化**：JSONL 追加写入（轻量，原型阶段足够）

## 后续迭代方向

1. **空间发现修复**：`wopal space list` 适配（去掉 `--json` 依赖或解析普通输出），让侧栏空间列表真实填充
2. **Chat 后端就绪**：解决 ellamaka server 的 DB 权限，验证完整 chat 流程
3. **分屏交互打磨**：可拖拽分割条、比例记忆
4. **会话持久化**：tab 刷新后恢复、会话历史可回看
5. **主题系统**：深/浅色切换、字体调节
6. **从原型到产品**：单文件 HTML → SolidJS 组件化（`packages/app` 已有 SolidJS 栈），引入状态管理

## 文件变更

| 文件 | 变更 |
|------|------|
| `public/workbench.html` | 🆕 产品化工作台（~600 行，三栏布局 + 三视图 + 命令面板 + 反馈） |
| `server.ts` | ✏️ 加载 workbench.html · `/workbench` 路由 · 桌面 UA 默认指向 · `feedbackReceive()` + `/api/feedback` · `/api/health` · 启动日志 |
| `feedback.jsonl` | 🆕 反馈收集持久化文件（运行时生成） |

---
**原型日期**：2026-07-02 · **状态**：可交互验证 · **验证目标**：核心流程（空间→打开→TUI/Chat 协作）顺畅度

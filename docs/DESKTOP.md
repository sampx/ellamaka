# ellamaka-desktop 设计

> **状态**: Draft
> **更新时间**: 2026-07-13
> **目标包**: `packages/ellamaka-desktop`
> **上游基线**: OpenCode `v1.15.13` / `385cb694419f98103af0e8fc6187ddcbcbb6eecb`
> **相关文档**: `BRANDING.md §17`、`ELLAMAKA-WORKBENCH.zh-CN.md`、`DESIGN.md`

本文档描述 ellamaka 官方桌面应用的目标架构。桌面应用承载 `ellamaka-app` Workbench，并由 Electron 主进程管理窗口、本地 sidecar 和 PTY 生命周期。

## 1. 设计目标

`ellamaka-desktop` 提供稳定的本地桌面运行环境，使 Workbench 的界面生命周期与后台进程生命周期相互独立。

- Renderer 刷新只重载界面，已有 TUI 和 Terminal 继续运行。
- Panel、Space 和桌面窗口关闭时，系统释放对应 PTY。
- 应用退出时，系统终止全部 sidecar 和子进程。
- `ellamaka-app` 同时服务浏览器和桌面端，两种环境共享产品能力并拥有各自的生命周期策略。
- 桌面包与 ellamaka 引擎、SDK 和 app 保持同一 OpenCode 版本基线。

## 2. 包定位与版本基线

### 2.1 独立复制模式

`packages/ellamaka-desktop` 从 OpenCode v1.15.13 的 `packages/desktop` 独立复制。它与 `ellamaka-app` 采用相同的品牌包模式，集中承载 Ellamaka 桌面定制。

| 维度 | 上游基线 | ellamaka-desktop |
|------|----------|-------------------|
| 包路径 | `packages/desktop` | `packages/ellamaka-desktop` |
| 包名 | `@opencode-ai/desktop` | `@opencode-ai/ellamaka-desktop` |
| 桌面框架 | Electron 41.2.1 | Electron，与 v1.15.13 保持兼容 |
| 渲染应用 | `@opencode-ai/app` | `@opencode-ai/ellamaka-app` |
| 本地服务 | OpenCode node sidecar | Ellamaka/WopalSpace node sidecar |
| 默认界面 | OpenCode 主界面 | Ellamaka Workbench `/workbench` |

OpenCode v1.15.13 的 desktop 已经采用 Electron。Tauri 运行时不属于 ellamaka-desktop 的基线。

### 2.2 版本协同

`ellamaka-desktop`、`ellamaka-app`、`packages/opencode` 和 JS SDK 共同组成一套版本单元。桌面包消费同版本的 app 公共接口和 node sidecar，不跨版本引入 1.17 desktop 实现。

Electron 安全修复、生命周期修复和平台兼容修复可以独立回移。每次回移保持 v1.15.13 的接口边界，并通过桌面测试验证。

## 3. 系统架构

```text
Electron Main Process
├── Window Manager
├── Sidecar Manager
├── PTY Ownership Registry
└── Lifecycle Coordinator
          │ IPC
Electron Preload
          │ allowlisted desktop API
ellamaka-app Renderer
          │ HTTP / WebSocket
Ellamaka node sidecar
          │
PTY / TUI processes
```

### 3.1 Electron Main Process

Main Process 是桌面运行时的所有者，负责：

- 创建和管理 BrowserWindow。
- 启动、监控和停止 Ellamaka sidecar。
- 为每个窗口维护 PTY 所有权注册表。
- 区分 Renderer 刷新、窗口关闭和应用退出。
- 执行桌面菜单、文件选择、系统通知、更新和深链接能力。
- 在窗口关闭和应用退出前完成进程清理。

### 3.2 Preload

Preload 暴露最小化、可验证的 IPC 接口。Renderer 通过该接口访问桌面能力，不直接获得 Node.js 或 Electron 主进程权限。

PTY 生命周期接口覆盖以下语义：

- 注册当前窗口创建的 PTY。
- 注销已经正常终止的 PTY。
- 读取当前窗口的 PTY 注册信息。
- 请求释放当前窗口拥有的全部 PTY。

### 3.3 ellamaka-app Renderer

Renderer 负责 Workbench 的布局、交互和终端连接。桌面构建使用 `ellamaka-app` 的：

- 根导出与 Provider。
- Vite 插件和 CSS。
- public 静态资源。
- i18n 字典。
- `/workbench` 路由。

Renderer 通过 `PlatformProvider` 获得 `platform: "desktop"`。Workbench 使用平台能力选择桌面生命周期策略，不通过 User-Agent 推断运行环境。

### 3.4 Ellamaka sidecar

Sidecar 由当前仓库的 `packages/opencode` node runtime 构建，提供 Ellamaka HTTP、SSE、WebSocket、Session、PTY 和 WopalSpace 能力。

Sidecar 使用随机本地端口和临时认证凭据，仅监听 loopback。Main Process 保存连接信息并通过受控初始化接口交给 Renderer。

## 4. 状态所有权

桌面应用将持久化界面状态、临时运行时状态和后台进程分层管理。

| 状态 | 权威所有者 | 生命周期 |
|------|------------|----------|
| Panel 布局、宽度、绑定 Session、directory | `ellamaka-app` / `localStorage` | 跨刷新、跨应用启动 |
| PTY ID、directory、panelID、kind、windowID | Electron Main Process | 当前应用进程 |
| PTY/TUI 操作系统进程 | Ellamaka sidecar | 当前桌面运行期 |
| Sidecar 连接凭据 | Electron Main Process | 当前应用进程 |

`localStorage` 继续负责 Workbench 布局。PTY ID 可以作为 Renderer 的连接缓存，但 Main Process 注册表是桌面运行期的所有权真相源。

## 5. PTY 所有权模型

每个 BrowserWindow 获得稳定的 `windowID`。Renderer 刷新沿用同一个窗口身份，窗口关闭后该身份失效。

每条 PTY 注册记录包含：

| 字段 | 说明 |
|------|------|
| `ptyID` | sidecar 返回的 PTY 标识 |
| `directory` | PTY 创建时的真实工作目录，也是后续 API 路由依据 |
| `panelID` | Workbench Panel 标识 |
| `kind` | `tui`、`term` 或 `split` |
| `windowID` | 所属 Electron 窗口 |

`directory` 与 Workbench `spacePath` 保持独立。所有 PTY 查询和删除请求使用注册记录中的真实 directory。

## 6. 生命周期行为

### 6.1 创建 PTY

1. Renderer 请求 sidecar 创建 PTY。
2. Sidecar 返回 `ptyID`。
3. Renderer 将 PTY 绑定到 Panel。
4. Renderer 通过 Preload 向 Main Process 注册 PTY 所有权。
5. Renderer 建立 PTY WebSocket 连接。

PTY 注册完成后，Renderer 刷新不会改变其后台进程所有权。

### 6.2 Renderer 刷新

1. Workbench flush 当前布局。
2. 桌面生命周期分支保留 PTY，不执行 Web 端 `pagehide` 删除逻辑，也不显示浏览器离开警告。
3. Renderer 和 PTY WebSocket 连接被销毁。
4. Main Process、sidecar 和 PTY 继续运行。
5. 新 Renderer 读取布局和当前窗口 PTY 注册表。
6. Renderer 使用 `ptyID + directory` 探测已有 PTY。
7. 探测成功后重新建立 WebSocket 连接。
8. 已失效的 PTY 从布局缓存和 Main Process 注册表中清除。

刷新前后复用同一个 PTY ID 和操作系统进程。

### 6.3 Panel 或 Space 关闭

1. Renderer 使用真实 directory 请求 sidecar 终止 PTY。
2. Sidecar 确认终止。
3. Renderer 清除 Panel 的 PTY 绑定。
4. Renderer 通知 Main Process 注销对应记录。

Space 关闭按相同流程处理该空间全部 Panel PTY。

### 6.4 桌面窗口关闭

1. Main Process 捕获窗口关闭请求并进入清理状态。
2. Main Process 读取该 `windowID` 的全部 PTY 注册记录。
3. Main Process 使用每条记录的真实 directory 请求 sidecar 终止 PTY。
4. Main Process 清空窗口注册表。
5. Main Process 完成窗口关闭。

窗口清理由 Main Process 驱动，不依赖 Renderer 的 `pagehide`、`beforeunload` 或 keepalive fetch。

### 6.5 应用退出

1. Main Process 关闭所有窗口拥有的 PTY。
2. Main Process 停止本地 sidecar。
3. Main Process 终止 sidecar 子进程组。
4. Electron 应用退出。

Sidecar 停止是应用级兜底，确保未完成单项清理的进程随应用一起终止。

### 6.6 Renderer 异常退出

Renderer 崩溃不会立即终止 PTY。Main Process 保留窗口注册表，使 Renderer 恢复后能够重新连接。窗口随后关闭时，Main Process 执行正常窗口清理。

## 7. Web 与 Desktop 生命周期

| 场景 | 浏览器 Workbench | ellamaka-desktop |
|------|-------------------|-------------------|
| Renderer/页面刷新 | Web 端策略处理 | 保留 PTY 并重新连接 |
| 浏览器 Tab 关闭 | Web 端策略处理 | 不适用 |
| Panel/Space 关闭 | 立即终止对应 PTY | 立即终止并注销对应 PTY |
| 桌面窗口关闭 | 不适用 | Main Process 终止窗口 PTY |
| 应用退出 | 不适用 | 终止全部 PTY 和 sidecar |

两种环境共享 `PtyManager` 的创建、探测和正常删除能力。销毁页面时的行为由平台适配层决定。

## 8. Sidecar 集成

桌面构建通过 `packages/opencode/script/build-node.ts` 生成 node runtime。Electron 构建将该 runtime 作为 Main Process 可加载的 sidecar 模块。

Sidecar 启动环境遵循 Ellamaka 路径和配置体系：

- 使用 `~/.wopal/` 下的配置、数据、缓存和状态目录。
- 加载 Ellamaka 品牌配置与 WopalSpace 能力。
- 提供 Workbench 所需的 WopalSpace 注册表和 Session 归组 API。
- 保持 `x-opencode-directory`/directory query 的实例路由契约。
- 禁用 sidecar 自身的嵌入式 Web UI，由 Electron Renderer 提供界面。

Main Process 负责 sidecar 健康检查。Renderer 在 sidecar 可用并完成初始化后进入 Workbench。

## 9. 安全边界

- BrowserWindow 启用 context isolation，Renderer 不启用 Node integration。
- Preload 只暴露明确允许的 IPC 方法。
- IPC 校验 `windowID`、`ptyID`、directory 和 kind。
- PTY 注册接口只管理 sidecar 已创建的 PTY，不接受任意进程 ID。
- Sidecar 只监听 loopback，并使用每次启动生成的认证凭据。
- 认证凭据由 Main Process 持有，不写入 `localStorage`。
- 窗口关闭清理只影响该窗口拥有的 PTY。
- 应用退出由 Main Process 统一终止 sidecar 和子进程组。

## 10. 品牌与桌面身份

桌面应用使用 Ellamaka 独立身份：

- 产品名称、可执行文件名和安装包名称使用 Ellamaka。
- App ID、协议、用户数据目录和日志目录与 OpenCode 隔离。
- 图标、菜单、窗口标题、通知和更新界面使用 Ellamaka 品牌资源。
- Deep Link 使用 Ellamaka 自有协议并由 Main Process 路由到 Workbench。
- 更新源、签名和发布渠道由 Ellamaka 分发体系管理。

品牌值集中定义并由构建层消费，Renderer 和 Main Process 不分散硬编码用户可见品牌。

## 11. 验证契约

桌面实现满足以下行为：

1. Electron 启动后加载 `ellamaka-app` 的 `/workbench`。
2. 本地 sidecar 使用 Ellamaka/WopalSpace 配置启动。
3. TUI 和 Terminal 可以创建、输入、输出和调整尺寸。
4. Renderer 刷新后 PTY ID 和操作系统 PID 保持不变。
5. 刷新不会创建重复 PTY。
6. Panel 关闭后对应 PTY 进程消失。
7. Space 关闭后该空间全部 PTY 进程消失。
8. 窗口关闭后该窗口注册的全部 PTY 进程消失。
9. 应用退出后 sidecar 和全部子进程消失。
10. 多目录 Panel 的 PTY 删除始终路由到各自真实 directory。
11. Renderer 异常退出并恢复后能够重新连接仍然存在的 PTY。
12. 浏览器版 Workbench 保持独立的 Web 生命周期行为。

## 12. 上游同步

`ellamaka-desktop` 记录 OpenCode v1.15.13 基线及其来源 commit。后续同步以选择性移植为主：

- 同版本 desktop 修复可以直接评估和移植。
- 跨版本修复按依赖、接口和行为逐项回移。
- Electron 安全更新保持优先级，并通过完整桌面回归验证。
- ellamaka 升级 OpenCode 基线时，desktop、app、engine 和 SDK 共同升级。

包级 `AGENTS.md` 维护开发命令、测试方式、生命周期规则和上游基线。`BRANDING.md` 继续记录品牌差异与分发身份，本文件维护桌面架构和运行时行为。

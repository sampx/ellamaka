# DESIGN-dsh-poc — dsh 双引擎融合实验设计

> **状态**: Active（实验性设计，随实践演进）
> **创建时间**: 2026-08-20
> **最近更新**: 2026-08-28（结构重整 + DSH home 收口）
> **上级架构**: `DESIGN.md`
> **研究依据**: `research/deepseek-harness-architecture-and-integration-research.md`

**阅读地图**：§2 目标架构（我们在建什么）→ §3 决策记录（为什么这样建）→ §4 双轨策略（怎么用 dsh）→ §5 技术事实基线（实证了什么）→ §6 待实施设计专题 → §7 当前约定 → §8 实验步骤（进展）。

## 1. 定位与哲学

### 1.1 定位

本文档是 ellamaka 与 dsh（DeepSeek Harness）双引擎融合实验的**单一真相源**，定义实验的设计哲学、目标架构、决策记录、桥/吸收双轨策略、技术事实基线、当前约定与实验步骤。

### 1.2 核心原则：边实践边设计

**不预先决定"复刻 vs 复用"，用起来收集证据，直到有信心再决定。**

ellamaka 对 dsh 的了解仍处于皮毛阶段，无法准确评估复刻的成本代价、复用的范围与难度。因此本实验**不决定**吸收轨的载体（ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制），而是：

1. **先用起来**：让 dsh 在 ellamaka 进程内完整运行，边用边熟悉 dsh 机理。
2. **边用边收集证据**：每个"桥"或"吸收"的实践，都回答一个成本问题。
3. **直到有信心再决定**：当证据足够时，才做吸收轨载体的最终决定。

### 1.3 为什么"不决定"是正确策略

"不决定"保留所有选项。它把决定推迟到信息最充分的时刻，避免在信息不足时锁死方向。这正是"桥不了该吸收"的落地方式——先用桥，桥贵了自然转向吸收。

### 1.4 心智负担管理

本实验通过**单一真相源**（本文档）+ **单一实施计划**（`PLAN-TODOS.md`）降低负担：明确思路，不再徘徊。

## 2. 终局架构（目标状态）

### 2.1 单进程、单端口、双容器

同一个 ellamaka 进程内跑两个 cordis 容器，共用一个公开端口：

- **web 容器**（web profile，插件零改动）：装配 VirtualWebServer，由 ellamaka 主 Server 在 `/dsh/*` 前缀下分发，Workbench iframe 使用同源 `/dsh/`。用户在其中使用完整 dsh 功能（会话、账本、checkpoint 全部照常）。
- **工具容器**（ellamaka-tools profile）：无 webserver 的纯工具后端。serve/TUI/desktop 启动时挂载，容器经 `globalThis.__ellamakaDshContainer` 暴露，`dsh-adapter` 将其中的工具投影进 ellamaka ToolRegistry。TUI 无 iframe 需求，只挂工具容器。

```text
ellamaka 进程（唯一监听端口）
├── ellamaka 引擎 + Effect HttpApi    → /api/*、/workbench 等原生资源
│     └── ToolRegistry：内置 grep/glob + dsh-adapter 投影的容器工具
├── /dsh/* → 受控 Node 路由挂载点 → 剥离 /dsh → VirtualWebServer（web 容器）
│     ├── /api/*            → 官方 dsh-client-connection
│     ├── /api/events.*     → 官方 WebSocket downlinks
│     ├── /plugins/*        → 官方 dsh-client-modules
│     ├── /plugins/events   → 官方 dsh-client-hmr
│     └── /*                → 官方 frontend-static fallback
└── dsh 工具容器（ellamaka-tools profile，无 webserver）
      └── globalThis.__ellamakaDshContainer  →  dsh-adapter 调用工具
```

**实现所有权**（单端口方案的八条边界）：

1. **`VirtualWebServer` 属于 `@wopal/ellamaka-cordis`**。它实现官方 `WebServer` 的 `register`、`registerUpgrade`、`registerFallback`、`tapIndex`、`collectIndexInjections`、`renderIndex`、`applyIndexTaps`、`host` 与 `port`。它保存路由表与 upgrade socket，并暴露 HTTP/upgrade 分发，不创建监听 socket。
2. **Ellamaka Server 提供受控 Node 路由挂载点**。挂载点保存前缀与 HTTP/upgrade handler，保留 Effect 已注册 listener 的顺序与生命周期。调用方获得 register/dispose 能力，不获得原始 `node:http.Server`。`serve.ts` 与 Desktop sidecar 共用这一入口。
3. **DSH 服务端插件保持官方原版**。主服务器剥离 `/dsh` 后，VirtualWebServer 看到的仍是官方 `/api`、`/plugins` 与 `/plugins/events`。`connection`、`client-hmr`、`modules`、`web-runtime` 与所有 UI 插件继续使用官方实现。Profile 只禁用真实 `webserver` 行，并在 Loader 挂载前提供 VirtualWebServer。
4. **`web-startup` 保持启用**。它继续提供 `webStartup`，满足 `web-runtime` 的注入关系。VirtualWebServer 的 `host`/`port` 返回 Ellamaka 的公开地址，供端口与信任判定读取。上游 `web-runtime` 只会生成根路径 URL，因此虚拟 profile 关闭它的 URL 打印与 shell/prompt URL 注入。
5. **浏览器前缀适配属于 DSH iframe 文档**。VirtualWebServer 在 index tap 链末尾注入启动脚本。脚本仅作用于隔离 iframe，负责把同源 `fetch('/api/*')`、WebSocket `/api/events.*` 与 EventSource `/plugins/events` 映射到 `/dsh/*`。外部 URL 和已经带 `/dsh` 的 URL 保持不变。
6. **静态资源路径由 index 变换拥有**。DSH 前端使用根路径 `/assets/*`、`/favicon.svg` 与 boot manifest 的 `/plugins/*`。index 变换统一添加 `/dsh` 前缀，并移除 iframe 不需要的 PWA manifest link。VirtualWebServer fallback 接收剥离后的路径并继续使用官方 frontend-static。
7. **DSH 上游发布包保持只读**。dsh 包声明 `./src/*` 但发布物没有 `src/`，且 connection 运行时代码合并在 `lib/index.js`/`lib/client.js`。方案不 import 内部源文件、不派生官方 bundle，也不新增 dual-face 定制包。
8. **HMR 路径沿用官方 `client-hmr`**。`hmr` 是 base 层 `@deepseek-ai/cordis-plugin-hmr`，Web overlay 已禁用；`client-hmr` 才拥有 `/plugins/events`。浏览器前缀适配覆盖其 EventSource，服务端路由保持原样。
9. **index 注入保持官方顺序**。VirtualWebServer 通过 Cordis `webserver/index-inject` 收集 modules 的注入项，先渲染 `__DSH_BOOT__` 与预加载资源，再执行 raw index taps 和 DSH 前缀适配。
10. **upgrade socket 由 VirtualWebServer 持有**。它在 host dispose 与主 Listener 停止时销毁已升级 socket，补足 Node `closeAllConnections()` 不覆盖 WebSocket 的行为。

### 2.2 DSH home 与依赖物化

**唯一 home**：`$DSH_HOME` 缺省 `$WOPAL_HOME/dsh`。dev（serve/TUI）与 Desktop sidecar 读取同一位置；`$DSH_HOME` 环境变量可覆盖。`~/.dsh` 归 dsh 官方 CLI 专用，ellamaka 不读写。

```text
$WOPAL_HOME/dsh/                          ← 唯一 DSH home
├── package.json                          ← 依赖：7 个 @deepseek-ai/* 包 + @wopal/ellamaka-cordis
├── node_modules/                         ← 完整依赖树，顶层扁平安装
└── profiles/
    ├── web/                              # web 容器 profile（dsh-base + dsh-web-app）
    ├── ellamaka-tools/                   # 工具容器 profile（dsh-base + 禁用补丁）
    └── node_modules/                     # 快捷方式目录（挂载时自动重建，不预置）
```

**物化内容**：

| 内容 | 说明 |
|------|------|
| `package.json` | 显式声明 7 个 dsh 包（`dsh`、`cordis`、`cordis-plugin-loader`、`dsh-app-boot`、`dsh-cmdline`、`dsh-home-paths`、`dsh-launch-environment`）+ `@wopal/ellamaka-cordis`。VirtualWebServer 使用的 `dsh-host-webserver` 由 cordis 包直接声明。dev 期 cordis 为 `file:` 依赖指向 workspace；P9 发布 npm 包后移除该链接 |
| `node_modules/` | `bun install` 物化，顶层扁平。sidecar 锚点检查 `node_modules/@deepseek-ai/dsh/package.json`，必须在顶层 |
| `profiles/web/` | 模板：`package.json`（bundles: dsh-base + dsh-web-app）+ `cordis.yml` + 空 patch 层 |
| `profiles/ellamaka-tools/` | 模板：`package.json`（bundles: dsh-base）+ `cordis.yml` + 空 patch 层。补丁禁用清单由挂载代码在首次挂载时播种（§2.3） |
| `profiles/node_modules/` | 快捷方式目录，`healProfilesModuleFallback(installAnchor, home)` 挂载时自动重建 |

**物化脚本**：`packages/opencode/script/materialize-dsh.ts`。生成 package.json → bun install → 预置两个 profile 模板 → 验证锚点与 Node strip-types 按 sidecar 同一 resolver 导入 dsh-web。脚本幂等：已存在的 profile 与补丁不覆盖。

**依赖解析（installAnchor）**：`installAnchor` 决定 dsh 软件包从哪解析。

- dev 模式（CLI serve/TUI）：`require.resolve("@deepseek-ai/dsh/package.json")` 解析到 workspace 的 node_modules（dsh 包已声明在 `packages/ellamaka-cordis/package.json`，随 `bun install` 一起安装，零额外操作）。
- Desktop sidecar：bundle 不携带 dsh 包，Node 无法从 bundle 解析，installAnchor 显式指向 `$DSH_HOME/node_modules/@deepseek-ai/dsh/package.json`。

**kill switch**：sidecar 检查锚点存在才挂载 dsh；闭包缺失时跳过 dsh，sidecar 正常运行（与 `ELLAMAKA_DSH=0` 等效）。打包分发的首次启动自动安装归 P9（见 §8）。

### 2.3 profile 机制

- profile 目录含 `package.json`（`dsh.profile.bundles` 有序 bundle 列表）+ `cordis.yml`（插件行清单）+ `cordis.patch.yml`（用户补丁层，按 entry id 覆盖/禁用，应用于全部 bundle 层之后）。
- 两个 profile 都在 `$DSH_HOME/profiles/` 下：`web/`（bundles: dsh-base + dsh-web-app，完整 UI）、`ellamaka-tools/`（bundles: dsh-base，补丁层禁用 agent-loop 专属插件）。
- `initProfile` 只创建缺失文件不覆盖；ellamaka 只在补丁层仍是空模板时播种默认禁用条目，用户编辑永远不会被覆盖。
- `$DSH_HOME/profiles/node_modules` 是快捷方式目录：`healProfilesModuleFallback(installAnchor, home)` 在每次挂载时从 installAnchor 出发遍历依赖清单，把每个包建一个快捷方式（symlink）到 `$DSH_HOME/profiles/node_modules/<name>`，使 profile 的插件行在 Loader 解析时能找到宿主已安装的包（与 dsh launcher 启动 profile 的方式一致）。它不是独立安装，指向哪份安装取决于 installAnchor。

### 2.4 关键事实

**架构事实**：

- **dsh 源码零改动、社区插件零改动、ellamaka HTTP 路由层零改动**。单端口方案只新增挂载层与 VirtualWebServer，不修改官方插件。
- **两种使用模式物理隔离**：iframe UI 需要 dsh 的 agent-loop 语义（会话账本 + checkpoint 屏障 + 完整插件集）；工具采用只需要工具本体 + 最小调用上下文。同一容器无法同时满足两种装配（checkpoint 插件会强制 flush 调用方的 live session），因此拆成两个容器，各装配各的 profile。
- **工具容器用 `mountDshTools` / `bootDshTools`**：加载 `ellamaka-tools` profile（bundles: dsh-base），其用户补丁层禁用全部 agent-loop 基础设施（session/agent-loop/llm/subagent/jobs/goal/plan-mode/compaction/web 等约 57 行，按依赖分组附理由），只保留工具注册表与执行链（tools/system-prompt/subprocess/fs/sandbox/spill/tool-fs/tool-fs-search 等）。工具以按 ellamaka session ID 缓存的轻量 facade 执行——传给 `tools.execute` 的 agent 携带 `session.header.cwd`（spawn 工作目录）、`session.header.id`（spill 归属标签）和 `session.events: []`（沙箱模式折叠），**容器内不创建任何 dsh session**。
- **desktop sidecar 用 `bootDshWeb` / `bootDshTools`**（自包含，Node strip-types 可直接 import）；`mountDshWeb`+CordisHub 的 `.js` 导入 Node 无法解析。sidecar 的模块 loader 将 `packages/ellamaka-cordis` 路径下的 `.js` 相对导入解析到 `.ts`。
- **动态装载保留**：前端 UI bundle 保持"后端 scan → `/plugins/<id>/client.js` 从磁盘动态 serve"机制，不内联。

**机制事实**：

- **dsh webserver**：`packages/host/webserver`，原生支持 `port: number`（0 为随机），`host: '127.0.0.1'`，不设 X-Frame-Options/CSP。
- **dsh boot 序列**：`boot()` = `new Context()` + baseUrl + `provide('dshHomePath')` + `ctx.plugin(Loader)` + prepare + `mountRootInclude` + loader await + `assertEntriesActivated`；除 `new Context()` 外全部由 `@deepseek-ai/dsh-app-boot` 单独导出。
- **Loader 插件**：`@deepseek-ai/cordis-plugin-loader`，`ctx.registry.plugin(Loader)` 挂载；`loader.remove(entryId)` 干净卸载。
- **dshHomePath**：`@deepseek-ai/dsh-home-paths` 的 `dshHomePath`。
- **dsh 装配位置**：`packages/ellamaka-cordis/src/dsh-web.ts`。
- **ellamaka data 根**：`~/.wopal/ellamaka/data`（`Global.Path.data`）。DSH home 独立于此（见 §2.2）。

### 2.5 装配 API

```ts
// mountDshWeb(ctx, { home, publicAddress, installAnchor? })
//   └── 在宿主 ctx 上重放 dsh boot(): baseUrl → dshHomePath → Loader
//       → launch env + cmdline public port → mountRootInclude → 激活审计
//   └── installAnchor: 显式指向已安装的 @deepseek-ai/dsh/package.json

// mountDshTools(ctx, opts) —— 同上 boot 序列，profile = ellamaka-tools
//   └── 无 webserver；首次挂载时若补丁层仍是空模板，播种完整禁用清单
//       （agent-loop 基础设施按依赖分组附理由），用户后续编辑不会被覆盖

// bootDshWeb(opts) —— 自建容器，standalone 用
//   └── 自建 Context + mountDshWeb；dispose 连 ctx.fiber 一起拆

// bootDshTools(opts) —— 自建容器，desktop sidecar 用
//   └── 自建 Context + mountDshTools；返回 handle 带 ctx，供 globalThis 暴露
```

- `bootDshWeb`/`bootDshTools` 是 desktop sidecar 的加载入口（自建容器，Node strip-types 可直接 import）。
- `mountDshWeb`/`mountDshTools` 用于在宿主 ctx 上重放（serve.ts 的 CordisHub ctx）。
- **desktop sidecar 必须用 boot 系列**：`mount*`+CordisHub 会经过 `@wopal/ellamaka-cordis` index 导入链，其内部 `.js` 扩展名导入 Node `--experimental-strip-types` 无法解析；boot 系列自包含，直接加载。

### 2.6 相关文件

| 文件 | 作用 |
| :--- | :--- |
| `packages/opencode/script/materialize-dsh.ts` | DSH home 物化脚本（生成 package.json、bun install、预置 profile 模板、锚点与 Node 导入验证） |
| `packages/ellamaka-app/src/pages/workbench/index.tsx` | 全屏 DSH iframe 视图，覆盖 SpaceRail + Workspace |
| `packages/ellamaka-app/src/pages/workbench/parts/top-bar.tsx` | 顶栏 DSH 按钮（toggle dshVisible） |
| `packages/ellamaka-app/src/pages/workbench/view-store.tsx` | `dshVisible` + `setDshVisible` |
| `packages/ellamaka-app/src/context/platform.tsx` | `getDshPort()`（desktop 侧读取；P4 移除，iframe 固定 `/dsh/`） |
| `packages/ellamaka-cordis/src/dsh-web.ts` | dsh 引擎装配（mountDshWeb/bootDshWeb/mountDshTools/bootDshTools） |
| `packages/ellamaka-cordis/src/index.ts` | 拆出 dsh-web 顶层导出（子路径） |
| `packages/opencode/src/cli/cmd/serve.ts` | `ELLAMAKA_DSH=1` 双容器挂载；动态 import |
| `packages/opencode/src/cli/cmd/tui/dsh-mount.ts` | TUI 工具容器挂载（`mountDshIfEnabled`，可测模块）；worker.ts 调用 |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | TUI 进程入口，调用 `mountDshIfEnabled` 并持有 dispose handle |
| `packages/ellamaka-desktop/src/main/sidecar.ts` | bootDshWeb + bootDshTools + dshPort（P4 移除 dshPort） |
| `packages/ellamaka-desktop/src/main/server.ts` | sidecar spawn 与健康检查（P4 移除 dshPort 传递） |
| `packages/ellamaka-desktop/src/main/sidecar-supervisor.ts` | connection.dshPort 字段（P4 移除） |
| `packages/ellamaka-desktop/src/preload/types.ts` | ServerReadyData/SidecarRuntimeState.dshPort（P4 移除） |
| `packages/ellamaka-desktop/src/renderer/index.tsx` | `getDshPort()` 平台实现（P4 移除） |
| `bunfig.toml` | dsh 包加入 minimumReleaseAgeExcludes |

## 3. 决策记录

### 3.1 端口架构演进：双端口 → 单端口

**双端口（历史方案，P1–P3 期间实施）**：ellamaka 监听 4097，dsh webserver 监听第二 loopback 端口（CLI 固定 4098，Desktop 随机），Workbench iframe 跨端口加载。`dshPort` 协议贯穿 server.ts → sidecar-supervisor.ts → preload/types.ts → renderer → platform.getDshPort()。

**当时选择双端口的原因**（放弃"单 server 合并路由"）：

- **`/api` 路径冲突**：dsh 前端和 ellamaka 都有 `/api`，同 origin 下冲突。
- **改 bundle 不可行（用户否决）**：`/api` 硬编码在**后端生成的运行时插件 bundle** 里（`dsh-client-connection`、`dsh-host-apiproxy` 等），不在静态前端里。改 bundle = fork dsh，会让社区插件（自带 `/api` 硬编码的 client bundle）无法直接使用，**破坏生态兼容**。
- **单 server 注入需要替换 webserver 实现**：dsh 插件的 route handler 是 node 原生 `(req, res)` 签名，WebSocket 需原始 node socket，与 Effect HttpApi 桥接复杂，且 `ctx.provide` 的 webServer 覆盖在 cordis 语义下有冲突风险。
- **双端口零侵入**：dsh 源码、社区插件、ellamaka HTTP 路由层全部零改动，天然规避上述全部问题。

**转向单端口的动因（2026-08-27 定稿）**：跨端口带来第二端口发现协议（dshPort 全链路）、Desktop 随机端口管理、HMR 与同源语义割裂。VirtualWebServer 方案解开了当时的死结——**不改任何 bundle**：官方插件继续注册原始 `/api`、`/plugins` 路由，只是注册到 VirtualWebServer 而非真实 socket；`/dsh` 前缀由边界适配层剥离。详细设计见 §2.1。

### 3.2 被否定的早期路线

| 路线 | 探索 | 否决原因 |
| :--- | :--- | :--- |
| 前端薄壳 + vite 代理 3080 | 独立 dsh 前端构建单元，vite `/api`/`/plugins` 代理到 dsh 独立进程 | 目标要求单进程集成；thin-shell 方案被 iframe 取代，已删除 |
| 每实例 CordisHub 装载 | 每实例目录一个 hub 只挂 spill | 装不下 dsh 引擎；已彻底拆除（per-instance hub 装配、turn-driver 桥、`cordis-plugins.log` 一并退役，instance 隔离由容器 per-directory scope 承接，见研究报告 §17.4） |
| 单 server 注入 dsh webserver | 禁用 webserver 行 + prepare 注入兼容实现 + node:http 分发器 | `/api` 冲突 + 改 bundle 破坏生态，见 §3.1（P4 以 VirtualWebServer + `/dsh` 前缀挂载形态重新落地，规避了当时的三项障碍） |
| `/api` namespace 化 | 改 vendored 前端 `/api` → `/dsh/api` | 证伪：静态 bundle 不含 `/api`，硬编码在运行时插件 bundle 里，改 bundle 破坏社区插件 |

### 3.3 DSH home 收口（2026-08-28）

**收口前的问题**：三个 home 交叠，职责不清。

1. `~/.dsh`：dsh 官方 CLI home。dev 挂载（serve/TUI）缺省使用它，ellamaka-tools profile 与指向 workspace 的依赖 symlink 散落其中。
2. `~/.wopal/ellamaka/data/dsh`：早期手工物化的闭包，只有 web profile，依赖以 `file:` 链接寄生 workspace（worktree 删除即断链），锚点结构曾被 npm 嵌套破坏。
3. `$WOPAL_HOME/ellamaka/cache`：DESIGN 曾规划的 P9 安装位置，未实现，路径废弃。

dev 与 Desktop 各用不同 home，profile 与依赖分散——这是文档与实现漂移的根源（代码注释曾引用不存在的 "PoC §7.14 / scheme B" 章节，即指这段未成文的手工物化方案）。

**收口决策**：

- 唯一 home：`$WOPAL_HOME/dsh`（§2.2）。dev 与 Desktop 读取同一位置。
- `ellamaka-tools` 补丁层重新播种默认禁用清单（不迁移旧补丁；旧内容确认为默认值）。
- 物化验证通过后清理旧闭包目录与 `~/.dsh` 内 ellamaka 产物。
- `~/.dsh` 归 dsh 官方 CLI 专用。
- P9 自动安装目标同步改为 `$DSH_HOME`（缺省 `$WOPAL_HOME/dsh`）。

### 3.4 iframe 是界面问题，不是架构结论

iframe 只是 PoC 让 dsh 界面先跑起来的手段。它阻挡的是"界面合并"，不是"容器能力复用"。真正的能力复用活在容器层，与 iframe 无关。

**终局 ellamaka 是独立产品，不是 dsh 的包装器**——界面必然自己长。dsh 的 dual-face 前端 bundle 设计（后端 Loader 决定前端插件集、按需拉取、rev 哈希热更）是值得反哺进 ellamaka 的设计，见 §4.3 吸收轨。

## 4. 桥/吸收双轨策略

### 4.1 总览

ellamaka 借 dsh 解决四类问题，分两轨：

| ellamaka 的痛 | dsh 给的解 | 靠桥还是吸收 |
|---|---|---|
| **工具能力增强**（grep/glob→fs-search、sandbox、spill） | 现成插件 | **桥**（契约缝隙 + 采用，个案） |
| **配置动态化**（现在启动期静态、无热重载） | patch 声明式 entry 树、增量重扫 | **吸收**（运行时机制复刻） |
| **插件规范化 + 动态插拔**（现在三路由混杂、静态装配） | Loader 动态装载、`loader.remove(entry)` 干净卸载、dual-face | **吸收**（宿主机制） |

### 4.2 桥轨 — 工具容器 + adapter 逐项采用 dsh 能力

当前优先级是让 ellamaka 直接使用 dsh 已有的强能力。首个候选仍是 **fs-search 替换 grep/glob**，它消除运行时下载 ripgrep，并提供更完整的搜索治理。

#### 4.2.1 承载形态

- **工具容器**（ellamaka-tools profile）是能力的"货架"：载入 dsh-base 全部插件，用 profile 补丁层按 id 禁用 agent-loop 专属插件（禁用清单见 §2.4）。工具容器不承载任何 dsh 会话，只暴露 `tools` 等服务。禁用清单是用户自有文件（`$DSH_HOME/profiles/ellamaka-tools/cordis.patch.yml`），ellamaka 不覆盖用户编辑。
- **dsh-adapter**（`.wopal/plugins/dsh-adapter`）是能力的"投影仪"：按映射白名单把容器工具投影到 ellamaka ToolRegistry 并送出执行。执行时按 ellamaka session ID 复用最小 facade——`agent.session.header.cwd`（spawn 工作目录）、`agent.session.header.id`（spill 归属标签）与 `agent.session.events`（沙箱模式折叠）；其他一切省略。
- **每次只采用一个能力**。权限继续由 ellamaka 原生 Permission 处理。
- 采用成本超过独立实现成本时，保留 ellamaka 原生能力。dsh 是能力来源，不是必须迁入的运行时归宿。

**采用边界**：

| 能力形态 | 采用方式 |
|---|---|
| 输入、输出和生命周期可由 dsh 通用工具契约表达 | 通过 `.wopal/plugins/dsh-adapter` 逐项投影到 ellamaka ToolRegistry |
| 只需少量调用上下文 | 在 adapter 内按需传入最小 per-call context（如 header.cwd/header.id），完全按工具的实测消费面供给，缺的字段省略 |
| 依赖 dsh 沙箱底座（fs-sandbox / bash-sandbox） | 阶段 A 在工具容器内直接装配沙箱后端，让工具在沙箱内运行（§4.2.3） |
| 依赖 dsh 自身的 session、agent loop、事件日志或子会话语义 | 不采用该包，按 ellamaka 的数据模型复刻所需机制 |
| 依赖 ellamaka Hook、Session/Part、Permission、Question、Task、UI 或 Instance 生命周期 | 由 ellamaka 原生插件负责 |

**per-space 隔离模型（容器共享、投影隔离）**：

- **容器装配是进程级共享能力池**：serve/TUI/desktop 各挂一个工具容器，进程内所有 instance 共用。容器载入完整工具链（grep/glob/bash/fs/str-replace 等全部在池中），禁用清单只管 agent-loop 基础设施，不管工具。装配一次，所有空间共用。
- **工具投影是 per-space 隔离点**：每个空间的 `.wopal/config/settings.jsonc` 声明自己的 adapter 映射白名单（`tools: [{source, target, enable}]`）。adapter 按 instance 加载，各带各的配置——空间 A 开 grep+glob，空间 B 开 grep+glob+bash，同一进程内互不影响；未开映射的空间用 ellamaka 内置工具。
- **配置层级走 ellamaka 原生合并**：用户级 `~/.wopal/config/settings.jsonc` → 空间级 `.wopal/config/settings.jsonc` → 空间本地 `settings.local.jsonc`，逐层覆盖，空间级配置天然按空间隔离。
- **instance 粒度对应**：ellamaka instance 目录 ≈ dsh per-call `header.cwd`，粒度一一对应；空间内子目录（instance）作为工作根，路径解析与 spawn 工作目录正确。
- **当前缺口与扩展点**：容器装配差异（per-space 不同 profile）当前不需要——工具全在池中，差异走投影层；工具参数（如 grep maxMatches）per-space 覆盖、per-space 沙箱策略（A 只读、B 可写）尚未实现，扩展点分别是 adapter 层 per-call 参数注入与 facade 合成 `sandbox/mode` 事件。

**受限工具采用的前置条件（facade 缺口）**：grep/glob 只读 `header.cwd`/`header.id`，当前 facade 足够。tool-fs 的 write/edit 与 tool-bash 每次调用都走 `sandbox-policy.resolve()`，它折叠 `session.events`（遍历找 `sandbox/mode` 覆盖，缺省回落进程级默认模式）。真 dsh Session 的 events 恒为数组（未播种也是 `[]`），因此 adapter 喂 `session.events: []` 是防御性补全而非必须；`session.id` 只喂 spill/日志，临时目录隔离键实为 `header.cwd`（§5.9 实证）。采用这些工具前，facade 补 `events: []` 即可。

#### 4.2.2 工具采用现状（2026-08-26 盘点后修订）

**已落地：fs-search（grep/glob）**：

- **grep / glob 已在工具容器完整可用**：内联 cap（250 匹配）内直接返回；超 cap 的结果 spill 到 `$TMPDIR/dsh-spill-*/session-<hash>/` 并返回恢复指示，spill 文件完整保存全部匹配。
- **adapter 映射白名单**：`.wopal/plugins/dsh-adapter` 配置 `tools: [{source: grep, target: grep}, {source: glob, target: glob}]`。同名 target 覆盖 ellamaka 内置工具；容器缺失时 adapter 挂 0 个工具，内置工具原样可用。
- **schema 投影**：adapter 把 dsh 的 JSON Schema 文档解包为 ZodRawShape（插件 SDK 契约），registry 走 zod 路径生成正确的扁平 schema；不支持的类型降级 `z.unknown()`，dsh schema 扩展不会破坏投影。
- **调用日志**：adapter 经容器 logger 记录每次调用（成功 `tool call`、失败 `tool call failed`，携带 tool/sessionID/callID），落入 dsh-plugins.log。
- **验证记录**：adapter 单测 10 项；dsh-web 集成测试含"工具容器 profile 完整执行 + 零 session 断言"；端到端证明 web 容器 + 工具容器并存、UI 完整、spill 完整、容器 `sessions()` 恒为空。

**盘点结论（2026-08-26 源码实证，见 §5.9）**：工具容器拟采用的能力分为三类依赖面——纯形状（A）、语义事件（B）、语义写（C）。**没有任何工具需要深 agent-loop（D）**。据此确立"先 A 后 B"两阶段路径（§4.2.3）。

#### 4.2.3 工具采用双阶段（先 A 后 B）

**阶段 A（工具在沙箱内运行）**：tool-fs（read/write/edit）、str_replace_editor（view/create/str_replace/insert）和前台 tool-bash 已在**沙箱后端**下运行。容器装配 **`fs-sandbox` / `bash-sandbox`**，`ctx.fs.sandboxMode` / `ctx.shell.sandboxMode` 有值，`sandboxPolicy.resolve()` 正常参与执行链并折叠模式覆盖。**采用 dsh 工具的核心动机就是沙箱能力**——ellamaka 现有文件/命令工具完全没有沙箱，而阶段 A 若用非沙箱后端等于白接。adapter 喂最小 session 输入：`session.header.cwd` + `session.header.id` + `session.events`。沙箱策略由空间级 `ellamaka.dsh.sandbox` 配置驱动（§5.10）：`enabled: true` 时 adapter 在 facade session 注入 `sandbox/mode` 事件（`mode` 限 `read-only`/`workspace-write`，默认 `workspace-write`）；`enabled: false` 时关闭沙箱（注入 `danger-full-access`），**不切换本地 fs/bash 后端**。真实容器验证了工作区写入、read-first 门禁、工作区外拒写与 session cwd。该阶段不引入审批流与策略层。`approval` 是可选依赖，`jobs` 未装配，因此工具容器隐藏 bash 的后台执行能力。

**阶段 B（待定）**：不接管 dsh 权限体系。dsh 的 approval/permission-presets 为 dsh 自身 UI 闭环服务，接管它等于拆掉 ellamaka 权限系统，成本极高、收益为零（工具替换定位下）。已记录大体思路（§4.2.4），核心小决策是"沙箱拒绝后模型主动申请更宽模式（escalation）的审批，要不要桥接到 ellamaka 的 ask"。随后期细化评估可行性，不可行则放弃。

**现状**：grep/glob（纯形状 A）、tool-fs（P3.1，read/write/edit）、str_replace_editor（P3.2，view/create/str_replace/insert）与 tool-bash（P3.3，前台命令）已落地；B 阶段待定。

#### 4.2.4 权限思路（B 阶段待定，只记录不做决策）

**权限继续走 ellamaka 原生体系，沙箱只当执行底座**——两者不是冲突：
- ellamaka Permission 回答"允不允许调这个工具/这个路径"（审批层，规则引擎 + 用户确认）
- dsh 沙箱回答"写入限在 workspace 内"（执行层，内核强制）

**留给后期的唯一小决策：escalation 桥接**。dsh 的模型在写入被沙箱拒绝后，可主动回填 `sandbox_permissions` + `justification` 申请一次更宽模式，该申请需经 dsh approval 服务审批。两个候选：
1. **桥接**：把 dsh escalation 审批接到 ellamaka 的 ask（approveEscalation 通道 → Permission.ask）。可用但需专用桥。
2. **不做**：模型被拒后由用户在空间设置中调整沙箱开关或受限模式，再重试。零成本。

若完全不可行或成本太高则放弃，不影响阶段 A 的沙箱能力。相关对照（仅存档）：

| | ellamaka 原生 Permission | dsh 权限体系 |
|---|---|---|
| 模型 | 规则引擎（permission + pattern + action） | 模式旋钮（sandbox-mode + approval-policy） |
| 粒度 | 细（按工具+路径模式） | 粗（会话级模式）+ 审批兜底 |
| 状态存哪 | SQLite 规则表 | session events 日志 |
| 执行点 | 工具调用前检查 | 能力执行时由沙箱后端强制 |

#### 4.2.5 wopal-plugin 边界（暂不迁移）

wopal-plugin 是 ellamaka 的原生集成层。它继续拥有规则与记忆注入、任务协作、上下文恢复、权限交互和运行时监控。

这些能力的价值来自 ellamaka 的宿主语义。把它们改写为 dsh 插件不会扩大可用范围，只会增加 adapter 与生命周期维护成本。

未来某个 wopal 能力若能脱离 ellamaka 语义，并在其他 dsh 宿主中产生独立价值，再单独评估。当前 PoC 不拆分、不迁移、不为此建设 Hook、Task 或 Session 桥。

### 4.3 吸收轨 — 配置动态化 + 插件规范化 + 动态插拔（宿主机制，长期主线）

- 这是微内核方向真正住的地方：让 ellamaka 宿主运行时从"静态装配"演进为"动态装载容器"。
- 具体：patch 声明式 entry 树、增量重扫、`loader.remove(entry)` 干净卸载、dual-face 前端 bundle。
- 这条轨成本最高、最接近终极目标，也最需要谨慎——**它决定 ellamaka 最终是"微内核"还是"dsh 包装器"**。

**微内核方向（目标留白）**：ellamaka 的演进方向明确——**容器化、动态化，尽量直接利用 dsh 生态**，终极目标是成为一个与 dsh 非常类似的微内核框架。但**这个目标不写死**——PoC 尚未验证到这个程度，ellamaka 最终能否做成微内核，关键看成本。因此本文档只锁定**方向**（容器化/动态化），不锁定**目标**（微内核），以成本门控。

### 4.4 载体决定（推迟）

吸收轨的载体（ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制）**本实验不决定**。它会在使用 dsh 的过程中被自然回答：

- 用 dsh 的 fs-search 替换 grep/glob → 看到"桥接一个工具"到底多贵 → 回答"桥"的成本。
- 用 dsh 的动态装载、patch、dual-face → 看到"这套机制"到底多复杂 → 回答"吸收"的成本。
- 用 dsh 一段时间 → 知道哪些能力值得内化、哪些不值得 → 回答"微内核"值不值得。

## 5. 技术事实基线

以下技术事实经源码实证或实测固化，本实验继续遵守。

### 5.1 深耦合包不可桥接（C2）

session-query / schedule / subagent / system prompt 注入等能力依赖 dsh 自家 loop/session 语义的引擎层（事件日志语料重放、agent.send 唤醒通道、子会话模型）。契约桥只能翻译接口层形状，翻译不了引擎层语义。这些能力的获取路径是**原生复刻**（机制设计可剥离，包与数据模型不可复用）。

> **重要区分（2026-08-26 盘点实证）**：上述"深耦合"指**引擎能力包**（session-query、schedule、subagent 等）。**工具插件（tool-fs、tool-bash、tool-fs-search 等）不在深耦合之列**——它们是叶子工具，只消费 session 的浅层形状（header.cwd / header.id / events 折叠），不依赖 agent-loop 语义。见 §5.9 消费面盘点。

### 5.2 工具管道设计（ctx.tools）

工具执行管道五段：`pre`（参数观察）→ `guard`（审批/拒绝决策）→ `around`（执行替换/包装，spill/timeout 挂载点）→ `post`（结果塑形）→ `result`（终态物化）。全部以 Cordis waterfall 事件暴露，插件可短路（guard 拒绝）或替换（around）。

### 5.3 session 语义模型

dsh 是"账本"（只记流水，余额随时可算），ellamaka 是"余额表"（只存现状，流水不保留）。核心差异导致深耦合包不可桥接（§5.1）。dsh 的"model-visible is logged"承诺带来**确定性回放**能力——loop 从玄学调试变工程测试，这是 dsh 敢高频重构 loop 内核的底气。

### 5.4 session-checkpoint-policy 实证结论

该插件监听 `tools/execute`，对 `exec.agent.session` 执行账本 flush（"执行副作用前，账本已持久化"的 agent-loop 语义）。adapter 不传 agent 时它短路放行，但 fs-search 的 spill 因缺 owner id 而降级；传入轻量 agent 时它抛 `session not live`（store 校验不过）。因此工具容器在 profile 层禁用该插件——这意味着：**工具容器不做请求边界持久化，但也不创建、不持有任何 session，账本持久化的缺失不产生功能影响**。web 容器保持完整 profile，checkpoint 与 UI 模式照常。

### 5.5 桥接 API 规范（实测固化）

全部从 async 侧（Cordis 服务）调回 Effect 世界的桥接遵守以下形态：

1. **持有 work Fiber 必须 `Effect.forkIn(scope)(work)`**：在 `Effect.scoped` 内取 scope，`Effect.forkIn(scope)(work)` 直接返回持有的 work fiber，`Fiber.await` 拿到真实 exit。禁止 `ManagedRuntime.runFork(work).pipe(Effect.forkIn(scope))`（双重 fork，返回值与中断语义错乱）。中断经 `runtime.runFork(Fiber.interrupt(fiber))` 执行。禁止 `runPromise` 驱动长任务（无中断句柄，未受管的 `forever` 任务导致进程退出时报错）。
2. **顶层 `Effect.runFork/runPromise/runCallback` 在运行时未导出**——一律经 `ManagedRuntime` 实例方法调用。
3. **`Effect.scope` 须在 `Effect.scoped` 内获取**，否则以空 defect Die。桥接 scope 由宿主层的 `Effect.scoped` 提供。
4. **ALS 上下文**：effect 体内发起的桥接调用沿传播链天然继承 Instance ALS，无需 `Instance.bind`。纯 async 侧发起的轮次须捕获-恢复 ALS。
5. **取消语义**：interrupt 后 finalizer 按子先父后顺序确定性执行，`forkIn(scope)` 的并发子任务级联清理。Cordis 入口只启动不拥有中断权。

### 5.6 日志桥接（已实现）

dsh 容器插件日志经 `ctx.logger`（自动命名）→ Exporter（`mountDshWeb`/`mountDshTools` 装配时注册）→ 独立文件 `dsh-plugins.log`（`$WOPAL_HOME/logs/`），不进 ellamaka 主日志。这是**唯一**的容器日志：进程级容器 → 全局日志目录，规则单一可预测。旧 Plan 1 的 per-instance hub 日志（`cordis-plugins.log`）已随旧机制一并拆除（见 §3.2）。

### 5.7 复刻方法论

复刻的对象是机制设计，不是包。每个闪光点剥离 session 耦合后归入三种形态：

- **A 类 — 算法吸收**：机制本质是纯逻辑，session 只是输入输出载体。提为纯函数嵌入现有 Effect 服务实现。不依赖 Cordis 化，可先行。
- **B 类 — 能力插件**：新能力天然是插件形态（工具、后台服务）。自研实现 + 自持契约封装，底层接 ellamaka Storage/Bus。
- **C 类 — 现状增强**：ellamaka 已有对应能力，仅缺 dsh 的某个精妙语义。将语义 diff 移植进现有实现。

### 5.8 工具选型（2026-08-26 盘点后修订）

- **优先直接采用（阶段 A，沙箱内运行）**：`fs-search`（grep/glob，已落地）、`tool-fs`（read/write/edit，P3.1 已落地）、`tool-str-replace-editor`（P3.2 已落地，绝对路径）。阶段 A 容器装配 `fs-sandbox`，让这些工具在沙箱底座下运行。
- **阶段 A 已落地**：`tool-bash`（配 `bash-sandbox` 与 `shellEnv`；`approval` 非硬依赖；`jobs` 未装配，因此工具容器禁用 `run_in_background`）。
- **阶段 B（待定）**：escalation 审批桥接（模型申请更宽模式接不接 ellamaka ask），随后期细化（§4.2.4）。
- **保留 ellamaka 原生实现**：`edit`、`read/write` 和 `wopal_task_*`。现有语义或宿主集成更重要。
- **需原生复刻（深耦合）**：session-query、schedule、subagent 等引擎能力包（§5.1）。

### 5.9 工具消费面盘点（2026-08-26 源码实证）

对工具容器拟采用的全部能力做源码级盘点（`labs/ref-repos/deepseek-harness`）。核心结论：**工具插件的 session/agent 依赖是浅层的，无一个需要深 agent-loop（D 类）**。分三类：

- **A 纯形状**：只读 `header.cwd` / `header.id` 标量，无事件折叠、无持久化追加。adapter 喂这两个字段即可。
  - `tool-fs-search`（grep/glob）、`tool-bash-persistent`（还要求一个持有 agent 的 owner）、`spill-policy`。
- **B 语义事件**：折叠 `session.events`（经 `sandboxPolicy.resolve()` 读 `sandbox/mode` 覆盖）。工具在沙箱后端下运行时 `sandboxMode` 有值，`resolve()` 折叠 `events` 中缺省的模式覆盖、回落进程级默认模式。
  - `tool-fs`（write/edit）、`tool-str-replace-editor`、`tool-bash`。
- **C 语义写**：写持久事件（`fs/observed`）或依赖 `fs/write-intent` / `fs/edit-intent` 瀑布。
  - `tool-fs`、`tool-str-replace-editor`（emit `fs/observed`）；`fs-observation-policy`（消费观察状态）。

**关键纠正（相对旧认知）**：
- **`session.events` 缺失不会 TypeError**：真 dsh Session 的 events 恒为数组（未播种也是 `[]`）。旧"缺 events → TypeError"的说法不成立；适配器喂 `events: []` 即可，是防御性而非必须。
- **`session.id` 不是临时目录隔离键**：隔离键是 `header.cwd`（缺了回落 `process.cwd()`），`id` 只喂 spill/日志，缺了无害。
- **工具无 D 类**：所有工具插件都是叶子，无模型调用、无重放。唯一"要活 agent"的是 `tool-bash-persistent`（owner 前提），但那是 `exec.agent` 存在性要求，不是 agent-loop 语义。

**服务依赖**（哪些真必需、哪些仅可选检查）：

| 服务 | 真必需 | 仅可选检查 |
|---|---|---|
| `tools` | 全部工具（registry） | — |
| `fs` | tool-fs、str-replace-editor | — |
| `shell` | tool-bash | — |
| `shellEnv` | **tool-bash 唯一硬依赖**（declared inject） | — |
| `systemPrompt` | tool-fs、tool-fs-search、tool-bash | sandbox-policy（context section） |
| `subprocess` | tool-fs-search | — |
| `terminals` | tool-bash-persistent | — |
| `sandboxPolicy` | 工具在沙箱内运行的决议组件（tool-fs/tool-bash/str-replace）——**阶段 A 装配沙箱后端即可用**；阶段 B 待定 | — |
| `approval` | **无任何工具无条件需要**；仅沙箱 escalation 路径 `ctx.get` | tool-fs、tool-bash |
| `jobs` | 无；仅 `run_in_background` 启用且使用 | tool-bash |
| `spillStore` | 无；处处 `ctx.get` 降级 | tool-fs-search、spill-policy |

**结论**：阶段 A 的最小可行 session 形状 = `header.cwd` + `header.id` + `events: []`，容器装配 **`fs-sandbox` / `bash-sandbox` 沙箱后端**让工具在沙箱内运行（`sandboxPolicy.resolve()` 折叠 `events` 里缺省的模式覆盖、回落进程级默认模式）；`approval`/`jobs`/`spillStore` 均非硬依赖（`ctx.get` 降级）。阶段 B 待定（§4.2.4）。

### 5.10 沙箱可用性实测（2026-08-26，前置验证）

macOS Seatbelt 沙箱**已实测可用**（`.wopal-space/.tmp` 下用 dsh 同款 profile 验证）：probe exit 0；`read-only` 拒写；`workspace-write` 工作区内可写、工作区外拒写；bun 环境（ellamaka dev 运行时）spawn `sandbox-exec` 正常。

三平台 runner 链（源码实证，`@deepseek-ai/dsh-sandbox-local`）：

| 平台 | 机制 | 依赖 | 强制完整度 |
|---|---|---|---|
| macOS | Seatbelt（`sandbox-exec`，系统自带） | 无 | full |
| Linux | bwrap（bubblewrap）优先，回退 Landlock（内核特性，自带 native launcher） | bwrap 需安装 | full（老内核 ABI 自报 partial） |
| Windows | ACL restricted-token runner（受限令牌） | 自带 `process.execPath` 跑 runner | partial（Everyone 组保留、NTFS 硬链接别名两个已知缺口） |

探测失败即拒绝执行（`SANDBOX_UNAVAILABLE`），不裸奔。

**空间沙箱配置（设计决策）**：不用 `DSH_PERMISSION_MODE` 环境变量。空间级 `.wopal/config/settings.jsonc`（+ `settings.local.jsonc`）拥有 dsh 工具容器的沙箱策略，配置形态为 `ellamaka.dsh.sandbox: { enabled, mode }`。

- `enabled: true` 启用沙箱。`mode` 在 `read-only` 与 `workspace-write` 间选择，adapter 为每次调用在 facade session 注入对应的 `sandbox/mode` 事件。
- `enabled: false`（或缺失）**关闭沙箱**（P3.5 已实施）。adapter 注入 `danger-full-access`，让工具在容器默认的不受限后端下运行。**它不切换本地 fs/bash 后端**——工具始终走同一个 dsh 容器与已装配的沙箱后端，关沙箱只是把有效模式放开为 `danger-full-access`。此前 P3.4.4 的实现错误地注入空 events，导致容器回落进程级默认 `workspace-write`，已在本批次修正。
- `danger-full-access` 同时保留为 dsh 的内部一次性 escalation 目标。它不作为空间级配置值暴露，只作为"沙箱关闭"的内部映射。

容器进程级默认值只在尚未解析空间配置时兜底。用户界面以明确的"启用沙箱"开关呈现该决策（关 → `danger-full-access`，开 → `read-only`/`workspace-write`），受限模式仅在沙箱启用后出现。

### 5.11 模型输入分层与动态装配（dsh 精髓复刻）

**核心原则**：每次模型请求的输入分成三个部分——`system`（长期稳定）、`tools`（native function-calling schema）、`messages`（历史 + 当前动态信息）。dsh 的关键纪律是**按内容性质决定它落在哪一部分**，而不是把所有动态能力都塞进一个地方：

| 内容 | dsh 放置位置 | 动态方式 | 缓存结果 |
|---|---|---|---|
| Persona、固定规则 | `system` header | 静态 section | 变化会破坏最前部缓存 |
| Native tools | `tools` header | `ctx.tools.register()` / disposer | schema 变化从首个变化 token 起失效 |
| MCP tools | `tools` header | 整代 register/unregister | MCP 工具变化同样失效 |
| Skill loader | `tools` header | 单个固定 `skill` 工具 | schema 长期稳定 |
| Skill 目录 | 历史尾部 user message | 完整目录快照 + digest + tombstone | 仅追加，不破坏既有前缀 |
| Skill 正文 | tool result / user 注入 | 按需加载 | 仅追加 |
| 沙箱模式、运行时策略 | 历史尾部 runtime-context snapshot | 变化时追加完整快照 | 仅追加 |
| Tool result | 历史尾部 | 正常会话事件 | 仅追加 |

**三个关键事实**：

1. **tools schema 不能放进 history**：`tools` 字段是模型 API 的"可调用函数协议"——它声明哪些工具可生成原生 tool call、参数 JSON Schema、`tool_choice` 与并行调用。把它降级成普通 user message，provider 不再把它当作可调用函数。Skill 能放 history，是因为真正的原生工具只有一个固定 `skill(name)`；普通 tools 若要放 history，必须先收缩为一个固定 dispatcher（`call_tool(name, args)` + 动态工具目录），这会在建模函数调用能力上付出代价。dsh 默认保留 native function calling，因此接受工具集合真正变化时缓存失效。

2. **native tools 变化必然破坏缓存**：若模型可见工具集合真新增/删除/改 schema，`tools` header 变化，从首个变化 token 起缓存失效。dsh 自身也明确这一代价（`tools/README`：registration/disposal/restriction 可能从首个变化 schema token 起失效；MCP 同理）。这是物理约束，无规避方法。

3. **每轮重建 ≠ 破坏缓存**：dsh 每轮（pre-step）都重新装配 `assembly.tools`（`system-prompt/index.ts` 遍历 tool provider 现场解析）。这仅是内存级重建（微秒级），不涉及 IO/进程/网络。只要工具集合不变且按稳定顺序排列、字节一致，重建多少次发出去的请求都一样，缓存照样命中。动态装配的正确含义是"每轮读当前 registry 得到最新集合"，而不是"每轮改动模型看到的 schema"。

**对 ellamaka 的目标形态**：

```text
system:
  Agent/Provider 提示词
  固定环境说明
  固定规则

tools:
  稳定 ellamaka builtin schemas
  每轮从 dsh registry 读取的当前 dsh 工具 schemas
  固定 skill loader schema
  当前 MCP native schemas

messages:
  已有会话历史
  当前用户消息
  动态 runtime-context 更新（仅变化时追加）
  动态 skill 目录更新（仅变化时追加）
  显式加载的 skill 正文
```

**dsh 工具动态装配（P3.5 已实施）**：

- Plugin SDK `Hooks` 新增 `"tool.provider"` 动态工具提供者契约（`packages/plugin/src/index.ts`），签名 `(input, output) => Promise<void>`，`output.tools` 承载当前 `ToolDefinition` 集合，自动进入 `TriggerName` 供 `Plugin.trigger` 每请求调用。
- `ToolRegistry.tools()`（`packages/opencode/src/tool/registry.ts`）在每轮模型请求先取静态集合（builtin + 静态插件工具），再 `plugin.trigger("tool.provider", ...)` 读取当前 dsh 工具，经共享投影函数 `fromPlugin` 转为 `Tool.Def`，按 id 合并：dsh 同名覆盖且保持原位置，新 id 按名字稳定排序追加。后续 `tool.definition` hook 与输出流程不变。
- adapter（`.wopal/plugins/dsh-adapter/index.ts`）注册 `"tool.provider"`，每次调用实时读 `container.get("tools").schemas()`，不再启动时冻结。dsh 插件动态加载/卸载 → 工具增删 → 下一轮请求自动看到新集合；同名 dsh 工具卸载后 builtin 自动恢复。facade session 缓存、日志、权限询问逻辑在 adapter 作用域声明一次，随每轮投影复用（内存级成本）。
- 工具集合真变化时缓存失效是预期行为（同 dsh）；未变化时通过确定性投影 + 名字排序保证字节一致、缓存命中（registry 单测覆盖字节稳定）。
- **不需要在 dsh 与 ellamaka 后端之间切换**——这从未是需求。界面只控制沙箱开关与保护层级（§5.10）。

**对 skill 目录改造（独立收尾）**：
- 从 `system`（`session/system.ts: sys.skills()`）与 `skill` 工具 description（`tool/registry.ts: describeSkill`）中移除动态目录。
- 改为 dsh 模式：固定 `skill` schema + 历史尾部持久 skill catalog + digest 变化时完整替换目录 + 空 tombstone + source metadata。
- 这独立于 dsh 工具收尾，可单独排期（P3.6，P4 后处理）。

## 6. 设计专题：工具结果契约映射（已定稿，待实施）

dsh 工具经 adapter 投影进 ellamaka 后，Workbench 的工具调用工具条与结果 block 需要正常显示。当前存在两处契约断裂，本设计在 **adapter 一处**补齐，前端零改动。

### 6.1 现状：两处契约断裂

**断裂一：参数名（蛇形 vs 驼峰）**

dsh 生态工具参数为蛇形命名，ellamaka 内建工具为驼峰命名：

| 工具 | dsh 参数 | ellamaka 内建参数 |
|------|---------|------------------|
| read | `file_path` | `filePath` |
| edit | `file_path` | `filePath` |
| write | `file_path` | `filePath` |

Workbench 的 `ContextToolBlock`/`FileChangeBlock` 从 `part.state.input` 读 `filePath`，dsh 工具实际传入 `file_path`，导致工具条文件路径显示为空。

**断裂二：diff 数据被 adapter 丢弃**

ellamaka 内建 edit/write 通过 `ctx.metadata()` 注入结构化 `filediff`（`file`/`patch`/`additions`/`deletions`），Workbench 的 `FileChangeBlock` 靠它渲染 diff 视图与 `+N/-N` 徽标。

dsh 的 edit/write 把 diff 放在 `meta.diffs`（`presentationMeta` 投影，结构 `[{path, oldText, newText}]`）。但 adapter 的 `tools.execute` 返回类型只声明 `{isError, content, error}`，**丢弃了 `meta`**。数据在 dsh 侧存在，是 adapter 未透传。

### 6.2 目标状态

- **adapter 是唯一契约映射点**：dsh 工具结果经 adapter 投影后，与 ellamaka 内建工具在 Workbench 渲染层表现一致。
- **前端零改动**：`chat-tool-blocks.tsx`、`message-part.tsx` 等渲染层不感知 dsh 与内建工具的差异。
- **同名工具复用现有 block**：grep/glob/read/edit/write/bash/str_replace_editor 走现有渲染路径。
- **dsh 新增工具走通用兜底**：不在现有 block 类型内的 dsh 工具落到 `GenericToolBlock`；如需专属渲染，属后续前端工作，不在本设计范围。

### 6.3 职责与边界

- **adapter 负责**：透传 dsh 的 `meta`，把 `meta.diffs` 映射为 ellamaka 的 `filediff`；把 `file_path` 参数重命名为 `filePath`（投影时重命名，execute 时转回）。
- **渲染层负责**：按现有契约消费 `filediff` 与 `filePath`，不感知来源。
- **diff 算法归属 adapter**：`patch` 由 `oldText`/`newText` 生成，算法在 adapter 内自持（不 import dsh 包，遵守 cordis import 边界），与 dsh 的 `computeHunkDiffs` 语义对齐。

### 6.4 映射对照

| dsh 侧 | ellamaka 侧 | 映射 |
|--------|------------|------|
| `meta.diffs[].path` | `filediff.file` | 直接 |
| `meta.diffs[].oldText`/`newText` | `filediff.patch` | 由 oldText/newText 生成 hunk diff |
| — | `filediff.additions`/`deletions` | 统计 oldText/newText 行差 |
| 参数 `file_path` | 参数 `filePath` | 投影时重命名，execute 时转回 |

### 6.5 范围衔接

本设计不改变工具容器、沙箱、escalation 或原生 UI 决策。它只补齐 adapter 的结果契约映射，使已采用的 dsh 工具在 Workbench 正常显示。实施与验收由后续 dev-flow Plan 承载。

## 7. 当前约定（双人确认制，无红线）

> PoC 场景**不设红线**：一切边界都可讨论、可变更。以下为当前生效的约定，任何一项的调整都需经用户与 Wopal 双方确认后生效。

1. **cordis import 边界**：`@deepseek-ai/cordis` 只出现在 `@wopal/ellamaka-cordis` 包内（版本锁 4.0.1）。
2. **dsh 依赖显式声明**：`ellamaka-cordis` 只显式声明源码真实 import 的 8 个 dsh 依赖（`dsh`、`cordis`、`cordis-plugin-loader`、`dsh-app-boot`、`dsh-cmdline`、`dsh-home-paths`、`dsh-launch-environment`、`dsh-host-webserver`），不声明凑数依赖。版本统一 `0.1.1-rc.2`，依赖锁定交给 `bun.lock`；root overrides 不再锁 `@deepseek-ai/*`（2026-08-27 起移除，曾锁 53 个）。`dsh-credentials-local` 属 `dsh-base` 传递依赖，其 rc.2 解析器支持 `version: 1 + refs:` 新版 credentials 格式（`~/.dsh/.credentials.yaml`）。
3. **dsh 深耦合包暂缓使用**：agent-loop/session/session-query/compaction/subagent/schedule 及任何 rt-import dsh-session 的包，暂不被主线代码 import、不在运行时加载、不作为插件挂载（深耦合原因见 §5.1；能力获取走自研复刻路径）。required peer 进入 node_modules/bun.lock 仅供类型解析。运行时加载探针（`packages/ellamaka-cordis/test/forbidden-load.test.ts`）作为当前状态的观测手段保留。
4. **session 所有权**：持久化与事件定义归 Storage/Bus/EventV2；Cordis 层只持有 facade。
5. **对外契约稳定**：SSE 事件、HttpApi、SDK 在实验中保持稳定。
6. **桥的加法原则**：桥接优先为新增文件/包装层，保持删除桥即回滚的能力。
7. **wopal-plugin 原生边界**：wopal-plugin 继续作为 ellamaka 原生插件运行。PoC 只采用独立 dsh 能力，不拆分或迁移 wopal-plugin。
8. **工具容器边界**：工具调用走专用工具容器（ellamaka-tools profile），**容器内不创建任何 dsh session**；adapter 只传递工具实测消费的最小 per-call context（细节见 §2.5、§4.2.1）。web 容器保持完整 profile，不复用为工具后端。禁用清单是该 profile 的用户补丁层，ellamaka 仅在模板为空时播种、不覆盖用户编辑。
9. **per-space 隔离**：容器装配是进程级共享能力池，per-space 差异在投影层解决（细节见 §4.2.1）。
10. **DSH home 唯一**：依赖闭包与 profile 只物化在 `$DSH_HOME`（缺省 `$WOPAL_HOME/dsh`，见 §2.2）；dev 与 Desktop 读取同一 home；`~/.dsh` 归 dsh 官方 CLI 专用。禁止引入第二份闭包或第二处 profile 位置（决策见 §3.3）。

## 8. 实验步骤（核心到外围）

> 实验顺序从核心到外围。核心是**插件生态融合 + 工具利用**，外围是发布层面细节。PoC 是长期实验，不合并 main，直到设计决定做出。

| 批次 | 内容 | 核心度 | 状态 |
|------|------|--------|------|
| P1 | 插件生态融合验证：dsh 插件在 ellamaka 容器内完整运行、动态装载 | 核心 | ✅ 完成 |
| P2 | 工具利用：fs-search（grep/glob）经工具容器 + adapter 落地 | 核心 | ✅ grep/glob 已落地 |
| P3 | **阶段 A 扩展 + 动态装配收尾**：tool-fs / str_replace / tool-bash 已落地；P3.5 完成动态 registry 与沙箱关闭语义；P3.6 在 P4 后处理 skill 目录模型输入 | 核心 | 🔶 收尾中 |
| P4 前置 Task 0 | **DSH home 收口**：依赖闭包与 profile 物化到 `$WOPAL_HOME/dsh` 唯一 home，dev/Desktop 统一读取（§2.2、§3.3） | 基础 | 📋 随 P4 Plan 审阅 |
| P4 | **DSH Web 单端口统一**：同源挂载 `/dsh/*`，保留官方 connection/HMR/modules/UI 插件（§2.1） | 核心 | 📋 正式 Plan reviewing |
| P5 | **阶段 B（待定）**：escalation 审批桥接思路细化（§4.2.4） | 核心 | ⏸ 待定 |
| P6 | 配置动态化实证整理：从 P4 提取 patch 覆盖与生命周期证据 | 吸收轨 | ⬜ |
| P7 | 插件规范化实证整理：从 P4 提取 Loader、dual-face 与卸载证据 | 吸收轨 | ⬜ |
| P8 | 界面演进：同源 iframe → 原生（远期） | 外围 | ⬜ |
| P9 | desktop 依赖安装：打包版首次启动自动安装 dsh 依赖闭包到 `$DSH_HOME`（缺省 `$WOPAL_HOME/dsh`，见 §2.2），移除 dev 期 file: 链接 | 外围 | ⬜ |

详细任务分解见 `PLAN-TODOS.md`。

## 9. 相关文档

- 实施计划与进度管理：`PLAN-TODOS.md`
- 研究报告（dsh 全景调研、四层架构分析、审计证据链）：`research/deepseek-harness-architecture-and-integration-research.md`
- 上级架构：`DESIGN.md`
- dsh 参考源码：`labs/ref-repos/deepseek-harness/`

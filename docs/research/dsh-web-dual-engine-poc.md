# dsh Web 前端双引擎接入 PoC 验证记录

> **文档定位**：本文件是 **纯 PoC 验证记录**，记录把 DeepSeek Harness (`dsh`) 的 Web 前端以独立 React 应用形态接入 ellamaka-app 仓库、与 ellamaka（SolidJS）同端口 URL 路径共存的实证过程与结论。**不构成正式设计**。
>
> **⚠️ 方向声明（2026-08-19，用户明确）**：本次 PoC 在 **feature worktree** 内进行，**没有任何红线约束**。之前的设计文档（`DESIGN-refactor-cordis.md`、`DESIGN-capabilities.md` 及其红线、C3 终审）**一律不执行**，仅作参考；最终设计以**本次 PoC 验证结果**为准，验证通过后据此调整/重写设计。**不要回看旧设计文档作为约束**，本 PoC 是全新方向。
>
> **⚠️ 实现方式（2026-08-19，用户明确）**：PoC 阶段**不 TDD**，快速验证方案即可，不做测试先行。正式设计落地时再恢复 TDD。
>
> **验证状态**：✅ 前端渲染、API 通信、会话交互均可用。控制台无 dsh 侧错误。

---

## 1. 目标与验证范围

**目标**：验证"双引擎并存"形态 —— 同一个 vite dev server（端口 3000）上，通过 URL 路径区分两个独立前端：

| 路径 | 引擎 | 技术栈 | 后端 |
| :--- | :--- | :--- | :--- |
| `/dsh` | dsh Web 前端 | React（薄壳 + 39 个 client 插件包） | dsh 后端 `:3080` |
| `/workbench` | ellamaka 前端 | SolidJS | ellamaka 后端 `:4097` |

**验证范围**（本 PoC 只覆盖 dsh 侧）：
- dsh 前端能否在 ellamaka-app 仓库内独立构建
- 能否与 dsh 后端正常通信（API RPC + 插件 bundle 拉取）
- 能否渲染真实数据并完成会话交互
- 与 `/workbench` 是否互不干扰

---

## 2. 总体架构

```
浏览器
│
├── http://localhost:3000/dsh        → dsh React 前端
├── http://localhost:3000/workbench  → ellamaka SolidJS 前端
└── http://localhost:3000            → vite dev server（唯一对外入口）
                    │
                    │  packages/ellamaka-app/vite.config.ts
                    ├─ /dsh → dsh-web-integration.ts 插件
                    │        ├─ serve dsh-web/dist（本地 src 编译的薄壳）
                    │        └─ 注入动态 __DSH_BOOT__（从后端实时抓取）
                    ├─ /api     → 反向代理 → dsh 后端 :3080 (changeOrigin:false)
                    ├─ /plugins → 反向代理 → dsh 后端 :3080
                    └─ /workbench → ellamaka SolidJS SPA
                                        │
                             ┌──────────┴──────────┐
                          dsh 后端 (3080)      ellamaka 后端 (4097)
                          dsh web --port 3080   dev.sh serve
```

### 2.1 三个关键层次

**前端接入层（vite 3000）**
- `/dsh` 由 `dsh-web-integration.ts` 插件处理：serve 本地构建的 `dsh-web/dist`，并把 `window.__DSH_BOOT__`（38 个插件条目的 boot manifest）实时从 dsh 后端抓取注入到 `</head>` 前。
- `/workbench` 是 ellamaka 自己的 SolidJS SPA，走它自己的后端（4097）。
- 同端口、URL 路径区分，两个引擎互不干扰。

**dsh 前端运行机制（薄壳 + 插件图）**
- 薄壳 `boot.tsx`（vendor 到 `dsh-web/vendor-dsh/packages/client/web/src/`）是唯一本地编译的 shell 代码。
- 它解析 `__DSH_BOOT__` → 建客户端模块系统 → 用 vendored cordis Loader 通过 `internal` 契约挂载 → 从后端 `/plugins/<id>/client.js` 按需拉取 39 个插件 bundle。
- 插件 bundle 是**后端**（3080）node_modules 里的官方构建产物，不是本地编译的。

**后端通信层（/api 信任围栏）**
- 前端 RPC 走 `/api/<service>.<method>` → vite 代理 → dsh 后端。
- 后端有 `api-request-trust` 浏览器信任围栏：Host + Origin 必须匹配。
- 这是本 PoC 踩到的关键坑（见 §4）。

---

## 3. 前端接入实现

### 3.1 目录结构

```
packages/ellamaka-app/
├── dsh-web/                          # dsh 前端独立构建单元
│   ├── index.html                    # 薄壳 HTML（title: DeepSeek Harness）
│   ├── vite.config.ts                # 独立 vite 配置（base: /dsh/）
│   ├── src/
│   │   ├── main.ts                   # 入口：new AppWebEntry(el).run()
│   │   └── node-module-stub.ts       # node:module 浏览器桩
│   ├── vendor-dsh/packages/client/   # 从 dsh 仓库 vendor 的 client 包 src
│   │   ├── web/                      # 薄壳（boot.tsx 等）
│   │   ├── modules/                  # 客户端模块系统
│   │   ├── web-react/                # React 渲染胶水
│   │   ├── ui-slots/                 # 槽位系统
│   │   ├── ui-primitives/            # 基础 React 原子组件
│   │   ├── ui-attachment/            # 附件组件
│   │   └── schema-form/              # 设置表单模型
│   └── dist/                         # 构建产物（12M，base /dsh/）
├── dsh-web-integration.ts            # vite 集成插件（/dsh serve + boot 注入 + 代理）
└── vite.config.ts                    # 主配置（proxy /api /plugins → 3080）
```

### 3.2 关键配置

**`dsh-web/vite.config.ts`** —— 独立构建，`base: "/dsh/"`：

```ts
resolve: {
  alias: [
    // node:module 浏览器桩（Loader 的 createRequire 在浏览器不可达）
    { find: /^node:module$/, replacement: src("./src/node-module-stub.ts") },
    // 薄壳从 src 编译（Loader 浏览器化关键）
    { find: /^@deepseek-ai\/dsh-client-web$/, replacement: src("./vendor-dsh/packages/client/web/src/boot.tsx") },
    // 模块系统从 src 编译（顶层 __ModuleLoader__.load 崩溃关键）
    { find: /^@deepseek-ai\/dsh-client-modules\/client$/, replacement: src("./vendor-dsh/packages/client/modules/src/client/index.ts") },
  ],
},
define: {
  "process.versions.node": '"0.0.0"',   // Loader fromInternal() 探针 → 空 internal slot
  "process.execArgv": "[]",
  "process.env.CORDIS_SHARED": "undefined",
},
esbuild: { jsx: "automatic", jsxImportSource: "react" },  // 覆盖主 tsconfig 的 solid-js jsx
```

**主 `vite.config.ts`** —— 代理到 dsh 后端：

```ts
proxy: {
  "/api":     { target: "http://127.0.0.1:3080", changeOrigin: false, ws: true },
  "/plugins": { target: "http://127.0.0.1:3080", changeOrigin: false },
}
```

---

## 4. 踩坑记录（本 PoC 的核心价值）

### 4.1 坑一：npm lib 的 Loader 未被浏览器化 → 空白页

**现象**：薄壳构建成功，但浏览器渲染空白页，`#root` 为空。

**根因**：npm 的 `@deepseek-ai/dsh-client-web` 是 tsdown **预打包**产物，其 cordis Loader 里的 `process.versions.node` / `node:module` 引用在打包时已固化，vite 的 `define` / `alias` 无法触及 → `fromInternal()` 返回空 internal slot，Loader 无法工作。

**修复**：把 `dsh-client-web` 从 **src 编译**（vendor 到 `dsh-web/vendor-dsh/`），让 vite 的 `define` + `node:module` 桩 + `esbuild` jsx 配置真正作用到 Loader 引用链。

### 4.2 坑二：npm lib 的 `dsh-client-modules/client` 顶层自注册崩溃 → `load` undefined

**现象**：`Cannot read properties of undefined (reading 'load')`，发生在**顶层模块求值**阶段（`import('/dsh/assets/index-*.js')` 直接抛错），`__DSH_MODULES__` 未建立、`#root` 空白。

**根因**：npm lib 的 `client.js` 顶层直接 `window.__ModuleLoader__.load({...})`（客户端 bundle 自注册协议）。但 shell 的 `run()` 里 `ClientModuleSystem` 构造**之后**才建立 `window.__ModuleLoader__` → 顶层求值即崩，整个模块被丢弃。

**修复**：把 `dsh-client-modules/client` 也从 **src 编译**。src 版 `modules/src/client/index.ts` 是普通导出，无顶层自注册包装。

### 4.3 坑三：`/api` 代理 `changeOrigin:true` 破坏信任围栏 → 全部 403

**现象**：UI 显示了，但控制台一堆 `dynamicCordisRunner/* HTTP 403` + `[web-runtime] connection lost` 重试风暴，功能几乎不可用。

**根因**：dsh 后端每个 `/api` 请求过 `api-request-trust.ts` 浏览器信任围栏（防 DNS 重绑定 + 跨站请求）：

```ts
// Host 围栏：Host 头必须是 loopback 或声明的 trustedHost
// Origin 围栏：若带 Origin，其 host 必须 === Host 的 host
return new URL(origin).host === hostUrl.host
```

代理 `changeOrigin:true` 把 `Host` 改写为 `127.0.0.1:3080`，但浏览器 `Origin: http://localhost:3000` 原样透传 → `localhost:3000 ≠ 127.0.0.1:3080` → 围栏拒绝 → 403。

**修复**：`changeOrigin:false`，让 `Host` 保持 `localhost:3000`（loopback），与 Origin 匹配 → 围栏放行。

**验证**（curl 精确复现）：
```
Host=localhost:3000, Origin=localhost:3000   → 200  ✅
Host=127.0.0.1:3080, Origin=localhost:3000   → 403  ❌
```

---

## 5. 为什么只 vendor 2 个包到 src

| 包 | 走 npm lib 还是 src | 原因 |
| :--- | :--- | :--- |
| `dsh-client-web` | **src** | Loader 浏览器化（坑一） |
| `dsh-client-modules/client` | **src** | 顶层 `__ModuleLoader__.load` 崩溃（坑二） |
| `dsh-client-web-react` | npm lib | 普通模块，lib 自足 |
| `dsh-client-ui-slots` | npm lib | 普通模块 |
| `dsh-client-ui-primitives` | npm lib | 普通模块（含 shiki/markdown 渲染，lib 已打包） |
| `dsh-client-ui-attachment` | npm lib | 普通模块 |
| `dsh-client-schema-form` | npm lib | 普通模块 |

> 关键洞察：**只有薄壳（web）和模块系统（modules）需要 src 编译**，因为只有它们触碰 cordis Loader 的浏览器化与 `__ModuleLoader__` 自注册协议。其余 5 包是纯 React 展示层，npm lib 预打包产物自足（CSS 以虚拟模块内联），走 lib 即可，避免引入 shiki/markdown 等依赖风暴。

---

## 6. 验证结果

- ✅ `/dsh` 渲染完整 UI（新会话/工作区/设置/选择工作区）
- ✅ 控制台 dsh 侧**零 error/warning**
- ✅ API 通信正常（`host.describe`、`settings.describe`、`dynamicCordisRunner/*` 均 200）
- ✅ 会话交互可用（点击会话打开，显示对话/轨迹、上下文注入、Agent 思考过程）
- ✅ `/workbench` 与 `/dsh` 同端口共存，互不干扰

---

## 7. 后端集成方案分析（讨论纪要）

> 前端 PoC 已验证通过。本节记录**后端集成**的架构方向讨论（2026-08-19），目标：ellamaka serve 单进程统一提供双引擎，放弃当前每实例 CordisHub，dsh 引擎作为一等公民并让 ellamaka 功能可消费。

### 7.1 现状：为什么 dsh 要独立 3080 进程

dsh 前端（39 个 client 插件）不是纯 UI——它通过 `/api` RPC 调用后端服务（`sessions.prompt`、`sessions.create`、`agents.resume` 等），背后是 dsh 自己的 **agent-loop/session 引擎**（78 个 base 插件 + 51 个 web-app 插件）。前端只是这引擎的浏览器表现层。

ellamaka 现有的 `CordisHub` 只挂了 spill 工具层（每实例目录一个 hub），装不下 dsh 引擎。

### 7.2 目标架构：单进程双引擎共享 dsh 容器

```
ellamaka serve 进程 (4097)
│
├── dsh 引擎 Context（进程级单例，boot() 装配）
│   ├─ ctx.agents / ctx.sessions / ctx.tools / ctx.skills ...
│   ├─ scope 隔离：每个实例目录 createScope 一个 scope
│   └─ 服务 dsh 前端（/api 路由）
│
├── ellamaka Effect 核心
│   ├─ loop/session（Effect 原生）
│   └─ 工具管道 → 通过桥消费 dsh 引擎 ctx.tools（grep-bridge 模式）
│
└── 统一 API 路由
    ├─ /dsh/*  → dsh 引擎
    └─ /workbench/* → ellamaka Effect 核心
```

### 7.3 关键可行性判断

**桥机制已有样板**：ellamaka 的 `grep-bridge.ts`（`Effect.forkIn` + `Fiber.await` + `Fiber.interrupt`）可平移到消费 dsh 引擎任何服务（agent-loop、skill、subagent、session-query）。

**scope 隔离不丢语义**：dsh 引擎 `ctx.tools` 用 `@deepseek-ai/dsh-scope` 做 scope 过滤（`ScopedLayers`、`scopeOf`、`scopeTarget`），工具按 agent scope 隔离。ellamaka 的每实例目录工具隔离可映射为每目录一个 dsh scope。

**放弃每实例 CordisHub**：spill → dsh 引擎 `ctx.tools` 天然支持；grep 桥 → 直接注册到 dsh `ctx.tools`。ellamaka 工具管道整体迁到 dsh 引擎。

### 7.4 待深入的问题（下一步）

1. **boot() 复用**：dsh `boot()` 依赖 `$DSH_HOME`、profile 目录、Loader。在 ellamaka 进程内复用需处理存储根（`$DSH_HOME/storages` 是进程级，用 `$DSH_HOME` 还是 ellamaka data 目录）。
2. **实例目录 → dsh scope 映射**：确认 `createScope(ctx, key)` 绑定工具/会话的方式，每实例目录一个 scope 的实现路径。
3. **dsh 引擎装配入口**：`boot()` 直接复用，还是新建 ellamaka 的 dsh Context 装配入口。
4. **存储隔离**：dsh session 持久化根 `$DSH_HOME/storages` 进程级，多实例目录是否要按目录隔离存储。

### 7.5 后端装配验证计划（下一步执行）

> 在 **feature worktree** 内做纯验证性 spike，**不改仓库生产代码**，无红线约束。验证通过后据此调整设计。

**验证目标**（实证三件事）：
1. **boot() 装配**：在 ellamaka 进程内调 `boot()` 装配 dsh 引擎，确认返回的 Context 上 `ctx.agents` / `ctx.tools` / `ctx.sessions` 等服务存在且可用。
2. **scope 隔离**：`createScope(ctx, key)` 按实例目录建 scope，确认工具按 scope 过滤（`ScopedLayers` / `scopeOf` / `scopeTarget`），每目录一个 scope 的隔离语义成立。
3. **桥消费**：把 `grep-bridge` 模式（`Effect.forkIn` + `Fiber.await` + `Fiber.interrupt`）平移到消费 dsh 引擎的 `ctx.tools`，实证完整桥路径。

**验证方式**：在 `.wopal-space/.tmp/` 或系统临时目录建独立 spike 脚本，引用 dsh workspace 的包做验证；遵守验证隔离规则，不污染仓库。

### 7.6 后端装配验证结果（2026-08-19，spike 通过）

> 在 dsh workspace 的 `examples/` 下建独立 spike 脚本（`boot()` headless-agent 完整引擎配置），验证后已清理，未污染任何仓库。

**验证目标 1 — boot() 装配 ✅**
- `boot('ellamaka-spike', <headless-agent/cordis.yml>)` 在进程内成功装配完整 dsh 引擎，返回可用 Context。
- 服务面齐全：`ctx.agents`（AgentRegistry）、`ctx.sessions`（SessionStore）、`ctx.tools`（ToolRuntime）、`ctx.agentLoop`（AgentLoop）全部 present。
- **结论**：dsh 引擎可作为进程级单例在 ellamaka serve 进程内装配，无需独立 3080 进程。

**验证目标 2 — scope 隔离 ✅**
- `createScope(ctx, {dir})` 按目录建 scope，`scopeOf(scope.ctx)` 返回 scoped，两个目录的 scope ctx 互不相同。
- 在 scopeA 注册工具后：`tools.get(name, keyA)` 可见，`tools.get(name, keyB)` 不可见（scopeB 隔离）。
- dispose 后 scopeA 也看不到（注册随 scope 生命周期回收）。
- **结论**：每实例目录 → 一个 dsh scope 的映射成立，工具按 scope 隔离语义完整。

**验证目标 3 — 桥消费 ✅（部分）**
- 通过 dsh 原生 `tools.execute(exec)` 执行，`exec.agent.ctx` 决定 scope 路由。
- scopeB 的 agent 执行 scopeA 注册的工具 → 正确返回 `UNKNOWN_TOOL`（isError=true），**证明 scope 路由在 execute 路径端到端生效**。
- scopeA 的 agent 执行报 `Cannot read properties of undefined (reading 'id')` —— 这是 spike 用最小 agent facade（缺 `session` 等字段）导致的**测试桩不完整**，非真实阻塞；真实 agent-loop 提供完整 Agent 对象。
- **结论**：桥消费路径可行，grep-bridge 模式可平移到 dsh `ctx.tools`；完整桥需用真实 Agent 对象验证。

**关键 API 差异（ellamaka 现有 Tools vs dsh ToolRuntime）**：
- ellamaka 的 `Tools` 有 `executeInline(def, args, exec)`；dsh 的 `ToolRuntime` 没有，用 `execute(exec)`（`exec.name` + `exec.agent.ctx` 路由 scope）。
- dsh `ToolDefinition` 要求 `output: { schema, render, presentationMeta? }`（ellamaka 的没有）。
- dsh `tools.register()` 返回 disposer（ellamaka 的返回 void）。

**下一步**：用真实 Agent 对象（`ctx.agents` 创建）验证完整桥路径；确认 `$DSH_HOME` 存储根与 ellamaka data 目录的映射。

### 7.7 后端 API 集成方案修正（2026-08-19，用户纠正）

> **⚠️ 用户明确纠正**：目标必须是**集成到一个 server**（ellamaka serve 单进程、单端口），**不是**用代理包装 dsh 独立后端进程（3080）。此前方案一直停留在"dsh 独立 webServer 监听 3080 + ellamaka 反向代理"，违背了集成目标，是错误方向。

**关键探查事实**：
- dsh 的 `WebServer` 类（`packages/host/webserver/src/index.ts`）把**路由注册表**（`register`/`registerUpgrade`/`registerFallback`/`tapIndex`/`applyIndexTaps`）和**端口绑定**（`[Service.init]` 里 `createServer` + `listen`）耦合在一个类里。
- 但 dsh 插件对 `webServer` 的调用**全部是路由注册方法**，没有一个是"必须 bind 端口"：
  - `client-connection` → `register({path:'/api'})`、`registerUpgrade`（`/api/events.mux|host` WebSocket）
  - `client/modules` → `register({path:'/plugins'})`、`tapIndex`
  - `client/hmr` → `register(...)`
  - `frontend-static` → `registerFallback`、`applyIndexTaps`
  - `ui-theme` → `tapIndex`
  - `web-app` bundle → 只读 `port`/`host`（打印 URL、信任解析）
- dsh 的 `webserver` 是 `web-app` bundle 里的一个**配置行**（`packages/bundle/web-app/cordis.patch.yml` 的 `id: webserver`，`inject: [webStartup]`，host/port 来自 `webStartup` provider）——**是可替换的**，不是引擎核心。
- dsh 前端硬编码 `/api`（`API_PATH = '/api'`，`packages/client/connection/src/api-path.ts`），RPC 端点形如 `sessions.prompt`、`sessions.create`、`agents.resume`（`namespace.method`）。

**修正后的集成方案（真正单 server）**：
```
ellamaka serve 进程 (4097) —— 唯一 HTTP server
│
├── ellamaka Effect HttpApi（原生）
│   ├─ /session /file /instance /project /config /event ...
│   └─ /workbench /global /wopal-space
│
├── dsh 引擎 Context（boot() 装配）
│   └─ ctx.webServer = ellamaka 提供的兼容实现（不 bind 端口）
│       ├─ /api        → dsh Typert RPC（sessions.prompt 等）
│       ├─ /api/events.mux|host → WebSocket
│       └─ /plugins    → 插件 bundle
│
└── 统一路由（ellamaka HttpApi 内）
    ├─ /dsh/api/*      → dsh 引擎 webServer 路由
    ├─ /dsh/plugins/*  → dsh 引擎 webServer 路由
    └─ 其余            → ellamaka Effect HttpApi
```

**核心机制**：dsh 引擎 boot 时，**不挂 dsh 自己的 `WebServer` 插件**（它 bind 端口），而是由 ellamaka 提供一个**同接口的 `webServer` 服务**，把 dsh 插件注册的 `/api`、`/plugins` 路由**挂到 ellamaka 的单一 server** 上。这样**只有一个 server、一个端口**，dsh 插件零改动（它们只调 `register`）。

**待验证技术点结论（2026-08-19，代码实证）**：

1. **prepare 覆盖 → 证伪**。cordis `ctx.provide` 在同一 isolate scope 重复注册会 throw（`vendor/cordis/src/reflect.ts:289-291` "service has been registered"），且 isolate key 是 root 级共享（`reflect.ts:286`）。prepare 在 root fiber 提供 `webServer` 后，dsh `webserver` 行挂载时再次 provide 必然冲突。**prepare 不能覆盖，只能独占**。
2. **禁用 `webserver` 行 + prepare 注入 → 可行路径**。`webserver` 是 web-app bundle 的普通配置行（`packages/bundle/web-app/cordis.patch.yml` `id: webserver`，`inject: [webStartup]`），patch 里 `{ id: 'webserver', disabled: true }` 即可禁用。官方先例：`apps/cli/src/profile-boot.ts:248-259` 的 `runProfile` 就在 prepare 钩子里 `hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, ...)` + `provideCmdline(...)`——**prepare 里 provide 服务是官方支持模式**。
3. **关键约束**：`web-runtime` 行（`id: web-runtime`，`@deepseek-ai/dsh-web-app`）`inject: ['webServer']`（`packages/bundle/web-app/src/index.ts:35`），且读 `webServer.host`/`port`（index.ts:110/136/167）。所以 ellamaka 的 `webServer` 实现必须：在 prepare 内 provide（config-tree 挂载前）、提供 `host`/`port` getter、实现 `register`/`registerUpgrade`/`registerFallback`/`tapIndex`/`applyIndexTaps` 接口。
4. **web profile 组成**：`~/.dsh/profiles/web/package.json` → `dsh.profile.bundles: [@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app]`。`web-cordis` example 是 patch overlay 先例（改 webserver port 到 3081，证明 patch 可改 webserver 行）。
5. **前端 dist 未构建**（`packages/web/frontend/dist` 不存在），web-runtime 挂载时 `resolveDistIndex` 会 fail loud——spike 需先构建前端或绕过。

**下一步 spike**：boot web profile（dsh-base + dsh-web-app），patch 禁用 `webserver` 行，prepare 提供 ellamaka 兼容 `webServer` 实现，验证：boot 成功、`connection` 注册 `/api` 路由、`modules` 注册 `/plugins`、`frontend-static` 认领 fallback 座、`web-runtime` 正常挂载。

### 7.8 单 server 集成 spike 验证结果（2026-08-19，通过）

> spike 脚本：系统临时目录 `spike-webserver-substitution.mjs`（引用 `~/.dsh/profiles/node_modules` 的构建产物），验证后不污染仓库。

**验证方式**：`loadProfile('web')` 加载 web profile（dsh-base + dsh-web-app bundle 层）→ patch 禁用 `webserver` 行 + `session-telemetry-otel` 行 → `boot()` 的 prepare 钩子提供 ellamaka 兼容 `webServer` 实现（同接口、不 bind 端口、`host`/`port` getter 返回 127.0.0.1/4097）→ 检查装配结果。

**结果（全部通过）**：
- ✅ `ctx.get('webServer')` 就是 ellamaka 实现——prepare 注入被 dsh 插件消费
- ✅ dsh 插件把路由注册到 ellamaka 实现上：`prefix:/plugins`（modules）、`exact:/plugins/events`、`prefix:/api`（connection）
- ✅ WebSocket 升级路由：`/api/events.mux`、`/api/events.host`
- ✅ `frontend-static` 认领 fallback 座；`ui-theme` 等注册 2 个 index taps
- ✅ `webRuntime` 正常提供（`{lanAddresses:[],trustedHosts:[]}`）
- ✅ 引擎服务面齐全：`agents`/`sessions`/`tools` 全 present
- ✅ 干净 dispose，无端口绑定（dsh 打印的 URL 行显示 4097，是 ellamaka 的端口）

**结论**：单 server 集成路径完全成立。ellamaka serve 进程内 boot dsh 引擎（禁用 webserver 行 + prepare 注入 ellamaka webServer），dsh 前端所需全部路由（/api RPC、/plugins bundle、WebSocket、fallback、index taps）都落在 ellamaka 实现上，由 ellamaka 挂到自己的 HttpApi server。**dsh 插件零改动**。

**剩余待验证**：
1. `/api` 硬编码路径 → `/dsh/api` 前缀映射（前端相对 origin 解析，ellamaka 路由层做前缀剥离后交给 webServer 路由表）。
2. ellamaka webServer 实现如何把注册的路由挂到 Effect HttpApi server（Hono/HttpApi 的 handler 适配）。
3. `$DSH_HOME` 存储根与 ellamaka data 目录映射（spike 用了 `~/.dsh`，正式集成需指向 ellamaka 数据目录）。

### 7.9 单 server 端到端 spike 验证结果（2026-08-19，全部通过）

> spike 脚本：系统临时目录 `spike2-node-dispatch.mjs`。在 spike 1 基础上加一层 node:http 分发，端到端探测 dsh 前端所需全部通道。

**验证方式**：ellamaka webServer 实现（同接口 + `match`/`matchUpgrade` 分发面）→ 一个 `node:http` server 把 request/upgrade 事件分发给它 → fetch/WebSocket 探测。

**结果（全部通过）**：
- ✅ `POST /api/host.describe` → 200 JSON（RPC 正常；`invalid-request` 是探测 body 无合法 rpcId 的预期响应）
- ✅ `GET /plugins/@deepseek-ai/dsh-api-gateway/client.js` → 200 text/javascript 17KB（插件 bundle 正常；id 从 `__DSH_BOOT__.entries[].id` 取）
- ✅ `GET /` → 200 text/html 12KB，注入 `window.__DSH_BOOT__`（fallback 座 + index taps 正常）
- ✅ `WS /api/events.mux` → upgraded:true（WebSocket 升级正常）

**关键架构结论（桥接层位置）**：
- dsh 的 route handler 是 **node 原生 `(req, res)` 签名**，WebSocket downlink 用 `ws` 库 `handleUpgrade(req, socket, head)` 需要**原始 node socket**。
- Effect 的 `NodeHttpServer` 在 upgrade 事件上把 socket 交给自己的 `WebSocketServer`（`@effect/platform-node/dist/NodeHttpServer.js` makeUpgradeHandler），dsh 的 upgrade 路由**不能走 Effect HttpRouter**。
- 因此桥接层必须在 **node:http server 层**：ellamaka 的 `serverLayer`（`packages/opencode/src/server/server.ts:200`）创建 `createServer()` 后，在 `request`/`upgrade` 事件上先查 dsh webServer 路由表（`/dsh` 前缀剥离后），命中则交给 dsh handler，未命中再交给 Effect HttpApi。**dsh 插件零改动，ellamaka 只需在 serverLayer 加一个分发器**。
- 前缀映射（待验证点 1）在此一并解决：分发器剥 `/dsh` 前缀后查表，dsh 前端硬编码 `/api` 相对 origin 解析自然落在 `/dsh/api`。

### 7.10 路径冲突与 namespace 化证伪（2026-08-19，用户纠正 + 实证）

> **问题提出**：dsh 前端 `/api` 与 ellamaka v2 `/api` 存在路径冲突（`/api/session` 等两边都有）。
> **初步假设（§7.10 原方案，已证伪）**：改 vendored 前端把 `/api` → `/dsh/api`，后端分发器剥前缀。
> **证伪实证**：
> 1. 前端静态 bundle（vendored web + `dsh-client-web` lib）**不含** `/api` 硬编码。
> 2. `/api` 硬编码在**运行时插件 bundle** 里（`dsh-client-connection`、`dsh-host-apiproxy` 等，由后端 dsh 引擎从 npm lib 生成并 serve）。
> 3. 插件 bundle 内 `resolveBase()` 返回 `location.origin`，`new URL('/api/xxx', origin)` 走绝对路径打 **origin 根**（不带 `/dsh`）。
> 4. **改 bundle 方案被用户否决**：改 bundle = fork dsh，会导致社区发布的插件（自带 `/api` 硬编码 client bundle）无法直接使用，破坏生态兼容。

### 7.11 终局方案：单进程、双端口（2026-08-19，确定）

> **核心洞察**：`/api` 冲突的本质是**同 origin 路径冲突**。插件 bundle 的前端锚点是 `resolveBase()` 返回 `location.origin`——**页面从哪个 origin 加载，`/api` 就打到哪个 origin**。

**架构**：

```
ellamaka serve / sidecar (单进程)
├── ellamaka 引擎 + HttpApi server  → 127.0.0.1:4097  (/api/provider, /workbench 等)
└── dsh 引擎 (boot 装配) + 原生 webserver → 127.0.0.1:4098 (或随机端口)  (/api, /plugins, /)
```

**集成方式**：
1. **后端**：ellamaka serve 启动时 boot dsh 引擎（`$DSH_HOME` 指向 ellamaka data 目录），dsh webserver 原生绑定第二端口（开发 4098，Desktop sidecar 模式 `port: 0` 随机端口）。**不禁用 webserver 行，不注入 ellamaka webServer 实现，不需要 node:http 分发器**。
2. **前端（Workbench）**：`/dsh` 页面通过 **iframe** 加载 `http://127.0.0.1:4098/`。dsh 前端完整的 React SPA 在 iframe 内运行，`location.origin` = 4098。
3. **零冲突零改动**：
   - 插件 bundle 的 `/api`、`/plugins`、WebSocket 升级全部打到 4098 → dsh 原生 webserver 处理。
   - ellamaka 主应用的所有 `/api/*` 留在 4097 → 互不干扰。
   - **dsh 源码零改动、社区插件零改动、ellamaka HTTP 路由层零改动**。
   - §7.2 目标“单进程双引擎共享 dsh 容器”（scope 隔离、Agent 桥消费）完整达成。

### 7.12 Desktop (Electron) 兼容性评估

| 检查项 | 评估结论 |
| :--- | :--- |
| **Sidecar 数量** | **仍为 1 个**。dsh 引擎在 ellamaka node sidecar 进程内 boot，无需第二个 sidecar 进程。 |
| **端口分配** | dsh webserver 原生支持 `port: 0`（OS 随机分配端口，`Config.port` 源码已确认），与 desktop sidecar 随机端口模型天然匹配。 |
| **iframe 嵌入** | dsh webserver **不设置** X-Frame-Options/frame-ancestors/CSP 限制；ellamaka renderer 无 frame-src 限制；Chromium 将 `http://127.0.0.1` 视为 secure context，无混合内容拦截。 |
| **端口通知** | Main Process 现有连接信息通道（URL+凭据）增加 `dshPort` 字段，Renderer 接收后驱动 iframe URL。 |
| **安全性** | dsh webserver 仅监听 loopback + Host 信任围栏，与 dsh 独立运行时安全模型相同。 |

---

## 9. 实现状态（压缩恢复锚点，2026-08-19 更新）

> **本节点是上下文压缩后的恢复入口**。

### 9.1 阶段结论演进

| 阶段 | 探索 | 结论 |
| :--- | :--- | :--- |
| §7.6 | 后端 boot() 装配 + scope 隔离 + 桥消费 | ✅ 证明双引擎同进程可行 |
| §7.7~7.9 | 单 server 注入 + node:http 分发器 | ✅ 机制跑通，但暗含 `/api` 必须 namespace 化的假设 |
| §7.10 | 前端 namespace 化与改 bundle | ❌ 证伪：vendored 无 `/api`；改 bundle = fork dsh 破坏社区插件 |
| §7.11~7.12 | **单进程双端口 + iframe 嵌入** | ✅ **终局方案**：零改动、零冲突、完美契合 Desktop 架构 |

### 9.2 实现范围（PoC 不 TDD 快速验证）

**块 1 — 后端 dsh 引擎启动集成**（`packages/opencode/` + `packages/ellamaka-cordis/`）：
- ✅ 单容器：`mountDshWeb(ctx, opts)`（`@wopal/ellamaka-cordis/dsh-web`）在宿主 cordis 上下文上重放 dsh `boot()` 序列（baseUrl → dshHomePath → Loader → launch env + cmdline --port → mountRootInclude → 激活审计），不创建第二个容器
- ✅ 单包：dsh 装配并入 `ellamaka-cordis`（原独立包 `ellamaka-dsh-host` 已删除）；serve.ts 静态 import
- ✅ 版本统一 0.1.0-rc.6（dsh、dsh-app-boot、dsh-base、dsh-cmdline、dsh-launch-environment、dsh-web-app、dsh-home-paths）
- ✅ `ELLAMAKA_DSH=1` 开关保留：开启时挂载到进程级 `CordisHub`（裸 hub，无 spill 装配，dsh 树自带 spill 条目无冲突）；关闭时零 dsh 挂载、ellamaka 服务不受影响
- ✅ webserver 绑定 127.0.0.1 **固定端口 4098**（`--port 4098`，dev 模式前端 iframe 可硬编码寻址；Desktop 随机端口交由后续 sidecar 接线），端到端验证双端口共存
- ✅ 端口选择：dev 固定 4098（前端 iframe 硬编码寻址，免端口发现往返）；Desktop 随机端口走 §7.12 的 `dshPort` 通道，属后续 phase

**块 2 — 前端 Workbench `/dsh` 页面集成**（`packages/ellamaka-app/`）：
- ✅ `/dsh` 路由已注册（`app.tsx`），`pages/dsh.tsx` 渲染 iframe 指向 `http://127.0.0.1:4098/`
- ✅ **thin shell 已删除**：`dsh-web/`（vendor-dsh 全套 115 个跟踪文件）、`dsh-web-integration.ts` 已 git rm；`vite.config.ts` 还原 fork 原版（去 dsh proxy + 集成插件）；`package.json` 去 `build:dsh-web`/`dev:dsh-web` 脚本与 11 个 `@deepseek-ai/dsh-client-*`/`cordis` 依赖。前端直接使用 dsh webserver 原生完整 Web UI

### 9.3 关键路径与事实

- **worktree 根**：`/Volumes/U500G/coding/wopal-workspace/.worktrees/ellamaka-feature-ellamaka-cordis-container-hosts-loop-with-spill-plugins/`
- **dsh profile**：`~/.dsh/profiles/web/`（bundles: dsh-base + dsh-web-app）
- **dsh webserver**：`packages/host/webserver`，原生支持 `port: number`（0 为随机），`host: '127.0.0.1'`
- **dsh boot 序列**：`boot()` = `new Context()` + baseUrl + `provide('dshHomePath')` + `ctx.plugin(Loader)` + prepare + `mountRootInclude` + loader await + `assertEntriesActivated`；除 `new Context()` 外全部步骤函数由 `@deepseek-ai/dsh-app-boot` 单独导出，可在宿主 ctx 上重放
- **Loader 插件**：`@deepseek-ai/cordis-plugin-loader`（app-boot 的 peer），`ctx.registry.plugin(Loader)` 挂载；`loader.remove(entryId)` 可干净卸载插件树
- **dshHomePath**：`@deepseek-ai/dsh-home-paths` 的 `dshHomePath` 函数，boot 时 `ctx.provide('dshHomePath', dshHomePath)` 供 Loader 配置表达式使用
- **dsh 装配位置**：`packages/ellamaka-cordis/src/dsh-web.ts`（单包，无独立 host 包）
- **前端已提交**：commit `b6392ee5cf`（保留作为历史，后续按新方案调整）

### 9.4 运行形态

- 开发模式：`scripts/dev.sh` 启动 ellamaka 后端（4097，内含 dsh 4098）+ vite 前端（3000）
- 前端 `/dsh`：iframe 指向 `http://127.0.0.1:4098/`
- Desktop 模式：单个 sidecar 监听两个随机端口，Renderer 通过 iframe 嵌入 dsh 端口

---

## 8. 相关文件

| 文件 | 作用 |
| :--- | :--- |
| `packages/ellamaka-app/src/pages/dsh.tsx` | `/dsh` 页面：iframe 指向 `http://127.0.0.1:4098/` |
| `packages/ellamaka-app/src/app.tsx` | `/dsh` 路由注册 |
| `packages/ellamaka-cordis/src/dsh-web.ts` | dsh 引擎装配（mountDshWeb/bootDshWeb），单容器重放 boot 序列 |
| `packages/opencode/src/cli/cmd/serve.ts` | `ELLAMAKA_DSH=1` 时挂载 dsh，固定端口 4098 |
| `bunfig.toml` | dsh 包加入 minimumReleaseAgeExcludes |

> 已删除（thin shell，被 iframe 方案取代）：`packages/ellamaka-app/dsh-web/`（vendor-dsh 全套）、`dsh-web-integration.ts`、vite proxy `/api`→3080、`build:dsh-web`/`dev:dsh-web` 脚本及 `@deepseek-ai/dsh-client-*` 依赖。

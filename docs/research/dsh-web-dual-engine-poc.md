# dsh Web 前端双引擎接入 PoC 验证记录

> **文档定位**：本文件是 **纯 PoC 验证记录**，记录把 DeepSeek Harness (`dsh`) 的 Web 前端以独立 React 应用形态接入 ellamaka-app 仓库、与 ellamaka（SolidJS）同端口 URL 路径共存的实证过程与结论。**不构成正式设计**，不修改 `DESIGN-refactor-cordis.md`、`DESIGN-capabilities.md` 等设计文档，也不改动项目规范（AGENTS.md 红线）。后端集成方案待本 PoC 结论确认后另行讨论。
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

---

## 8. 相关文件

| 文件 | 作用 |
| :--- | :--- |
| `packages/ellamaka-app/dsh-web/vite.config.ts` | dsh 前端独立构建配置 |
| `packages/ellamaka-app/dsh-web/src/main.ts` | 薄壳入口 |
| `packages/ellamaka-app/dsh-web/src/node-module-stub.ts` | node:module 浏览器桩 |
| `packages/ellamaka-app/dsh-web/vendor-dsh/` | 从 dsh 仓库 vendor 的 client 包 src |
| `packages/ellamaka-app/dsh-web-integration.ts` | vite 集成插件（/dsh serve + boot 注入） |
| `packages/ellamaka-app/vite.config.ts` | 主配置（proxy /api /plugins → 3080） |
| `packages/ellamaka-app/package.json` | dsh 相关依赖 + build:dsh-web 脚本 |
| `bunfig.toml` | dsh 包加入 minimumReleaseAgeExcludes |

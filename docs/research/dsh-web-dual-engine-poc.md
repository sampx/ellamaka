# dsh Web 前端双引擎接入 PoC 记录

> **文档定位**：本文件是 dsh（DeepSeek Harness）Web 前端接入 ellamaka 的 **PoC 方案、实施现状与关键决策记录**。它不构成正式设计，但保留对后续更新正式设计有价值的信息：**终局方案、实施进度、决策原因、关键参考**。
>
> **⚠️ 工作方式（2026-08-20，用户明确）**：PoC 阶段**不需要正式设计文档**，也不 TDD。短平快——研究出方案 → 写 PoC 文档记录 → 直接实施。本文件是 PoC 的**唯一真相源与压缩恢复锚点**。用户说过的决策**不得要求用户重复第二遍**；上下文压缩后靠通读本文件恢复全部信息。
>
> **⚠️ desktop 集成约束（2026-08-20，用户明确，硬性）**：dsh 集成到 desktop **必须保留动态配置装载能力**（禁止 bundle 内联 dsh 组件）。dsh 闭包在 **onboarding 阶段 npm 安装**到 `$WOPAL_HOME/ellamaka/data/dsh/`（方案 B，见 §4；POC 不实现安装，仅定机制）。
>
> **验证状态**：✅ 前后端均已跑通。dev 模式 `ELLAMAKA_DSH=1` 时 dsh 引擎挂载于 4098；desktop 模式 sidecar 加载闭包、随机端口通知 renderer。控制台无 dsh 侧错误。

---

## 1. 终局方案：单进程、双端口 + iframe 嵌入

> 经过了多轮探索（早期路线见 §2），最终确定**终局方案**：dsh 引擎在 ellamaka 进程内 boot，用原生 webserver 绑**第二个 loopback 端口**；前端用 **iframe** 加载该端口，实现零改动、零冲突、双引擎同进程并存。

### 1.1 架构

```
ellamaka serve / sidecar (单进程)
├── ellamaka 引擎 + HttpApi server  → 127.0.0.1:4097  (/api/provider, /workbench 等)
└── dsh 引擎 (boot 装配) + 原生 webserver → 127.0.0.1:4098 (或随机端口)  (/api, /plugins, /)
```

### 1.2 集成方式

1. **后端**：ellamaka serve 启动时 boot dsh 引擎（`$DSH_HOME` 指向 ellamaka data 目录），dsh webserver 原生绑定第二端口（开发 4098，Desktop sidecar 模式 `port: 0` 随机端口）。**不禁用 webserver 行，不注入 ellamaka webServer 实现，不需要 node:http 分发器**。
2. **前端（Workbench）**：DSH 视图通过 **iframe** 加载 `http://127.0.0.1:4098/`。dsh 前端完整的 React SPA 在 iframe 内运行，`location.origin` = dsh 端口。
3. **零冲突零改动**：
   - dsh 插件的 `/api`、`/plugins`、WebSocket 升级全部打到 dsh 端口 → dsh 原生 webserver 处理。
   - ellamaka 主应用的所有 `/api/*` 留在 ellamaka 端口 → 互不干扰。
   - **dsh 源码零改动、社区插件零改动、ellamaka HTTP 路由层零改动**。
   - 双引擎同进程、共享 dsh 容器的目标（scope 隔离、Agent 桥消费）完整达成。

### 1.3 为什么双端口（而非单 server 合并路由）

早期方案想"单 server 单端口"，即把 dsh 的 `/api`、`/plugins` 路由合并进 ellamaka 的 HttpApi server。**放弃原因**（决策记录）：

- **`/api` 路径冲突**：dsh 前端和 ellamaka 都有 `/api`，同 origin 下冲突。
- **改 bundle 不可行（用户否决）**：`/api` 硬编码在**后端生成的运行时插件 bundle** 里（`dsh-client-connection`、`dsh-host-apiproxy` 等），不在静态前端里。改 bundle = fork dsh，会让社区插件（自带 `/api` 硬编码的 client bundle）无法直接使用，**破坏生态兼容**。
- **单 server 注入需要替换 webserver 实现**：dsh 插件的 route handler 是 node 原生 `(req, res)` 签名，WebSocket 需原始 node socket，与 Effect HttpApi 桥接复杂，且 `ctx.provide` 的 webServer 覆盖在 cordis 语义下有冲突风险。
- **双端口零侵入**：dsh 源码、社区插件、ellamaka HTTP 路由层全部零改动，天然规避上述全部问题。

---

## 2. 被否定的早期路线（决策参考）

> 这些路线都已被上述终局方案取代，记录在此仅作**决策历史**，不再执行。它们揭示的关键约束已沉淀进 §1.3。

| 路线 | 探索 | 否决原因 |
| :--- | :--- | :--- |
| 前端薄壳 + vite 代理 3080 | 独立 dsh 前端构建单元，vite `/api`/`/plugins` 代理到 dsh 独立进程 | 目标要求单进程集成；thin-shell 方案被 iframe 取代，已删除 |
| 每实例 CordisHub 装载 | 每实例目录一个 hub 只挂 spill | 装不下 dsh 引擎 |
| 单 server 注入 dsh webserver | 禁用 webserver 行 + prepare 注入兼容实现 + node:http 分发器 | `/api` 冲突 + 改 bundle 破坏生态，见 §1.3 |
| `/api` namespace 化 | 改 vendored 前端 `/api` → `/dsh/api` | 证伪：静态 bundle 不含 `/api`，硬编码在运行时插件 bundle 里，改 bundle 破坏社区插件 |

---

## 3. 关键实现：dsh 引擎装配

> dsh 的插件架构（双半身、层次、动态加载机制）源码级剖析见 `deepseek-harness-architecture-and-integration-research.md` §15。

dsh 引擎通过 `@wopal/ellamaka-cordis/dsh-web` 装配到 ellamaka 进程。**单容器重放 boot 序列**，不创建第二个 Cordis 容器。

### 3.1 装配机制

```ts
// mountDshWeb(ctx, { home, port, installAnchor? })
//   └── 在宿主 ctx 上重放 dsh boot(): baseUrl → dshHomePath → Loader
//       → launch env + cmdline --port → mountRootInclude → 激活审计
//   └── installAnchor: 显式指向闭包里的 @deepseek-ai/dsh/package.json（打包模式 require.resolve 无法解析到用户目录）

// bootDshWeb(opts) —— 自建容器，standalone 用
//   └── 自建 Context + mountDshWeb；dispose 连 ctx.fiber 一起拆
```

- `bootDshWeb` 是 desktop sidecar 的加载入口（自建容器，Node strip-types 可直接 import）。
- `mountDshWeb` 用于在宿主 ctx 上重放（多用于复用宿主容器装配的场景）。
- **desktop sidecar 必须用 `bootDshWeb`**：`mountDshWeb`+CordisHub 会经过 `@wopal/ellamaka-cordis` index 导入链，其内部 `.js` 扩展名导入 Node `--experimental-strip-types` 无法解析；`bootDshWeb` 自包含，直接加载。

### 3.2 动态装载保留

- 前端 UI bundle 保持"后端 scan → `/plugins/<id>/client.js` 从磁盘动态 serve"机制，**不内联**。
- 插件集由后端 Loader entry 集决定，带 rev 哈希可热更。

---

## 4. Desktop 集成方案（方案 B）

> 本节是 desktop 接入 dsh 的可实施规格。用户决策已全部记录于此，不得要求重复。

### 4.1 用户的硬性要求

1. **不丧失动态配置装载能力**：禁止把 dsh 组件 bundle 内联进 desktop。前端 UI bundle 保持"后端 scan → `/plugins/<id>/client.js` 从磁盘动态 serve"机制。
2. **desktop 启动自动安装 dsh 组件**：不依赖用户手动安装/配置 dsh。

### 4.2 交付方案（方案 B — onboarding npm 安装）

> **2026-08-20 定案**：放弃方案 A（extraResources 附带 dsh 闭包，~281MB）。改走方案 B：**dsh 闭包在 onboarding 阶段用 npm 安装到用户数据目录**。POC 阶段不实现安装逻辑，仅定机制、定安装位置。

| 层 | 内容 | 位置 | 可写性 |
| :--- | :--- | :--- | :--- |
| **1. dsh 代码/插件包** | `@deepseek-ai/dsh-*`（含前端 bundle `exports["./client"]` 产物）+ `@wopal/ellamaka-cordis` | 用户数据目录 `$WOPAL_HOME/ellamaka/data/dsh/node_modules` | 可写 |
| **2. profile 声明**（`package.json` + `cordis.patch.yml`） | bundle 列表 + 用户 patch 层 | 用户数据目录 | 可写 |
| **3. 会话/存储/配置** | 运行数据 | 用户数据目录 | 可写 |

**核心机制**：`bootDshWeb({ home, installAnchor })`。home 指向 dsh 数据目录，`installAnchor` 指向物化闭包里的 dsh 包。所以：
- 代码/配置/storage 全在用户数据目录，与 ellamaka 配置同根（`Global.Path.data`）
- 动态装载完整保留
- **原生二进制按平台各自安装**（sharp → `@img/sharp-<platform>-<arch>`、node-pty 平台 prebuilds），无需 3 端通用单一产物
- 安装器：npm（`npm install --omit=dev`），registry 已验证可达（npmmirror，单包 ~950ms）
- 幂等：闭包已存在且版本匹配 → 跳过重装

**安装位置定案**：`$WOPAL_HOME/ellamaka/data/dsh/`。

> **⚠️ 位置选择说明（2026-08-20）**：该位置选择**比较随意**，当前不调整，POC 阶段不追求完美。后续应调整到更合理语义位置，如 **`$WOPAL_HOME/ellamaka/cache/dsh/`**——因为 dsh 依赖本质是引擎代码（可重建、可丢弃、体积 ~200MB+），语义更贴近 `cache/` 而非 `data/`。调整是单点改动：改 sidecar 的 `DSH_HOME` 默认解析即可。

### 4.3 desktop 集成接线（实施规格）

```
onboarding（方案 B，POC 阶段不实现安装，仅定机制）:
  npm install --omit=dev 物化到 $WOPAL_HOME/ellamaka/data/dsh/（package.json + node_modules）
  deps: @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, @wopal/ellamaka-cordis

desktop sidecar 启动（sidecar.ts，Node utilityProcess，已启用 --experimental-strip-types）:
  Server.listen(...) 后:
  bootDshWeb({ home: $DSH_HOME, port: 0, installAnchor: $DSH_HOME/node_modules/@deepseek-ai/dsh/package.json })
    ← $DSH_HOME 缺省 $WOPAL_HOME/ellamaka/data/dsh
    ← 闭包缺失 → 不挂载，sidecar 正常（kill switch）
    ← 必须 bootDshWeb（自包含）；mountDshWeb+CordisHub 的 .js 导入 Node 解析不了
  ready 消息携带 dshPort

Main Process:
  SidecarRuntimeState.connection.dshPort
  Renderer 接收后驱动 iframe URL

Renderer:
  全屏 DSH 视图 iframe src = http://127.0.0.1:<dshPort>/
```

**dev vs desktop 端口策略**：
- **dev**：`serve.ts` 固定 4098（`ELLAMAKA_DSH=1`），前端 iframe 硬编码寻址，免端口发现
- **desktop**：dsh `port: 0` 随机端口 → Main 通知 → renderer 驱动 iframe URL

### 4.4 DSH 界面呈现形态（用户已拍板）

- **iframe 呈现**（`http://127.0.0.1:<dshPort>/`，dsh 完整 SPA 独立 origin）
- 触发入口：**顶栏 Logo 右侧新增 "DSH" 按钮**（`top-bar.tsx`）
- 位置：**全屏覆盖工作区（含左侧 SpaceRail 侧边栏）**，顶栏保留可切回。用户明确："将左侧 sidebar 也遮蔽住"
- `dshVisible` 状态由 `view-store.tsx` 暴露，`top-bar` toggle，`workbench/index.tsx` 渲染

---

## 5. 实施现状

> 本节点是上下文压缩后的恢复入口。2026-08-20 的 desktop 集成决策见 §4。

### 5.1 块 1 — 后端 dsh 引擎启动集成（`packages/opencode/` + `packages/ellamaka-cordis/`）✅

- ✅ 单容器：`mountDshWeb(ctx, opts)`（`@wopal/ellamaka-cordis/dsh-web`）在宿主 ctx 重放 boot 序列，不创建第二个容器
- ✅ 单包：dsh 装配并入 `ellamaka-cordis`（原独立 `ellamaka-dsh-host` 已删除）
- ✅ 版本统一 0.1.0-rc.6（root overrides 锁 58 个 `@deepseek-ai/dsh-*`）
- ✅ `ELLAMAKA_DSH=1` 开关保留：开启挂载到进程级 CordisHub；关闭零 dsh 挂载
- ✅ **2026-08-20 修复 desktop 崩溃**：`index.ts` 拆出 dsh-web 顶层导出（改子路径）+ `serve.ts` 动态 import；`dist/node/node.js` Node LOAD OK
- ✅ `installAnchor` 支持（`DshHostOptions.installAnchor`）
- ⏳ **块 3 — Desktop 集成接线**（见 §5.3）

### 5.2 块 2 — 前端 Workbench DSH 视图集成（`packages/ellamaka-app/`）✅

- ✅ 顶栏 "DSH" 按钮（`top-bar.tsx`），点击切换全屏 DSH iframe 视图
- ✅ `dshVisible` 状态（`view-store.tsx`）
- ✅ `workbench/index.tsx` 用 `Show when={!wb.dshVisible}` 全屏覆盖 **SpaceRail + Workspace**
- ✅ iframe src 从硬编码 4098 改为读 dshPort（dev 回落 4098）
- ✅ typecheck 通过，863 单元测试通过，workbench 边界检查 0 违规

### 5.3 块 3 — Desktop 集成接线（POC 范围：接线；安装逻辑留后续）⏳ 部分完成

按 §4 方案 B 执行。POC 阶段不实现 onboarding 安装，只做 sidecar 加载接线。

| 步骤 | 状态 | 说明 |
| :--- | :--- | :--- |
| `installAnchor` 支持 | ✅ | `DshHostOptions.installAnchor`，dev 默认 require.resolve |
| sidecar 加载 dsh | ✅ | `sidecar.ts` 用 `bootDshWeb`，`$DSH_HOME` 缺省，闭包缺失不挂载；`ready` 携带 dshPort |
| Main 端口通知 | ✅ | `connection.dshPort` 贯穿 spawn→supervisor→IPC |
| renderer 驱动 iframe | ✅ | `workbench/index.tsx` 读 dshPort（dev 回落 4098） |

> **注意**：desktop sidecar 必须用 `bootDshWeb`（自包含），不能用 `mountDshWeb`+CordisHub——后者 `@wopal/ellamaka-cordis` index 内部 `.js` 导入 Node strip-types 无法解析。

---

## 6. 关键路径与事实

- **worktree 根**：`/Volumes/U500G/coding/wopal-workspace/.worktrees/ellamaka-feature-ellamaka-cordis-container-hosts-loop-with-spill-plugins/`
- **dsh profile**：`~/.dsh/profiles/web/`（bundles: dsh-base + dsh-web-app）
- **dsh webserver**：`packages/host/webserver`，原生支持 `port: number`（0 为随机），`host: '127.0.0.1'`，不设 X-Frame-Options/CSP
- **dsh boot 序列**：`boot()` = `new Context()` + baseUrl + `provide('dshHomePath')` + `ctx.plugin(Loader)` + prepare + `mountRootInclude` + loader await + `assertEntriesActivated`；除 `new Context()` 外全部由 `@deepseek-ai/dsh-app-boot` 单独导出
- **Loader 插件**：`@deepseek-ai/cordis-plugin-loader`，`ctx.registry.plugin(Loader)` 挂载；`loader.remove(entryId)` 干净卸载
- **dshHomePath**：`@deepseek-ai/dsh-home-paths` 的 `dshHomePath`
- **dsh 装配位置**：`packages/ellamaka-cordis/src/dsh-web.ts`
- **ellamaka data 根**：`~/.wopal/ellamaka/data`（`Global.Path.data`）

---

## 7. 相关文件

| 文件 | 作用 |
| :--- | :--- |
| `packages/ellamaka-app/src/pages/workbench/index.tsx` | 全屏 DSH iframe 视图，覆盖 SpaceRail + Workspace |
| `packages/ellamaka-app/src/pages/workbench/parts/top-bar.tsx` | 顶栏 DSH 按钮（toggle dshVisible） |
| `packages/ellamaka-app/src/pages/workbench/view-store.tsx` | `dshVisible` + `setDshVisible` |
| `packages/ellamaka-app/src/context/platform.tsx` | `getDshPort()`（desktop 侧读取） |
| `packages/ellamaka-cordis/src/dsh-web.ts` | dsh 引擎装配（mountDshWeb/bootDshWeb） |
| `packages/ellamaka-cordis/src/index.ts` | 拆出 dsh-web 顶层导出（子路径） |
| `packages/opencode/src/cli/cmd/serve.ts` | `ELLAMAKA_DSH=1` 挂载 dsh，固定端口 4098；动态 import |
| `packages/ellamaka-desktop/src/main/sidecar.ts` | bootDshWeb + dshPort（ready 携带） |
| `packages/ellamaka-desktop/src/main/server.ts` | spawn → 传递 dshPort |
| `packages/ellamaka-desktop/src/main/sidecar-supervisor.ts` | connection.dshPort 字段 |
| `packages/ellamaka-desktop/src/preload/types.ts` | ServerReadyData/SidecarRuntimeState.dshPort |
| `packages/ellamaka-desktop/src/renderer/index.tsx` | `getDshPort()` 平台实现 |
| `bunfig.toml` | dsh 包加入 minimumReleaseAgeExcludes |

---

## 8. 待办与后续（更新正式设计的输入）

| 待办 | 说明 |
| :--- | :--- |
| **onboarding npm 安装** | POC 未实现。机制已定（§4.2）：`npm install --omit=dev` 物化到 dsh 数据目录，幂等 |
| **安装位置调整** | 从 `data/dsh/` → `$WOPAL_HOME/ellamaka/cache/dsh/`（更贴合缓存语义）。单点改 `DSH_HOME` 默认解析 |
| **`.js` 构建产物** | `@wopal/ellamaka-cordis` 需要 dist 构建产物才能被 Node 直接 import（当前 exports 指向 src）。desktop 用 `bootDshWeb` 规避，但正式集成若走 `mountDshWeb` 需解决 |
| **完整端到端验证** | desktop 启动后点 DSH 按钮看到完整 SPA（闭包已物化时），`/plugins/` 动态加载 UI bundle |

> 已删除（thin shell，被 iframe 方案取代）：`packages/ellamaka-app/dsh-web/`（vendor-dsh 全套）、`dsh-web-integration.ts`、vite proxy `/api`→3080、`build:dsh-web`/`dev:dsh-web` 脚本及 `@deepseek-ai/dsh-client-*` 依赖。

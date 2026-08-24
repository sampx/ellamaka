# DESIGN-dsh-poc — dsh 双引擎融合实验设计

> **状态**: Active（实验性设计，随实践演进）
> **创建时间**: 2026-08-20
> **上级架构**: `DESIGN.md`
> **研究依据**: `research/deepseek-harness-architecture-and-integration-research.md`

## 1. Role

本文档是 ellamaka 与 dsh（DeepSeek Harness）双引擎融合实验的架构真相源。它定义实验的设计哲学、双引擎现实、桥/吸收双轨策略、技术事实基线、当前约定与实验步骤。

本文档是 ellamaka 与 dsh 双引擎融合实验的**单一真相源**。技术事实基线见 §6。

## 2. 设计哲学：边实践边设计

### 2.1 核心原则

**不预先决定"复刻 vs 复用"，用起来收集证据，直到有信心再决定。**

ellamaka 对 dsh 的了解仍处于皮毛阶段，无法准确评估复刻的成本代价、复用的范围与难度。因此本实验**不决定**吸收轨的载体（ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制），而是：

1. **先用起来**：让 dsh 在 ellamaka 进程内完整运行，边用边熟悉 dsh 机理。
2. **边用边收集证据**：每个"桥"或"吸收"的实践，都回答一个成本问题。
3. **直到有信心再决定**：当证据足够时，才做吸收轨载体的最终决定。

### 2.2 为什么"不决定"是正确策略

"不决定"保留所有选项。它把决定推迟到信息最充分的时刻，避免在信息不足时锁死方向。这正是"桥不了该吸收"的落地方式——先用桥，桥贵了自然转向吸收。

### 2.3 心智负担管理

本实验通过**单一真相源**（本文档）+ **单一实施计划**（`PLAN-TODOS.md`）降低负担：明确思路，不再徘徊。

## 3. 双引擎现实（PoC 成果）

### 3.1 终局方案：单进程、双容器（web 容器 + 工具容器）

同一个 ellamaka 进程内跑两个 cordis 容器：

- **web 容器**（web profile，插件零改动）：挂载 dsh 原生 webserver 到第二个 loopback 端口，Workbench iframe 嵌入该端口，用户在其中使用完整 dsh 功能（会话、账本、checkpoint 全部照常）。
- **工具容器**（ellamaka-tools profile）：无 webserver 的纯工具后端。serve 启动时挂载，容器经 `globalThis.__ellamakaDshContainer` 暴露，`dsh-adapter` 将其中的工具投影进 ellamaka ToolRegistry。

```
ellamaka 进程
├── ellamaka 引擎 + HttpApi server      → 127.0.0.1:4097  (/api/provider, /workbench 等)
│     └── ToolRegistry：内置 grep/glob + dsh-adapter 投影的容器工具
├── dsh web 容器（web profile 完整插件） → 127.0.0.1:4098  → iframe UI
└── dsh 工具容器（ellamaka-tools profile，无 webserver）
      └── globalThis.__ellamakaDshContainer  →  dsh-adapter 调用工具
```

### 3.2 关键事实

- **dsh 源码零改动、社区插件零改动、ellamaka HTTP 路由层零改动**。
- **两种使用模式物理隔离**：iframe UI 需要 dsh 的 agent-loop 语义（会话账本 + checkpoint 屏障 + 完整插件集）；工具采用只需要工具本体 + 最小调用上下文。同一容器无法同时满足两种装配（checkpoint 插件会强制 flush 调用方的 live session），因此拆成两个容器，各装配各的 profile。
- **工具容器用 `mountDshTools` / `bootDshTools`**：加载 `ellamaka-tools` profile（bundles: dsh-base），其用户补丁层禁用 agent-loop 专属插件（`session-checkpoint-policy`）。工具以轻量 per-call context 执行——传给 `tools.execute` 的 agent 只携带 `session.header.cwd`（spawn 工作目录）与 `session.header.id`（spill 归属标签），**容器内不创建任何 dsh session**。
- **desktop sidecar 用 `bootDshWeb` / `bootDshTools`**（自包含，Node strip-types 可直接 import）；`mountDshWeb`+CordisHub 的 `.js` 导入 Node 无法解析。
- **动态装载保留**：前端 UI bundle 保持"后端 scan → `/plugins/<id>/client.js` 从磁盘动态 serve"机制，不内联。
- **`$DSH_HOME` 缺省** `$WOPAL_HOME/ellamaka/data/dsh`，闭包缺失不挂载（kill switch）。
- **dshPort 贯穿** server.ts → sidecar-supervisor.ts → preload/types.ts → renderer → platform.getDshPort()。

### 3.3 为什么双端口（而非单 server 合并路由）

早期方案想"单 server 单端口"，即把 dsh 的 `/api`、`/plugins` 路由合并进 ellamaka 的 HttpApi server。**放弃原因**（决策记录）：

- **`/api` 路径冲突**：dsh 前端和 ellamaka 都有 `/api`，同 origin 下冲突。
- **改 bundle 不可行（用户否决）**：`/api` 硬编码在**后端生成的运行时插件 bundle** 里（`dsh-client-connection`、`dsh-host-apiproxy` 等），不在静态前端里。改 bundle = fork dsh，会让社区插件（自带 `/api` 硬编码的 client bundle）无法直接使用，**破坏生态兼容**。
- **单 server 注入需要替换 webserver 实现**：dsh 插件的 route handler 是 node 原生 `(req, res)` 签名，WebSocket 需原始 node socket，与 Effect HttpApi 桥接复杂，且 `ctx.provide` 的 webServer 覆盖在 cordis 语义下有冲突风险。
- **双端口零侵入**：dsh 源码、社区插件、ellamaka HTTP 路由层全部零改动，天然规避上述全部问题。

### 3.4 被否定的早期路线（决策参考）

| 路线 | 探索 | 否决原因 |
| :--- | :--- | :--- |
| 前端薄壳 + vite 代理 3080 | 独立 dsh 前端构建单元，vite `/api`/`/plugins` 代理到 dsh 独立进程 | 目标要求单进程集成；thin-shell 方案被 iframe 取代，已删除 |
| 每实例 CordisHub 装载 | 每实例目录一个 hub 只挂 spill | 装不下 dsh 引擎；已彻底拆除（per-instance hub 装配、turn-driver 桥、`cordis-plugins.log` 一并退役，instance 隔离由容器 per-directory scope 承接，见研究报告 §17.4） |
| 单 server 注入 dsh webserver | 禁用 webserver 行 + prepare 注入兼容实现 + node:http 分发器 | `/api` 冲突 + 改 bundle 破坏生态，见 §3.3 |
| `/api` namespace 化 | 改 vendored 前端 `/api` → `/dsh/api` | 证伪：静态 bundle 不含 `/api`，硬编码在运行时插件 bundle 里，改 bundle 破坏社区插件 |

### 3.5 装配机制

```ts
// mountDshWeb(ctx, { home, port, installAnchor? })
//   └── 在宿主 ctx 上重放 dsh boot(): baseUrl → dshHomePath → Loader
//       → launch env + cmdline --port → mountRootInclude → 激活审计
//   └── installAnchor: 显式指向闭包里的 @deepseek-ai/dsh/package.json（打包模式 require.resolve 无法解析到用户目录）

// mountDshTools(ctx, opts) —— 同上 boot 序列，profile = ellamaka-tools
//   └── 无 webserver；首次挂载时若补丁层仍是空模板，播种禁用条目
//       （session-checkpoint-policy disabled），用户后续编辑不会被覆盖

// bootDshWeb(opts) —— 自建容器，standalone 用
//   └── 自建 Context + mountDshWeb；dispose 连 ctx.fiber 一起拆

// bootDshTools(opts) —— 自建容器，desktop sidecar 用
//   └── 自建 Context + mountDshTools；返回 handle 带 ctx，供 globalThis 暴露
```

- `bootDshWeb`/`bootDshTools` 是 desktop sidecar 的加载入口（自建容器，Node strip-types 可直接 import）。
- `mountDshWeb`/`mountDshTools` 用于在宿主 ctx 上重放（serve.ts 的 CordisHub ctx）。
- **desktop sidecar 必须用 boot 系列**：`mount*`+CordisHub 会经过 `@wopal/ellamaka-cordis` index 导入链，其内部 `.js` 扩展名导入 Node `--experimental-strip-types` 无法解析；boot 系列自包含，直接加载。

### 3.6 关键路径与事实

- **dsh profile**：`web/`（bundles: dsh-base + dsh-web-app，完整 UI）、`ellamaka-tools/`（bundles: dsh-base，补丁层禁用 agent-loop 专属插件）。两者都在 `$DSH_HOME/profiles/` 下。
- **profile 机制**：profile 目录含 `package.json`（`dsh.profile.bundles` 有序 bundle 列表）+ `cordis.patch.yml`（用户补丁层，按 entry id 覆盖/禁用，应用于全部 bundle 层之后）。`initProfile` 只创建缺失文件不覆盖；ellamaka 只在补丁层仍是空模板时播种默认禁用条目，用户编辑永远不会被覆盖。
- **dsh webserver**：`packages/host/webserver`，原生支持 `port: number`（0 为随机），`host: '127.0.0.1'`，不设 X-Frame-Options/CSP
- **dsh boot 序列**：`boot()` = `new Context()` + baseUrl + `provide('dshHomePath')` + `ctx.plugin(Loader)` + prepare + `mountRootInclude` + loader await + `assertEntriesActivated`；除 `new Context()` 外全部由 `@deepseek-ai/dsh-app-boot` 单独导出
- **Loader 插件**：`@deepseek-ai/cordis-plugin-loader`，`ctx.registry.plugin(Loader)` 挂载；`loader.remove(entryId)` 干净卸载
- **dshHomePath**：`@deepseek-ai/dsh-home-paths` 的 `dshHomePath`
- **dsh 装配位置**：`packages/ellamaka-cordis/src/dsh-web.ts`
- **ellamaka data 根**：`~/.wopal/ellamaka/data`（`Global.Path.data`）

### 3.7 相关文件

| 文件 | 作用 |
| :--- | :--- |
| `packages/ellamaka-app/src/pages/workbench/index.tsx` | 全屏 DSH iframe 视图，覆盖 SpaceRail + Workspace |
| `packages/ellamaka-app/src/pages/workbench/parts/top-bar.tsx` | 顶栏 DSH 按钮（toggle dshVisible） |
| `packages/ellamaka-app/src/pages/workbench/view-store.tsx` | `dshVisible` + `setDshVisible` |
| `packages/ellamaka-app/src/context/platform.tsx` | `getDshPort()`（desktop 侧读取） |
| `packages/ellamaka-cordis/src/dsh-web.ts` | dsh 引擎装配（mountDshWeb/bootDshWeb/mountDshTools/bootDshTools） |
| `packages/ellamaka-cordis/src/index.ts` | 拆出 dsh-web 顶层导出（子路径） |
| `packages/opencode/src/cli/cmd/serve.ts` | `ELLAMAKA_DSH=1` 双容器挂载：web（4098）+ tools（globalThis 暴露）；动态 import |
| `packages/ellamaka-desktop/src/main/sidecar.ts` | bootDshWeb + bootDshTools + dshPort（ready 携带） |
| `packages/ellamaka-desktop/src/main/server.ts` | spawn → 传递 dshPort |
| `packages/ellamaka-desktop/src/main/sidecar-supervisor.ts` | connection.dshPort 字段 |
| `packages/ellamaka-desktop/src/preload/types.ts` | ServerReadyData/SidecarRuntimeState.dshPort |
| `packages/ellamaka-desktop/src/renderer/index.tsx` | `getDshPort()` 平台实现 |
| `bunfig.toml` | dsh 包加入 minimumReleaseAgeExcludes |

### 3.8 iframe 是界面问题，不是架构结论

iframe 只是 PoC 让 dsh 界面先跑起来的手段。它阻挡的是"界面合并"，不是"容器能力复用"。真正的能力复用活在容器层，与 iframe 无关。

**终局 ellamaka 是独立产品，不是 dsh 的包装器**——界面必然自己长。dsh 的 dual-face 前端 bundle 设计（后端 Loader 决定前端插件集、按需拉取、rev 哈希热更）是值得反哺进 ellamaka 的设计，见 §5 吸收轨。

## 4. 桥/吸收双轨策略

ellamaka 借 dsh 解决四类问题，分两轨：

| ellamaka 的痛 | dsh 给的解 | 靠桥还是吸收 |
|---|---|---|
| **工具能力增强**（grep/glob→fs-search、sandbox、spill） | 现成插件 | **桥**（契约缝隙 + 采用，个案） |
| **配置动态化**（现在启动期静态、无热重载） | patch 声明式 entry 树、增量重扫 | **吸收**（运行时机制复刻） |
| **插件规范化 + 动态插拔**（现在三路由混杂、静态装配） | Loader 动态装载、`loader.remove(entry)` 干净卸载、dual-face | **吸收**（宿主机制） |

### 4.1 桥轨 — 工具容器 + adapter 逐项采用 dsh 能力

当前优先级是让 ellamaka 直接使用 dsh 已有的强能力。首个候选仍是 **fs-search 替换 grep/glob**，它消除运行时下载 ripgrep，并提供更完整的搜索治理。

**承载形态：工具容器 + adapter**（§3.1）：

- **工具容器**（ellamaka-tools profile）是能力的"货架"：载入 dsh-base 全部插件，用 profile 补丁层按 id 禁用 agent-loop 专属插件（当前仅有 `session-checkpoint-policy`）。工具容器不承载任何 dsh 会话，只暴露 `tools` 等服务。禁用清单是用户自有文件（`$DSH_HOME/profiles/ellamaka-tools/cordis.patch.yml`），ellamaka 不覆盖用户编辑。
- **dsh-adapter**（`.wopal/plugins/dsh-adapter`）是能力的"投影仪"：按映射白名单把容器工具投影到 ellamaka ToolRegistry 并送出执行。执行时只携带工具实际消费的最小 per-call context——`agent.session.header.cwd`（spawn 工作目录）与 `agent.session.header.id`（spill 归属标签），其他一切省略。
- **每次只采用一个能力**。权限继续由 ellamaka 原生 Permission 处理。
- 采用成本超过独立实现成本时，保留 ellamaka 原生能力。dsh 是能力来源，不是必须迁入的运行时归宿。

#### 4.1.1 采用边界

| 能力形态 | 采用方式 |
|---|---|
| 输入、输出和生命周期可由 dsh 通用工具契约表达 | 通过 `.wopal/plugins/dsh-adapter` 逐项投影到 ellamaka ToolRegistry |
| 只需少量调用上下文 | 在 adapter 内按需传入最小 per-call context（如 header.cwd/header.id），完全按工具的实测消费面供给，缺的字段省略 |
| 依赖 dsh 自身的 session、agent loop、事件日志或子会话语义 | 不采用该包，按 ellamaka 的数据模型复刻所需机制 |
| 依赖 ellamaka Hook、Session/Part、Permission、Question、Task、UI 或 Instance 生命周期 | 由 ellamaka 原生插件负责 |

**session-checkpoint-policy 的实证结论**：该插件监听 `tools/execute`，对 `exec.agent.session` 执行账本 flush（"执行副作用前，账本已持久化"的 agent-loop 语义）。adapter 不传 agent 时它短路放行，但 fs-search 的 spill 因缺 owner id 而降级；传入轻量 agent 时它抛 `session not live`（store 校验不过）。因此工具容器在 profile 层禁用该插件——这意味着：**工具容器不做请求边界持久化，但也不创建、不持有任何 session，账本持久化的缺失不产生功能影响**。web 容器保持完整 profile，checkpoint 与 UI 模式照常。

#### 4.1.2 fs-search 采用现状（P2 首批落地）

- **grep/glob 已在工具容器完整可用**：内联 cap（250 匹配）内直接返回；超 cap 的结果 spill 到 `$TMPDIR/dsh-spill-*/session-<hash>/` 并返回恢复指示，spill 文件完整保存全部匹配。
- **adapter 映射白名单**：`.wopal/plugins/dsh-adapter` 配置 `tools: [{source: grep, target: grep}, {source: glob, target: glob}]`。同名 target 覆盖 ellamaka 内置工具；容器缺失时 adapter 挂 0 个工具，内置工具原样可用。
- **验证记录**：adapter 单测 7 项；dsh-web 集成测试含"工具容器 profile 完整执行 + 零 session 断言"；端到端证明 web 容器 + 工具容器并存、UI 完整、spill 完整、容器 `sessions.list()` 恒为空。

#### 4.1.3 wopal-plugin 边界（暂不迁移）

wopal-plugin 是 ellamaka 的原生集成层。它继续拥有规则与记忆注入、任务协作、上下文恢复、权限交互和运行时监控。

这些能力的价值来自 ellamaka 的宿主语义。把它们改写为 dsh 插件不会扩大可用范围，只会增加 adapter 与生命周期维护成本。

未来某个 wopal 能力若能脱离 ellamaka 语义，并在其他 dsh 宿主中产生独立价值，再单独评估。当前 PoC 不拆分、不迁移、不为此建设 Hook、Task 或 Session 桥。

### 4.2 吸收轨 — 配置动态化 + 插件规范化 + 动态插拔（宿主机制，长期主线）

- 这是微内核方向真正住的地方：让 ellamaka 宿主运行时从"静态装配"演进为"动态装载容器"。
- 具体：patch 声明式 entry 树、增量重扫、`loader.remove(entry)` 干净卸载、dual-face 前端 bundle。
- 这条轨成本最高、最接近终极目标，也最需要谨慎——**它决定 ellamaka 最终是"微内核"还是"dsh 包装器"**。

### 4.3 载体决定（推迟）

吸收轨的载体（ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制）**本实验不决定**。它会在使用 dsh 的过程中被自然回答：

- 用 dsh 的 fs-search 替换 grep/glob → 看到"桥接一个工具"到底多贵 → 回答"桥"的成本。
- 用 dsh 的动态装载、patch、dual-face → 看到"这套机制"到底多复杂 → 回答"吸收"的成本。
- 用 dsh 一段时间 → 知道哪些能力值得内化、哪些不值得 → 回答"微内核"值不值得。

## 5. 微内核方向（目标留白）

ellamaka 的演进方向明确：**容器化、动态化，尽量直接利用 dsh 生态**。终极目标是成为一个与 dsh 非常类似的微内核框架。

但**这个目标不写死**——PoC 尚未验证到这个程度，ellamaka 最终能否做成微内核，关键看成本。因此本文档只锁定**方向**（容器化/动态化），不锁定**目标**（微内核），以成本门控。

## 6. 技术事实基线

以下技术事实经源码实证或实测固化，本实验继续遵守。

### 6.1 深耦合包不可桥接（C2）

session-query / schedule / subagent / system prompt 注入等能力依赖 dsh 自家 loop/session 语义的引擎层（事件日志语料重放、agent.send 唤醒通道、子会话模型）。契约桥只能翻译接口层形状，翻译不了引擎层语义。这些能力的获取路径是**原生复刻**（机制设计可剥离，包与数据模型不可复用）。

### 6.2 桥接 API 规范（实测固化）

全部从 async 侧（Cordis 服务）调回 Effect 世界的桥接遵守以下形态：

1. **持有 work Fiber 必须 `Effect.forkIn(scope)(work)`**：在 `Effect.scoped` 内取 scope，`Effect.forkIn(scope)(work)` 直接返回持有的 work fiber，`Fiber.await` 拿到真实 exit。禁止 `ManagedRuntime.runFork(work).pipe(Effect.forkIn(scope))`（双重 fork，返回值与中断语义错乱）。中断经 `runtime.runFork(Fiber.interrupt(fiber))` 执行。禁止 `runPromise` 驱动长任务（无中断句柄，未受管的 `forever` 任务导致进程退出时报错）。
2. **顶层 `Effect.runFork/runPromise/runCallback` 在运行时未导出**——一律经 `ManagedRuntime` 实例方法调用。
3. **`Effect.scope` 须在 `Effect.scoped` 内获取**，否则以空 defect Die。桥接 scope 由宿主层的 `Effect.scoped` 提供。
4. **ALS 上下文**：effect 体内发起的桥接调用沿传播链天然继承 Instance ALS，无需 `Instance.bind`。纯 async 侧发起的轮次须捕获-恢复 ALS。
5. **取消语义**：interrupt 后 finalizer 按子先父后顺序确定性执行，`forkIn(scope)` 的并发子任务级联清理。Cordis 入口只启动不拥有中断权。

### 6.3 工具管道设计（ctx.tools）

工具执行管道五段：`pre`（参数观察）→ `guard`（审批/拒绝决策）→ `around`（执行替换/包装，spill/timeout 挂载点）→ `post`（结果塑形）→ `result`（终态物化）。全部以 Cordis waterfall 事件暴露，插件可短路（guard 拒绝）或替换（around）。

### 6.4 日志桥接（已实现）

dsh 容器插件日志经 `ctx.logger`（自动命名）→ Exporter（`mountDshWeb`/`mountDshTools` 装配时注册）→ 独立文件 `dsh-plugins.log`（`$WOPAL_HOME/logs/`），不进 ellamaka 主日志。这是**唯一**的容器日志：进程级容器 → 全局日志目录，规则单一可预测。旧 Plan 1 的 per-instance hub 日志（`cordis-plugins.log`）已随旧机制一并拆除（见 §3.4）。

### 6.5 复刻方法论（研究报告 §11）

复刻的对象是机制设计，不是包。每个闪光点剥离 session 耦合后归入三种形态：

- **A 类 — 算法吸收**：机制本质是纯逻辑，session 只是输入输出载体。提为纯函数嵌入现有 Effect 服务实现。不依赖 Cordis 化，可先行。
- **B 类 — 能力插件**：新能力天然是插件形态（工具、后台服务）。自研实现 + 自持契约封装，底层接 ellamaka Storage/Bus。
- **C 类 — 现状增强**：ellamaka 已有对应能力，仅缺 dsh 的某个精妙语义。将语义 diff 移植进现有实现。

### 6.6 工具选型（研究报告 §12）

- **优先直接采用**：`fs-search`（替换原生 glob/grep，消除运行时下载问题）、`fs-observation-policy`（先读后写门禁，纯增量）。
- **保留 ellamaka 原生实现**：`edit`、`read/write` 和 `wopal_task_*`。它们的现有语义或宿主集成更重要。
- **逐项评估**：`bash`、ask-user、jobs、goal、schedule、session-query、terminal。只有可用通用工具契约低成本接入时才进入采用清单。

### 6.7 session 语义模型（研究报告 §13）

dsh 是"账本"（只记流水，余额随时可算），ellamaka 是"余额表"（只存现状，流水不保留）。核心差异导致深耦合包不可桥接（§6.1）。dsh 的"model-visible is logged"承诺带来**确定性回放**能力——loop 从玄学调试变工程测试，这是 dsh 敢高频重构 loop 内核的底气。

## 7. 当前约定（双人确认制，无红线）

> PoC 场景**不设红线**：一切边界都可讨论、可变更。以下为当前生效的约定，任何一项的调整都需经用户与 Wopal 双方确认后生效。

1. **cordis import 边界（当前约定）**：`@deepseek-ai/cordis` 只出现在 `@wopal/ellamaka-cordis` 包内（版本锁 4.0.1）。
2. **dsh 深耦合包暂缓使用（当前约定）**：agent-loop/session/session-query/compaction/subagent/schedule 及任何 rt-import dsh-session 的包，暂不被主线代码 import、不在运行时加载、不作为插件挂载（深耦合原因见 §6.1；能力获取走自研复刻路径）。required peer 进入 node_modules/bun.lock 仅供类型解析。运行时加载探针（`packages/ellamaka-cordis/test/forbidden-load.test.ts`）作为当前状态的观测手段保留。
3. **session 所有权（当前约定）**：持久化与事件定义归 Storage/Bus/EventV2；Cordis 层只持有 facade。
4. **对外契约稳定（当前约定）**：SSE 事件、HttpApi、SDK 在实验中保持稳定。
5. **桥的加法原则（当前约定）**：桥接优先为新增文件/包装层，保持删除桥即回滚的能力。
6. **wopal-plugin 原生边界（当前约定）**：wopal-plugin 继续作为 ellamaka 原生插件运行。PoC 只采用独立 dsh 能力，不拆分或迁移 wopal-plugin。
7. **工具容器边界（当前约定）**：工具调用走专用工具容器（ellamaka-tools profile），**容器内不创建任何 dsh session**；adapter 只传递工具实测消费的最小 per-call context。web 容器保持完整 profile，不复用为工具后端。工具容器的 agent-loop 插件禁用清单是该 profile 的用户补丁层，ellamaka 仅在模板为空时播种、不覆盖用户编辑。

## 8. 实验步骤（核心到外围）

> 实验顺序从核心到外围。核心是**插件生态融合 + 工具利用**，外围是发布层面细节。PoC 是长期实验，不合并 main，直到设计决定做出。

| 批次 | 内容 | 核心度 | 状态 |
|------|------|--------|------|
| P1 | 插件生态融合验证：dsh 插件在 ellamaka 容器内完整运行、动态装载 | 核心 | ✅ 接线完成 |
| P2 | 工具利用：fs-search（grep/glob）经工具容器 + adapter 落地；逐项采用继续 | 核心 | 🔶 当前重点（fs-search 已落地，工具容器 + adapter 机制搭就） |
| P3 | 配置动态化观察：patch 声明式、增量重扫 | 吸收轨 | ⬜ |
| P4 | 插件规范化观察：dual-face、Loader 动态插拔 | 吸收轨 | ⬜ |
| P5 | 界面演进：iframe → 原生（远期） | 外围 | ⬜ |

详细任务分解见 `PLAN-TODOS.md`。

## 9. 相关文档

- 实施计划与进度管理：`PLAN-TODOS.md`
- 研究报告（dsh 全景调研、四层架构分析、审计证据链）：`research/deepseek-harness-architecture-and-integration-research.md`
- 上级架构：`DESIGN.md`
- dsh 参考源码：`labs/ref-repos/deepseek-harness/`

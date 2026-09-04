# DESIGN-dsh — ellamaka 与 dsh 融合架构设计

> **状态**：融合机制、生产物化、插件供应链均已实施并通过验收，进入维护态。**空间 × Agent 配置体系是当前主线**；workbench 前端插件互通为启动前提明确的后续门槛轨道。
> **上级架构**：`DESIGN.md`
> **技术依据**：`research/deepseek-harness-architecture-and-integration-research.md`（dsh 全景调研）

**阅读地图**：架构总览 → 运行时机制 → 能力采用 → 配置与隔离 → 已验证事实 → 设计约束 → 生产物化验收基线 → 插件供应链 → **空间 × Agent 配置体系（当前主线）** → workbench × dsh 前端插件互通（门槛轨道）。

本文档不使用章节号，交叉引用一律以标题文字为准（如「见「设计约束 · 不可变闭包」」）。

---

## 背景与目标

ellamaka 是 WopalSpace 的引擎（OpenCode fork）。为获得沙箱执行、插件生态、动态装载等能力，ellamaka 在自身进程内集成 dsh 引擎，形成双引擎融合架构。

**设计目标**：

1. **单一进程**：ellamaka 与 dsh 运行于同一进程，共享一个公开端口。
2. **能力复用**：ellamaka 直接采用 dsh 的工具能力（沙箱、搜索、文件操作），不重复实现。
3. **会话归属**：ellamaka 拥有会话与状态所有权。Web 容器承载 dsh 完整会话（见「架构总览 · 单进程、单端口、双容器」）；工具容器与 adapter 投影路径不创建、不持有任何会话，只提供执行能力（见「已验证事实 · 工具容器不持久化的成立条件」）。
4. **对外稳定**：ellamaka 的 API、SSE 事件、SDK 契约不因融合而变化。
5. **插件生态一体化**：dsh 插件可命令式安装、即时生效、跨重启保留，配置融入 ellamaka 配置体系（见「插件供应链」）。
6. **空间化 Agent 配置**：wopal 的多空间、多 Agent 协作模式在 dsh 界面内原生成立——每个空间有自己的 Agent 团队、武器可见性与界面形态（见「空间 × Agent 配置体系」）。

**范围边界**：dsh 的会话/账本语义、调度、子代理等引擎能力不在工具采用范围内——这些能力依赖 dsh 自身的会话模型，与 ellamaka 的会话所有权冲突（见「已验证事实 · 深耦合能力不可采用」）。Agent 配置与组队能力（见「空间 × Agent 配置体系」）运行在 dsh Web 容器内，使用 dsh 自有会话模型，不与 ellamaka 争抢会话所有权。

---

## 架构总览

### 单进程、单端口、双容器

ellamaka 进程内运行两个独立容器（Cordis container），共用 ellamaka 的唯一监听端口：

| 容器 | Profile | 职责 | 会话 |
|------|---------|------|------|
| **Web 容器** | `web` | 承载 dsh 完整 Web 界面（会话、账本、checkpoint、Agent 配置体系） | 有 |
| **工具容器** | `ellamaka-tools` | 提供纯工具执行后端，供 ellamaka 工具管道调用 | 无 |

```text
ellamaka 进程（唯一监听端口）
├── ellamaka 引擎 + Effect HttpApi    → /api/*、/workbench 等原生资源
│     └── ToolRegistry：内置工具 + dsh-adapter 投影的容器工具
├── /dsh/* → 受控 Node 路由挂载点 → VirtualWebServer（Web 容器）
│     ├── /api/*          → dsh 官方 connection 插件
│     ├── /api/events.*   → dsh 官方 WebSocket downlinks
│     ├── /plugins/*      → dsh 官方 modules 插件
│     ├── /plugins/events → dsh 官方 HMR 插件
│     └── /*              → dsh 官方 frontend-static
├── 工具容器（ellamaka-tools profile，无 webserver）
│     └── globalThis.__ellamakaDshContainer → dsh-adapter 调用工具
├── DSH Plugin Manager（见「插件供应链」）
│     └── `ellamaka dsh plugin` 命令 → plugins/ 安装区 + 运行中容器热挂载
└── 预设生成器（见「空间 × Agent 配置体系 · 预设生成器」）
      └── 每空间 × 每灵魂 → 一份 Agent 配置单 → Web 容器会话按空间装配
```

**两个容器必须分离**的原因：Web UI 需要 dsh 的完整 agent-loop 语义（会话账本 + checkpoint 屏障 + 完整插件集）；工具采用只需要工具本体 + 最小调用上下文。同一容器无法同时满足两种装配——checkpoint 插件会强制 flush 调用方的 live session（见「已验证事实 · 工具容器不持久化的成立条件」）。

**入口分工**：

- CLI serve / web：挂载 Web 容器 + 工具容器
- Desktop sidecar：挂载 Web 容器 + 工具容器（boot 系列自建容器）
- TUI：只挂工具容器（无 iframe 需求）
- Workbench：由承载页面的 serve/web 后端或 Desktop sidecar 提供 Web 容器与工具容器

### 组件清单

| 组件 | 位置 | 职责 |
|------|------|------|
| `VirtualWebServer` | `@wopal/ellamaka-cordis` | 实现 dsh 官方 WebServer 接口，提供路由/upgrade 分发，不创建监听 socket |
| 受控路由挂载点 | `Listener.mountNodeRoute` | 按前缀分发 HTTP/upgrade 到已注册 handler，保留 Effect listener 生命周期 |
| Ellamaka DSH Bridge | `@wopal/ellamaka-cordis` | 随 CLI 与 Desktop sidecar 编译发布；提供容器、虚拟 WebServer、运行时动态加载与 dsh boot 装配，不作为 DSH 闭包依赖发布 |
| DSH Runtime Manager | `@wopal/ellamaka-cordis/runtime` | serve、web、TUI 与 Desktop sidecar 共用的启动入口；负责禁用判断、闭包物化、完整性校验、动态加载和容器挂载 |
| DSH Plugin Manager | `@wopal/ellamaka-cordis/plugins`（随 Bridge 发布） | 插件供应链：安装区管理、依赖解析、热挂载与 profile 清单同步 |
| 预设生成器 | Bridge 侧同步模块 | 从各空间 `.wopal/` 定义文件生成 Agent 配置单，注册进 Web 容器的预设体系（见「空间 × Agent 配置体系 · 预设生成器」） |
| DSH 运行时清单 | Ellamaka 构建产物 | 构建时从 `packages/ellamaka-cordis/package.json` 派生并锁定 DSH 官方依赖、完整依赖树与完整性信息；运行时内嵌读取 |
| dsh 引擎装配 | `@wopal/ellamaka-cordis/dsh-web` | 通过 installAnchor 从物化闭包加载官方运行时，重放 dsh boot 序列，构造两个容器；覆盖 `ctx.dshHomePath` 与插件 `dshHome` 配置注入，落地运行时隔离 |
| dsh-adapter | `.wopal/plugins/dsh-adapter` | 把工具容器中的工具投影进 ellamaka ToolRegistry |
| DSH home | `$WOPAL_HOME/dsh` | 不可变依赖闭包、用户插件安装区、profile 定义、运行时 state、Agent 配置单根的唯一位置 |

---

## 运行时机制

### 单端口分发

Dsh 的 Web 路由与 ellamaka 原生路由共用 ellamaka 的监听端口：

1. ellamaka Server 提供受控 Node 路由挂载点，保存前缀与 HTTP/upgrade handler。
2. `VirtualWebServer` 持有 dsh 官方插件注册的路由与 upgrade socket，暴露分发能力。
3. `mountDshWeb` 返回的 `webServer` 经 `Listener.mountNodeRoute({ prefix: "/dsh", ... })` 挂到主 listener。
4. 主服务器剥离 `/dsh` 前缀后，`VirtualWebServer` 看到的是官方 `/api`、`/plugins` 原始路径。

**边界**：

- 调用方获得 register/dispose 能力，不获得原始 `node:http.Server`。
- upgrade socket 由 `VirtualWebServer` 持有，在 host dispose 与主 listener 停止时销毁——补足 Node `closeAllConnections()` 不覆盖 WebSocket 的行为。

### 浏览器前缀适配

Dsh 前端在隔离 iframe 内加载。`VirtualWebServer` 在 index tap 链末尾注入适配脚本，把 DSH 浏览器传输映射到 `/dsh/*`：

- `fetch`（字符串、`Request`、`URL` 对象）、`WebSocket`、`EventSource`
- `document.createElement("script")` 动态加载的插件 bundle
- 覆盖相对路径与同源绝对 URL；外部 URL 与已带 `/dsh` 的 URL 保持不变

**静态资源路径**：DSH 前端使用根路径 `/assets/*`、`/favicon.svg` 与 boot manifest 的 `/plugins/*`。index 变换统一添加 `/dsh` 前缀，并移除 iframe 不需要的 PWA manifest link。

### iframe 地址派生

`DshIframe` 的 src 从活跃 server 的 `http.url` 派生为 `<url>/dsh/`，不写死相对路径。原因：ellamaka-app 的 dev 模式由 Vite 服务前端（默认 3000），后端 serve 独立监听（默认 4097）；相对 `/dsh/` 在 `:3000/workbench` 页面会解析到前端 origin。派生后 dev 下指向 `http://127.0.0.1:4097/dsh/`、Desktop 下指向 sidecar 本地地址，两侧都命中后端 `/dsh` 挂载点。

### 助理 tab 承载

Dsh iframe 的宿主是 workbench 的「助理」tab（General 空间 tab）：

- **派生可见性**：`dshVisible = dshEnabled && 激活 tab 是 General`。`dshEnabled` 来自 `/global/health` 的 `dsh` 字段（真值源 `ELLAMAKA_DSH` kill switch）。没有独立可见性信号，激活高亮、点击语义、持久化（`activeTabPath` 已持久化）三者天然一致。
- **keep-alive**：iframe 与原生工作区双层持久挂载，仅切 `display`；切 tab 不重载 iframe，DSH 会话状态保留（Space Keep-Alive 同款不变量）。
- **覆盖范围**：iframe 盖掉助理 tab 内容区全部（含 SpaceRail），dsh 界面自带侧栏；tab 名保持「助理」。
- **回落**：`ELLAMAKA_DSH=0` 时助理 tab 显示原生 General 会话空间，与 DSH 引入前行为一致；General 引擎作用域（`provisionGeneral`、会话投影、后台任务会话）不受影响。

### DSH home 与运行时隔离

#### 交付边界

Ellamaka 发布物包含编译后的 **Ellamaka DSH Bridge**，不包含 DSH 官方运行时依赖。Bridge 是 Ellamaka 自身代码，随 CLI 二进制与 Desktop sidecar 一同构建。它不发布为独立 registry 包，也不作为 `$WOPAL_HOME/dsh/package.json` 的依赖。

全部 `@deepseek-ai/*` 官方包在首次启用 DSH 时物化到 `$WOPAL_HOME/dsh`。这条边界在 dev、CLI 发布物与 Desktop 发布物中保持一致：

```text
Ellamaka CLI / Desktop sidecar
└── compiled DSH Bridge                  ← Ellamaka 发布物

$WOPAL_HOME/dsh/closures/<fingerprint>/
├── package.json                         ← DSH 官方直接依赖
├── package-lock.json                    ← 完整解析树与 integrity（构建期内嵌锁的落盘复本）
├── runtime-manifest.json                ← 本闭包对应的运行时清单复本
└── node_modules/@deepseek-ai/*          ← DSH 官方运行时闭包
```

Dsh 不依赖 Ellamaka DSH Bridge。依赖方向始终是 `Ellamaka → Bridge → DSH runtime`。生产闭包中没有 `@wopal/ellamaka-cordis`、`file:` workspace 链接、TS 源码副本或 Node TypeScript loader。

#### 唯一 home 与目录所有权

**唯一 home**：`$WOPAL_HOME/dsh`。serve、web、TUI、Workbench 后端与 Desktop sidecar 读取同一位置。Ellamaka 集成只用 `$WOPAL_HOME`，**永不使用 `$DSH_HOME`，永不设置 `DSH_HOME` 环境变量**；`~/.dsh` 归 dsh 官方 CLI 专用，Ellamaka 不在其内读写。

```text
$WOPAL_HOME/dsh/
├── closures/                            ← 按内容哈希命名的依赖闭包；只增不减，永不自动删除
│   └── <fingerprint>/                   ← 清单 sha256 摘要前 12 位 hex；同名即同内容
│       ├── package.json
│       ├── package-lock.json
│       ├── runtime-manifest.json
│       └── node_modules/
├── plugins/                             ← 用户插件安装区（见「插件供应链」）；唯一按内容可变的安装区
│   ├── installed.json                   ← 已装插件真相源：包名、版本、启用于哪些 profile
│   └── <pkg>/<version>/                 ← 每插件独立目录，自带传递依赖子树
├── profiles/                            ← 用户可编辑 profile（跨版本保留）
│   ├── web/
│   ├── ellamaka-tools/
│   └── node_modules/                    ← 启动时按 installAnchor 重建的快捷方式（heal 时并入 plugins/ 源）
├── presets/                             ← 生成的空间 × 灵魂 Agent 配置单根（见「预设生成器」；生成物，可随时重建）
├── state/                               ← DSH 运行时数据（含用户自建配置单 `state/.agent-presets/`）
├── staging/                             ← 物化临时区；持锁进程开始时清空，成功后移入 closures/
└── locks/                               ← materialize.lock（物化）与 plugins.lock（供应链）跨进程锁
```

闭包按指纹不可变。新 Ellamaka 版本需要不同的 DSH 依赖树时创建新闭包，不原地修改正在运行的闭包。`profiles/`、`presets/` 与 `state/` 独立于闭包版本，升级时保持用户配置、生成物与运行时数据。

**闭包内容边界**：闭包 = dsh 版本化的官方运行时（引擎、官方工具插件、官方 client UI、官方自带配置单与内置技能）。这些是 dsh 的产品内容，随 dsh 版本演进而非随用户演进；用户的自进化内容（自建配置单、用户技能、已装插件、profile 补丁）全部落在闭包之外的可变区。升级闭包不丢任何用户内容。

#### 运行时清单与版本来源

`packages/ellamaka-cordis/package.json` 的精确 `dependencies` 是 DSH 官方**直接依赖版本**的唯一编辑源。Ellamaka 构建流程从中选取 `@deepseek-ai/*` 依赖生成 `dsh-runtime-manifest.json`。该文件是构建生成物，随 CLI 与 Desktop sidecar 嵌入，不由开发者手工维护：

- 直接依赖名称与精确版本，包括 `@deepseek-ai/dsh`；
- 清单 schema、Bridge ABI 与内容指纹。

清单不携带任何锁快照，也不从构建期锁文件（bun.lock）推导版本或 registry。传递依赖树的解析与锁定发生在**构建期**：构建流程以清单的精确直接依赖版本调用 npm（Arborist）解析出完整传递依赖树，产出一份**内嵌锁**（`dsh-runtime-lock.json`），随 CLI 与 Desktop sidecar 一同嵌入二进制。清单形态：

```json
{
  "schema": "ellamaka.dsh-runtime/v1",
  "bridgeAbi": 1,
  "dependencies": {
    "@deepseek-ai/dsh": "0.1.1-rc.2",
    "@deepseek-ai/cordis": "4.0.2"
  },
  "fingerprint": "sha256:<manifest-digest>"
}
```

**内嵌锁**是构建期由清单解析出的完整传递依赖树快照，记录每个包的名称、精确版本与 `node_modules` 相对路径（含嵌套安装的同名不同版本条目）。它由 `Bun.build` 编译期内联成 JS 常量打进二进制，运行时通过静态 `import` 直接读取内存对象，不读任何磁盘文件。锁与清单指纹绑定：清单直接依赖版本变化必然触发锁重新生成，二者永远同步。

**锁的生成与漂移门禁**：锁是构建生成物，随代码入仓库（`generated/dsh-runtime-lock.json`），不由开发者手工维护。构建门禁比对锁绑定的 `manifestFingerprint` 与当前清单指纹，不一致或缺失时自动重新解析并写回，随代码一同提交；release/CI 构建只做 `--check` 漂移校验，锁过期即拦截构建。开发者升级依赖的唯一流程：改版本 → `bun install` → 构建。

运行时物化器只消费发布物内嵌的清单与内嵌锁，不读取 `latest`，不自行选择兼容版本，也不依赖源码仓库中的 `package.json`。普通配置不提供 DSH 版本覆盖项——Bridge 与 DSH runtime 作为一个经过验证的兼容组合随 Ellamaka 版本发布。未来如需独立升级 DSH，由发布流程交付新的完整运行时清单。

清单指纹覆盖直接依赖精确版本、schema 与 Bridge ABI。目标闭包路径由该指纹确定。同一精确版本清单对应同一指纹；内嵌锁由构建期解析产生，同一发布物在不同机器上物化出相同的闭包。**闭包一旦锁定即不可变**，二次启动零网络命中。换源不改变已锁定闭包。

#### 统一启动语义

`ELLAMAKA_DSH` 是唯一禁用开关，默认启用：

- 未设置或值不等于 `0`：启动 DSH Runtime Manager；
- `ELLAMAKA_DSH=0`：跳过清单检查、网络访问、物化、Bridge 动态加载和容器挂载，回到无 DSH 基线。

所有入口共用 `@wopal/ellamaka-cordis/runtime` 下的 Runtime Manager。

| 用户入口 | 物化责任人 | 成功后的装配 |
|----------|------------|--------------|
| `ellamaka serve` / `ellamaka web` | 当前 Ellamaka 进程 | Web 容器 + 工具容器 |
| `ellamaka` TUI | 当前 Ellamaka 进程 | 工具容器 |
| 浏览器 Workbench | 承载 Workbench 的 serve/web 后端 | Web 容器 + 工具容器；浏览器不执行文件系统物化 |
| Desktop Workbench | Desktop sidecar | Web 容器 + 工具容器；Electron Main/Renderer 不物化 |

Dsh 初始化是启动阶段的一部分，采用**阻塞等待**策略：入口在提供 DSH 能力前等待该阶段完成。等待期间的体验契约：

- **进度**：物化按阶段输出进度（读取内嵌锁 → 下载 → 解压 → 校验 → 激活），日志含阶段名与包数。
- **超时**：物化整个阶段硬超时默认 5 分钟。超时进入 `degraded`，Ellamaka 继续无 DSH 启动，本次不重试。
- **成本分布**：下载只发生在首装与指纹变更两个时刻。常规启动命中已验证闭包时只执行本地快速校验，零网络、零等待。

#### 物化状态机

Runtime Manager 对每次启动执行同一状态机：

1. **Gate**：读取 `ELLAMAKA_DSH`。值为 `0` 时返回 `disabled`。
2. **Resolve**：读取内嵌运行时清单，计算预期指纹与目标闭包目录。
3. **Inspect**：验证目标闭包的 manifest、内嵌锁、关键 anchor 与直接依赖版本。完整时直接进入 Load。
4. **Lock**：缺失或损坏时获取跨进程 `materialize.lock`。等待者在持锁者完成后重新 Inspect。
5. **Stage**：读取内嵌锁；用内置 `pacote` 按锁逐包下载 tarball 并解压到 `staging/`。物化不依赖系统 bun、npm 或用户 shell，也不在运行时解析依赖树。
6. **Verify**：校验内嵌锁的合法 npm v3 形状、`@deepseek-ai/dsh` anchor、每个直接依赖的精确版本，以及 Bridge 所需的官方模块导出。
7. **Activate**：把通过验证的 staging 目录原子重命名为 `closures/<fingerprint>`。未通过验证的 staging 从不参与加载。
8. **Profile**：创建缺失的 profile 模板；已有 profile 与用户补丁保持不变。按本次 installAnchor 重建 `profiles/node_modules` 快捷方式。
9. **Load**：以 installAnchor 动态加载官方运行时，挂载该入口需要的容器，返回 `ready`。

同一进程对初始化 Promise 做单飞复用。同一 `$WOPAL_HOME` 下的多个 Ellamaka 进程通过文件锁协调，只有一个进程下载和安装；其他进程等待并复用已验证闭包。

#### installAnchor 与动态加载

`installAnchor` 是目标闭包内 `@deepseek-ai/dsh/package.json` 的绝对路径：

```text
$WOPAL_HOME/dsh/closures/<fingerprint>/node_modules/@deepseek-ai/dsh/package.json
```

它是**模块解析锚点**，不是下载地址，也不决定版本。版本由「运行时清单与版本来源」的内嵌清单决定。Bridge 以 installAnchor 创建闭包作用域的 resolver，再从同一 `node_modules` 加载 `@deepseek-ai/cordis`、`dsh-app-boot`、`dsh-cmdline`、profile bundles 与其他官方模块。

Bridge 的生产代码不在模块顶层静态导入 `@deepseek-ai/*` 运行时包。类型依赖在构建期保留，运行时值通过 installAnchor resolver 获取。由此保证：

- CLI 与 Desktop 使用同一份磁盘闭包；
- 解析结果不受当前工作目录、workspace、全局 node_modules 或应用 bundle 影响；
- Ellamaka 发布物不重复打包 DSH 官方依赖；
- Bridge 自身始终是已编译 JavaScript。

#### 升级、失败与可观测状态

指纹相同的闭包可无限复用。新 Ellamaka 发布物携带新指纹时物化新闭包，已运行的旧进程继续持有自己的 immutable installAnchor。新闭包验证成功后才参与本次启动；版本不匹配时不回退到旧闭包，以免 Bridge ABI 与 DSH runtime 静默错配。

**闭包生命周期——只增不减**：物化成功后永久保留，无自动回收；磁盘占用 = 本机出现过的版本指纹数（一般 2~3 份），清理方式只有用户手动删除目录。`staging/` 由物化进程自管理：持锁开始即清空残留；成功后原子 `rename` 移入 `closures/`；失败时保留现场供诊断。如需便利清理，以显式命令交付（如 `ellamaka dsh cleanup --dry-run`），不属于启动行为。

运行状态统一为：

| 状态 | 含义 |
|------|------|
| `disabled` | 用户以 `ELLAMAKA_DSH=0` 明确禁用 |
| `preparing` | 正在校验、等待锁或物化 |
| `ready` | 目标闭包通过验证且容器已挂载 |
| `degraded` | 本次启动物化、校验、加载或挂载失败，Ellamaka 无 DSH 继续运行 |

每次进程启动最多自动物化一次。网络不可达、超时、磁盘不足、integrity 不匹配、锁异常和 Bridge 加载失败均进入 `degraded`，保留可诊断错误并在下次启动重试。失败的 staging 不会覆盖可用闭包。已有正确闭包时启动不需要网络。

**下载与缓存**：

- 物化器用 `pacote` 按内嵌锁逐包下载 tarball 并解压（有界并发 + 进度日志）。`pacote` 不做依赖树求解（树已在构建期解析并内嵌），在 SEA 单文件二进制内稳定可用。**官方闭包的树解析只存在于构建期源码环境**：Arborist 的树求解在 `bun --compile` 单文件二进制内会陷入忙循环（见「已验证事实 · 插件供应链实测事实」）；用户插件的传递树解析走「插件供应链」的最小解析器，不受此约束影响。
- registry 是**传输通道，不是版本真相源**：物化器对一组候选 registry 做并发测速，选取本次启动最快可达的一个作为下载源；全部不可达时兜底官方 npm。换源不改变已锁定闭包。

#### 运行时数据隔离

Dsh 引擎的运行时数据（settings、credentials、匿名用户 ID、sessions、storages、home patch）统一落在 `$WOPAL_HOME/dsh/state`。隔离采用**纯配置注入，零环境变量**：

| 机制 | 说明 | 隔离方式 |
|------|------|---------|
| `ctx` 注入的 `dshHomePath` | profile 配置 `!!js dshHomePath(...)` 表达式经 `with(ctx){eval}` 求值，覆盖 storages/sessions | 装配时 `ctx.provide("dshHomePath", (...s) => join(stateDir, ...s))` |
| 插件直接 `import { resolveDshHome }` | settings/credentials/agent-instructions/shell-env/skill-fs/attachment 等读 `config.dshHome` | 在 profile patch 层给各插件传 `dshHome: $WOPAL_HOME/dsh/state` |
| 无配置注入的例外 | `llm-deepseek` 上传索引、`anonymous-user-id` | 使用插件显式路径配置；未提供隔离入口的功能保持禁用 |

两种机制最终都落在 `$WOPAL_HOME/dsh/state`，不依赖 `DSH_HOME`。官方 dsh CLI 无论同进程还是独立进程，都感知不到 Ellamaka 的运行时数据。

### Profile 机制

每个 profile 目录含：

| 文件 | 作用 |
|------|------|
| `package.json` | 声明 `dsh.profile.bundles` 有序 bundle 列表（仅官方 bundle；插件层由 Plugin Manager 依 installed.json 组合，见「插件供应链 · add 流水线」实现决策 D-04） |
| `cordis.yml` | 插件行清单 |
| `cordis.patch.yml` | 用户补丁层，按 entry id 覆盖/禁用，应用于所有 bundle 层之后 |

- `web` profile：bundles `dsh-base + dsh-web-app`，完整 UI。
- `ellamaka-tools` profile：bundles `dsh-base`，补丁层禁用 agent-loop 专属插件（禁用清单见「能力采用 · 工具容器装配」）。
- `initProfile` 只创建缺失文件不覆盖；ellamaka 只在补丁层仍是空模板时播种默认禁用条目，用户编辑永不覆盖。
- `profiles/node_modules` 是快捷方式目录：`healProfilesModuleFallback` 每次挂载时从 installAnchor 遍历依赖清单，为每个包建 symlink，使 profile 插件行在 Loader 解析时找到宿主已安装的包。它不是独立安装，指向哪份安装取决于 installAnchor。

---

## 能力采用

ellamaka 通过工具容器采用 dsh 的工具能力。采用原则：**每个能力逐项评估，采用成本超过独立实现成本时保留 ellamaka 原生能力**。dsh 是能力来源，不是必须迁入的运行时归宿。

### 采用边界

| 能力形态 | 采用方式 |
|----------|----------|
| 输入输出与生命周期可由 dsh 通用工具契约表达 | 经 dsh-adapter 投影进 ellamaka ToolRegistry |
| 只需少量调用上下文 | adapter 按需传入最小 per-call context，缺省字段省略 |
| 依赖 dsh 沙箱底座 | 在工具容器内装配沙箱后端，工具在沙箱内运行 |
| 依赖 dsh 自身的 session / agent loop / 事件日志 / 子会话语义 | 不采用该包，按 ellamaka 数据模型复刻所需机制 |
| 依赖 ellamaka Hook / Session / Permission / UI | 由 ellamaka 原生插件负责 |

**已采用能力**：

| 能力 | 工具 | 后端 | 沙箱 |
|------|------|------|------|
| 文件搜索 | `grep` / `glob` | `fs-search` | 无（纯读取） |
| 文件操作 | `read` / `write` / `edit` | `tool-fs` | `fs-sandbox` |
| 字符串替换编辑 | `str_replace_editor` | `tool-str-replace-editor` | `fs-sandbox` |
| 命令执行 | `bash` | `tool-bash` | `bash-sandbox` |

**保留 ellamaka 原生实现**：`edit`、`read`/`write`、`wopal_task_*`（现有语义或宿主集成更重要）。

**需原生复刻（深耦合，不采用）**：session-query、schedule、subagent 等引擎能力包（见「已验证事实 · 深耦合能力不可采用」）。

### 工具容器装配

工具容器装配 `fs-sandbox` / `bash-sandbox` 沙箱后端，使 `ctx.fs.sandboxMode` / `ctx.shell.sandboxMode` 有值，`sandboxPolicy.resolve()` 参与执行链。容器内不创建任何 dsh session。

补丁层禁用 agent-loop 基础设施（session、agent-loop、llm、subagent、jobs、goal、plan-mode、compaction、web 等约 57 行，按依赖分组附理由），只保留工具注册表与执行链（tools、system-prompt、subprocess、fs、sandbox、spill、tool-fs、tool-fs-search 等）。

**两个已确认的容器语义**：

1. **工具容器不做请求边界持久化**：`session-checkpoint-policy` 插件监听 `tools/execute`，对 live session 执行账本 flush。adapter 不传 live agent 时它短路放行。工具容器在 profile 层禁用该插件——不创建、不持有任何 session，账本持久化缺失不产生功能影响（见「已验证事实 · 工具容器不持久化的成立条件」）。
2. **后台任务能力禁用**：`jobs` 未装配，工具容器隐藏 `run_in_background`，schema 隐藏该字段，强制传入时由 dsh 拒绝。

### 工具投影（dsh-adapter）

dsh-adapter（`.wopal/plugins/dsh-adapter`）把工具容器中的工具投影进 ellamaka ToolRegistry：

- **映射白名单**：配置 `tools: [{source, target, enable}]`。同名 target 覆盖 ellamaka 内置工具；容器缺失时 adapter 挂 0 个工具，内置工具原样可用。
- **schema 投影**：把 dsh 的 JSON Schema 解包为 ellamaka 插件 SDK 的 ZodRawShape；不支持的类型降级 `z.unknown()`，dsh schema 扩展不破坏投影。
- **参数映射**：dsh 蛇形参数（`file_path`）重命名为 ellamaka 驼峰（`filePath`），投影时重命名、execute 时转回。
- **结果映射**：dsh 的 `meta.diffs` 映射为 ellamaka 的 `filediff`（`file`/`patch`/`additions`/`deletions`），hunk diff 算法在 adapter 内自持，不 import dsh 包。前端零改动。
- **调用日志**：adapter 经容器 logger 记录每次调用（成功/失败，携带 tool/sessionID/callID），落入 `dsh-plugins.log`。
- **权限门禁复用**：adapter 在执行前复用 ellamaka 的 read/edit 与 external_directory 权限门禁。

**动态装配**：adapter 注册 `"tool.provider"`，每次调用实时读 `container.get("tools").schemas()`，不再启动时冻结。dsh 插件动态加载/卸载 → 工具增删 → 下一轮模型请求自动看到新集合；同名 dsh 工具卸载后内置工具自动恢复。工具集合真变化时缓存失效是预期行为；未变化时通过确定性投影 + 名字排序保证字节一致、缓存命中。

### 沙箱语义

工具调用经 adapter 投影时，按 ellamaka session 复用最小 facade：`session.header.cwd`（spawn 工作目录）、`session.header.id`（归属标签）、`session.events`（沙箱模式折叠）。其他一切省略。

沙箱模式在运行时决议（见「配置与隔离 · 沙箱配置」）：

- **启用沙箱**：注入 `sandbox/mode` 事件，`mode` 在 `read-only` 与 `workspace-write` 间选择。
- **关闭沙箱**：注入 `danger-full-access`，工具在容器默认后端下运行。**不切换本地 fs/bash 后端**——工具始终走同一容器与已装配的沙箱后端，关沙箱只是放开有效模式。

`danger-full-access` 保留为 dsh 内部一次性 escalation 目标，不作为空间级配置值暴露。

### escalation 审批桥接与沙箱三态切换

沙箱拒绝后，dsh 模型可回填 `sandbox_permissions` + `justification` 申请一次性更宽模式。该申请经 dsh 原生 approval 服务审批——工具容器**原生启用** `approval` 插件，由 adapter 补齐其运行时前置条件，审批决策经桥显示在 Workbench 权限卡片。

**adapter session 门面扩展**（「工具投影」facade 的增量）：

| 扩展 | 语义 |
|------|------|
| `append(type, data)` | 往自持 events 数组 push，approval 审计对（`approval/asked` + `approval/decided`）落内存不落盘 |
| turn 包裹 | 每次 `tools.execute()` 外层 `turn/start` → 执行 → `turn/end`（引用计数，finally 保证闭合，并发/嵌套仅最外层闭合） |

两者合起来满足 approval 插件的 `hasOpenTurn` 前置条件。工具容器仍不创建持久会话（「已验证事实 · 工具容器不持久化的成立条件」语义 1 不变）。

**approval answerer 桥**：adapter 在容器 ctx 上注册 `approval/request` waterfall listener，按 `req.agent.session.header.id`（= ellamaka sessionID）从 `askRegistry` 取执行时注册的 ask 闭包，构造 `sandbox_escalation` permission ask（patterns = 目标模式，从 escalation reason 解析；metadata 携带 toolName/callID/justification）。决策映射：

| 用户决策 | dsh outcome |
|---------|------------|
| once | `allowed-once`（dsh 原生 one-shot，仅本次调用以更宽模式执行） |
| always | ellamaka Permission 规则池承接（会话内同 pattern 免再问），dsh 侧返回 `allowed-once` |
| reject | `rejected` |
| 无 ask 闭包（TUI 等无 UI 入口） | `next()` 委托 waterfall 兜底 `unavailable`（fail-closed） |
| abort | dsh 原生 `cancelled`（ApprovalService 与请求信号 race） |

**escalation 策略**：`ellamaka.dsh.sandbox.escalation: "ask" | "never"`（默认 `ask`）。`never` 时 adapter 向每个 facade seed `approval/policy` session 事件（dsh 原生 fold 语义，LAST 优先），approval 服务在 waterfall 之前确定性拒绝，answerer 零调用。沙箱关闭（full-access）时 escalation 字段不广告，无需处理。

**沙箱三态切换（per-session）**：Workbench chat composer 底栏 `ComposerSandboxControl` 下拉（只读 / 工作区写入 / 完全访问），选择按会话存浏览器 storage（workspace 存储，按 sessionID 分桶），不改写任何 settings 文件。选择随消息携带：提交时经 `FollowupDraft.sandboxMode` 进入 prompt payload，`UserMessage.sandboxMode` 持久化（fork/queue 继承），`SessionTools.resolve` 透传进 `Tool.Context.extra`；adapter 在每次 `tools.execute()` 读取 `extra.sandboxMode`，有值即 append `sandbox/mode` 事件（LAST-wins，立即生效）。无选择回落空间默认（「配置与隔离 · 沙箱配置」）。`full-access` 映射事件值 `danger-full-access`（见「沙箱语义」）。显示条件：dock composer 且空间配置含 dsh-adapter 插件。不使用 dsh permission-presets。

**fold 不变量**：显式选择必须总是追加事件，即使该值等于空间默认。事件日志按 LAST-wins 折叠，"恢复默认"只能靠显式写入默认值；把"等于默认"优化成"不追加"会让会话滞留在上一次的 override 上。`extra.sandboxMode` 缺失才是"沿用当前折叠值"的唯一信号。

---

## 配置与隔离

### 进程级共享、空间级隔离

**容器装配是进程级共享能力池**：serve/TUI/desktop 各挂一个工具容器，进程内所有空间共用。容器载入完整工具链，禁用清单只管 agent-loop 基础设施，不管工具。装配一次，所有空间共用。

**工具投影是空间级隔离点**：每个空间的 `.wopal/config/settings.jsonc` 声明自己的 adapter 映射白名单与沙箱策略。adapter 按空间加载，各带各的配置——空间 A 开 grep+glob，空间 B 开 grep+glob+bash，互不影响；未开映射的空间用 ellamaka 内置工具。

**配置层级走 ellamaka 原生合并**：用户级 → 空间级 → 空间本地，逐层覆盖。

### 沙箱配置

空间级 `.wopal/config/settings.jsonc`（+ `settings.local.jsonc`）拥有工具容器的沙箱策略，配置形态为 `ellamaka.dsh.sandbox: { enabled, mode }`：

| 配置 | 含义 |
|------|------|
| `enabled: true` | 启用沙箱，`mode` 在 `read-only` 与 `workspace-write` 间选择 |
| `enabled: false` / 缺失 | 关闭沙箱，注入 `danger-full-access` |

进程级默认值只在尚未解析空间配置时兜底。**不用 `DSH_PERMISSION_MODE` 环境变量**——沙箱策略由空间配置拥有。

### 沙箱平台支持

dsh 沙箱后端 `@deepseek-ai/dsh-sandbox-local` 三平台支持（已实测 macOS）：

| 平台 | 机制 | 依赖 | 强制完整度 |
|------|------|------|-----------|
| macOS | Seatbelt（`sandbox-exec`，系统自带） | 无 | full |
| Linux | bwrap（bubblewrap）优先，回退 Landlock | bwrap 需安装 | full（老内核自报 partial） |
| Windows | ACL restricted-token runner | 自带 runner | partial（两个已知缺口） |

探测失败即拒绝执行（`SANDBOX_UNAVAILABLE`），不裸奔。

---

## 已验证事实

> 本节事实经源码实证或实测固化，是设计决策的依据。表述为结论，不展开推导。

### 深耦合能力不可采用

session-query / schedule / subagent / system prompt 注入等能力依赖 dsh 的引擎层语义（事件日志语料重放、agent.send 唤醒通道、子会话模型）。契约桥只能翻译接口层形状，翻译不了引擎层语义。这些能力的获取路径是**原生复刻**（机制设计可剥离，包与数据模型不可复用）。

**重要区分**：上述"深耦合"指引擎能力包。工具插件（tool-fs、tool-bash、tool-fs-search 等）**不在深耦合之列**——它们是叶子工具，只消费 session 的浅层形状，不依赖 agent-loop 语义。

### 工具消费面

对工具容器采用的全部能力做源码级盘点。结论：**工具插件的 session/agent 依赖是浅层的，无一个需要深 agent-loop**。分三类：

| 类别 | 特征 | 工具 |
|------|------|------|
| **A 纯形状** | 只读 `header.cwd` / `header.id` 标量 | `tool-fs-search`、`spill-policy` |
| **B 语义事件** | 折叠 `session.events` 读 `sandbox/mode` 覆盖 | `tool-fs`、`tool-str-replace-editor`、`tool-bash` |
| **C 语义写** | 写持久事件或依赖瀑布 | `tool-fs`、`tool-str-replace-editor`（emit `fs/observed`）、`fs-observation-policy` |

**两个关键纠正**：

1. `session.events` 缺失不会 TypeError：真 dsh Session 的 events 恒为数组。adapter 喂 `events: []` 是防御性而非必须。
2. `session.id` 不是临时目录隔离键：隔离键是 `header.cwd`，`id` 只喂 spill/日志，缺了无害。

### 服务依赖

| 服务 | 真必需 | 仅可选检查 |
|------|--------|-----------|
| `tools` | 全部工具 | — |
| `fs` | tool-fs、str-replace-editor | — |
| `shell` | tool-bash | — |
| `shellEnv` | **tool-bash 唯一硬依赖** | — |
| `systemPrompt` | tool-fs、tool-fs-search、tool-bash | sandbox-policy |
| `subprocess` | tool-fs-search | — |
| `sandboxPolicy` | 工具在沙箱内运行的决议组件 | — |
| `approval` | 无任何工具无条件需要 | tool-fs、tool-bash |
| `jobs` | 无（仅 run_in_background 启用时） | tool-bash |
| `spillStore` | 无（处处 ctx.get 降级） | tool-fs-search、spill-policy |

**最小可行 session 形状** = `header.cwd` + `header.id` + `events: []`。`approval`/`jobs`/`spillStore` 均非硬依赖。

### 工具容器不持久化的成立条件

`session-checkpoint-policy` 监听 `tools/execute`，对 `exec.agent.session` 执行账本 flush（"执行副作用前账本已持久化"）。adapter 不传 agent 时它短路放行；传入轻量 agent 时抛 `session not live`。因此工具容器在 profile 层禁用该插件。

**推论**：工具容器不做请求边界持久化，但也不创建、不持有任何 session，账本持久化的缺失不产生功能影响。Web 容器保持完整 profile，checkpoint 与 UI 模式照常。

### 桥接 API 规范

从 async 侧（Cordis 服务）调回 Effect 世界的桥接遵守以下形态（已实测固化）：

1. **持有 work Fiber 必须 `Effect.forkIn(scope)(work)`**：在 `Effect.scoped` 内取 scope，`forkIn(scope)` 直接返回持有的 work fiber。禁止 `ManagedRuntime.runFork(work).pipe(Effect.forkIn(scope))`。中断经 `runtime.runFork(Fiber.interrupt(fiber))`。禁止 `runPromise` 驱动长任务。
2. **顶层 Effect.runFork/runPromise/runCallback 在运行时未导出**——一律经 `ManagedRuntime` 实例方法调用。
3. **`Effect.scope` 须在 `Effect.scoped` 内获取**，否则以空 defect Die。
4. **ALS 上下文**：effect 体内发起的桥接调用沿传播链天然继承 Instance ALS；纯 async 侧发起的轮次须捕获-恢复 ALS。
5. **取消语义**：interrupt 后 finalizer 按子先父后顺序确定性执行，`forkIn(scope)` 的并发子任务级联清理。Cordis 入口只启动不拥有中断权。

### 插件供应链实测事实（2026-09-02，真实官方包）

对真实 `@deepseek-ai/*` 包（cordis 4.0.2、cordis-plugin-loader 1.0.3、dsh-app-boot 0.1.1-rc.2）验证，实验记录 `.wopal-space/.tmp/dsh-plugin-spike/SPIKE-REPORT.md`：

1. **运行中容器热挂载成立**：`loader.create({ name, config })` 向已启动容器挂载插件，服务立即可读；`loader.remove(id)` 卸载，effects 干净反解；root include 的 `entry.update()` 事务性插拔（按 entry id diff，自动 mount/unmount）同样成立。**无需重启容器，无需 patch 官方 Loader**。
2. **编译二进制内运行时依赖解析成立**：约 150 行 BFS 解析器（abridged packument + semver range + hoist 去重）在源码（991ms）与 `bun --compile` 二进制（1065ms）内均正确解析传递树，无忙循环。Arborist 忙循环约束只针对官方闭包的大树求解，不阻塞用户插件的小树解析。
3. **实现契约**：include `entry.update()` 是浅合并——更新 patches 必须先展开旧 config（否则 `path` 字段丢失报 `extension "" not supported`）；裸包名解析经 `loader.internal.import` 缝隙 + `profiles/node_modules` symlink parent-walk（`add` 后必须重跑 heal）；`mountRootInclude` 由 `dsh-app-boot` 导出；root config 扩展名仅 `.json/.yaml/.yml`。

### 生成 SDK 的双文件一致性

hey-api 生成的客户端由两个文件共同决定一个字段的线上行为：`types.gen.ts`（类型层）与 `sdk.gen.ts`（运行时 `buildClientParams` 映射层）。**类型存在 ≠ 运行时发送**：HttpApi 新增 payload 字段后若只再生成类型（或生成中断留下半新状态），`sdk.gen.ts` 映射缺键会让客户端在编码时静默丢弃该字段——无报错、无日志。验收方式：对新增字段 grep 两个文件都要命中；或跑 `bun script/build.ts` 全量再生成并 diff。

### 权限规则的合并顺序语义

Permission 评估为 LAST-wins（`findLast`），规则表顺序 = frontmatter 键声明序经合并后的位置。同一名 agent 的配置可来自多副本（`~/.wopal` home + 空间 `.wopal`），经 `mergeDeep` 按插入序合并：后加载副本的键保留其声明位置，显式 `x: ask` 可能被先声明但在合并序中靠后的 `"*": allow` 通配压过，静默放行。**不变量**：需要收窄通配的显式规则，必须保证其在合并后的最终规则表中位于通配之后；最稳妥的写法是 frontmatter 不声明通配（引擎 defaults 已提供 `"*": allow` 兜底），只写显式例外。验收方式：`GET /agent` 查看活实例合并后的规则表，确认显式规则位于相关通配之后。

### Agent 配置体系机制事实（2026-09-03，闭包源码实证）

1. **配置单（agent preset）= 一个会话主 Agent 的装配清单**：一个目录含 `agent.cordis.yml`（插件行清单）与可选 `preset.yml`（展示元数据）。会话按所选配置单装配工具、人格、技能与行为配置。
2. **双根发现与优先序**：官方根（闭包内 `dsh/config/agent-presets/`，trust=system）+ 用户根（`$WOPAL_HOME/dsh/state/.agent-presets/`，trust=user，首次写入时创建）。roots 数组按优先序去重，**earlier root 赢得重复 id**；用户根恒排最后，因此用户根的同 id 目录被官方静默遮蔽（不报错、不生效）。
3. **Bridge 装配点**：`mountDshWeb` 以 agent-presets extraPatch 注入 `default: "standard"` 与官方根；roots 是宿主可配数组，追加自定义 system 根是一行配置。
4. **配置单服务能力完整**：`agentPresets` 服务提供 `list/resolve/mount/read/copy/remove/composeFrom/recompose/standingKeyFor`；`copy(from, id, name)` 是官方钦定的 authoring 路径（校验 id 形状、拒绝覆盖、失败回滚）。
5. **工具可见性的引擎级开关**：`tools.restrict({ allow?, deny? })` 按**Agent 作用域**收窄武器——命中名单的工具从该 Agent 的模型视野中完全移除（schema 不下发，token 一并消失）；引擎强制拒绝无作用域的全局限制（"a context-global restriction would mask every agent"）。配置单挂载层即 Agent 作用域，preset 行插件调用 restrict 天然 per-Agent 生效。
6. **子代理继承配置单**：子代理创建时经 `composeFrom` 加入父会话的配置单（读父的 live scope 而非 header）；`SpawnTeammateRequest`（name/description/prompt/context: fresh|fork/provider/signal）**不含 preset 字段**——队员装备跟随队长，角色差异由任务书与目录规则表达。
7. **官方配置单在闭包内不可变**：闭包指纹锁定（见「DSH home 与运行时隔离」），定制官方配置单的唯一正路是 copy 到用户根改副本。

---

## 设计约束

> 以下约束定义生产边界。实现可以调整内部结构，但依赖方向、发布边界、版本确定性、启动语义与数据隔离的变化必须先更新本设计并重新确认。约束按编号列表组织，交叉引用使用「设计约束 · <标题>」。

1. **cordis import 边界**：`@deepseek-ai/cordis` 的类型与运行时适配只出现在 `@wopal/ellamaka-cordis` 包内。生产运行时值经 installAnchor resolver 从物化闭包获取。
2. **DSH 依赖真相源**：`ellamaka-cordis` 的 `dependencies` 只显式声明 Bridge 使用的官方直接依赖，并使用精确版本。构建生成的 `dsh-runtime-manifest.json` 携带直接依赖精确版本，`dsh-runtime-lock.json` 携带完整传递依赖树与 integrity；运行时不维护第二份手工清单，也不在运行时解析依赖树。
3. **dsh 深耦合包暂缓使用**：agent-loop/session/session-query/compaction/subagent/schedule 及任何 rt-import dsh-session 的包，暂不被主线代码 import、不在运行时加载、不作为插件挂载。required peer 进入 node_modules/bun.lock 仅供类型解析。运行时加载探针（`forbidden-load.test.ts`）作为当前状态的观测手段保留。
4. **session 所有权**：持久化与事件定义归 Storage/Bus/EventV2；Cordis 层只持有 facade。
5. **对外契约稳定**：SSE 事件、HttpApi、SDK 在融合中保持稳定。
6. **桥接的加法原则**：桥接优先为新增文件/包装层，保持删除桥即回滚的能力。
7. **wopal-plugin 原生边界**：wopal-plugin 继续作为 ellamaka 原生插件运行。只采用独立 dsh 能力，不拆分或迁移 wopal-plugin。
8. **工具容器边界**：工具调用走专用工具容器（ellamaka-tools profile），容器内不创建任何 dsh session；adapter 只传递工具实测消费的最小 per-call context。web 容器保持完整 profile，不复用为工具后端。禁用清单是 profile 的用户补丁层，ellamaka 仅在模板为空时播种、不覆盖用户编辑。
9. **空间隔离**：容器装配是进程级共享能力池，空间差异在投影层解决。
10. **DSH home 唯一**：依赖闭包、profile 定义与运行时数据只物化在 `$WOPAL_HOME/dsh`；ellamaka 集成永远只用 `$WOPAL_HOME`，不用 `$DSH_HOME`，**永不设置 `DSH_HOME` env**。`~/.dsh` 归 dsh 官方 CLI 专用，ellamaka 不在其内创建、修改或删除任何内容。
11. **启用开关统一**：`ELLAMAKA_DSH` 是禁用开关，默认开启。serve、web、TUI 与 Desktop sidecar 统一以 `ELLAMAKA_DSH=0` 禁用，未设置或 `!=0` 启用。无其他分支启用方式。
12. **运行时隔离**：dsh 运行时数据经纯配置注入落 `$WOPAL_HOME/dsh/state`，与闭包/profiles 分目录，与官方 `~/.dsh` 完全隔离。隔离不依赖 `DSH_HOME` env。
13. **交付边界**：Ellamaka 发布物携带编译后的 Bridge；`@deepseek-ai/*` 官方运行时只存在于指纹闭包。Bridge 不发布为独立 registry 包，也不进入闭包 manifest。
14. **版本绑定**：DSH 运行时清单与 Ellamaka 发布版本绑定。普通配置不覆盖 DSH 版本；独立升级通过发布经过验证的完整清单完成。
15. **统一自物化**：Runtime Manager 是所有入口的唯一物化实现。闭包缺失或损坏会触发自动物化，不等价于用户禁用，也不要求用户运行脚本修复。
16. **不可变闭包**：每份完整依赖树按清单指纹落入独立 generation。升级创建新 generation，运行进程持续使用启动时捕获的 installAnchor。
17. **插件安装共享、启用按 profile**：安装区（`plugins/`）进程内唯一，安装/升级/卸载全局一次；激活经 profile bundles 清单按容器声明。同一进程内不做同包双版本 skew。
18. **插件安装零外部工具链**：安装器不 forward 系统包管理器（pnpm/npm），复用 Runtime Manager 的 pacote + registry 测速基建；用户插件的传递树由内置最小解析器在运行时解析（见「已验证事实 · 插件供应链实测事实」）。
19. **安装命令式、配置双轨**：插件安装与 dsh 界面侧的插件配置走命令式并即时生效；集成到 ellamaka 的工具投影配置走 settings.jsonc（与「配置与隔离 · 进程级共享、空间级隔离」一致）。
20. **approval 原生边界**：dsh approval 插件以官方原版使用（不 fork、不修改官方闭包）。宿主侧只补齐 session facade 前置条件并经 answerer 桥接决策；审批审计对落内存不落盘，工具容器不持久化任何会话。
21. **Bun 宿主兼容性门禁**：发布态 `ellamaka serve` 是单 Bun 进程；用户插件不得要求 Node 私有模块加载器或 `--expose-internals`。`plugin add` 必须在写入 installed.json 和触碰运行中容器前完成静态依赖扫描与 Bun 隔离挂载预检；不兼容插件拒绝安装并给出可操作诊断，绝不以伪造 `loader.internal`、切换到 Node 或降级整台宿主来绕过。官方 Node 专用 `cordis-plugin-hmr` 是宿主实现例外：Bun 路径以 Bridge 的 Bun HMR 适配器替代它，不把该例外转嫁给第三方插件。

---

## 生产物化验收基线

> 已于 2026-09-01（P5 批次）全部达成，进入维护态。

| # | 能力 | 验收结果 |
|---|------|----------|
| 1 | 发布边界 | CLI 与 Desktop sidecar 包含已编译 Bridge；发布物不包含 DSH 官方包源码；闭包 manifest 不包含 `@wopal/ellamaka-cordis` 或 `file:` 依赖 |
| 2 | 清单生成 | 构建从 `ellamaka-cordis/package.json` 生成 `dsh-runtime-manifest.json`，并解析出内嵌锁 `dsh-runtime-lock.json`；CI 检测源、清单与锁的漂移 |
| 3 | 版本确定性 | 同一 Ellamaka 发布物在不同机器上使用相同直接版本、传递锁树与 integrity；运行时从不查询 `latest`，也不在运行时解析依赖树 |
| 4 | 入口一致性 | serve、web、TUI 与 Desktop sidecar 默认自动物化；Workbench 由承载它的后端完成物化；`ELLAMAKA_DSH=0` 是唯一跳过路径 |
| 5 | 单一实现 | 所有入口调用同一个 Runtime Manager；不存在 Desktop 复制版物化器或需要用户运行的物化脚本 |
| 6 | 并发与原子性 | 多进程共享 `$WOPAL_HOME` 时只执行一次下载；未验证 staging 不参与加载；升级不改写运行中的闭包；闭包只增不减、无自动删除 |
| 7 | 动态加载 | Bridge 仅从 installAnchor 对应闭包加载官方运行时；应用 bundle、cwd、workspace 和全局 node_modules 不影响解析 |
| 8 | 失败语义 | 首次安装、升级、离线、超时、integrity 失败与损坏闭包均产生确定的状态和诊断；Ellamaka 能以无 DSH 模式继续运行 |
| 9 | 隔离 | 依赖闭包、profiles 与 state 各归其位；Ellamaka 不读写 `~/.dsh`，不设置或消费 `DSH_HOME` |
| 10 | PoC 机制退出 | 生产链路不再使用 TS strip-types、`.js → .ts` loader、`resources/dsh-materialize/cordis` 源码副本及手工版本常量 |

---

## 插件供应链

> 核心供应链已于 2026-09-02 达成（验收基线 + 用户实机验证），进入维护态；「Bun 宿主兼容性预检」是新增的发布前门禁，待实施后才可宣称 Bun 路径的第三方插件兼容性闭环完成。

### 定位与原则

dsh 插件是 ellamaka 的一等公民：**命令式安装、即时生效、跨重启保留**。动态生效（装完即用）是 ellamaka 插件（重启生效）不具备的差异化能力。

三条原则：

1. **安装共享、启用按 profile**（「设计约束 · 插件安装共享、启用按 profile」）：web 与 tools 两容器同进程同闭包，安装动作全局一次；激活按容器声明。
2. **闭包分层**：官方闭包保持不可变（见「DSH home 与运行时隔离」）；用户插件装到独立的可变安装区。官方闭包是"产品发布时刻的依赖快照"，不承担插件生态容器职责。
3. **零外部工具链**（「设计约束 · 插件安装零外部工具链」）：不依赖系统 pnpm/npm。

### 安装区布局

```text
$WOPAL_HOME/dsh/plugins/
├── installed.json               ← 真相源
│                                  [{ name, version, source, enabledIn: ["web","ellamaka-tools"], installedAt }]
└── <pkg>/<version>/             ← 每插件独立目录（原地升级替换，不做指纹代数）
    ├── package.json
    └── node_modules/            ← 该插件的传递依赖子树（含嵌套同名不同版本）
```

- **官方包不重装**：插件依赖 `@deepseek-ai/*` 时经 `profiles/node_modules` symlink 解析到闭包（heal 机制），与官方运行时版本天然一致，无 skew。
- **可变目录语义**：命令式操作配可变目录，升级=替换目录+更新 installed.json；与闭包"只增不减"的 immutable 语义解耦。
- **installed.json 是唯一真相源**：插件层由 Bridge 在 boot/热更时从 store 组合，`profiles/*/package.json` 保持 initProfile 原状（仅官方 bundle）。补丁层 `cordis.patch.yml` 保留为用户逃生口（见「插件供应链 · 配置与信任」）。

### 命令面

```sh
ellamaka dsh plugin add <pkg>[@version] [--profile web,tools]   # 缺省启用两个 profile
ellamaka dsh plugin add --dir <path> [--profile ...]            # 本地目录安装（开发迭代通道）
ellamaka dsh plugin remove <pkg>
ellamaka dsh plugin enable <pkg> --profile <name> | disable <pkg> [--profile <name>]
ellamaka dsh plugin list [--json]
```

所有命令经由 Bridge 的闭包解析与容器更新缝隙驱动运行中容器，**不需要 dsh 官方 CLI 在场**；Bun 路径不得以伪造 Node `internal` loader 作为该解析机制。

### add 流水线

```text
解析 spec → BFS 解析传递树（abridged packument + semver + hoist，见「已验证事实 · 插件供应链实测事实」）
        → pacote 按解析树逐包下载解压到 plugins/<pkg>/<version>/（复用物化器基建 + registry 测速）
        → 校验入口：package.json 声明 dsh.bundle.patch（bundle）或纯库依赖（警告安装）
        → Bun 宿主兼容性预检（静态依赖扫描 + 隔离挂载）
        → 写 installed.json → 重跑 symlink heal → 更新 profiles bundles 清单
        → 运行中容器热挂载（loader.create / include update）
        → adapter 侧 tool.provider hook 下一轮自动可见
```

- **热挂载按容器分别执行**：对 tools 容器直接 `loader.create`；对 web 容器经 include patch 同步（浅合并契约）。启动中的容器（preparing 状态）跳过热挂载，待 Load 阶段由清单自然生效。
- **失败语义**：解析或下载失败 → 不写 installed.json、不触碰容器，命令返回非零并保留诊断；半安装状态只存在于 staging 临时目录，不参与解析。卸载 = `loader.remove` + include 反向 patch + 删除目录 + 更新清单，effects 自动反解。
- **并发**：与物化共用 `locks/` 目录的跨进程文件锁（`plugins.lock`），多进程同时 add 串行化；同进程经 Plugin Manager 单飞。

### Bun 宿主兼容性预检

发布态的 `ellamaka serve` 不因安装一个 dsh 插件而改变运行时。插件的目标宿主固定为 Bun；Node 是开发/构建工具和 Desktop 既有环境，不是 CLI serve 的运行时逃生通道。

预检在插件已下载到 staging、但尚未写入 `installed.json` 前执行，分两层：

1. **静态拒绝**：扫描插件入口及已解析传递依赖树的静态 `import`/`require`，拒绝 Node 私有加载器依赖，包括 `internal/*`、`node:internal/*`、`node-addon-require-builtin`，以及要求/探测 `--expose-internals` 的已知调用形态。诊断必须列出插件包、命中文件、specifier 或特征和依赖链。
2. **隔离挂载**：静态扫描无命中不等于兼容。Bridge 在不接入 Web/工具正式容器、也不写 store 的候选 Cordis context 中，以 Bun resolver 加载并激活插件 entry；任何模块解析或激活失败都视为不兼容。候选 context 的 dispose 必须完成后才可写 store 或热挂载。

静态扫描的职责是尽早解释确定的 Node 私有 loader 依赖，不把它伪装成安全审计；动态 `import`、`eval`、生成代码或压缩后的间接访问由隔离挂载兜底。公共 `node:` API 不因名字被一律拒绝：只有在 Bun 解析或激活实际失败时才返回通用运行时不兼容，避免把 Bun 已支持的 Node API 误判为不可用。

拒绝语义固定为：不写 `installed.json`、不更新 profile links、不触碰运行中容器、不留下可解析的半安装目录；CLI 返回稳定错误码 `DshPluginBunIncompatible`，并说明“此插件要求当前发布态 Bun 宿主不提供的 Node 私有 loader 或运行时能力”。已运行的同名旧版本继续服务。

这条门禁只限制服务端宿主插件。`dsh-client` 浏览器 bundle、插件的常规 dsh 服务/API 与动态安装、启用、禁用、卸载语义不受影响；Bun HMR 适配器负责服务端的配置和模块 generation 更新，`dsh-client-hmr` 继续负责浏览器端重载。

**实现决策**（代码注释按编号引用这些决策，编号属实现层锚点，非章节号）：

- **D-01**：容器完整补丁栈 = bundle layers → store 组合的插件层 → 用户补丁层，逐层覆盖。
- **D-02**：热挂载触发 = server 进程 watch `installed.json`（约 2s 轮询 store 哈希）；CLI 命令是纯磁盘操作、永不直接触碰容器；store 原子写（tmp+rename）保证 watcher 只见一致状态。
- **D-03**：include `entry.update()` 重放契约——按 entry id diff 事务性插拔，浅合并（更新 patches 先展开旧 config）。
- **D-04**：store 是唯一组合源，profiles 不写插件 bundles 清单。
- **D-05**：供应链 heal——`profiles/node_modules` 为每个已装用户插件建 symlink，`add` 后必须重跑。
- **D-06**：Bun 宿主兼容性门禁——下载后的 staging 先做 Node 私有 loader 静态扫描，再做隔离 Cordis 挂载；任一失败都不可写 store 或触碰正式容器。

### 配置与信任

- **配置双轨**（「设计约束 · 安装命令式、配置双轨」）：工具投影侧——某插件的工具是否投影进 ellamaka、以何白名单——走空间级 `settings.jsonc`（`ellamaka.dsh.tools` 段），与「工具投影」映射白名单合并；dsh 界面侧——插件在 web 容器内的 entry 级配置——命令式写入该插件的补丁层，动态生效。
- **信任边界**：命令式安装是用户显式动作，初期免安装确认，只做 tarball 完整性（integrity）校验；第三方插件与 ellamaka 同进程执行、能碰 fs/shell 的风险在 `plugin add` 输出中明示。不新造权限体系。

### 验收基线

> 已于 2026-09-02 达成下列原有验收项（供应链 Plan 200 测试全绿 + 用户实机验证 hello 插件热挂载/卸载/设置页 GUI）；Bun 宿主兼容性预检须另行验收。

| # | 能力 | 验收结果 |
|---|------|----------|
| 1 | 安装 | `add` 在无系统包管理器的环境下完成第三方 dsh 插件安装，传递树完整，`@deepseek-ai/*` 依赖走闭包 symlink |
| 2 | 即时生效 | 运行中的 serve 进程内 `add` 后：web 容器新插件 entry 激活、UI 可见；tools 容器新工具下一轮模型请求可见；全程无重启 |
| 3 | 持久化 | 重启后插件清单与激活状态与安装时一致；installed.json 是唯一真相源 |
| 4 | 卸载/禁用 | `remove`/`disable` 后 effects 反解、工具从 registry 消失、内置同名工具自动恢复 |
| 5 | 失败语义 | 网络失败、解析失败、坏包均不污染 installed.json 与运行容器；有可诊断输出 |
| 6 | 并发 | 多进程并发 add 串行化；半安装状态不参与解析 |
| 7 | 隔离 | 插件安装不触碰闭包、不读写 `~/.dsh`、不引入 `DSH_HOME`/`DSH_PERMISSION_MODE` env |
| 8 | Bun 宿主兼容性预检 | **待实施**：Node 私有 loader 依赖在 staging 被拒绝；动态/未知运行时依赖在隔离挂载失败时被拒绝；两种失败都不改变 store 或运行中容器，并输出命中证据 |

---

## 空间 × Agent 配置体系（当前主线）

> 设计定稿（2026-09-03）。目标：wopal 的多空间、多 Agent 协作模式在 dsh 界面内原生成立——每个空间有自己的 Agent 团队（灵魂）、武器可见性、技能集与界面形态；定义文件来自 ellamaka 既有资产（`.wopal/`），自动生成，不重新设计。机制事实依据见「已验证事实 · Agent 配置体系机制事实」。

### 定位

主战场是 **dsh 界面本身**（助理 tab 的原生 UI + 官方引擎）。ellamaka 侧已定稿不再扩展，只通过工具容器继续喂小工具（见「能力采用」）。本节把 ellamaka 已验证的「空间 = 能力集 + 灵魂团队 + 权限控武器」模式，用 dsh 自己的机制（配置单 + 组队 + 插件体系）在 dsh 内重实现。

三个组成件，全部踩在既有地基上：

| 组成件 | 解决的问题 | 依赖的地基 |
|--------|-----------|-----------|
| **武器架插件** | 队员武器可见性 + 上下文 token 成本 | 引擎 `tools.restrict`（Agent 配置体系机制事实第 5 条）+ 供应链 |
| **预设生成器** | 从 ellamaka 定义文件自动生成配置单 | SpaceRegistry + agent-presets 双根机制 + installAnchor |
| **空间皮肤插件** | 界面按空间定制（编码空间/多媒体空间） | 供应链 + dsh client 插件面（hello 前置实证已验证）+ slots/theme 体系 |

组队不新建机制，直接采用 dsh 官方组队能力（见「组队语义」）。

### 概念映射

| wopal 空间资产 | dsh 机制 | 生成器动作 |
|---------------|---------|-----------|
| 空间 = 能力集 + 多 agent | 一组配置单（每灵魂一份，id = `空间-灵魂`） | 每空间 × 每灵魂生成一份 |
| `.wopal/agents/<灵魂>` 人格定义 | 配置单 persona | 人格文本直接搬入 |
| 权限 frontmatter 的工具可见性 | 武器架插件一行 + `allow` 名单 | 解析 frontmatter → allow 列表 |
| `.wopal/skills/` | 配置单 skill 行指向该空间技能目录（绝对路径） | 一行配置 |
| 空间 `AGENTS.md` / REGULATIONS | 引擎 agent-instructions 按会话 cwd 向上逐层读取 | **无需生成**——按目录自动生效 |
| 灵魂间协作规则 | 官方组队工具行 + 人格内协作纪律 | 组队工具行 + 人格段落 |
| `.wopal/` 下的 dsh 插件启用集 | 配置单插件行（安装全局共享，可见性按配置单授予） | 按空间配置生成行 |

**关键边界——安装共享、可见性按配置单**：dsh 插件安装是进程级全局动作（「设计约束 · 插件安装共享、启用按 profile」既定）；"空间 A 有而空间 B 没有"的表达层是**配置单的插件行 + 武器架 allow 名单**，不是每空间一套安装区。这与既有的「安装共享、启用按 profile」同构，可见性粒度从 profile 细化到配置单。

### 武器架插件

一个小插件，全空间共用，每个配置单引用一行：

- **行为**：挂载时读取自身配置 `{ allow: [toolName...] }`，对当前 Agent 作用域调用一次 `ctx.tools.restrict({ allow })`。
- **效果**：不在 allow 名单内的工具从该 Agent 的模型视野中完全移除——工具 schema 不下发，对应 prompt token 一并消失。同时解决两个问题：**队员不必承接主 Agent 全部武器**（ellamaka 权限体系控可见性的对等语义）与 **token 成本**（描述文本不再占用上下文）。
- **作用域正确性**：配置单挂载层即 Agent 作用域（引擎强制拒绝无作用域的全局限制），preset 行插件调用 restrict 天然只影响加入该配置单的 Agent。
- **安装与分发**：经供应链安装一次（全局），配置单以一行插件行 + 各自 allow 名单引用。

### 预设生成器

Bridge 侧同步模块，职责单一：**空间定义文件 → 配置单目录**。

```text
扫已注册空间（SpaceRegistry / wopal CLI，现成能力）
  → 每空间 × 每灵魂生成一份配置单（见「概念映射」映射表）
      人格   ← .wopal/agents/<soul>
      武器   ← 权限 frontmatter → 武器架插件行 + allow 名单
      技能   ← skill 行指向该空间 .wopal/skills/（绝对路径）
      插件   ← 空间配置的 dsh 插件行
  → 生成物写入 $WOPAL_HOME/dsh/presets/<空间>/<id>/（纯文本 YAML，可再生 artifact）
  → Bridge 装配时把该目录注册为 agent-presets 的自定义 system 根（roots 数组前置，一行配置）
  → workbench 建会话按空间选中该空间的配置单组（dsh 会话本就支持 per-session 选配置单）
```

- **生成物纪律**：`presets/` 下全部是可再生 artifact，禁止手编（见「设计决策 · 生成物可再生」）；用户个性化走官方 authoring 路径 copy 到 `state/.agent-presets/`（用户根，升级不丢）。
- **触发时机**：Web 容器 boot 时 + 空间定义文件变化时（watch 或按需刷新，与供应链 watcher 同型）。
- **幂等**：重复生成产出一致结果；空间删除 → 对应配置单目录移除 → 列表自动消失。

### 空间皮肤插件

一个 dsh 插件（服务端 + 客户端两半），实现「界面按空间定制」：

- **空间识别**：服务端从当前会话的 cwd 反查所属空间——dsh Web 容器的会话按空间目录建立（`provisionSpace`），空间目录带 `.wopal-space/` 标记，纯 fs 判断，不依赖跨引擎调用（见「设计决策 · 空间识别用会话工作目录」）。
- **数据通道**：服务端经 `ctx.webServer.register` 在 `/dsh/*` 下暴露该空间的皮肤配置（主题 token 覆盖、界面件开关、品牌资源）；客户端同源 fetch（「运行时机制 · 浏览器前缀适配」同源适配下天然可用）。
- **界面件**：客户端按配置应用主题 token 与声明式 slots——brand 位（空间名/标识）、composer 上下 dock 条（空间专属常驻信息条）、会话头部动作位（空间专属操作入口）、自定义工具的对话卡片（`tool.call.toolview` 按工具名 key）。
- **风格一致性**：主题 token 对齐 workbench 设计语言；皮肤件与 workbench 共享同一套品牌资源。

### 组队语义

直接采用 dsh 官方组队能力，不新建机制：

- **招人**：主 Agent 运行时经 `subagent`（独立小弟）/ `subagent_fork`（带上下文分身）/ Agent Teams（正式编队，成员互发消息、领任务）招人；大规模并行用 `workflow`。
- **队员装备**：队员自动加入队长的配置单——继承队长的武器、技能与空间规则（cwd 同源），天然"知道这个空间的守则"。角色差异由**任务书**（spawn 的 name/description/prompt，即灵魂定义的职责部分）与**目录规则**表达。
- **协作纪律**：消息往来、任务分派、完成上报是引擎内建能力；协作规范（如 wopal 的 agents-collab 约定）写入主 Agent 人格。
- **per-角色武器装备**（不同队员带不同工具集）：官方招人接口不含 preset 字段，需自定义招人 provider（引擎 `registerProvider` 扩展点）按角色挂载不同配置单。这是条件触发项——第一阶段任务书 + 目录规则已覆盖角色分化的主要诉求，只有当"队员必须带不同武器"成为真实需求时才立项（见「设计决策 · 组队用官方机制」）。

### 设计决策

| 决策 | 内容 | 理由 |
|------|------|------|
| **新 id，不覆盖** | 生成配置单一律用新 id（`空间-灵魂`），禁止以同 id 覆盖官方配置单；用户根同 id 本就被静默遮蔽，宿主根同 id 遮蔽技术上可行但会让官方演进被旧副本永久压住 | 静默腐化防线 + 升级语义干净 |
| **生成物可再生** | `presets/` 是生成 artifact，禁手编；个性化走用户根 copy | 单一真相源在 `.wopal/` 定义文件；生成物随时可删可重建 |
| **武器可见性 = per-Agent 白名单** | 角色武器差异统一走武器架插件，不用补丁层或安装区表达 | 引擎级语义正确（从视野移除）；token 成本同步解决 |
| **界面定制只走声明式 slots/theme** | 皮肤插件禁用 replace 整区（shadows-shipped-ui 高风险位） | 未来 iframe → 原生演进（待定事项）时定制件可迁移 |
| **空间识别用会话工作目录** | 皮肤插件与服务端以 cwd + 空间目录标记判断，不新增会话字段、不做跨引擎 RPC | 最小耦合；dsh 会话本就按空间目录建立 |
| **组队用官方机制** | 自定义招人 provider 仅在 per-角色武器成为真实需求后立项 | 队员继承配置单已覆盖主要诉求；避免过早建设 |

### 验收基线

演进步骤与批次管理见 `PLAN-TODOS.md` 当前主线（小步推进，每步有可应用成果）。本节只定验收终点：

| 验收项 | 判据 |
|--------|------|
| 空间装配 | 多空间实测：每空间 × 每灵魂配置单生成、界面可选、新会话按空间装配 |
| 武器可见性 | 不同配置单的会话模型视野工具集与 allow 名单一致；token 占用随名单收窄 |
| 技能与规则 | 空间技能目录加载；AGENTS.md 规则按 cwd 生效 |
| 界面形态 | 编码/多媒体两演示空间视觉可区分；皮肤件崩溃被错误隔离，不影响宿主 |
| 组队 | 队员继承队长配置单与空间规则；任务书角色分化生效 |

---

## Bun 宿主 HMR 与闭包升级（当前主线）

> 设计定稿（2026-09-03）。背景：官方 0.1.1-rc.2 运行中发生三类事故——tool-cordis 进程级注册冲突、29.9 万事件大会话回放拖垮单进程控制面、state 目录被官方 CLI 污染。官方 0.1.2-rc.1 已将模块级 HMR 改为按 profile 显式启用（base bundle 默认 `hmr: disabled: true`），web profile 以 `patchReload: 'live'` 的 watch-only 回退实现用户 patch 热加载；闭包应升级至该版本。本节给出 Bun 宿主下 DSH 热加载能力的完整设计与升级路径。机制事实依据见「已验证事实」与本节内联引用。

### 官方 0.1.2-rc.1 机制事实

以下事实逐条核对自 `labs/ref-repos/deepseek-harness`（0.1.2-rc.1 tag）：

- **模块级 HMR 是 opt-in**：`packages/bundle/base/cordis.patch.yml` 中 `hmr` 行带 `disabled: true`，注释「Module reload is opt-in per profile」。官方唯一调用方是 CLI TUI 开发路径。
- **watch-only 回退**：`apps/cli/src/profile-boot.ts` 对 `patchReload: 'live'` 的 profile（web 模板默认 live），在 `hmr` 未挂载时以 `config: { root: [] }` 挂载一个空根 HMR 实例，仅提供 `registerConfig` 配置监听——不打开任何模块根，不触碰模块缓存。
- **HMR 的 Node 私有依赖仍在**：`vendor/hmr/src/index.ts:120` 构造器要求 `ctx.loader.internal` 存在，模块热换路径使用 Node 内部 ESM loader 的 `loadCache`/`resolve`。Bun 下该条件永远不成立（`ModuleLoader.fromInternal()` 只识别 Node ≥22 的 internal/modules/esm/loader）。
- **loader 无 internals 时的降级是官方语义**：`vendor/loader/src/index.ts:73` 中 `internal = ModuleLoader.fromInternal()` 可为 `undefined`；裸包名导入走原生 `import()`（`vendor/loader/src/config/tree.ts`）。官方 embedder 文档明确「无 internals 走 documented no-internals path」。
- **tool-cordis 注册表冲突未修**：`packages/extensions/cordis-host-runner/src/inspect-registry.ts` 的 `register()` 依旧按 manifest id 全局去重抛错；同引擎第二个含 `tool-cordis` 的 preset 挂载仍失败。
- **FrameQueue 仍无界**：`packages/host/apiproxy/lib/index.js` 的 `FrameQueue.push` 依旧无条件 `buffer.push`，无帧数/字节上限。
- **agent-loop 仍逐 delta 事件**：`packages/core/agent-loop/src/agent.ts:368` 依旧 `session.append('assistant/chunk', ...)` 逐 delta 持久化；存储层 `packChunkRuns` 打包发生在写入时，运行时事件数不变。

### Bun 宿主 HMR 适配器（bun-hmr）

**定位**：Bun 容器内实现官方「配置热加载」契约；模块级热换降级为安全的事务性重载。适配器以 `@wopal/ellamaka-cordis/bun-hmr` 提供，在 Bun 路径以同一 `hmr` 服务位替代官方插件；Node 路径（Desktop sidecar）继续用官方 `@deepseek-ai/cordis-plugin-hmr`。

**能力边界**（对照官方 hmr 的两个消费者）：

| 能力 | 官方语义 | bun-hmr 语义 |
|------|---------|-------------|
| `registerConfig(filename, refresh)` | 监听单文件，变更时串行执行 refresh | 原样实现（chokidar watch，行为等价） |
| 模块根监听（`root: [dirs]`） | 追 Node 模块图、清缓存、按依赖分析热换插件 | 不支持；候选 import 校验 + fiber 原子替换（见下） |
| `loader.exit()` 兜底 | 依赖树变化触发宿主重启 | 同语义：闭包级依赖变更由 Runtime Manager 走新闭包 generation |

**模块热换的 Bun 替代路径（generation 原子替换）**：

1. 插件或 profile patch 变更 → Bridge 组合完整候选补丁栈（现有 `startDshPluginService` 的组合逻辑）。
2. 候选栈在隔离 Cordis context 中加载并激活校验（复用「插件供应链 · Bun 宿主兼容性预检」的隔离挂载实现）。
3. 校验通过后等待该容器无进行中 agent 请求（空闲窗口），事务性执行 `includeEntry.update()`——由官方 Loader 按 entry id 插拔 fiber，失败自动回滚旧栈。
4. Bun 模块缓存不需要清除：隔离候选使用内容寻址 URL（`file://...?<content-hash>`）加载变更模块，天然绕开缓存冲突；已运行容器的旧模块实例随旧 fiber dispose。

**Bun 下不伪造 `loader.internal`（拆雷）**：

- 删除 `dsh-web.ts` 中 `loader.internal = { import }` 的注入；裸包名解析改为 Bridge 侧显式 resolver：`mountProfile` 在组合补丁栈前把所有行 `name` 中的裸包名解析为闭包/安装区的绝对 `file://` URL，再交给 Loader。
- 官方代码路径兼容性依据：`PresetTree.import`、`HostResolvedRootInclude.import` 在 `internal === undefined` 时回落 `super.import`（原生 `import()`），`file://` URL 直接命中。桥接行为与官方 embedder 语义一致。
- 该变更使官方 `cordis-plugin-hmr` 在 Bun 下的构造器守卫**确定抛错**（而非侥幸通过后误用私有 API）——这是期望行为，Bun 路径挂载的是 bun-hmr。

**热换安全边界**：

- 影响会话核心的变更（agent-loop/session/compaction 类行）推迟到当前请求结束的空闲窗口；等待有上限（超时记 `pending` 状态并在 UI 提示，不强杀会话）。
- bun-hmr 自身失败（watcher 建立、候选校验）只降级为「变更待重启生效」，绝不影响容器现有服务；所有失败经 log-bridge 结构化上报。

### tool-cordis 注册冲突的宿主侧缓解

上游未修（进程级 id 去重），宿主侧在本闭包版本内执行缓解：

- **wopal 配置单**：已移除 `tool-cordis` 行（2026-09-03 已实施），恢复条件 = 上游把注册表按 agent scope 化或幂等。
- **创造模式单会话约束**：官方 `cordis` preset 内置 `tool-cordis`，同一引擎最多一个该 preset 的活动会话；第二个会话挂载失败回落 default。此约束作为已知限制记录，不在宿主侧 hack（修改官方 preset 违反「已验证事实 · 官方配置单在闭包内不可变」）。
- **会话恢复顺序**：resume 大 preset 会话先于新会话创建发生时，同样受此约束；Bridge 不做挂载重试风暴抑制之外的额外干预（错误已被 loader 聚合，UI 侧由挂载失败回落语义兜底）。

### 闭包升级路径（0.1.1-rc.2 → 0.1.2-rc.1）

1. **版本提升**：`packages/ellamaka-cordis/package.json` 六个 `@deepseek-ai/*` 直接依赖提升至 `0.1.2-rc.1`（`cordis`/`cordis-plugin-loader` 保持 4.0.2/1.0.3，官方未变更）。
2. ** manifests 再生**：构建生成新的 `dsh-runtime-manifest.json` 与 `dsh-runtime-lock.json`（约束「DSH 依赖真相源」），Runtime Manager 自动物化新指纹闭包，旧闭包保留（「设计约束 · 不可变闭包」）。
3. **stateHomePatches 复核**：rc.2 的 8 行 state 注入与 `dshHomePath` override 逐行对照 rc.1（`app-boot/src/index.ts:803` 仍 provide `dshHomePath`，seam 未变）；`session-persistence-jsonl` 在 web 容器保持禁用（tools 容器语义不变）。
4. **agent-presets 行为回归**：rc.1 `mount.ts` 的 `mountPreset`/`leakedServices` 契约未变；重点回归双根发现（官方根 + 用户根 extraPatch）与 standing mount 复检。
5. **Bun 路径回归清单**（升级后必须全绿）：serve（Bun）下 web+tools 双容器挂载、wopal/fae/rook 配置单挂载、插件 add/enable/remove 热挂载、`/global/health`、`/dsh` iframe 全链路、Desktop sidecar（Node）同清单回归。
6. **升级收益**：watch-only patch 热加载进入可用区间（bun-hmr 兜底）、base bundle 的 PTC tools mode env seam、http-proxy 版本对齐等 rc.1 修复一并获得。

### 非目标

- 不在宿主侧实现 Node `loadCache` 等价物或 `--expose-internals` 仿真；Bun 不提供这些私有结构，伪造已被证实是事故温床。
- 不修改官方闭包内任何包（含 `cordis` preset 与 `tool-cordis`）；上游缺陷以升级跟踪。
- 不在本设计内处理 FrameQueue 背压与 agent-loop delta 合并——两者属上游缺陷，宿主侧仅以「会话隔离 + 大会话不自动 resume」缓解，修复跟踪官方仓库。

---

## workbench × dsh 前端插件互通（门槛轨道）

> 前身为主线方向（2026-09-02 定稿方向二）。2026-09-03 重排优先级：**空间 × Agent 配置体系先行**——先把 dsh 插件用起来（自建 + 外部发现），用出真实价值后再评估 WC 化吸收。

### 定位与启动前提

dsh 前端插件体系（React + 声明制 slots）与 ellamaka workbench（SolidJS）是两套框架，组件经 **Web Component（WC）** 跨框架插座互通。方向二：dsh 前端插件补 `ellamaka.ui` 面（WC 壳），由 workbench 定义 slot 面加载——主导权在 ellamaka，与「ellamaka 吸收 dsh 能力」主线一致。

**启动前提**（两条同时满足才排期，否则不启动）：

1. **插件生态在真实使用中**：自建插件（武器架、空间皮肤等）已日常在用，且外部发现的 dsh 插件中有被实际留存使用的案例——有真实插件才有值得 WC 化的对象。
2. **workbench slot 化完成**：workbench 侧已建立 3–5 个挂载点与 props 契约。

### 一包多面

一个插件包三个激活面，installed.json 仍唯一真相源，`enable/disable` 一个动作管三处：

| 面 | 目标 | 机制 | 状态 |
|----|------|------|------|
| `dsh.bundle.patch` | dsh 服务端容器（工具/服务） | 供应链 | 已达成 |
| `dsh.client` | dsh GUI（React + slots） | 组合图动态派生 | 已达成（hello 前置实证） |
| `ellamaka.ui` | workbench（WC + slot 声明） | 本节新增 | 门槛轨道，未启动 |

新增 manifest 面：`package.json → ellamaka.ui: { entry: "./lib/ellamaka.js", slots: [...] }`。插件作者用 React 写组件包 WC 壳，或纯 TS 写轻组件；WC 自包含运行时，Shadow DOM 提供样式隔离。

### 数据通道

dsh 容器 HTTP 面挂在主 server `/dsh/*`（VirtualWebServer），workbench 页面与之**同源**（prod 同一 server；dev 由 Vite `/dsh` proxy 转发）。dsh 第三方插件「服务端 `ctx.webServer.register` 路由 + 客户端 fetch `/dsh/...`」的标准数据模式在 workbench 中原样成立——写得规范的 dsh 前端插件，数据面在 workbench 天然可用，改造量集中在 UI 壳。

容器未运行时，数据请求失败的降级语义由 workbench 加载器承担：WC 显示不可用态，不污染宿主。

### 执行清单（启动后按序执行，每步独立可逆）

| V# | 验证 | 内容 | 通过判据 |
|----|------|------|---------|
| V1 | 同源连通 | Bridge 静态路由 `/dsh/ellamaka-ui/<pkg>/<ver>/*` + Vite `/dsh` proxy | workbench fetch 插件 WC 文件返回 200 |
| V2 | 加载器最小链路 | installed.json 含 fixture（`ellamaka.ui` 声明）→ 加载 → 挂载 → 卸载 | fixture WC 在声明 slot 挂载并正确卸载；remove 后不再挂载 |
| V3 | 数据面实证 | fixture 插件服务端 register `/dsh/fixture/status` | WC 同源 fetch 渲染真实数据 |
| V4 | 真实插件实证 | fork 一个在用 dsh client 插件补 `ellamaka.ui` 面 | `add` → watcher 热挂载 → workbench 显示实际功能 |
| V5 | 失败语义 | 容器未起 / 插件加载异常 | 不可用态降级；插件崩溃被错误隔离，宿主其余槽位不受影响 |

### 平台侧改造清单（启动后实施）

| 件 | 归属 | 内容 |
|----|------|------|
| 静态路由 | Bridge | `/dsh/ellamaka-ui/<pkg>/<version>/*` 服务 plugins 目录 WC 文件（`/dsh/plugins/*` 是 dsh registry 专用，不复用） |
| dev proxy | ellamaka-app | Vite `/dsh` 转发到 serve |
| workbench slot 面 | ellamaka-app | 初始 3-5 个挂载点（会话侧栏、会话头部、设置页项等）+ 每个 slot 的 props 契约 |
| WC 加载器 | ellamaka-app | 读 installed.json → 过滤 `ellamaka.ui` + enabled 含 "workbench" → 动态 import → Shadow DOM 挂载 → 错误隔离 → 卸载 |
| enabledIn 语义扩展 | 供应链 | "workbench" 加入启用面取值（「设计约束 · 插件安装共享、启用按 profile」的延伸） |

### 与既有约束的衔接

- **信任面**：WC 与 workbench 同页面上下文，可信度等同 dsh 插件同进程执行（用户显式安装 + `add` 风险提示，见「插件供应链 · 配置与信任」），不新增权限体系。
- **单真相源**：installed.json 不新增第二清单；实现决策 D-04 保持。
- **官方闭包不变**：`ellamaka.ui` 面仅消费方为 ellamaka，不触碰官方闭包、不进入 dsh GUI 运行时。

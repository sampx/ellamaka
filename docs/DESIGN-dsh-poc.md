# DESIGN-dsh — ellamaka 与 dsh 融合架构设计

> **状态**: 融合机制与生产物化已实施并通过 §8 基线；插件供应链（§9）为目标设计，待实施
> **上级架构**: `DESIGN.md`
> **技术依据**: `research/deepseek-harness-architecture-and-integration-research.md`（dsh 全景调研）

本文档定义 ellamaka 与 dsh（DeepSeek Harness）融合架构。融合机制与生产物化已实施，是本设计的第一阶段成果；插件供应链（§9）把 dsh 插件升级为 ellamaka 的一等公民，是当前的目标设计。本文档是后续实施与验收的设计基线。

**阅读地图**：§2 架构总览 → §3 运行时机制 → §4 能力采用 → §5 配置与隔离 → §6 已验证事实 → §7 设计约束 → §8 物化验收基线（已达成）→ §9 插件供应链（目标设计）。

---

## 1. 背景与目标

ellamaka 是 WopalSpace 的引擎（OpenCode fork）。为获得沙箱执行、插件生态、动态装载等能力，ellamaka 在自身进程内集成 dsh 引擎，形成双引擎融合架构。

**设计目标**：

1. **单一进程**：ellamaka 与 dsh 运行于同一进程，共享一个公开端口。
2. **能力复用**：ellamaka 直接采用 dsh 的工具能力（沙箱、搜索、文件操作），不重复实现。
3. **会话归属**：ellamaka 拥有会话与状态所有权。Web 容器承载 dsh 完整会话（§2.1）；工具容器与 adapter 投影路径不创建、不持有任何会话，只提供执行能力（§6.4）。
4. **对外稳定**：ellamaka 的 API、SSE 事件、SDK 契约不因融合而变化。
5. **插件生态一体化**：dsh 插件可命令式安装、即时生效、跨重启保留，配置融入 ellamaka 配置体系（§9）。

**范围边界**：本文档描述融合后的目标架构。dsh 的会话/账本语义、调度、子代理等引擎能力不在采用范围内——这些能力依赖 dsh 自身的会话模型，与 ellamaka 的会话所有权冲突（§6.1）。

---

## 2. 架构总览

### 2.1 单进程、单端口、双容器

ellamaka 进程内运行两个独立容器（Cordis container），共用 ellamaka 的唯一监听端口：

| 容器 | Profile | 职责 | 会话 |
|------|---------|------|------|
| **Web 容器** | `web` | 承载 dsh 完整 Web 界面（会话、账本、checkpoint） | 有 |
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
└── DSH Plugin Manager（§9）
      └── `ellamaka dsh plugin` 命令 → plugins/ 安装区 + 运行中容器热挂载
```

**两个容器必须分离**的原因：Web UI 需要 dsh 的完整 agent-loop 语义（会话账本 + checkpoint 屏障 + 完整插件集）；工具采用只需要工具本体 + 最小调用上下文。同一容器无法同时满足两种装配——checkpoint 插件会强制 flush 调用方的 live session（§6.4）。

**入口分工**：

- CLI serve / web：挂载 Web 容器 + 工具容器
- Desktop sidecar：挂载 Web 容器 + 工具容器（boot 系列自建容器）
- TUI：只挂工具容器（无 iframe 需求）
- Workbench：由承载页面的 serve/web 后端或 Desktop sidecar 提供 Web 容器与工具容器

### 2.2 组件清单

| 组件 | 位置 | 职责 |
|------|------|------|
| `VirtualWebServer` | `@wopal/ellamaka-cordis` | 实现 dsh 官方 WebServer 接口，提供路由/upgrade 分发，不创建监听 socket |
| 受控路由挂载点 | `Listener.mountNodeRoute` | 按前缀分发 HTTP/upgrade 到已注册 handler，保留 Effect listener 生命周期 |
| Ellamaka DSH Bridge | `@wopal/ellamaka-cordis` | 随 CLI 与 Desktop sidecar 编译发布；提供容器、虚拟 WebServer、运行时动态加载与 dsh boot 装配，不作为 DSH 闭包依赖发布 |
| DSH Runtime Manager | `@wopal/ellamaka-cordis/runtime` | serve、web、TUI 与 Desktop sidecar 共用的启动入口；负责禁用判断、闭包物化、完整性校验、动态加载和容器挂载 |
| DSH Plugin Manager | `@wopal/ellamaka-cordis/plugins`（随 Bridge 发布） | 插件供应链：安装区管理、依赖解析、热挂载与 profile 清单同步（§9） |
| DSH 运行时清单 | Ellamaka 构建产物 | 构建时从 `packages/ellamaka-cordis/package.json` 派生并锁定 DSH 官方依赖、完整依赖树与完整性信息；运行时内嵌读取 |
| dsh 引擎装配 | `@wopal/ellamaka-cordis/dsh-web` | 通过 `installAnchor` 从物化闭包加载官方运行时，重放 dsh boot 序列，构造两个容器；覆盖 `ctx.dshHomePath` 与插件 `dshHome` 配置注入，落地运行时隔离（§3.4） |
| dsh-adapter | `.wopal/plugins/dsh-adapter` | 把工具容器中的工具投影进 ellamaka ToolRegistry |
| DSH home | `$WOPAL_HOME/dsh` | 不可变依赖闭包、用户插件安装区、profile 定义、运行时 state 与物化锁的唯一位置 |

---

## 3. 运行时机制

### 3.1 单端口分发

DSH 的 Web 路由与 ellamaka 原生路由共用 ellamaka 的监听端口：

1. ellamaka Server 提供受控 Node 路由挂载点，保存前缀与 HTTP/upgrade handler。
2. `VirtualWebServer` 持有 dsh 官方插件注册的路由与 upgrade socket，暴露分发能力。
3. `mountDshWeb` 返回的 `webServer` 经 `Listener.mountNodeRoute({ prefix: "/dsh", ... })` 挂到主 listener。
4. 主服务器剥离 `/dsh` 前缀后，`VirtualWebServer` 看到的是官方 `/api`、`/plugins` 原始路径。

**边界**：

- 调用方获得 register/dispose 能力，不获得原始 `node:http.Server`。
- upgrade socket 由 `VirtualWebServer` 持有，在 host dispose 与主 listener 停止时销毁——补足 Node `closeAllConnections()` 不覆盖 WebSocket 的行为。

### 3.2 浏览器前缀适配

DSH 前端在隔离 iframe 内加载。`VirtualWebServer` 在 index tap 链末尾注入适配脚本，把 DSH 浏览器传输映射到 `/dsh/*`：

- `fetch`（字符串、`Request`、`URL` 对象）、`WebSocket`、`EventSource`
- `document.createElement("script")` 动态加载的插件 bundle
- 覆盖相对路径与同源绝对 URL；外部 URL 与已带 `/dsh` 的 URL 保持不变

**静态资源路径**：DSH 前端使用根路径 `/assets/*`、`/favicon.svg` 与 boot manifest 的 `/plugins/*`。index 变换统一添加 `/dsh` 前缀，并移除 iframe 不需要的 PWA manifest link。

### 3.3 iframe 地址派生

`DshIframe` 的 src 从活跃 server 的 `http.url` 派生为 `<url>/dsh/`，不写死相对路径。原因：ellamaka-app 的 dev 模式由 Vite 服务前端（默认 3000），后端 serve 独立监听（默认 4097）；相对 `/dsh/` 在 `:3000/workbench` 页面会解析到前端 origin。派生后 dev 下指向 `http://127.0.0.1:4097/dsh/`、Desktop 下指向 sidecar 本地地址，两侧都命中后端 `/dsh` 挂载点。

### 3.4 DSH home、运行时隔离与依赖物化

#### 3.4.1 交付边界

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

DSH 不依赖 Ellamaka DSH Bridge。依赖方向始终是 `Ellamaka → Bridge → DSH runtime`。生产闭包中没有 `@wopal/ellamaka-cordis`、`file:` workspace 链接、TS 源码副本或 Node TypeScript loader。

#### 3.4.2 唯一 home 与目录所有权

**唯一 home**：`$WOPAL_HOME/dsh`。serve、web、TUI、Workbench 后端与 Desktop sidecar 读取同一位置。Ellamaka 集成只用 `$WOPAL_HOME`，**永不使用 `$DSH_HOME`，永不设置 `DSH_HOME` 环境变量**；`~/.dsh` 归 dsh 官方 CLI 专用，Ellamaka 不在其内读写。

```text
$WOPAL_HOME/dsh/
├── closures/                            ← 按内容哈希命名的依赖闭包；只增不减，永不自动删除
│   └── <fingerprint>/                   ← 清单 sha256 摘要前 12 位 hex；同名即同内容，非代数编号
│       ├── package.json
│       ├── package-lock.json
│       ├── runtime-manifest.json        ← 本闭包对应的运行时清单复本
│       └── node_modules/
├── plugins/                             ← 用户插件安装区（§9）；唯一按内容可变的安装区
│   ├── installed.json                   ← 已装插件真相源：包名、版本、启用于哪些 profile
│   └── <pkg>/<version>/                 ← 每插件独立目录，自带传递依赖子树
├── profiles/                            ← 用户可编辑 profile（跨版本保留）
│   ├── web/
│   ├── ellamaka-tools/
│   └── node_modules/                    ← 启动时按 installAnchor 重建的快捷方式（heal 时并入 plugins/ 源）
├── state/                               ← DSH 运行时数据
├── staging/                             ← 物化临时区；持锁进程开始时清空，成功后移入 closures/
└── locks/materialize.lock               ← 仅物化窗口存在，防两进程并发下载安装
```

闭包按指纹不可变。新 Ellamaka 版本需要不同的 DSH 依赖树时创建新闭包，不原地修改正在运行的闭包。`profiles/` 与 `state/` 独立于闭包版本，升级时保持用户配置与运行时数据。

#### 3.4.3 运行时清单与版本来源

`packages/ellamaka-cordis/package.json` 的精确 `dependencies` 是 DSH 官方**直接依赖版本**的唯一编辑源。Ellamaka 构建流程从中选取 `@deepseek-ai/*` 依赖生成 `dsh-runtime-manifest.json`。该文件是构建生成物，随 CLI 与 Desktop sidecar 嵌入，不由开发者手工维护：

- 直接依赖名称与精确版本，包括 `@deepseek-ai/dsh`；
- 清单 schema、Bridge ABI 与内容指纹。

清单不携带任何锁快照，也不从构建期锁文件（bun.lock）推导版本或 registry。传递依赖树的解析与锁定发生在**构建期**：构建流程以清单的精确直接依赖版本调用 npm（Arborist）解析出完整传递依赖树，产出一份**内嵌锁**（`dsh-runtime-lock.json`），随 CLI 与 Desktop sidecar 一同嵌入二进制。清单的目标形态如下：

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

运行时物化器只消费发布物内嵌的清单与内嵌锁，不读取 `latest`，不自行选择兼容版本，也不依赖源码仓库中的 `package.json`。例如构建清单声明 `@deepseek-ai/dsh: 0.1.1-rc.2`，该 Ellamaka 发布物始终物化这一版本。升级 DSH 的路径是修改唯一编辑源、构建新的 Ellamaka 发布物。

普通配置不提供 DSH 版本覆盖项。Bridge 与 DSH runtime 作为一个经过验证的兼容组合随 Ellamaka 版本发布。单独填写一个 DSH 版本无法同时声明完整传递依赖树与 Bridge ABI，容易产生未经验证的运行组合。未来如需独立升级 DSH，由发布流程交付新的完整运行时清单，而不是由用户配置任意版本字符串。

清单指纹覆盖直接依赖精确版本、schema 与 Bridge ABI。目标闭包路径由该指纹确定。构建检查保证内嵌清单与唯一编辑源一致，避免手工清单和版本常量漂移。同一精确版本清单对应同一指纹；内嵌锁由构建期解析产生，同一清单在构建时解析出确定性的传递树，因此同一发布物在不同机器上物化出相同的闭包。**闭包一旦锁定即不可变**，二次启动零网络命中。换源不改变已锁定闭包。

#### 3.4.4 统一启动语义

`ELLAMAKA_DSH` 是唯一禁用开关，默认启用：

- 未设置或值不等于 `0`：启动 DSH Runtime Manager；
- `ELLAMAKA_DSH=0`：跳过清单检查、网络访问、物化、Bridge 动态加载和容器挂载，回到无 DSH 基线。

所有入口共用 `@wopal/ellamaka-cordis/runtime` 下的 Runtime Manager。不存在 Desktop 专用物化器、CLI 参考脚本或需要用户手动运行的预安装命令。

| 用户入口 | 物化责任人 | 成功后的装配 |
|----------|------------|--------------|
| `ellamaka serve` / `ellamaka web` | 当前 Ellamaka 进程 | Web 容器 + 工具容器 |
| `ellamaka` TUI | 当前 Ellamaka 进程 | 工具容器 |
| 浏览器 Workbench | 承载 Workbench 的 serve/web 后端 | Web 容器 + 工具容器；浏览器不执行文件系统物化 |
| Desktop Workbench | Desktop sidecar | Web 容器 + 工具容器；Electron Main/Renderer 不物化 |

DSH 初始化是启动阶段的一部分，采用**阻塞等待**策略：入口在提供 DSH 能力前等待该阶段完成。等待期间的体验契约：

- **进度**：物化按阶段输出进度（读取内嵌锁 → 下载 → 解压 → 校验 → 激活），日志含阶段名与包数，避免用户面对无反馈的挂起。
- **超时**：物化整个阶段硬超时默认 5 分钟（下载、安装合并计时）。超时进入 `degraded`，Ellamaka 继续无 DSH 启动，本次不重试。
- **成本分布**：下载只发生在首装与指纹变更两个时刻。常规启动命中已验证闭包时只执行本地快速校验，零网络、零等待。

#### 3.4.5 物化状态机

Runtime Manager 对每次启动执行同一状态机：

1. **Gate**：读取 `ELLAMAKA_DSH`。值为 `0` 时返回 `disabled`。
2. **Resolve**：读取内嵌运行时清单，计算预期指纹与目标闭包目录。
3. **Inspect**：验证目标闭包的 manifest、内嵌锁、关键 anchor 与直接依赖版本。完整时直接进入 Load。
4. **Lock**：缺失或损坏时获取跨进程 `materialize.lock`。等待者在持锁者完成后重新 Inspect。
5. **Stage**：读取内嵌锁（完整传递依赖树快照）；用内置 `pacote` 按锁逐包下载 tarball 并解压到 `staging/` 对应路径。物化不依赖系统 bun、npm 或用户 shell，也不在运行时解析依赖树——树已在构建期解析并内嵌。
6. **Verify**：校验内嵌锁的合法 npm v3 形状、`@deepseek-ai/dsh` anchor、每个直接依赖的精确版本，以及 Bridge 所需的官方模块导出。
7. **Activate**：把通过验证的 staging 目录原子重命名为 `closures/<fingerprint>`。未通过验证的 staging 从不参与加载。
8. **Profile**：创建缺失的 profile 模板；已有 profile 与用户补丁保持不变。按本次 installAnchor 重建 `profiles/node_modules` 快捷方式。
9. **Load**：以 installAnchor 动态加载官方运行时，挂载该入口需要的容器，返回 `ready`。

同一进程对初始化 Promise 做单飞复用。同一 `$WOPAL_HOME` 下的多个 Ellamaka 进程通过文件锁协调，只有一个进程下载和安装；其他进程等待并复用已验证闭包。

#### 3.4.6 installAnchor 与动态加载

`installAnchor` 是目标闭包内 `@deepseek-ai/dsh/package.json` 的绝对路径：

```text
$WOPAL_HOME/dsh/closures/<fingerprint>/node_modules/@deepseek-ai/dsh/package.json
```

它是**模块解析锚点**，不是下载地址，也不决定版本。版本由 §3.4.3 的内嵌清单决定。Bridge 以 installAnchor 创建闭包作用域的 resolver，再从同一 `node_modules` 加载 `@deepseek-ai/cordis`、`dsh-app-boot`、`dsh-cmdline`、profile bundles 与其他官方模块。

Bridge 的生产代码不在模块顶层静态导入 `@deepseek-ai/*` 运行时包。类型依赖在构建期保留，运行时值通过 installAnchor resolver 获取。由此保证：

- CLI 与 Desktop 使用同一份磁盘闭包；
- 解析结果不受当前工作目录、workspace、全局 node_modules 或应用 bundle 影响；
- Ellamaka 发布物不重复打包 DSH 官方依赖；
- Bridge 自身始终是已编译 JavaScript，不需要 Node strip-types 或 `.js → .ts` loader。

#### 3.4.7 升级、失败与可观测状态

指纹相同的闭包可无限复用。新 Ellamaka 发布物携带新指纹时物化新闭包，已经运行的旧进程继续持有自己的 immutable installAnchor，不受升级影响。新闭包验证成功后才参与本次启动；版本不匹配时不回退到旧闭包，以免 Bridge ABI 与 DSH runtime 静默错配。

**闭包生命周期——只增不减**：

- 物化成功后永久保留，**自动回收不存在**。磁盘占用 = 本机出现过的版本指纹数（一般 2~3 份）；清理方式只有用户手动删除目录，规则简单可预测。
- `staging/` 由物化进程自管理：持锁开始即清空残留；成功后原子 `rename` 移入 `closures/`；失败时保留现场供诊断，下次物化直接覆盖。
- 后续如需便利清理，以显式命令交付（如 `ellamaka dsh cleanup --dry-run` 列出可删闭包），不属于本设计的启动行为。

运行状态统一为：

| 状态 | 含义 |
|------|------|
| `disabled` | 用户以 `ELLAMAKA_DSH=0` 明确禁用 |
| `preparing` | 正在校验、等待锁或物化 |
| `ready` | 目标闭包通过验证且容器已挂载 |
| `degraded` | 本次启动物化、校验、加载或挂载失败，Ellamaka 无 DSH 继续运行 |

每次进程启动最多自动物化一次。网络不可达、超时、磁盘不足、integrity 不匹配、锁异常和 Bridge 加载失败均进入 `degraded`，保留可诊断错误并在下次启动重试。失败的 staging 不会覆盖可用闭包。已有正确闭包时启动不需要网络。

**下载与缓存**：

- 物化器用 `pacote` 按内嵌锁逐包下载 tarball 并解压（有界并发 + 进度日志）。`pacote` 不做依赖树求解（树已在构建期解析并内嵌），只做"按精确版本下载 + 解压"，在 SEA 单文件二进制内稳定可用。**官方闭包的树解析只存在于构建期源码环境**：Arborist 的树求解在 `bun --compile` 单文件二进制内会陷入忙循环（§6.6）；用户插件的传递树解析走 §9 的最小解析器，不受此约束影响。
- registry 是**传输通道，不是版本真相源**：物化器对一组候选 registry 做并发测速（metadata 端点往返延迟），选取本次启动最快可达的一个作为下载源，不同地区与不同时刻的用户自动获得最合适的通道；全部不可达时兜底官方 npm（`https://registry.npmjs.org/`）。换源不改变已锁定闭包，不使用 `latest`、不依赖用户在 shell 里的 npm 配置。

#### 3.4.8 运行时数据隔离

DSH 引擎的运行时数据（settings、credentials、匿名用户 ID、sessions、storages、home patch）统一落在 `$WOPAL_HOME/dsh/state`。隔离采用**纯配置注入，零环境变量**：

| 机制 | 说明 | 隔离方式 |
|------|------|---------|
| `ctx` 注入的 `dshHomePath` | profile 配置 `!!js dshHomePath(...)` 表达式经 `with(ctx){eval}` 求值，覆盖 storages/sessions | 装配时 `ctx.provide("dshHomePath", (...s) => join(stateDir, ...s))` |
| 插件直接 `import { resolveDshHome }` | settings/credentials/agent-instructions/shell-env/skill-fs/attachment 等读 `config.dshHome` | 在 profile patch 层给各插件传 `dshHome: $WOPAL_HOME/dsh/state` |
| 无配置注入的例外 | `llm-deepseek` 上传索引、`anonymous-user-id` | 使用插件显式路径配置；未提供隔离入口的功能保持禁用 |

两种机制最终都落在 `$WOPAL_HOME/dsh/state`，不依赖 `DSH_HOME`。官方 dsh CLI 无论同进程还是独立进程，都感知不到 Ellamaka 的运行时数据。

### 3.5 Profile 机制

每个 profile 目录含：

| 文件 | 作用 |
|------|------|
| `package.json` | 声明 `dsh.profile.bundles` 有序 bundle 列表 |
| `cordis.yml` | 插件行清单 |
| `cordis.patch.yml` | 用户补丁层，按 entry id 覆盖/禁用，应用于所有 bundle 层之后 |

- `web` profile：bundles `dsh-base + dsh-web-app`，完整 UI。
- `ellamaka-tools` profile：bundles `dsh-base`，补丁层禁用 agent-loop 专属插件（禁用清单见 §4.2）。
- `initProfile` 只创建缺失文件不覆盖；ellamaka 只在补丁层仍是空模板时播种默认禁用条目，用户编辑永不覆盖。
- `profiles/node_modules` 是快捷方式目录：`healProfilesModuleFallback` 每次挂载时从 installAnchor 遍历依赖清单，为每个包建 symlink，使 profile 插件行在 Loader 解析时找到宿主已安装的包。它不是独立安装，指向哪份安装取决于 installAnchor。

---

## 4. 能力采用

ellamaka 通过工具容器采用 dsh 的工具能力。采用原则：**每个能力逐项评估，采用成本超过独立实现成本时保留 ellamaka 原生能力**。dsh 是能力来源，不是必须迁入的运行时归宿。

### 4.1 采用边界

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

**需原生复刻（深耦合，不采用）**：session-query、schedule、subagent 等引擎能力包（§6.1）。

### 4.2 工具容器装配

工具容器装配 `fs-sandbox` / `bash-sandbox` 沙箱后端，使 `ctx.fs.sandboxMode` / `ctx.shell.sandboxMode` 有值，`sandboxPolicy.resolve()` 参与执行链。容器内不创建任何 dsh session。

补丁层禁用 agent-loop 基础设施（session、agent-loop、llm、subagent、jobs、goal、plan-mode、compaction、web 等约 57 行，按依赖分组附理由），只保留工具注册表与执行链（tools、system-prompt、subprocess、fs、sandbox、spill、tool-fs、tool-fs-search 等）。

**两个已确认的容器语义**：

1. **工具容器不做请求边界持久化**：`session-checkpoint-policy` 插件监听 `tools/execute`，对 live session 执行账本 flush。adapter 不传 live agent 时它短路放行。工具容器在 profile 层禁用该插件——不创建、不持有任何 session，账本持久化缺失不产生功能影响（§6.4）。
2. **后台任务能力禁用**：`jobs` 未装配，工具容器隐藏 `run_in_background`，schema 隐藏该字段，强制传入时由 dsh 拒绝。

### 4.3 工具投影（dsh-adapter）

dsh-adapter（`.wopal/plugins/dsh-adapter`）把工具容器中的工具投影进 ellamaka ToolRegistry：

- **映射白名单**：配置 `tools: [{source, target, enable}]`。同名 target 覆盖 ellamaka 内置工具；容器缺失时 adapter 挂 0 个工具，内置工具原样可用。
- **schema 投影**：把 dsh 的 JSON Schema 解包为 ellamaka 插件 SDK 的 ZodRawShape；不支持的类型降级 `z.unknown()`，dsh schema 扩展不破坏投影。
- **参数映射**：dsh 蛇形参数（`file_path`）重命名为 ellamaka 驼峰（`filePath`），投影时重命名、execute 时转回。
- **结果映射**：dsh 的 `meta.diffs` 映射为 ellamaka 的 `filediff`（`file`/`patch`/`additions`/`deletions`），hunk diff 算法在 adapter 内自持，不 import dsh 包。前端零改动。
- **调用日志**：adapter 经容器 logger 记录每次调用（成功/失败，携带 tool/sessionID/callID），落入 `dsh-plugins.log`。
- **权限门禁复用**：adapter 在执行前复用 ellamaka 的 read/edit 与 external_directory 权限门禁。

**动态装配**：adapter 注册 `"tool.provider"`，每次调用实时读 `container.get("tools").schemas()`，不再启动时冻结。dsh 插件动态加载/卸载 → 工具增删 → 下一轮模型请求自动看到新集合；同名 dsh 工具卸载后内置工具自动恢复。工具集合真变化时缓存失效是预期行为；未变化时通过确定性投影 + 名字排序保证字节一致、缓存命中。

### 4.4 沙箱语义

工具调用经 adapter 投影时，按 ellamaka session 复用最小 facade：`session.header.cwd`（spawn 工作目录）、`session.header.id`（归属标签）、`session.events`（沙箱模式折叠）。其他一切省略。

沙箱模式在运行时决议（§5.2）：

- **启用沙箱**：注入 `sandbox/mode` 事件，`mode` 在 `read-only` 与 `workspace-write` 间选择。
- **关闭沙箱**：注入 `danger-full-access`，工具在容器默认后端下运行。**不切换本地 fs/bash 后端**——工具始终走同一容器与已装配的沙箱后端，关沙箱只是放开有效模式。

`danger-full-access` 保留为 dsh 内部一次性 escalation 目标，不作为空间级配置值暴露，只作为"沙箱关闭"的内部映射。

### 4.5 阶段 B：escalation 审批桥接与沙箱三态切换

沙箱拒绝后，dsh 模型可回填 `sandbox_permissions` + `justification` 申请一次性更宽模式。该申请经 dsh 原生 approval 服务审批——工具容器**原生启用** `approval` 插件（不移出 disabled 清单之外的 fork），由 adapter 补齐其运行时前置条件，审批决策经桥显示在 Workbench 权限卡片。

**adapter session 门面扩展**（§4.3 facade 的增量）：

| 扩展 | 语义 |
|------|------|
| `append(type, data)` | 往自持 events 数组 push，approval 审计对（`approval/asked` + `approval/decided`）落内存不落盘 |
| turn 包裹 | 每次 `tools.execute()` 外层 `turn/start` → 执行 → `turn/end`（引用计数，finally 保证闭合，并发/嵌套仅最外层闭合） |

两者合起来满足 approval 插件的 `hasOpenTurn` 前置条件。工具容器仍不创建持久会话（§6.4 语义 1 不变）。

**approval answerer 桥**：adapter 在容器 ctx 上注册 `approval/request` waterfall listener，按 `req.agent.session.header.id`（= ellamaka sessionID）从 `askRegistry` 取执行时注册的 ask 闭包，构造 `sandbox_escalation` permission ask（patterns = 目标模式，从 escalation reason 解析；metadata 携带 toolName/callID/justification）。决策映射：

| 用户决策 | dsh outcome |
|---------|------------|
| once | `allowed-once`（dsh 原生 one-shot，仅本次调用以更宽模式执行） |
| always | ellamaka Permission 规则池承接（会话内同 pattern 免再问），dsh 侧返回 `allowed-once` |
| reject | `rejected` |
| 无 ask 闭包（TUI 等无 UI 入口） | `next()` 委托 waterfall 兜底 `unavailable`（fail-closed） |
| abort | dsh 原生 `cancelled`（ApprovalService 与请求信号 race） |

**escalation 策略**：`ellamaka.dsh.sandbox.escalation: "ask" | "never"`（默认 `ask`）。`never` 时 adapter 向每个 facade seed `approval/policy` session 事件（dsh 原生 fold 语义，LAST 优先），approval 服务在 waterfall 之前确定性拒绝，answerer 零调用。沙箱关闭（full-access）时 escalation 字段不广告，无需处理。

**沙箱三态切换**：Workbench chat 输入框 composer 底栏 `ComposerSandboxControl` 下拉（Read Only / Workspace Write / Full Access），经既有 `global.config.update` 端点最小 patch 全局配置中 dsh-adapter 插件 spec 的 inline `sandbox` 选项。映射：`read-only`/`workspace-write` → `{enabled: true, mode}`；`full-access` → `{enabled: false}`。显示条件：仅当配置含 dsh-adapter 插件时渲染。新会话生效（adapter 按 sessionID 缓存 facade）。不使用 dsh permission-presets。

---

## 5. 配置与隔离

### 5.1 进程级共享、空间级隔离

**容器装配是进程级共享能力池**：serve/TUI/desktop 各挂一个工具容器，进程内所有空间共用。容器载入完整工具链，禁用清单只管 agent-loop 基础设施，不管工具。装配一次，所有空间共用。

**工具投影是空间级隔离点**：每个空间的 `.wopal/config/settings.jsonc` 声明自己的 adapter 映射白名单与沙箱策略。adapter 按空间加载，各带各的配置——空间 A 开 grep+glob，空间 B 开 grep+glob+bash，互不影响；未开映射的空间用 ellamaka 内置工具。

**配置层级走 ellamaka 原生合并**：用户级 → 空间级 → 空间本地，逐层覆盖。

### 5.2 沙箱配置

空间级 `.wopal/config/settings.jsonc`（+ `settings.local.jsonc`）拥有工具容器的沙箱策略，配置形态为 `ellamaka.dsh.sandbox: { enabled, mode }`：

| 配置 | 含义 |
|------|------|
| `enabled: true` | 启用沙箱，`mode` 在 `read-only` 与 `workspace-write` 间选择 |
| `enabled: false` / 缺失 | 关闭沙箱，注入 `danger-full-access` |

进程级默认值只在尚未解析空间配置时兜底。**不用 `DSH_PERMISSION_MODE` 环境变量**——沙箱策略由空间配置拥有。

### 5.3 沙箱平台支持

dsh 沙箱后端 `@deepseek-ai/dsh-sandbox-local` 三平台支持（已实测 macOS）：

| 平台 | 机制 | 依赖 | 强制完整度 |
|------|------|------|-----------|
| macOS | Seatbelt（`sandbox-exec`，系统自带） | 无 | full |
| Linux | bwrap（bubblewrap）优先，回退 Landlock | bwrap 需安装 | full（老内核自报 partial） |
| Windows | ACL restricted-token runner | 自带 runner | partial（两个已知缺口） |

探测失败即拒绝执行（`SANDBOX_UNAVAILABLE`），不裸奔。

---

## 6. 已验证事实

> 本节事实经源码实证或实测固化，是设计决策的依据。表述为结论，不展开推导。

### 6.1 深耦合能力不可采用

session-query / schedule / subagent / system prompt 注入等能力依赖 dsh 的引擎层语义（事件日志语料重放、agent.send 唤醒通道、子会话模型）。契约桥只能翻译接口层形状，翻译不了引擎层语义。这些能力的获取路径是**原生复刻**（机制设计可剥离，包与数据模型不可复用）。

**重要区分**：上述"深耦合"指引擎能力包。工具插件（tool-fs、tool-bash、tool-fs-search 等）**不在深耦合之列**——它们是叶子工具，只消费 session 的浅层形状，不依赖 agent-loop 语义。

### 6.2 工具消费面

对工具容器采用的全部能力做源码级盘点。结论：**工具插件的 session/agent 依赖是浅层的，无一个需要深 agent-loop**。分三类：

| 类别 | 特征 | 工具 |
|------|------|------|
| **A 纯形状** | 只读 `header.cwd` / `header.id` 标量 | `tool-fs-search`、`spill-policy` |
| **B 语义事件** | 折叠 `session.events` 读 `sandbox/mode` 覆盖 | `tool-fs`、`tool-str-replace-editor`、`tool-bash` |
| **C 语义写** | 写持久事件或依赖瀑布 | `tool-fs`、`tool-str-replace-editor`（emit `fs/observed`）、`fs-observation-policy` |

**两个关键纠正**：

1. `session.events` 缺失不会 TypeError：真 dsh Session 的 events 恒为数组。adapter 喂 `events: []` 是防御性而非必须。
2. `session.id` 不是临时目录隔离键：隔离键是 `header.cwd`，`id` 只喂 spill/日志，缺了无害。

### 6.3 服务依赖

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

### 6.4 工具容器不持久化的成立条件

`session-checkpoint-policy` 监听 `tools/execute`，对 `exec.agent.session` 执行账本 flush（"执行副作用前账本已持久化"）。adapter 不传 agent 时它短路放行；传入轻量 agent 时抛 `session not live`。因此工具容器在 profile 层禁用该插件。

**推论**：工具容器不做请求边界持久化，但也不创建、不持有任何 session，账本持久化的缺失不产生功能影响。Web 容器保持完整 profile，checkpoint 与 UI 模式照常。

### 6.5 桥接 API 规范

从 async 侧（Cordis 服务）调回 Effect 世界的桥接遵守以下形态（已实测固化）：

1. **持有 work Fiber 必须 `Effect.forkIn(scope)(work)`**：在 `Effect.scoped` 内取 scope，`forkIn(scope)` 直接返回持有的 work fiber。禁止 `ManagedRuntime.runFork(work).pipe(Effect.forkIn(scope))`。中断经 `runtime.runFork(Fiber.interrupt(fiber))`。禁止 `runPromise` 驱动长任务。
2. **顶层 Effect.runFork/runPromise/runCallback 在运行时未导出**——一律经 `ManagedRuntime` 实例方法调用。
3. **`Effect.scope` 须在 `Effect.scoped` 内获取**，否则以空 defect Die。
4. **ALS 上下文**：effect 体内发起的桥接调用沿传播链天然继承 Instance ALS；纯 async 侧发起的轮次须捕获-恢复 ALS。
5. **取消语义**：interrupt 后 finalizer 按子先父后顺序确定性执行，`forkIn(scope)` 的并发子任务级联清理。Cordis 入口只启动不拥有中断权。

### 6.6 插件供应链 spike 事实（2026-09-02，真实官方包实测）

对真实 `@deepseek-ai/*` 包（cordis 4.0.2、cordis-plugin-loader 1.0.3、dsh-app-boot 0.1.1-rc.2）验证，实验记录 `.wopal-space/.tmp/dsh-plugin-spike/SPIKE-REPORT.md`：

1. **运行中容器热挂载成立**：`loader.create({ name, config })` 向已启动容器挂载插件，服务立即可读；`loader.remove(id)` 卸载，effects 干净反解；root include 的 `entry.update()` 事务性插拔（按 entry id diff，自动 mount/unmount）同样成立。**无需重启容器，无需 patch 官方 Loader**。
2. **编译二进制内运行时依赖解析成立**：约 150 行 BFS 解析器（abridged packument + semver range + hoist 去重）在源码（991ms）与 `bun --compile` 二进制（1065ms）内均正确解析传递树，无忙循环。§3.4.7 的 Arborist 忙循环约束只针对官方闭包的大树求解，不阻塞用户插件的小树解析。
3. **实现契约**：include `entry.update()` 是浅合并——更新 patches 必须先展开旧 config（否则 `path` 字段丢失报 `extension "" not supported`）；裸包名解析经 `loader.internal.import` 缝隙 + `profiles/node_modules` symlink parent-walk（`add` 后必须重跑 heal）；`mountRootInclude` 由 `dsh-app-boot` 导出；root config 扩展名仅 `.json/.yaml/.yml`。

---

## 7. 设计约束

> 以下约束定义生产目标边界。实现可以调整内部结构，但依赖方向、发布边界、版本确定性、启动语义与数据隔离的变化必须先更新本设计并重新确认。

1. **cordis import 边界**：`@deepseek-ai/cordis` 的类型与运行时适配只出现在 `@wopal/ellamaka-cordis` 包内。生产运行时值经 installAnchor resolver 从物化闭包获取。
2. **DSH 依赖真相源**：`ellamaka-cordis` 的 `dependencies` 只显式声明 Bridge 使用的官方直接依赖，并使用精确版本。构建生成的 `dsh-runtime-manifest.json` 携带直接依赖精确版本，`dsh-runtime-lock.json` 携带完整传递依赖树与 integrity；运行时不维护第二份手工清单，也不在运行时解析依赖树。
3. **dsh 深耦合包暂缓使用**：agent-loop/session/session-query/compaction/subagent/schedule 及任何 rt-import dsh-session 的包，暂不被主线代码 import、不在运行时加载、不作为插件挂载。required peer 进入 node_modules/bun.lock 仅供类型解析。运行时加载探针（`forbidden-load.test.ts`）作为当前状态的观测手段保留。
4. **session 所有权**：持久化与事件定义归 Storage/Bus/EventV2；Cordis 层只持有 facade。
5. **对外契约稳定**：SSE 事件、HttpApi、SDK 在实验中保持稳定。
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
18. **插件安装零外部工具链**：安装器不 forward 系统包管理器（pnpm/npm），复用 Runtime Manager 的 pacote + registry 测速基建；用户插件的传递树由内置最小解析器在运行时解析（§6.6 已验证可行）。
19. **安装命令式、配置双轨**：插件安装与 dsh 界面侧的插件配置走命令式并即时生效；集成到 ellamaka 的工具投影配置走 settings.jsonc（与 §5.1 空间级隔离一致）。
20. **approval 原生边界**：dsh approval 插件以官方原版使用（不 fork、不修改官方闭包）。宿主侧只补齐 session facade 前置条件并经 answerer 桥接决策；审批审计对落内存不落盘，工具容器不持久化任何会话。

---

## 8. 生产物化验收基线

> 本节是物化机制的完成判据，已于 2026-09-01（P5 批次）全部达成，进入维护态。

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

## 9. 插件供应链（目标设计）

> 状态：spike 已验证技术地基（§6.6），本节为实施设计基线。

### 9.1 定位与原则

PoC 前期只开放了官方闭包内的工具投影一条窄缝：第三方 dsh 插件没有任何安装通道，profiles 手编 YAML 与 ellamaka 配置体系割裂。本节把 dsh 插件升级为 ellamaka 的一等公民：**命令式安装、即时生效、跨重启保留**。dsh 插件的动态生效（装完即用）是 ellamaka 插件（重启生效）不具备的差异化能力，是 PoC 转正的核心价值。

三条原则：

1. **安装共享、启用按 profile**（§7 约束 17）：web 与 tools 两容器同进程同闭包，安装动作全局一次；激活按容器声明。per-profile 双版本 skew 是伪需求。
2. **闭包分层**：官方闭包保持不可变（§3.4 的版本确定性地基不动）；用户插件装到独立的可变安装区。官方闭包是"产品发布时刻的依赖快照"，不承担插件生态容器职责。
3. **零外部工具链**（§7 约束 18）：不依赖系统 pnpm/npm。

### 9.2 安装区布局

```text
$WOPAL_HOME/dsh/plugins/
├── installed.json               ← 真相源
│                                  [{ name, version, source, enabledIn: ["web","ellamaka-tools"], installedAt }]
└── <pkg>/<version>/             ← 每插件独立目录（原地升级替换，不做指纹代数）
    ├── package.json
    └── node_modules/            ← 该插件的传递依赖子树（含嵌套同名不同版本）
```

- **官方包不重装**：插件依赖 `@deepseek-ai/*` 时经 `profiles/node_modules` symlink 解析到闭包（heal 机制扩展一个遍历源），与官方运行时版本天然一致，无 skew。
- **可变目录语义**：命令式操作配可变目录，升级=替换目录+更新 installed.json；与闭包"只增不减"的 immutable 语义解耦。
- **installed.json 是唯一真相源**：profiles 的 bundles 清单由 Plugin Manager 依据它生成同步；用户手编 cordis.yml 的 bundles 段不再被读取（补丁层 `cordis.patch.yml` 保留为用户逃生口，见 §9.5）。

### 9.3 命令面

```sh
ellamaka dsh plugin add <pkg>[@version] [--profile web,tools]   # 缺省启用两个 profile
ellamaka dsh plugin remove <pkg>
ellamaka dsh plugin enable <pkg> --profile <name> | disable <pkg> [--profile <name>]
ellamaka dsh plugin list [--json]
```

对应 npm 心智：命令式动作 + installed.json 持久化，重启后依然在。所有命令经由 Bridge 的 `internal.import` 缝隙驱动运行中容器，**不需要 dsh 官方 CLI 在场**。

### 9.4 add 流水线

```text
解析 spec → BFS 解析传递树（abridged packument + semver + hoist，§6.6）
        → pacote 按解析树逐包下载解压到 plugins/<pkg>/<version>/（复用物化器基建 + registry 测速）
        → 校验入口：package.json 声明 dsh.bundle.patch（bundle）或纯库依赖（警告安装）
        → 写 installed.json → 重跑 symlink heal → 更新 profiles bundles 清单
        → 运行中容器热挂载（loader.create / include update，§6.6 路径 A/B）
        → adapter 侧 tool.provider hook 下一轮自动可见（P3.5 已有机制）
```

- **热挂载按容器分别执行**：对 tools 容器直接 `loader.create`；对 web 容器经 include patch 同步（浅合并契约，§6.6.3）。启动中的容器（preparing 状态）跳过热挂载，待 Load 阶段由清单自然生效。
- **失败语义**：解析或下载失败 → 不写 installed.json、不触碰容器，命令返回非零并保留诊断；半安装状态只存在于 staging 临时目录，不参与解析。卸载 = `loader.remove` + include 反向 patch + 删除目录 + 更新清单，effects 自动反解。
- **并发**：与物化共用 `locks/` 目录的跨进程文件锁（`plugins.lock`），多进程同时 add 串行化；同进程经 Plugin Manager 单飞。

### 9.5 配置与信任

- **配置双轨**（§7 约束 19）：工具投影侧——某插件的工具是否投影进 ellamaka、以何白名单——走空间级 `settings.jsonc`（`ellamaka.dsh.tools` 段），与 §4.3 adapter 映射白名单合并；dsh 界面侧——插件在 web 容器内的 entry 级配置——命令式（`ellamaka dsh plugin config <pkg> <yaml>`）写入该插件的补丁层，动态生效。profile 的 `cordis.patch.yml` 降级为 Plugin Manager 的生成物 + 高级逃生口。
- **信任边界**：命令式安装是用户显式动作，初期免安装确认，只做 tarball 完整性（integrity）校验；第三方插件与 ellamaka 同进程执行、能碰 fs/shell 的风险在 `plugin add` 输出中明示。不新造权限体系。

### 9.6 验收基线

| # | 能力 | 验收结果 |
|---|------|----------|
| 1 | 安装 | `add` 在无系统包管理器的环境下完成第三方 dsh 插件安装，传递树完整，`@deepseek-ai/*` 依赖走闭包 symlink |
| 2 | 即时生效 | 运行中的 serve 进程内 `add` 后：web 容器新插件 entry 激活、UI 可见；tools 容器新工具下一轮模型请求可见；全程无重启 |
| 3 | 持久化 | 重启后插件清单与激活状态与安装时一致；installed.json 是唯一真相源 |
| 4 | 卸载/禁用 | `remove`/`disable` 后 effects 反解、工具从 registry 消失、内置同名工具自动恢复 |
| 5 | 失败语义 | 网络失败、解析失败、坏包均不污染 installed.json 与运行容器；有可诊断输出 |
| 6 | 并发 | 多进程并发 add 串行化；半安装状态不参与解析 |
| 7 | 隔离 | 插件安装不触碰闭包、不读写 `~/.dsh`、不引入 `DSH_HOME`/`DSH_PERMISSION_MODE` env |

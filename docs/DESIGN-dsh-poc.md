# DESIGN-dsh — ellamaka 与 dsh 融合架构设计

> **状态**: 正式设计（由 PoC 验证后定稿）
> **上级架构**: `DESIGN.md`
> **技术依据**: `research/deepseek-harness-architecture-and-integration-research.md`（dsh 全景调研）

本文档定义 ellamaka 与 dsh（DeepSeek Harness）融合后的目标架构。融合机制已经 PoC 完整验证可行，后续工作为细节优化与新增功能插件，本文档作为该架构的正式设计基线。

**阅读地图**：§2 架构总览 → §3 运行时机制 → §4 能力采用 → §5 配置与隔离 → §6 已验证事实 → §7 设计约束。

---

## 1. 背景与目标

ellamaka 是 WopalSpace 的引擎（OpenCode fork）。为获得沙箱执行、插件生态、动态装载等能力，ellamaka 在自身进程内集成 dsh 引擎，形成双引擎融合架构。

**设计目标**：

1. **单一进程**：ellamaka 与 dsh 运行于同一进程，共享一个公开端口。
2. **能力复用**：ellamaka 直接采用 dsh 的工具能力（沙箱、搜索、文件操作），不重复实现。
3. **会话归属**：ellamaka 拥有会话与状态所有权；dsh 侧不创建持久会话，只提供执行能力。
4. **对外稳定**：ellamaka 的 API、SSE 事件、SDK 契约不因融合而变化。

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
└── 工具容器（ellamaka-tools profile，无 webserver）
      └── globalThis.__ellamakaDshContainer → dsh-adapter 调用工具
```

**两个容器必须分离**的原因：Web UI 需要 dsh 的完整 agent-loop 语义（会话账本 + checkpoint 屏障 + 完整插件集）；工具采用只需要工具本体 + 最小调用上下文。同一容器无法同时满足两种装配——checkpoint 插件会强制 flush 调用方的 live session（§6.4）。

**入口分工**：

- CLI serve 与 TUI：挂载 Web 容器 + 工具容器
- Desktop sidecar：挂载 Web 容器 + 工具容器（boot 系列自建容器）
- TUI：只挂工具容器（无 iframe 需求）

### 2.2 组件清单

| 组件 | 位置 | 职责 |
|------|------|------|
| `VirtualWebServer` | `@wopal/ellamaka-cordis` | 实现 dsh 官方 WebServer 接口，提供路由/upgrade 分发，不创建监听 socket |
| 受控路由挂载点 | `Listener.mountNodeRoute` | 按前缀分发 HTTP/upgrade 到已注册 handler，保留 Effect listener 生命周期 |
| dsh 引擎装配 | `@wopal/ellamaka-cordis/dsh-web` | 重放 dsh boot 序列，构造两个容器；覆盖 `ctx.dshHomePath` 与插件 `dshHome` 配置注入，落地运行时隔离（§3.4） |
| dsh-adapter | `.wopal/plugins/dsh-adapter` | 把工具容器中的工具投影进 ellamaka ToolRegistry |
| DSH home | `$WOPAL_HOME/dsh` | 依赖闭包、profile 定义与运行时 state 的唯一物化位置 |
| 物化脚本 | `packages/opencode/script/materialize-dsh.ts` | ellamaka 侧物化参考实现（依赖清单 + arborist 安装 + profile 预置）；onboarding 提前物化由 wopal-cli setup 承载 |

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

**唯一 home**：`$WOPAL_HOME/dsh`。dev（serve/TUI）、Web 与 Desktop sidecar 读取同一位置。ellamaka 集成只用 `$WOPAL_HOME`，**永不使用 `$DSH_HOME`，永不设置 `DSH_HOME` 环境变量**；`~/.dsh` 归 dsh 官方 CLI 专用，ellamaka 不在其内读写。

```text
$WOPAL_HOME/dsh/
├── package.json          ← 声明 7 个 dsh 依赖 + @wopal/ellamaka-cordis
├── node_modules/         ← 完整依赖树，顶层扁平安装
├── profiles/             ← profile 定义（web / ellamaka-tools）
│   ├── web/
│   ├── ellamaka-tools/
│   └── node_modules/     ← 快捷方式目录（挂载时自动重建）
└── state/                ← dsh 引擎运行时数据（settings/sessions/storages/...）
```

**运行时隔离**：dsh 引擎的运行时数据（settings、credentials、匿名用户 ID、sessions、storages、home patch）与依赖闭包、profile 定义三者同根但分目录，全部落在 `$WOPAL_HOME/dsh` 下。运行时数据归 `state/`，与官方 dsh CLI 完全隔离。

隔离采用**纯配置注入，零环境变量**。dsh 引擎解析 home 有两条机制，ellamaka 分别覆盖：

| 机制 | 说明 | 隔离方式 |
|------|------|---------|
| `ctx` 注入的 `dshHomePath` | profile 配置 `!!js dshHomePath(...)` 表达式经 `with(ctx){eval}` 求值，覆盖 storages/sessions | 装配时 `ctx.provide("dshHomePath", (...s) => join(stateDir, ...s))` |
| 插件直接 `import { resolveDshHome }` | settings/credentials/agent-instructions/shell-env/skill-fs/attachment 等读 `config.dshHome` | 在 profile patch 层给各插件传 `dshHome: $WOPAL_HOME/dsh/state` |
| 无配置注入的例外 | `llm-deepseek` 上传索引、`anonymous-user-id` | 装配时用显式 `path` / `options.env` 参数传入 |

两种机制殊途同归，最终都落在 `$WOPAL_HOME/dsh/state`，**不依赖 `DSH_HOME` env**。官方 dsh CLI 无论同进程还是独立进程，都感知不到任何污染。

**启用开关（统一语义）**：`ELLAMAKA_DSH` 是**禁用开关（kill switch）**，默认开启。CLI（serve/web/TUI）与 Desktop sidecar 统一遵循：

- 未设置或 `ELLAMAKA_DSH != 0` → 启用 dsh（物化缺失时由各入口自行物化或引导）
- `ELLAMAKA_DSH=0` → 完全禁用 dsh，回到无 dsh 基线

**物化机制**：生成 `package.json`（7 个 `@deepseek-ai/*` 依赖 + `@wopal/ellamaka-cordis`）→ 安装依赖树 → 预置 profile 模板 → 验证锚点与 Node strip-types 导入 dsh-web。幂等：已存在的 profile 与补丁不覆盖。安装引擎为 `@npmcli/arborist`（纯 JS，无外部包管理器依赖），不依赖系统 bun。dsh 依赖清单、profile 模板与安装编排由 `packages/opencode/script/materialize-dsh.ts` 承载，作为 ellamaka 侧的物化参考实现。

**物化触发分两条路径**：

- **提前物化（向导路径）**：`wopal setup` / Desktop onboarding 在安装配置阶段完成物化，让首次启动 Workbench 时依赖已就位。编排见 `DESKTOP-ONBOARDING.md` §5.3 与 `../../../projects/wopal-cli/docs/DESIGN.md` §6.3。
- **运行时兜底（ellamaka 路径）**：`ELLAMAKA_DSH` 启用时，dev（CLI serve/web/TUI）与 Desktop sidecar 装配 dsh 前检查闭包锚点；缺失则物化后挂载，失败则降级为无 dsh 运行并提示。兜底保证 onboarding 被跳过时 dsh 仍可用，与插件依赖安装的运行时兜底语义一致（$WOPAL_HOME/plugins 首次使用即装；dsh 闭包首次装配即物化）。

**依赖解析（installAnchor）**：

- dev 模式：`require.resolve("@deepseek-ai/dsh/package.json")` 解析到 workspace 的 node_modules
- Desktop sidecar：bundle 不携带 dsh 包，installAnchor 显式指向 `$WOPAL_HOME/dsh/node_modules/@deepseek-ai/dsh/package.json`

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

---

## 7. 设计约束

> PoC 场景不设红线，一切边界可讨论、可变更。以下为当前生效的约定，任何调整需经用户与实施方双方确认。

1. **cordis import 边界**：`@deepseek-ai/cordis` 只出现在 `@wopal/ellamaka-cordis` 包内（版本锁 4.0.1）。
2. **dsh 依赖显式声明**：`ellamaka-cordis` 只显式声明源码真实 import 的 dsh 依赖，不声明凑数依赖。版本统一 `0.1.1-rc.2`，依赖锁定交给 `bun.lock`；root overrides 不再锁 `@deepseek-ai/*`。
3. **dsh 深耦合包暂缓使用**：agent-loop/session/session-query/compaction/subagent/schedule 及任何 rt-import dsh-session 的包，暂不被主线代码 import、不在运行时加载、不作为插件挂载。required peer 进入 node_modules/bun.lock 仅供类型解析。运行时加载探针（`forbidden-load.test.ts`）作为当前状态的观测手段保留。
4. **session 所有权**：持久化与事件定义归 Storage/Bus/EventV2；Cordis 层只持有 facade。
5. **对外契约稳定**：SSE 事件、HttpApi、SDK 在实验中保持稳定。
6. **桥接的加法原则**：桥接优先为新增文件/包装层，保持删除桥即回滚的能力。
7. **wopal-plugin 原生边界**：wopal-plugin 继续作为 ellamaka 原生插件运行。只采用独立 dsh 能力，不拆分或迁移 wopal-plugin。
8. **工具容器边界**：工具调用走专用工具容器（ellamaka-tools profile），容器内不创建任何 dsh session；adapter 只传递工具实测消费的最小 per-call context。web 容器保持完整 profile，不复用为工具后端。禁用清单是 profile 的用户补丁层，ellamaka 仅在模板为空时播种、不覆盖用户编辑。
9. **空间隔离**：容器装配是进程级共享能力池，空间差异在投影层解决。
10. **DSH home 唯一**：依赖闭包、profile 定义与运行时数据只物化在 `$WOPAL_HOME/dsh`；ellamaka 集成永远只用 `$WOPAL_HOME`，不用 `$DSH_HOME`，**永不设置 `DSH_HOME` env**。`~/.dsh` 归 dsh 官方 CLI 专用，ellamaka 不在其内创建、修改或删除任何内容。
11. **启用开关统一**：`ELLAMAKA_DSH` 是禁用开关，默认开启。CLI 与 Desktop 统一以 `ELLAMAKA_DSH=0` 禁用，未设置或 `!=0` 启用。无其他分支启用方式。
12. **运行时隔离**：dsh 运行时数据经纯配置注入落 `$WOPAL_HOME/dsh/state`，与闭包/profiles 分目录，与官方 `~/.dsh` 完全隔离。隔离不依赖 `DSH_HOME` env。

---

## 附录 A. 历史与演进记录

> 本节记录实现过程中被放弃或替换的方案，供追溯，不属于当前目标架构。

### A.1 端口架构：双端口 → 单端口

早期实现采用双端口：ellamaka 监听 4097，dsh webserver 监听第二 loopback 端口（CLI 固定 4098，Desktop 随机），`dshPort` 协议贯穿全链路。后因跨端口带来的第二端口发现协议、Desktop 随机端口管理、HMR 与同源语义割裂，改为单端口方案（§3.1）。双端口自此为历史决策。

### A.2 被否定的早期路线

| 路线 | 否决原因 |
|------|----------|
| 前端薄壳 + vite 代理 | 目标要求单进程集成；thin-shell 被 iframe 取代 |
| 每实例 CordisHub 装载 | 装不下 dsh 引擎；instance 隔离由容器 per-directory scope 承接 |
| 单 server 注入 dsh webserver | `/api` 冲突 + 改 bundle 破坏生态兼容 |
| `/api` namespace 化 | 静态 bundle 不含 `/api`，硬编码在运行时插件 bundle 里，改 bundle 破坏社区插件 |

### A.3 DSH home 收口

早期存在三个交叠 home（`~/.dsh`、`~/.wopal/ellamaka/data/dsh`、`$WOPAL_HOME/ellamaka/cache`），职责不清、依赖分散。收口为唯一 `$WOPAL_HOME/dsh`。

### A.4 工具结果契约映射

早期 adapter 未透传 dsh 工具的 `meta`，导致 Workbench 工具条文件路径显示为空、diff 视图不渲染。已在 adapter 补齐（§4.3 参数映射与结果映射）。

### A.5 未采用的候选能力：web 搜索

dsh 的 `web_search` 工具（DeepSeek provider）经评估后未采用。原因：唯一随闭包发布的 provider 依赖 DeepSeek Anthropic 兼容 Messages API，每次搜索是一次完整模型调用（非纯检索端点，需付费）。用户已有更低成本的等价路径（Exa MCP / skill），无需桥接。此决策不影响架构；`ctx.web` 的 provider 注册表 + 执行时选择 + 结构化错误码设计仍可作为原生 web 能力实现的参考。

### A.6 运行时隔离：拒绝 `DSH_HOME` env，采用纯配置注入

PoC 前期 dsh 引擎运行时数据落在 `~/.dsh`（settings/credentials/sessions/storages），与闭包 `$WOPAL_HOME/dsh` 分离。初拟方案为在装配时设 `process.env.DSH_HOME = $WOPAL_HOME/dsh/state` 重定向——只需设一个 env 即可覆盖全部路径。

经评估否决：`DSH_HOME` 是 dsh 官方 CLI 的保留环境变量，ellamaka 复用它带来语义混淆与继承污染（从 ellamaka 进程 fork 官方 CLI 时子进程继承 `DSH_HOME` 会写入错误位置）。改为**纯配置注入**：`ctx.provide("dshHomePath", ...)` 覆盖 `!!js` 表达式路径 + profile patch 层给插件传 `dshHome` 配置 + 两个例外用显式参数。完全不设 env，官方 CLI 无感知。dsh 官方本身将 `resolveDshHome(configured, ...)` 的显式配置作为最高优先级，此方案利用官方原生支持、不改依赖。

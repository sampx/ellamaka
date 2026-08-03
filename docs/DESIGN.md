# Ellamaka

> **状态**: Active
> **更新时间**: 2026-08-03
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`

## 1. Role

ellamaka 是 OpenCode fork，WopalSpace 的执行引擎。它同时承载非 WopalSpace 与 WopalSpace 两种运行模式，负责配置加载、capability composition、ontology 运行时物化、plugin 执行与权限系统。

不负责：空间初始化、ontology 内容设计、空间运行态维护——这些归属 wopal-cli、Space Ontology 和 `.wopal-space/`。

### 1.1 设计文档关系

| 文档                    | 职责                                                                  | 关系                                       |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| **BRANDING.md**         | 品牌化定制真相源：逐文件、逐行、逐模式记录所有上游注入变更            | 定制实现细节的唯一权威；本文件不重复其内容 |
| **DESIGN.md**（本文件） | 架构概览：适配点总表、配置契约、ontology 加载契约、状态归属           | 描述"是什么"和"有什么"，不描述"怎么改"     |
| **RELEASE-IDENTITY.md** | CLI/Desktop 产品 SemVer、OpenCode upstream、build identity 与兼容选择 | 发布身份唯一真相源                         |
| **DISTRIBUTION.md**     | 发布/分发设计：workflow、artifact contract、安装路径、R2 CDN          | 消费 ReleaseIdentity，不复制版本算法       |

定制实现细节（哪些文件改了、用什么模式注入、改动行数）一律见 **BRANDING.md**，本文件仅保留适配点索引和节号引用。

## 2. WopalSpace Adaptations

ellamaka 继承上游 OpenCode 全部 agent runtime、TUI/Web、session、tool、plugin 能力。WopalSpace 适配通过以下最小 fork delta 实现。详细注入模式、改动行数和具体代码见 **BRANDING.md**。

| 适配点                    | 概要                                                                                              | BRANDING.md 节号  |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ----------------- |
| WopalSpace 自动检测       | CLI 从 cwd 检测单一空间；sidecar 按 instance directory 解析独立空间根                             | §5                |
| 全局路径分离              | `$WOPAL_HOME/config` + `$WOPAL_HOME/ellamaka/{data,cache,state}`                                  | §5                |
| 非 WopalSpace 模式        | 配置入口迁移至 WOPAL_HOME；capability loading 保持 OpenCode-compatible 并叠加 WOPAL_HOME 全局能力 | §6.2              |
| WopalSpace 模式           | 从 instance space root 加载 `.wopal/` 配置和能力；空间根与任意子目录共享同一 context              | §6.1              |
| Instance 运行模式         | 按 directory 检测空间根；server 不使用进程 env 表达当前空间                                       | §8                |
| Agent/Command/Plugin 加载 | 从 `.wopal/` 加载同名可覆盖内置                                                                   | §2, §5.1          |
| 权限合并                  | defaults → global → space settings → agent frontmatter                                            | §3（本文件）      |
| 引擎安装识别              | 识别 `$WOPAL_HOME/bin/` 安装路径                                                                  | §4.8              |
| Skill 加载                | base/user 并发解析，space overlay 按序覆盖                                                        | —                 |
| Branding & build          | BINARY_NAME、构建包装、CLI 品牌常量                                                               | §2–§4             |
| TUI 空间配置              | `settings.jsonc` 的 `tui` 字段和主题目录                                                          | §4.7              |
| Web UI 产品化             | Fork 上游 `packages/app` 为 `packages/ellamaka-app`，承接 poc/web 验证的产品形态                  | §9（本文件），§15 |
| Runtime API 与 SDK        | Effect HttpApi schema → OpenAPI → 生成 SDK；Wopal CLI adapter 将空间控制能力映射为 Runtime API    | §7.1（本文件）    |

上游文件改动遵循：新文件优先、提前返回 guard、回调注入、禁止格式化重排。完整策略和合并保护文件清单见 **BRANDING.md §9**。

## 3. Configuration Contract

Ellamaka 运行时包含两种模式：

- **非 WopalSpace**：当前 instance 没有 `wopalSpaceRoot`。配置入口由 WOPAL_HOME 所有，capability loading 保持 OpenCode-compatible 的目录发现和覆盖机制，并在末层叠加 WOPAL_HOME 全局能力。
- **WopalSpace**：当前 instance 的 `wopalSpaceRoot` 是空间根。当前 directory 可以是空间根或其任意子目录，配置和能力始终从这个根加载。

WopalSpace 模式下配置加载优先级（低→高）：

| 层级                 | 来源                                                     |
| -------------------- | -------------------------------------------------------- |
| Built-in defaults    | ellamaka 内置                                            |
| Global config        | `$WOPAL_HOME/config/settings.jsonc`                      |
| Space settings       | `<space>/.wopal/config/settings.jsonc` → `ellamaka` 字段 |
| Agent frontmatter    | `<space>/.wopal/agents/*.md`                             |
| Environment override | `OPENCODE_CONFIG_CONTENT`                                |

权限合并同此优先链，按最后匹配项生效。非 WopalSpace 模式的配置文件入口迁移至 `$WOPAL_HOME/config/settings.jsonc`，不加载 opencode XDG 全局配置；agents、commands、plugins、skills 与外部技能继续遵循 OpenCode-compatible capability loading，并由 `$WOPAL_HOME` 提供 Ellamaka 全局覆盖层。

## 4. Ontology Loading Contract

| 加载面   | 来源                                             | 行为                                           |
| -------- | ------------------------------------------------ | ---------------------------------------------- |
| Commands | `.wopal/commands/`                               | 可覆盖内置命令                                 |
| Agents   | `.wopal/agents/`                                 | Markdown 定义 agent 身份与 frontmatter         |
| Plugins  | `.wopal/plugins/`                                | 向 runtime 暴露 plugin tools                   |
| Settings | `.wopal/config/settings.jsonc`                   | `ellamaka` 字段配置 engine，`tui` 字段配置 TUI |
| Skills   | `$WOPAL_HOME/skills/` → `<space>/.wopal/skills/` | 并发解析 + 按序合并，右侧优先                  |

## 5. Upstream Merge Boundary

| 规则     | 说明                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| 分支     | `main` = 定制稳定线；`dev` = 跟踪 upstream/dev，不作为开发主线                        |
| 合并方向 | upstream/dev → merge to main                                                          |
| 裁剪前缀 | 见 `UPSTREAM-MERGE-LOG.md`（desktop、enterprise、slack、nix、specs 等非 engine 组件） |

详细合并流程、合并保护文件清单、定制代码最小侵入原则、冲突热点和验证清单见 **BRANDING.md §9**。

## 6. Distribution

Ellamaka CLI 构建为多平台 standalone binary，Desktop 构建为原生安装包。两者分别使用标准 SemVer、namespaced tag、workflow 和 latest feed。Desktop manifest 声明 upstream baseline、engine API range 与 Wopal CLI requirement；Wopal 读取 CLI stable latest 并验证 requirements，把两个独立制品组合为完整产品。`wopal ellamaka install` 默认安装完整产品，`--headless` 只安装外部 CLI。

构建入口：CI 中 `publish-ellamaka.yml` 直接调用 `packages/opencode/script/build.ts --p1` 并注入 env；本地开发使用 `packages/ellamaka/build.ts` 包装脚本。

Setup Center 将 ontology base capabilities 物化到 `WOPAL_HOME` 后，ellamaka 按现有 user/base + space overlay 链路加载。外部 CLI 的安装收据位于 `$WOPAL_HOME/ellamaka/state/`，`bin/` 只保存 executable。

详细 artifact contract 见 `docs/DISTRIBUTION.md`。

## 7. State Ownership

| 状态                             | 位置                                                  | Owner                                                                                 |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Global config                    | `$WOPAL_HOME/config/`                                 | ellamaka                                                                              |
| Runtime data                     | `$WOPAL_HOME/ellamaka/data/`                          | ellamaka                                                                              |
| Cache                            | `$WOPAL_HOME/ellamaka/cache/`                         | ellamaka                                                                              |
| Process state                    | `$WOPAL_HOME/ellamaka/state/`                         | ellamaka                                                                              |
| Instance WopalSpace root         | 当前 directory 的检测结果                             | `undefined` 表示非 WopalSpace；绝对路径表示 WopalSpace                                |
| CLI WopalSpace compatibility env | CLI 单进程运行期的 `WOPAL_SPACE` / `WOPAL_SPACE_ROOT` | CLI 入口；不作为 sidecar 当前空间状态                                                 |
| Wopal CLI 健康                   | `$WOPAL_HOME/bin/wopal` 的短时探测结果                | `CliContract`，CLI 二进制保持版本事实来源                                             |
| 空间 ontology                    | `<space>/.wopal/`                                     | Space Ontology，ellamaka 加载                                                         |
| 空间运行态                       | `<space>/.wopal-space/`                               | space runtime；wopal-plugin 按 instance root 写日志，Ellamaka engine 不拥有其目录结构 |

### 7.1 Runtime API 与 SDK 契约

Ellamaka 的 HTTP API 是 Workbench 和外部集成使用运行时能力的唯一网络表面。领域 schema 同时驱动 Effect HttpApi 路由、运行时校验、OpenAPI 和生成 SDK。Root API 承载全局控制能力，Instance API 承载工作目录相关运行时能力。

Workbench Session Projection 是左侧会话列表的服务端只读模型，只返回 `time_archived IS NULL` 且 `parent_id IS NULL` 的 Session。归档会话和子会话不属于可直接装载的根会话资源。

Wopal CLI adapter 作为 Runtime 的领域服务使用 `wopal ... --api-version` capability。它维护非权威空间快照，并将稳定的 CLI 结果映射为 Ellamaka 领域资源和错误。adapter 位于 sidecar 内，直接 spawn wopal 进程；wopal 调用是无状态进程边界，不引入专门的常驻 worker。消费侧 schema 从 wopal 共享契约包导入，与 wopal 的 TypeBox 契约同源。浏览器只使用 Ellamaka API。

`CliContract` 将 CLI 安装状态与能力调用分开处理。`/global/health` 公开最低版本、已检测版本与兼容状态。CLI 不可用时，Ellamaka 保持 Session Runtime，Workbench 将 Space Control 降级为可恢复状态。用户确认修复后，Runtime 使用已安装 CLI 的更新命令或第一方 installer 修复二进制，并重新探测状态；sidecar 与已有 Workbench 现场继续运行。

完整的路径语义、schema、错误、版本、SDK 生成和端点门禁见 [API-CONTRACT.md](./API-CONTRACT.md)。

### 7.2 Sidecar Instance Context

一个 sidecar 同时服务多个 directory instance。配置加载和插件创建从当前 directory 直接检测可选的 `wopalSpaceRoot`。空间根与空间内任意子目录得到同一个 root；非 WopalSpace instance 不继承其他空间状态。

PluginInput 通过可选 `wopalSpaceRoot` 字段接收当前 instance 的空间根。字段缺失表示非 WopalSpace。插件使用该字段定位空间级资源，普通 Engine 运行时保持上游环境与子进程行为。

`WOPAL_HOME` 是 sidecar 的进程级安装根。它拥有全局配置、全局能力和运行时存储。`WOPAL_SPACE` 与 `WOPAL_SPACE_ROOT` 只服务单目录 CLI 兼容边界，不承担 server request routing 或 plugin context 所有权。

## 8. Web UI 与 ellamaka-app

### 8.1 背景

WopalSpace 需要 Web UI 作为 TUI 之外的第二种用户界面。经过 PoC 验证(`poc/web`)——确认 Web TUI 可行、多空间并行可行、TUI+Chat 融合可行——需要以正式技术栈承载产品形态。

### 8.2 设计决策

**不在 PoC 基础上迭代,而是 fork 上游 `packages/app` 为 `packages/ellamaka-app`**:

| 方案                                              | 决策    | 原因                                                                              |
| ------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| 直接修改 `packages/app`                           | ❌ 否决 | 侵入上游源码,合并上游 `opencode` 更新时冲突面大                                   |
| 在 `poc/web` 基础上迭代                           | ❌ 否决 | PoC 代码质量和架构无法承接产品化(单文件 1025 行、裸 JSON 协议、CDN 外部依赖)      |
| **Fork `packages/app` → `packages/ellamaka-app`** | ✅ 采纳 | 复用现有基础设施(core/sdk/ui/i18n/terminal/theme);保持上游同步能力;定制与上游解耦 |

### 8.3 详细规约

关于 `ellamaka-app` 工作台（Workbench）的具体界面、视图模型（TUI/Chat/Split 面板模型）、详细目录架构、上游同步细节、PoC 能力迁移规约以及与 `wopal-cli` 的协同，请参阅独立的详细设计规范文档：

- 中文版：[WORKBENCH.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/WORKBENCH.md)

---

## 9. Related Documents

| 文档                              | 引用目的                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| `./BRANDING.md`                   | 品牌化定制唯一真相源—                                          |
| `./API-CONTRACT.md`               | Runtime API、OpenAPI、生成 SDK 与 Wopal CLI adapter 契约       |
| `./WORKBENCH.md`                  | ellamaka 自定义工作台 app 设计                                 |
| `./RELEASE-IDENTITY.md`           | CLI/Desktop 独立 SemVer、OpenCode upstream、构建身份与兼容选择 |
| `./DISTRIBUTION.md`               | release、artifact、安装契约                                    |
| `../../wopal-cli/docs/DESIGN.md`  | wopal-cli 如何消费 ellamaka release                            |
| `UPSTREAM-MERGE-LOG.md`           | 裁剪边界、合并策略、验证经验                                   |
| `packages/opencode/AGENTS.md`     | engine package 内部规则                                        |
| `packages/ellamaka-app/AGENTS.md` | ellamaka 官方 web UI 包级开发规则                              |

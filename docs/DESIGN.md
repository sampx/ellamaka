# Ellamaka

> **状态**: Active  
> **更新时间**: 2026-05-30  
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`  
> **上级产品**: `../../../docs/products/wopal-space/PRD-wopalspace.md`

## 0. Change Log

| 日期 | 类型 | 摘要 |
|------|------|------|
| 2026-05-31 | Updated | Skill loader 改为确定性覆盖：user/base 先加载，space overlay 同名稳定覆盖。 |
| 2026-05-30 | Updated | 将详细分发契约下沉到 `docs/DISTRIBUTION.md`，本文件仅保留 release 与安装边界摘要。 |
| 2026-05-30 | Updated | 增加独立分发契约：多平台 standalone binary、release artifacts、checksum、installer 与下游消费接口。 |
| 2026-05-30 | 创建 | 定义 ellamaka 作为 WopalSpace Engine 的项目职责、边界、架构模块、配置契约、上游跟踪策略与状态模型。 |

## 1. Project Role

ellamaka 是 WopalSpace 的执行引擎，是基于 OpenCode 的 fork。它负责承载 Agent 会话、TUI/Web、Provider Auth、Command、Agent、Plugin、权限系统、配置加载与 wopal-space mode，让 WopalSpace 的本体能力可以被真实运行。

ellamaka 的核心边界是“解释并运行空间本体”，而不是“生成、治理或规划空间本体”。它不承担产品路线、空间结构维护、用户记忆沉淀或 ontology 内容创作；这些分别属于 WopalSpace 产品层、space runtime、Space Ontology 与 wopal-cli。

| 负责 | 不负责 |
|------|--------|
| 继承并运行 OpenCode 的核心 agent engine 能力 | 定义 WopalSpace 的产品愿景、空间治理原则或阶段路线 |
| 提供 `--wopal-space` 模式，让 engine 能理解当前 space 的 `.wopal/` 本体能力 | 维护 `.wopal-space/STRUCTURE.md`、`REGULATIONS.md`、用户记忆或空间文档 |
| 加载 WopalSpace ontology 中的 commands、agents、plugins、settings 与 TUI 配置 | 编写 ontology 内容本身，包括 skills、commands、rules、agent souls |
| 管理 ellamaka 自身的全局配置、数据、缓存、状态与日志路径 | 承担确定性的空间初始化、安装、诊断与项目编排；这些属于 wopal-cli |
| 保持与 upstream OpenCode 的可追踪 fork 关系 | 将 WopalSpace 能力重新实现为独立 engine |
| 维护上游合并边界、裁剪边界和 fork delta 最小化策略 | 承接 upstream 的全部产品形态、发布体系、云服务与非空间组件 |

## 2. Capability Scope

ellamaka 的目标态能力范围包括：

| 能力组 | 目标态边界 |
|--------|------------|
| Agent Runtime | 提供 OpenCode 继承而来的会话、模型调用、工具执行、权限控制、上下文处理、TUI/Web 交互与 subagent 运行基础。 |
| WopalSpace Mode | 通过 `--wopal-space` 开关进入空间模式，识别当前工作区中的 `.wopal/`，加载空间级本体配置与能力。 |
| Configuration Loading | 在普通 OpenCode 配置链路之外，为 WopalSpace 提供 `~/.wopal/ellamaka/config/`、`.wopal/config/settings.jsonc` 与 `.wopal/agents/*.md` 的配置层。 |
| Ontology Runtime Loading | 从 `.wopal/` 加载 commands、agents、plugins、themes 与相关运行配置，让 ontology 成为可执行能力包。 |
| Plugin Runtime | 运行 `.wopal/plugins/` 中的插件，向 agent 暴露插件工具，并处理本地 path plugin 的依赖安装。 |
| TUI Configuration | 在 TUI 配置中识别 `.wopal/config/settings.jsonc` 的 `tui` 字段，让空间可以提供 TUI 级外观与行为配置。 |
| Distribution and Release | 构建、打包、发布和校验 ellamaka 的多平台 standalone binaries，为独立安装入口和下游产品提供标准化 release contract。 |
| Upstream Compatibility | 保持 OpenCode 原有架构、包结构、命令语义和 runtime 模型，降低 merge upstream 成本。 |
| Upstream Tracking | 使用固定分支策略、裁剪清单、合并记录和验证契约持续跟踪 upstream/dev。 |

明确排除：

| 排除领域 | 归属 |
|----------|------|
| Space 创建、安装、诊断、扫描与确定性维护 | wopal-cli |
| Ontology 内容设计，包括 agents、skills、rules、commands、templates | Space Ontology |
| 空间运行态事实、守则、用户档案、长期记忆 | `.wopal-space/` |
| 产品路线、阶段拆解、跨项目架构契约 | WopalSpace Product DESIGN |
| 项目计划、验收、验证与交付记录 | Phase / Plan / UAT / Verification documents |
| Desktop、SaaS/Cloud 后台、Slack bot、VS Code extension、Python SDK、Nix、上游 docs/site、infra、GitHub Action 等非 WopalSpace Engine 组件 | 上游 OpenCode 或其他项目，不进入 ellamaka fork 的目标边界 |

## 3. Key Decisions

| 决策 | 理由 |
|------|------|
| ellamaka 保持为 OpenCode fork，而不是独立重写 engine | OpenCode 已提供成熟的 agent runtime、TUI/Web、provider、session、plugin 和 permission 基础；fork delta 越小，长期维护成本越低。 |
| WopalSpace 适配通过显式 `--wopal-space` 模式启用 | 空间模式改变配置加载语义，显式开关能避免普通 OpenCode 项目受到 WopalSpace 规则影响。 |
| WopalSpace mode 不加载项目级 `opencode.jsonc` | 空间模式下配置权威来自全局 ellamaka 配置与 `.wopal/` 本体配置，避免当前项目配置污染空间级 Agent 行为。 |
| 全局配置根使用 `~/.wopal/ellamaka/config/` | WopalSpace 需要与 upstream OpenCode 的默认配置根分离，避免用户现有 OpenCode 配置与 WopalSpace runtime 互相污染。 |
| `.wopal/config/settings.jsonc` 使用 `ellamaka` 与 `tui` 分区 | 单一空间配置文件可同时承载 engine 配置与 TUI 配置，但通过字段分区保持职责清晰。 |
| Agent frontmatter 可作为权限与 agent 配置的最高优先级来源 | Agent 身份文件是 WopalSpace 中 agent 行为的直接载体，适合承载与该 agent 强绑定的最终覆盖配置。 |
| 本地 `.wopal/` commands、agents、plugins 参与运行时加载 | Ontology 是空间能力基因，engine 必须把它物化为可执行命令、agent 定义和工具能力。 |
| WopalSpace 定制集中在小型注入点与独立模块 | 独立模块与 guard 分支能降低 upstream merge 冲突，便于区分本地能力和 upstream 能力。 |
| 定制逻辑优先放在新文件 | 上游文件只保留最小 `import` 与调用注入点，避免上游主流程改动与定制逻辑在同一区域冲突。 |
| 定制分支使用提前返回门卫 | `if (flag) { ... return result }` 让 WopalSpace 路径在上游主流程前闭合，减少主流程改动对空间模式的破坏。 |
| 新模块通过回调接口访问上游内部能力 | 闭包注入比直接传递 Effect Service 更稳定，可降低上游类型变更向定制模块扩散。 |
| 上游逻辑需要复用时提取共享辅助函数 | 共享辅助函数避免复制上游逻辑，让普通路径和 WopalSpace 路径在必要处共享后处理语义。 |
| 禁止对上游文件做无关格式化重排 | import 顺序、依赖项、对象 key 的噪音 diff 会放大合并冲突窗口。 |
| 长期裁剪非 WopalSpace Engine 组件 | ellamaka 的产品目标是空间执行引擎，不承担 upstream OpenCode 的全量产品矩阵和发布体系。 |
| TUI 配置链作为独立运行链处理 | TUI 配置不完全经过主 `config.ts`，空间模式必须显式接入 `.wopal/config/settings.*` 的 `tui` 字段。 |
| `WOPAL_SPACE` flag 在 worker + TUI 双实例下必须可读 | TUI/worker 双实例运行时存在 flag 初始化时序问题，空间模式识别必须跨实例稳定。 |

## 4. Module Architecture

| 模块 | 职责 | 载体 |
|------|------|------|
| CLI Entry | 定义命令入口、全局选项和 `--wopal-space` 开关，将空间模式注入运行环境。 | `packages/opencode/src/index.ts` |
| Core Runtime | 继承 OpenCode 的 agent runtime、session、tool、permission、provider、server、TUI/Web 与 project bootstrap。 | `packages/opencode/src/` |
| Configuration Core | 负责普通配置加载、schema 解析、深度合并、provider/agent/plugin/command 配置装配。 | `packages/opencode/src/config/` |
| WopalSpace Config Loader | 在空间模式下发现 `.wopal/`，加载全局配置和 `.wopal/config/settings.jsonc`，装配 commands、agents、plugins。 | `packages/opencode/src/config/wopal-space.ts` |
| WopalSpace Settings Discovery | 发现从当前目录到 worktree 边界之间的 `.wopal/` 目录，并生成空间配置目录序列。 | `packages/opencode/src/config/wopal-space-settings.ts` |
| TUI WopalSpace Config | 从 `.wopal/config/settings.jsonc` 的 `tui` 字段加载 TUI 配置，并让 TUI 读取空间主题目录。 | `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts` |
| Plugin Loading | 加载 `.wopal/plugins/`，处理 path plugin 依赖来源，并向 runtime 暴露 plugin tools。 | `packages/opencode/src/plugin/`, `packages/opencode/src/config/plugin.ts` |
| Agent Loading | 加载 `.wopal/agents/*.md` 与 mode 配置，合并为可运行 agent 定义。 | `packages/opencode/src/config/agent.ts` |
| Command Loading | 加载 `.wopal/commands/*.md` 与命令定义，支持 ontology command 覆盖 built-in command。 | `packages/opencode/src/config/command.ts` |
| Permission System | 合并默认权限、全局权限、空间权限与 agent frontmatter 权限，决定工具调用授权。 | `packages/opencode/src/permission/`, `packages/opencode/src/config/agent.ts` |
| Flag and Global Path | 承载 `WOPAL_SPACE`、`OPENCODE_DISABLE_AGENTS_SKILLS`、`WOPAL_HOME` 与 `~/.wopal/ellamaka/*` 路径体系。 | `packages/core/src/flag/flag.ts`, `packages/core/src/global.ts` |
| Installation Integration | 识别独立安装、下游消费安装与 `.wopal/bin` 安装路径，向 runtime 暴露安装来源与升级通道。 | `packages/opencode/src/installation/index.ts` |
| Release Packaging | 构建多平台 standalone binary、artifact 命名、checksum 与 release manifest。 | `packages/opencode/script/*`, CI workflows |
| Skill Loading | 按目录优先级确定性加载 skills，user/base 先扫描，space overlay 后扫描；同名 skill 由 space overlay 稳定覆盖。 | `packages/opencode/src/skill/` |
| Upstream Merge Boundary | 记录分支策略、裁剪清单、冲突处理规则、保留定制项与合并后验证要求。 | `UPSTREAM-MERGE-LOG.md` |
| Storage and Database | 承载 OpenCode runtime 持久化数据、session storage、Drizzle schema 与 migration。 | `packages/opencode/src/storage/`, `packages/opencode/src/**/*.sql.ts`, `packages/opencode/migration/` |
| UI and App Packages | 提供 Web/App/TUI 相关界面能力，作为 OpenCode inherited surface 保留。 | `packages/app/`, `packages/ui/`, `packages/storybook/` |
| SDK and Integration Packages | 提供 SDK、plugin、script、shared、util 等 workspace package。 | `packages/sdk/`, `packages/plugin/`, `packages/script/`, `packages/shared/`, `packages/util/` |

## 5. Technical Stack Choices

| 领域 | 选型 | 选择理由 | 边界 |
|------|------|----------|------|
| Runtime | Bun + TypeScript ESM | OpenCode 既有架构以 Bun 和 TypeScript 为核心，适合 CLI、server、TUI 与 workspace packages。 | 不引入独立 Node-only runtime 作为 WopalSpace 分叉基础。 |
| Effect System | Effect v4 beta | OpenCode 当前服务层大量使用 Effect，适合表达可组合服务、依赖层、资源生命周期和并发。 | 新增服务遵循现有 Effect 模式，不用 ad hoc 全局单例替代服务层。 |
| Package Layout | Bun workspaces + packages monorepo | 继承 OpenCode 的多包结构，区分 core engine、app、ui、sdk、plugin、script 等边界。 | WopalSpace 定制优先放在 engine 注入点，不为每个定制创建独立包。 |
| Configuration Format | JSON / JSONC + frontmatter | OpenCode 配置链路已有 JSON/JSONC 与 markdown agent frontmatter，适合承载空间配置与 agent 局部覆盖。 | 不把空间结构事实写入 ellamaka 配置；结构事实归 `.wopal-space/STRUCTURE.md`。 |
| Plugin System | OpenCode plugin system | 复用 upstream plugin 加载和工具暴露机制，让 `.wopal/plugins/` 成为空间工具扩展面。 | 插件能力由 ontology 提供，ellamaka 只负责加载和运行。 |
| UI | OpenCode TUI/Web stack, Solid-based packages | 保留 upstream UI 技术栈，减少 fork delta，并允许空间级 TUI 配置覆盖。 | UI 设计语言不由 ellamaka 项目 DESIGN 独立定义；空间产品体验由 WopalSpace 统一设计。 |
| Database | Drizzle schema + migration folders | 继承 OpenCode 持久化与 migration 机制，便于 session/runtime 数据演进。 | WopalSpace 的用户记忆和空间事实不进入 ellamaka database 作为权威源。 |
| Upstream Tracking | `main` for ellamaka stable customization, `dev` for upstream tracking | 固定分支角色让上游合并、冲突处理和稳定版本维护可预测。 | `dev` 只作为 upstream/dev 跟踪基准，不作为 ellamaka 定制开发主线。 |
| Fork Delta Management | New-file-first, minimal upstream injection, guard return, no noise reformatting | 这是长期合并成本控制机制，避免每次 upstream merge 都重新解冲突。 | 只有必要注入点允许改动上游文件；无关格式化不进入 diff。 |
| Product Trimming | Maintain deleted-prefix boundary for non-engine components | ellamaka 只保留 WopalSpace engine 所需面，避免继承 upstream 的全量产品和发布复杂度。 | 裁剪列表由 `UPSTREAM-MERGE-LOG.md` 维护，合并时作为冲突处理依据。 |
| Validation | Package-local typecheck/test/build plus space-mode regression checks | 普通类型/build 验证不足以证明 WopalSpace 定制仍可用，需覆盖 flag、TUI、settings、plugins、themes。 | 不从 repo root 运行测试；不直接运行 `tsc` 替代 package typecheck。 |

## 6. Interfaces and Contracts

### 6.1 CLI Contract

| Interface | Consumer | Contract |
|-----------|----------|----------|
| `ellamaka --wopal-space` | WopalSpace 用户、wopal-cli、Agent runtime launcher | 启用 WopalSpace 配置模式；设置 `WOPAL_SPACE=1`；配置加载链路进入 WopalSpace 分支。 |
| `--pure` | 用户、调试流程 | 设置 `OPENCODE_PURE=1`，禁用外部插件加载，用于隔离 plugin 影响。 |
| `--log-level` | 用户、调试流程 | 设置日志级别并初始化 runtime log。 |
| OpenCode inherited CLI commands | 普通 OpenCode 使用者、WopalSpace runtime | 保留 upstream 命令语义；WopalSpace 定制不应破坏普通命令入口。 |

### 6.2 WopalSpace Configuration Contract

空间模式下，配置来源按目标职责分层：

| 层级 | 来源 | 职责 |
|------|------|------|
| Built-in defaults | ellamaka 内置默认配置 | 提供 engine 可运行的基础默认值。 |
| Global ellamaka config | `~/.wopal/ellamaka/config/opencode.json[c]` | 用户级 engine 全局配置、provider、model、默认权限。 |
| Space settings | `<space>/.wopal/config/settings.jsonc` 的 `ellamaka` 字段 | 当前 space 的 engine 配置覆盖，包括 agent、permission、plugin、command、model 等空间级约定。 |
| Agent frontmatter | `<space>/.wopal/agents/*.md` | 与具体 agent 绑定的配置和权限覆盖。 |
| Environment content | `OPENCODE_CONFIG_CONTENT` | 当前启动进程的临时 local override。 |

空间模式下，ellamaka 发现 `.wopal/` 后返回 WopalSpace 配置结果，不继续加载项目级 `opencode.jsonc`。

### 6.3 Permission Contract

wopal-space mode 下权限配置优先级从低到高为：

| 优先级 | 来源 | 规则 |
|--------|------|------|
| 1 | Built-in defaults | engine 默认权限基线。 |
| 2 | `~/.wopal/ellamaka/config/opencode.json[c]` 顶层 `permission` | 用户级默认权限。 |
| 3 | `.wopal/config/settings.json[c]` 中的 `ellamaka.permission` / `ellamaka.agent.<name>.permission` | 空间级和 agent 级空间配置。 |
| 4 | `.wopal/agents/{name}.md` frontmatter 中的 `permission` | agent 身份文件的最终覆盖。 |

权限数组采用合并后按最后匹配项生效的语义。

### 6.4 Ontology Loading Contract

| Surface | Source | Consumer | Contract |
|---------|--------|----------|----------|
| Commands | `.wopal/commands/` | ellamaka command runtime | Markdown command files become executable slash commands; ontology commands may override built-in commands. |
| Agents | `.wopal/agents/` | agent runtime | Markdown agent files define agent identity, prompt and frontmatter configuration. |
| Plugins | `.wopal/plugins/` | plugin runtime, tool system | Plugin packages are loaded into ellamaka and expose tools to agents according to permission rules. |
| Settings | `.wopal/config/settings.jsonc` | config loader, TUI config loader | `ellamaka` field configures engine; `tui` field configures TUI. |
| Themes | `.wopal/config/themes/` | TUI runtime | TUI theme lookup includes the space theme directory when running in space mode. |

### 6.5 TUI Contract

| Interface | Consumer | Contract |
|-----------|----------|----------|
| `.wopal/config/settings.jsonc` `tui` field | TUI config loader | Parsed as TUI configuration and merged into the active TUI config. |
| `.wopal/config/themes/` | TUI plugin/theme runtime | Space-level theme directory participates in theme lookup. |
| OpenCode inherited TUI | Users | Existing TUI behavior remains available unless explicitly overridden by space configuration. |
| `WOPAL_SPACE` flag | TUI + worker runtime | Must be readable in both worker and TUI instances so space mode does not disappear across process/runtime boundaries. |

### 6.6 Upstream Tracking Contract

ellamaka 通过稳定的分支和合并契约持续跟踪 upstream OpenCode：

| Surface | Contract |
|---------|----------|
| `main` | ellamaka 定制代码的稳定主线。 |
| `dev` | 跟踪 upstream OpenCode `dev`，作为合并基准，不作为 ellamaka 定制开发主线。 |
| `origin` | ellamaka fork 仓库。 |
| `upstream` | OpenCode 官方仓库。 |
| Merge direction | 从 `upstream/dev` 拉取，在 `main` 上合并，解决冲突、验证并记录结果。 |
| Complex merge isolation | 复杂合并可先在隔离 worktree 分支中解决，再 fast-forward 或 merge 回 `main`。 |
| Merge log | `UPSTREAM-MERGE-LOG.md` 记录分支策略、裁剪前缀、保留定制项、冲突处理、教训和验证结果。 |

长期裁剪边界如下。合并 upstream 时，命中这些前缀的非目标组件默认保持删除，除非被重新确认纳入 WopalSpace Engine 范围。

| Prefix group | Boundary |
|--------------|----------|
| `packages/desktop/`, `desktop-electron/` | 桌面应用不是 ellamaka 的 engine 目标面。 |
| `packages/enterprise/`, `console/`, `function/` | SaaS/Cloud 后台不属于 WopalSpace engine 范围。 |
| `packages/containers/` | Docker 构建面不属于 ellamaka 目标 runtime。 |
| `packages/web/`, upstream `docs/` | 上游网站和文档站点不在 ellamaka 中维护。 |
| `packages/extensions/`, `identity/` | VS Code 扩展和品牌素材不是 ellamaka 职责。 |
| `packages/slack/`, `zen/` | Slack bot 和 API proxy 不进入 ellamaka 范围。 |
| `sdks/` | Python SDK 不属于当前 engine 边界。 |
| `github/`, `.github/` upstream workflow | 上游 GitHub Action 和 workflow automation 不作为 ellamaka 产品面继承。 |
| `infra/`, `sst.config.ts`, `sst-env.d.ts` | 上游基础设施和 SST 部署不属于 ellamaka 范围。 |
| `nix/`, `flake.nix`, `flake.lock` | Nix 构建面不属于当前 WopalSpace engine 目标。 |
| `install`, upstream `script/` | 上游安装和发布脚本由 WopalSpace 分发机制替代。 |
| `specs/` | 上游 spec archive 不作为 ellamaka 设计权威维护。 |

上游合并的质量门槛如下：

| Gate | Requirement |
|------|-------------|
| Typecheck | 对受影响 package 运行 package-local typecheck。 |
| Build | 相关 engine package build 必须通过。 |
| Tests | 运行适用的 package-local tests；上游已知问题或环境问题必须单独标注。 |
| Space mode config | 验证 `WOPAL_SPACE` 模式仍能加载 `.wopal/config/settings.*`。 |
| TUI config | 验证 TUI 能接收 space settings，且 space mode 下不依赖 `.opencode/tui.json`。 |
| Plugin loading | 验证 `.wopal/plugins/*` path plugins 和 file dependencies 仍可加载。 |
| Theme loading | 验证 `.wopal/config/themes/` 参与 theme lookup。 |
| Flag propagation | 验证 `WOPAL_SPACE` flag 在 worker + TUI 双实例中都可用。 |
| Deleted prefixes | 验证 upstream 重新引入的 deleted-prefix 文件被移除或被明确重新归类。 |

### 6.7 Upstream Compatibility Contract

ellamaka 尽量保留 upstream OpenCode 的 package shape、实现风格和模块边界。WopalSpace-specific behavior 应位于明确的 guard 条件之后，主要是 `Flag.WOPAL_SPACE`，并集中在专用模块中，例如 `config/wopal-space.ts`、`config/wopal-space-settings.ts` 和 TUI-specific wopal-space config modules。

当 upstream 架构变化时，ellamaka 迁移自身定制以适配新的 upstream shape，而不是冻结旧的 upstream 内部结构。例如 upstream 将 shared package 重命名为 core 后，ellamaka 将自定义 global path 和 flag behavior 迁移到 `@opencode-ai/core`；upstream 移除 barrels 并迁移更多 Effect-native services 后，ellamaka 保持直接子路径 import 和 Effect 服务风格。

### 6.8 Distribution and Installation Summary

ellamaka 拥有独立的 Engine 分发机制。P1 延续当前 OpenCode CLI release pipeline 作为发布骨架，并收敛为 WopalSpace 所需的 stable artifact naming、固定安装路径和 checksum 校验语义。ellamaka 可脱离 wopal-space 独立运行；wopal-cli 的 `setup` 功能可将其下载并与 wopal-space 配置集成。

稳定边界：

1. stable release 是自动消费主通道。
2. `ellamaka-main` 保持本地开发特例语义。
3. 安装目标固定为与 `wopal` 共存的用户级 binary 目录。
4. `wopal engine install` 与独立安装入口消费同一套 release artifacts。
5. 分发阶段与 wopal-space mode 的配置融合各有分工，各自独立完成。

详细 artifact naming、install contract、runtime handoff 与 P1 out of scope 见 `docs/DISTRIBUTION.md`。

### 6.9 Skill Loading Contract

Skill 按目录优先级顺序发现：user 目录（`~/.agents/skills`、`~/.wopal/skills`）先扫描，space 目录（`<space>/.wopal/skills`）后扫描。加载阶段先并发解析所有 `SKILL.md`，再按发现顺序串行写入 `state.skills`；同名 skill 由后出现的目录稳定覆盖。这保证了 space overlay 可覆盖 user/base skill，同时保留并发解析带来的启动性能。

优先级链：

```text
~/.agents/skills
-> ~/.wopal/skills
-> <space>/.wopal/skills
```

右侧优先级最高。

## 7. Data and State Model

| 状态 | 位置 | Owner | 规则 |
|------|------|-------|------|
| Global config | `~/.wopal/ellamaka/config/` | ellamaka | 保存用户级 engine 配置，并与 upstream OpenCode 配置根隔离。 |
| Runtime data | `~/.wopal/ellamaka/data/` | ellamaka | 保存 ellamaka 拥有的 engine runtime 数据与日志。 |
| Cache | `~/.wopal/ellamaka/cache/` | ellamaka | 保存下载二进制、缓存与生成的 runtime cache artifacts。 |
| State | `~/.wopal/ellamaka/state/` | ellamaka | 保存进程与 runtime state，例如锁文件。 |
| Debug logs | 使用 `WOPAL_DEBUG_LOG_DIR` 时落到 `$space/logs/` | ellamaka + WopalSpace runtime | space-mode debug output 可重定向到当前 space logs，便于诊断。 |
| Space ontology | `<space>/.wopal/` | Space Ontology, loaded by ellamaka | 提供 engine runtime 消费的 commands、agents、plugins、rules、templates 和 settings。 |
| Space settings | `<space>/.wopal/config/settings.jsonc` | Space Ontology | 为当前 space 提供 `ellamaka` 与 `tui` 两个配置分区。 |
| Agent definitions | `<space>/.wopal/agents/*.md` | Space Ontology | 定义 agent identity、prompt 与 frontmatter-level runtime configuration。 |
| Theme files | `<space>/.wopal/config/themes/*.json` | Space Ontology / TUI runtime | space-level custom themes 由 TUI theme loading 发现。 |
| Plugin dependencies | 从 `.wopal/plugins/` path plugins 推导 | ellamaka plugin runtime | 本地 plugin dependencies 被发现并安装，以保障 runtime 可用。 |
| Project config | project-level `opencode.json[c]` | Non-space OpenCode projects | WopalSpace mode 成功发现 `.wopal/` 后忽略项目级配置。 |
| Database schema | `packages/opencode/src/**/*.sql.ts` | ellamaka / inherited OpenCode runtime | Drizzle schema 使用 snake_case 字段，migration folders 生成到 `packages/opencode/migration/`。 |
| Upstream merge record | `UPSTREAM-MERGE-LOG.md` | ellamaka maintainers | 记录 upstream tracking state、deleted-prefix boundary、保留定制项、merge lessons 与 verification outcomes。 |
| Space runtime facts | `<space>/.wopal-space/` | WopalSpace runtime, not ellamaka | STRUCTURE、REGULATIONS、memory、logs 与 temporary space state 不属于 ellamaka 数据权威。 |

## 8. Related Documents

| 文档 | 引用目的 |
|------|----------|
| `../../../docs/products/wopal-space/PRD-wopalspace.md` | WopalSpace 产品定位、核心能力和治理原则。 |
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md` | WopalSpace 总体架构、ellamaka 在产品分层中的 engine 位置。 |
| `./DISTRIBUTION.md` | ellamaka release、artifact、安装路径与下游消费契约。 |
| `../../wopal-cli/docs/DESIGN.md` | wopal-cli 作为 ellamaka release consumer 的分发和 setup 契约。 |
| `AGENTS.md` | ellamaka 仓库级开发规则、测试规则和代码风格约定。 |
| `packages/opencode/AGENTS.md` | opencode package 内部模块组织、Effect 规则、数据库与 migration 规则。 |
| `UPSTREAM-MERGE-LOG.md` | upstream OpenCode 跟踪策略、裁剪边界、合并策略、保留定制项与合并验证经验。 |
| `docs/references/ellamaka-config-mechanism.md` | ellamaka 配置加载链路、路径、环境变量和 provider 配置研究。 |

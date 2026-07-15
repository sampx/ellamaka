# Ellamaka

> **状态**: Active
> **更新时间**: 2026-07-15
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`

## 0. Change Log

| 日期 | 类型 | 摘要 |
|------|------|------|
| 2026-07-15 | Updated | Workbench Session Projection 只暴露未归档根会话，归档会话和带 `parentID` 的子会话不进入左侧会话列表。 |
| 2026-07-11 | Major | §7.1 新增 Runtime API 与 SDK 契约。Effect HttpApi、OpenAPI 和生成 SDK 形成单一 API 链路；Wopal CLI adapter 通过版本化 capability contract 集成空间控制能力。 |
| 2026-07-04 | Updated | §9 新增 ellamaka-app Web UI 架构设计决策;§1.1 补充 ellamaka-app 引用 |
| 2026-06-18 | Updated | §3 放弃 opencode 配置兼容：普通模式下不再加载 opencode XDG 全局配置和项目级 opencode.jsonc；§2 适配点表格同步 |
| 2026-06-11 | Updated | §1 新增文档关系声明；§2 表移除与 BRANDING.md 重复细节，添加节号引用；§5 简化指向 BRANDING.md；同步 BRANDING.md 重构为设计意图驱动 |
| 2026-05-31 | Updated | 精简为设计事实与契约；移除上游继承描述和 fork delta 管理哲学。 |
| 2026-05-31 | Updated | 明确 P1 不改 runtime loading 模型；skill loader 改为确定性覆盖。 |
| 2026-05-30 | Created | 初始创建。 |

## 1. Role

ellamaka 是 OpenCode fork，WopalSpace 的执行引擎。负责 WopalSpace 模式下的自动检测、配置加载、ontology 运行时物化、plugin 执行与权限系统。

不负责：空间初始化、ontology 内容设计、空间运行态维护——这些归属 wopal-cli、Space Ontology 和 `.wopal-space/`。

### 1.1 设计文档关系

| 文档 | 职责 | 关系 |
|------|------|------|
| **BRANDING.md** | 品牌化定制真相源：逐文件、逐行、逐模式记录所有上游注入变更 | 定制实现细节的唯一权威；本文件不重复其内容 |
| **DESIGN.md**（本文件） | 架构概览：适配点总表、配置契约、ontology 加载契约、状态归属 | 描述"是什么"和"有什么"，不描述"怎么改" |
| **DISTRIBUTION.md** | 发布/分发设计：release 流程、artifact contract、安装路径、R2 CDN | 独立方向记录，与本文件无重复 |
| **packages/ellamaka-app/AGENTS.md** | ellamaka web UI 包级开发规则 | 继承上游 `packages/app`，承接 poc/web 产品形态 |

定制实现细节（哪些文件改了、用什么模式注入、改动行数）一律见 **BRANDING.md**，本文件仅保留适配点索引和节号引用。

## 2. WopalSpace Adaptations

ellamaka 继承上游 OpenCode 全部 agent runtime、TUI/Web、session、tool、plugin 能力。WopalSpace 适配通过以下最小 fork delta 实现。详细注入模式、改动行数和具体代码见 **BRANDING.md**。

| 适配点 | 概要 | BRANDING.md 节号 |
|--------|------|-------------------|
| WOPAL_SPACE 自动检测 | 从 cwd 向上查找 `.wopal/.git` 文件确定空间根 | §7.3 |
| 全局路径分离 | `~/.wopal/config` + `~/.wopal/ellamaka/{data,cache,state}` | §5 |
| 普通模式配置加载 | 所有模式仅从 `~/.wopal/config/settings.jsonc` 加载配置，不与 opencode XDG 全局配置交互 | §6.2 |
| 空间配置加载 | 从空间根加载 `.wopal/` 下的配置和能力 | §5.1 |
| 空间模式跳过项目配置 | `RuntimeFlags.wopalSpace` guard 短路项目级 `opencode.jsonc` | §7.3 |
| Agent/Command/Plugin 加载 | 从 `.wopal/` 加载同名可覆盖内置 | §2, §5.1 |
| 权限合并 | defaults → global → space settings → agent frontmatter | §3（本文件） |
| 引擎安装识别 | 识别 `~/.wopal/bin/` 安装路径 | §4.8 |
| Skill 加载 | base/user 并发解析，space overlay 按序覆盖 | — |
| Branding & build | BINARY_NAME、构建包装、CLI 品牌常量 | §2–§4 |
| TUI 空间配置 | `settings.jsonc` 的 `tui` 字段和主题目录 | §4.7 |
| Web UI 产品化 | Fork 上游 `packages/app` 为 `packages/ellamaka-app`，承接 poc/web 验证的产品形态 | §9（本文件），§15 |
| Runtime API 与 SDK | Effect HttpApi schema → OpenAPI → 生成 SDK；Wopal CLI adapter 将空间控制能力映射为 Runtime API | §7.1（本文件） |

上游文件改动遵循：新文件优先、提前返回 guard、回调注入、禁止格式化重排。完整策略和合并保护文件清单见 **BRANDING.md §9**。

## 3. Configuration Contract

空间模式下配置加载优先级（低→高）：

| 层级 | 来源 |
|------|------|
| Built-in defaults | ellamaka 内置 |
| Global config | `~/.wopal/config/settings.jsonc` |
| Space settings | `<space>/.wopal/config/settings.jsonc` → `ellamaka` 字段 |
| Agent frontmatter | `<space>/.wopal/agents/*.md` |
| Environment override | `OPENCODE_CONFIG_CONTENT` |

权限合并同此优先链，按最后匹配项生效。普通模式下仅从 `~/.wopal/config/settings.jsonc` 加载配置，不加载 opencode XDG 全局配置。

## 4. Ontology Loading Contract

| 加载面 | 来源 | 行为 |
|--------|------|------|
| Commands | `.wopal/commands/` | 可覆盖内置命令 |
| Agents | `.wopal/agents/` | Markdown 定义 agent 身份与 frontmatter |
| Plugins | `.wopal/plugins/` | 向 runtime 暴露 plugin tools |
| Settings | `.wopal/config/settings.jsonc` | `ellamaka` 字段配置 engine，`tui` 字段配置 TUI |
| Skills | `~/.wopal/skills/` → `<space>/.wopal/skills/` | 并发解析 + 按序合并，右侧优先 |

## 5. Upstream Merge Boundary

| 规则 | 说明 |
|------|------|
| 分支 | `main` = 定制稳定线；`dev` = 跟踪 upstream/dev，不作为开发主线 |
| 合并方向 | upstream/dev → merge to main |
| 裁剪前缀 | 见 `UPSTREAM-MERGE-LOG.md`（desktop、enterprise、slack、nix、specs 等非 engine 组件） |

详细合并流程、合并保护文件清单、定制代码最小侵入原则、冲突热点和验证清单见 **BRANDING.md §9**。

## 6. Distribution

ellamaka 构建为多平台 standalone binary，提供 stable release artifacts + checksums。`wopal-cli` 通过 `wopal ellamaka install` 消费。P1 使用固定安装路径 `~/.wopal/bin/ellamaka`。

构建入口：CI 中 `publish-ellamaka.yml` 直接调用 `packages/opencode/script/build.ts --p1` 并注入 env；本地开发使用 `packages/ellamaka/build.ts` 包装脚本。

P1 不改 runtime loading 模型。setup 将 ontology base capabilities 物化到 `~/.wopal/` 后，ellamaka 按现有 user/base + space overlay 链路加载。

详细 artifact contract 见 `docs/DISTRIBUTION.md`。

## 7. State Ownership

| 状态 | 位置 | Owner |
|------|------|-------|
| Global config | `~/.wopal/config/` | ellamaka |
| Runtime data | `~/.wopal/ellamaka/data/` | ellamaka |
| Cache | `~/.wopal/ellamaka/cache/` | ellamaka |
| Process state | `~/.wopal/ellamaka/state/` | ellamaka |
| 空间 ontology | `<space>/.wopal/` | Space Ontology，ellamaka 加载 |
| 空间运行态 | `<space>/.wopal-space/` | space runtime，ellamaka 不写入 |

### 7.1 Runtime API 与 SDK 契约

Ellamaka 的 HTTP API 是 Workbench 和外部集成使用运行时能力的唯一网络表面。领域 schema 同时驱动 Effect HttpApi 路由、运行时校验、OpenAPI 和生成 SDK。Root API 承载全局控制能力，Instance API 承载工作目录相关运行时能力。

Workbench Session Projection 是左侧会话列表的服务端只读模型，只返回 `time_archived IS NULL` 且 `parent_id IS NULL` 的 Session。归档会话和子会话不属于可直接装载的根会话资源。

Wopal CLI adapter 作为 Runtime 的领域服务使用 `wopal ... --json --api-version` capability。它维护非权威空间快照，并将稳定的 CLI 结果映射为 Ellamaka 领域资源和错误。浏览器只使用 Ellamaka API。

完整的路径语义、schema、错误、版本、SDK 生成和端点门禁见 [API-CONTRACT.md](./API-CONTRACT.md)。

## 8. Web UI 与 ellamaka-app

### 8.1 背景

WopalSpace 需要 Web UI 作为 TUI 之外的第二种用户界面。经过 PoC 验证(`poc/web`)——确认 Web TUI 可行、多空间并行可行、TUI+Chat 融合可行——需要以正式技术栈承载产品形态。

### 8.2 设计决策

**不在 PoC 基础上迭代,而是 fork 上游 `packages/app` 为 `packages/ellamaka-app`**:

| 方案 | 决策 | 原因 |
|------|------|------|
| 直接修改 `packages/app` | ❌ 否决 | 侵入上游源码,合并上游 `opencode` 更新时冲突面大 |
| 在 `poc/web` 基础上迭代 | ❌ 否决 | PoC 代码质量和架构无法承接产品化(单文件 1025 行、裸 JSON 协议、CDN 外部依赖) |
| **Fork `packages/app` → `packages/ellamaka-app`** | ✅ 采纳 | 复用现有基础设施(core/sdk/ui/i18n/terminal/theme);保持上游同步能力;定制与上游解耦 |
### 8.3 详细规约

关于 `ellamaka-app` 工作台（Workbench）的具体界面、视图模型（TUI/Chat/Split 面板模型）、详细目录架构、上游同步细节、PoC 能力迁移规约以及与 `wopal-cli` 的协同，请参阅独立的详细设计规范文档：

- 英文版：[ELLAMAKA-WORKBENCH.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/ELLAMAKA-WORKBENCH.md)
- 中文版：[ELLAMAKA-WORKBENCH.zh-CN.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/ELLAMAKA-WORKBENCH.zh-CN.md)

---

## 9. Related Documents

| 文档 | 引用目的 |
|------|----------|
| `./BRANDING.md` | 品牌化定制唯一真相源— |
| `./API-CONTRACT.md` | Runtime API、OpenAPI、生成 SDK 与 Wopal CLI adapter 契约 |
| `./ELLAMAKA-WORKBENCH.md` | ellamaka 自定义工作台 app 设计 |
| `./DISTRIBUTION.md` | release、artifact、安装契约 |
| `../../wopal-cli/docs/DESIGN.md` | wopal-cli 如何消费 ellamaka release |
| `UPSTREAM-MERGE-LOG.md` | 裁剪边界、合并策略、验证经验 |
| `packages/opencode/AGENTS.md` | engine package 内部规则 |
| `packages/ellamaka-app/AGENTS.md` | ellamaka 官方 web UI 包级开发规则 |

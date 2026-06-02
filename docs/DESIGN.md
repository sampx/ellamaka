# Ellamaka

> **状态**: Active
> **更新时间**: 2026-05-31
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`

## 0. Change Log

| 日期 | 类型 | 摘要 |
|------|------|------|
| 2026-06-01 | Updated | 新增 branding/build wrapper 适配点；§6 补充构建入口说明。 |
| 2026-05-31 | Updated | 精简为设计事实与契约；移除上游继承描述和 fork delta 管理哲学。 |
| 2026-05-31 | Updated | 明确 P1 不改 runtime loading 模型；skill loader 改为确定性覆盖。 |
| 2026-05-30 | Created | 初始创建。 |

## 1. Role

ellamaka 是 OpenCode fork，WopalSpace 的执行引擎。负责承载 `--wopal-space` 模式下的配置加载、ontology 运行时物化、plugin 执行与权限系统。

不负责：空间初始化、ontology 内容设计、空间运行态维护——这些归属 wopal-cli、Space Ontology 和 `.wopal-space/`。

## 2. WopalSpace Adaptations

ellamaka 继承上游 OpenCode 全部 agent runtime、TUI/Web、session、tool、plugin 能力。WopalSpace 适配通过以下最小 fork delta 实现：

| 适配点 | 实现方式 | 载体 |
|--------|---------|------|
| `--wopal-space` flag | `WOPAL_SPACE` 环境变量，worker + TUI 双实例可读 | `packages/core/src/flag/flag.ts` |
| 全局路径分离 | `~/.wopal/config` + `~/.wopal/ellamaka/{data,cache,state}` | `packages/core/src/global.ts` |
| 普通模式兼容层 | 加载 opencode XDG 全局配置和能力，再用 ellamaka 全局配置覆盖 | `packages/opencode/src/config/config.ts`、`config/paths.ts` |
| 空间配置加载 | 发现 `.wopal/`，加载 `settings.jsonc` → `ellamaka` 字段，合并 agents/commands/plugins | `packages/opencode/src/config/wopal-space.ts`、`wopal-space-settings.ts` |
| 空间模式跳过项目配置 | `Flag.WOPAL_SPACE` guard → 不加载项目级 `opencode.jsonc` | `packages/opencode/src/config/config.ts:570` |
| Agent/Command/Plugin 加载 | 从 `.wopal/{agents,commands,plugins}/` 加载同名可覆盖内置 | `packages/opencode/src/config/{agent,command,plugin}.ts` |
| 权限合并 | defaults → global → space settings → agent frontmatter，最后匹配生效 | `packages/opencode/src/permission/` |
| 引擎安装识别 | 识别 `~/.wopal/bin/` 安装路径与升级通道 | `packages/opencode/src/installation/index.ts` |
| 确定性 skill 加载 | base/user 先并发解析，space overlay 后按序稳定覆盖 | `packages/opencode/src/skill/index.ts` |
| Branding & build wrapper | `BINARY_NAME=ellamaka` + channel env 注入，品牌常量集中管理；本地构建包装脚本 | `packages/ellamaka/branding.ts`、`packages/ellamaka/build.ts` |
| TUI 空间配置 | 识别 `settings.jsonc` 的 `tui` 字段和空间主题目录 | `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts` |

上游文件改动遵循：新文件优先、提前返回 guard、回调注入、禁止格式化重排。详细策略见 `UPSTREAM-MERGE-LOG.md`。

## 3. Configuration Contract

空间模式下配置加载优先级（低→高）：

| 层级 | 来源 |
|------|------|
| Built-in defaults | ellamaka 内置 |
| Global config | `~/.wopal/config/settings.jsonc` |
| Space settings | `<space>/.wopal/config/settings.jsonc` → `ellamaka` 字段 |
| Agent frontmatter | `<space>/.wopal/agents/*.md` |
| Environment override | `OPENCODE_CONFIG_CONTENT` |

权限合并同此优先链，按最后匹配项生效。普通模式先加载 opencode 的 XDG 全局配置和 `.opencode/` 能力，再加载 `~/.wopal/config/settings.jsonc`。

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
| 验证门槛 | typecheck、build、tests、space mode config、TUI、plugin、theme、flag propagation |

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

## 8. Related Documents

| 文档 | 引用目的 |
|------|----------|
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md` | ellamaka 在产品分层中的定位 |
| `./DISTRIBUTION.md` | release、artifact、安装契约 |
| `../../wopal-cli/docs/DESIGN.md` | wopal-cli 如何消费 ellamaka release |
| `UPSTREAM-MERGE-LOG.md` | 裁剪边界、合并策略、验证经验 |
| `AGENTS.md` | 仓库级开发规则 |
| `packages/opencode/AGENTS.md` | engine package 内部规则 |

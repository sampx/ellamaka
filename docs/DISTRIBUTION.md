# Ellamaka — Distribution

> **状态**: Active
> **更新时间**: 2026-05-30
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> **项目设计**: `./DESIGN.md`

## 0. Change Log

| Date | Type | Summary |
|---|---|---|
| 2026-05-30 | Updated | 优化语言表达，明确独立分发定位。 |
| 2026-05-30 | Updated | 精简为分发特有内容，避免与 `DESIGN.md` 重复。 |
| 2026-05-30 | Created | 定义 ellamaka 的 release backbone、artifact contract、固定安装路径与 runtime handoff。 |

---

## 1. Scope

本文件定义 ellamaka 的 Engine release contract：GitHub Release backbone、artifact naming、固定安装路径与 CLI 消费边界。

ellamaka 的发布是自包含的，但 P1 的自动消费入口是 `wopal ellamaka install`。wopal-cli 的 `setup` 通过该入口完成 engine 安装引导。

项目职责、配置链路与 runtime loading 见 `DESIGN.md`。

---

## 2. Release Backbone

P1 延续当前 OpenCode CLI release pipeline 作为发布骨架，在现有 `packages/opencode/script/build.ts` 与 CI publish workflow 上收敛为 WopalSpace 所需的 Engine release contract。

P1 的 canonical release source：

- GitHub Release

P1 的 canonical consumer：

1. `wopal ellamaka install`
2. `wopal setup`（通过 `wopal ellamaka install`）
3. 人工从 GitHub Release 页面手动下载

---

## 3. Release Contract

### 3.1 Stable release

stable release 是 P1 唯一的自动消费通道。

每个 stable release 至少包含：

1. 版本 tag `v<version>`
2. 完整平台 artifacts
3. `checksums.txt`

P1 的 version discovery 以 release tag 和稳定 artifact naming 为主。

### 3.2 Local development channel

`ellamaka-main` 保持本地开发特例语义：

1. 本地构建
2. 本地验证
3. 手动 rebuild / replace

`ellamaka-main` 走独立的手动路径，与 released channel 分离。

---

## 4. Artifact Contract

ellamaka 的发布产物使用 `ellamaka` 品牌。

P1 平台矩阵：

| OS | Arch | Variant | Artifact |
|---|---|---|---|
| macOS | arm64 | native | `ellamaka-darwin-arm64.zip` |
| macOS | x64 | native | `ellamaka-darwin-x64.zip` |
| macOS | x64 | baseline | `ellamaka-darwin-x64-baseline.zip` |
| Linux | arm64 | glibc | `ellamaka-linux-arm64.tar.gz` |
| Linux | x64 | glibc | `ellamaka-linux-x64.tar.gz` |
| Linux | arm64 | musl | `ellamaka-linux-arm64-musl.tar.gz` |
| Linux | x64 | musl | `ellamaka-linux-x64-musl.tar.gz` |
| Linux | x64 | glibc baseline | `ellamaka-linux-x64-baseline.tar.gz` |
| Linux | x64 | musl baseline | `ellamaka-linux-x64-baseline-musl.tar.gz` |
| Windows | arm64 | native | `ellamaka-windows-arm64.zip` |
| Windows | x64 | native | `ellamaka-windows-x64.zip` |
| Windows | x64 | baseline | `ellamaka-windows-x64-baseline.zip` |

Contract：

1. archive 内的 binary 名称固定为 `ellamaka` / `ellamaka.exe`。
2. consumer 依赖稳定文件名，无需人工解释 release 页面。
3. baseline 与 musl 变体在文件名中显式可见。
4. `checksums.txt` 与同版本 artifacts 一起发布。
5. release build 的 channel 对外固定为 `ellamaka`；本地开发 channel 保持 `ellamaka-main`。

---

## 5. Install Contract

P1 使用固定安装路径。

| Platform | Binary path | Runtime roots |
|---|---|---|
| macOS / Linux | `~/.wopal/bin/ellamaka` | `~/.wopal/ellamaka/{config,data,cache,state}` |
| Windows | 用户级等价目录中的 `ellamaka.exe` | 用户级等价目录中的 `Wopal/ellamaka/*` |

Install contract：

1. `wopal ellamaka install` 是 P1 唯一的自动安装入口。
2. consumer 根据 OS / arch / libc 与稳定 artifact naming 计算目标文件名。
3. consumer 在放置 binary 前必须校验 SHA-256。
4. 安装成功的标志是 `ellamaka --version` 正常输出。
5. P1 使用固定安装路径；自定义目录、后台更新和二级包管理器适配属于后续阶段。

---

## 6. Runtime Handoff

ellamaka 安装完成后，运行时加载链路按 WopalSpace mode 工作：

1. 读取全局配置根 `~/.wopal/ellamaka/config/`
2. 在 `--wopal-space` 模式下发现 `<space>/.wopal/`
3. 合并 `<space>/.wopal/config/settings.jsonc` 中的 `ellamaka` 与 `tui` 配置
4. 加载 `<space>/.wopal/agents/*.md`
5. 加载 `<space>/.wopal/commands/*.md`
6. 加载 `<space>/.wopal/plugins/`

分发阶段只负责 binary 可达。以下由运行时和其他组件承接：

1. space-local 配置——由 ontology 提供，ellamaka 加载。
2. space-local plugin 依赖——由 ellamaka 启动时处理。
3. `.wopal-space/` runtime files——由 CLI materialize，ontology commands 维护。
4. setup orchestration——由 wopal-cli 的 `wopal setup` 负责。

---

## 7. Out of Scope for P1

1. 自定义安装目录
2. npm / brew / winget / choco 等多渠道适配
3. 自动后台更新
4. 额外的复杂 release manifest 系统
5. 在分发阶段替代 wopal-space mode 的配置融合与 runtime loading
6. 独立 ellamaka installer 脚本

---

## 8. Related Documents

| 文档 | 说明 |
|---|---|
| `./DESIGN.md` | ellamaka 的项目职责、配置层与 WopalSpace runtime 边界 |
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md` | 产品级 setup integration flow 与系统分层 |
| `../../wopal-cli/docs/DESIGN.md` | CLI 的 setup / engine / space orchestration 边界 |
| `../../wopal-cli/docs/DISTRIBUTION.md` | CLI 对 ellamaka release 的消费契约 |
| `../../../.wopal/docs/DESIGN.md` | ontology 的 template、command 与 runtime maintenance 设计 |
| `../../../.wopal/docs/DISTRIBUTION.md` | ontology materialization 与 runtime handoff 边界 |

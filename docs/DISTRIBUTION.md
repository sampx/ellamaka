# Ellamaka — Distribution

> **状态**: Active
> **更新时间**: 2026-06-01
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> **项目设计**: `./DESIGN.md`

## 0. Change Log

| Date | Type | Summary |
|---|---|---|
| 2026-06-01 | Updated | §4.2 补充本地构建入口；§5 标注 channel 值来源；§9 添加 BRANDING.md 引用。 |
| 2026-06-01 | Updated | 新增 §3 Publish Procedure：版本模型、CI 自动发布步骤、手动发布步骤、验证清单、与上游 opencode 的差异对比。 |
| 2026-06-01 | Updated | 明确 P1 publish workflow 必须脱离 upstream repository guard 并产出 ellamaka 品牌 artifacts。 |
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

- `wopal-cn/ellamaka` GitHub Releases

P1 release workflow 必须以 `wopal-cn/ellamaka` 为可执行发布仓库。继承自 upstream 的 `anomalyco/opencode` repository guard、`opencode-*` artifact path、`bin/opencode` binary name 和 upstream release upload target 都属于需要收敛的 release surface。P1 保留 runtime loading 模型，只收敛 build、naming、checksums 和 GitHub Release 上传边界。

P1 的 canonical consumer：

1. `wopal ellamaka install`
2. `wopal setup`（通过 `wopal ellamaka install`）
3. 人工从 GitHub Release 页面手动下载

---

## 3. Publish Procedure

### 3.1 Version Model

`@opencode-ai/script` 的 `Script` 类通过环境变量控制版本号与发布模式：

| 环境变量 | 作用 | `Script` 行为 |
|---|---|---|
| `OPENCODE_VERSION` | 指定版本号 | 设置时直接作为 `Script.version`；未设置时自动推导（npm registry 最新版 +1，或 `0.0.0-{channel}-{timestamp}`） |
| `OPENCODE_RELEASE` | 发布模式开关 | `Script.release = !!OPENCODE_RELEASE`，控制是否生成正式 release（tag、GitHub Release） |
| `OPENCODE_CHANNEL` | 更新渠道 | 设置时作为 `Script.channel`；未设置时自动推导（`OPENCODE_VERSION` 为非 `0.0.0-*` 时 → `"latest"`，否则 → git branch 名） |
| `BINARY_NAME` | 产物名前缀 | 构建时替换所有硬编码 `"opencode"`，控制输出目录名、binary 名、archive 名 |

这些变量是上游 `Script` 类的原生接口。ellamaka 不修改 `Script` 源码，只在 CI 或本地构建时注入正确的值。

### 3.2 自动化发布（CI）

**触发条件**：向 `wopal-cn/ellamaka` 推送 `v*` 格式的 tag，或手动触发 `workflow_dispatch`。

**工作流文件**：`.github/workflows/publish-ellamaka.yml`

**Step 1 — 版本解析**（`version` job）：

```
git tag v0.1.0 → 剥离 v 前缀 → version=0.1.0, release=true, tag=v0.1.0
```

手动触发且未指定版本 → `version=0.0.0-dev, release=''`

**Step 2 — 构建 CLI**（`build-cli` job）：

```bash
bun install
BINARY_NAME=ellamaka \
OPENCODE_VERSION=0.1.0 \
OPENCODE_RELEASE=true \
bun ./packages/opencode/script/build.ts --p1
```

`--p1` flag 触发 P1 平台过滤：只构建 4 个目标平台，跳过桌面端、musl、baseline 等变体。

**Step 3 — 打包上传**：

- macOS / Windows → `.zip`
- Linux → `.tar.gz`
- 4 个平台产物分别通过 `actions/upload-artifact` 上传

**Step 4 — 创建 Release**（`release` job，仅 `release=true` 时运行）：

1. 下载 4 个 artifact
2. 验证 4 个文件存在
3. 生成 `checksums.txt`
4. `gh release create v0.1.0` 创建 GitHub Release 并上传所有产物

**仓库守卫**：所有 job 都有 `if: github.repository == 'wopal-cn/ellamaka'`，防止 fork 误触发。

### 3.3 手动发布（本地开发）

**构建 release 产物**：

```bash
BINARY_NAME=ellamaka OPENCODE_VERSION=0.1.0 OPENCODE_RELEASE=true \
  bun run build -- --p1
```

产物输出到 `packages/opencode/dist/ellamaka-{platform}/bin/ellamaka`。

**本地开发快捷方式**：

```bash
bun packages/ellamaka/build.ts
```

等价于 `BINARY_NAME=ellamaka OPENCODE_CHANNEL=ellamaka-main bun run build -- --p1`，版本号自动推导为 `0.0.0-ellamaka-main-{timestamp}`。

### 3.4 发布验证清单

| 检查项 | 命令 / 方法 |
|---|---|
| TypeScript 类型检查 | `bun typecheck` |
| P1 构建成功 | `BINARY_NAME=ellamaka bun run build -- --p1` |
| 4 平台产物存在 | 检查 `dist/` 下 `ellamaka-darwin-arm64`、`ellamaka-darwin-x64`、`ellamaka-linux-x64`、`ellamaka-windows-x64` |
| 版本号正确 | `./dist/ellamaka-darwin-arm64/bin/ellamaka --version` 输出 `ellamaka/x.y.z` |
| checksums 正确 | `sha256sum dist/ellamaka-*.zip dist/ellamaka-*.tar.gz` 与 `checksums.txt` 对比 |

### 3.5 与上游 opencode 的区别

| | opencode `script/publish.ts` | ellamaka `publish-ellamaka.yml` |
|---|---|---|
| 触发方式 | 手动运行脚本 | git tag push / workflow_dispatch |
| 发布内容 | npm 包 (CLI/SDK/Plugin) + Desktop finalize | CLI 二进制 × 4 平台 |
| 版本管理 | 遍历所有 `package.json` 替换版本号 | 通过 `OPENCODE_VERSION` env 传入 |
| Tag 管理 | 脚本内创建/删除/推送 tag | CI 由 tag push 触发，不在 workflow 内操作 tag |
| 产物目标 | npm registry + GitHub Release | 仅 GitHub Release |

---

## 4. Release Contract

### 4.1 Stable release

stable release 是 P1 唯一的自动消费通道。

每个 stable release 至少包含：

1. 版本 tag `v<version>`
2. P1 官方平台 artifacts
3. `checksums.txt`

P1 的默认 version discovery 使用 stable release 的 latest 版本。显式指定版本时，consumer 使用对应的 `v<version>` release tag 和稳定 artifact naming。

P1 的信任边界是 GitHub Release HTTPS 下载与 SHA-256 完整性校验。`checksums.txt` 用于发现下载损坏、传输错误和 artifact 不匹配。签名、attestation、provenance 和独立透明日志属于后续阶段。

### 4.2 Local development channel

`ellamaka-main` 保持本地开发特例语义：

1. `bun packages/ellamaka/build.ts` 本地构建
2. 本地验证
3. 手动 rebuild / replace

`ellamaka-main` 走独立的手动路径，与 released channel 分离。

---

## 5. Artifact Contract

ellamaka 的发布产物使用 `ellamaka` 品牌。

P1 平台矩阵收缩为 one-click 主路径所需的官方优先平台。ellamaka 单包体积较大，musl、baseline、Linux arm64 和 Windows arm64 变体属于后续扩展。

| OS | Arch | Variant | Artifact |
|---|---|---|---|
| macOS | arm64 | native | `ellamaka-darwin-arm64.zip` |
| macOS | x64 | native | `ellamaka-darwin-x64.zip` |
| Linux | x64 | glibc | `ellamaka-linux-x64.tar.gz` |
| Windows | x64 | native | `ellamaka-windows-x64.zip` |

Contract：

1. archive 内的 binary 名称固定为 `ellamaka` / `ellamaka.exe`。
2. consumer 依赖稳定文件名，无需人工解释 release 页面。
3. `checksums.txt` 与同版本 artifacts 一起发布。
4. release build 的 channel 对外固定为 `ellamaka`（`packages/ellamaka/branding.ts:CHANNEL_RELEASE`）；本地开发 channel 保持 `ellamaka-main`（`CHANNEL_DEV`）。
5. release workflow 的上传目标固定为 `wopal-cn/ellamaka`。
6. Windows signing、repack 和 upload 步骤使用 `ellamaka-*` 文件路径。

---

## 6. Install Contract

P1 使用固定安装路径。

所有用户级路径都解析到 `WOPAL_HOME`。默认值：macOS / Linux 为 `~/.wopal`，Windows 为 `%USERPROFILE%\.wopal`。

| Platform | Binary path | Runtime roots |
|---|---|---|
| macOS / Linux | `$WOPAL_HOME/bin/ellamaka` | `$WOPAL_HOME/ellamaka/{config,data,cache,state}` |
| Windows | `$WOPAL_HOME/bin/ellamaka.exe` | `$WOPAL_HOME/ellamaka/{config,data,cache,state}` |

Install contract：

1. `wopal ellamaka install` 是 P1 唯一的自动安装入口。
2. 不指定版本时，consumer 安装 stable release 的 latest 版本。
3. 显式指定版本时，consumer 安装对应 `v<version>` release。
4. consumer 根据 OS / arch / libc 与稳定 artifact naming 计算目标文件名。
5. consumer 在放置 binary 前必须校验 SHA-256。
6. 安装成功的标志是 `ellamaka --version` 正常输出。
7. P1 使用固定安装路径；自定义目录、后台更新和二级包管理器适配属于后续阶段。

---

## 7. Runtime Handoff

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

## 8. Out of Scope for P1

1. 自定义安装目录
2. npm / brew / winget / choco 等多渠道适配
3. 自动后台更新
4. 额外的复杂 release manifest 系统
5. 在分发阶段替代 wopal-space mode 的配置融合与 runtime loading
6. 独立 ellamaka installer 脚本

---

## 9. Related Documents

| 文档 | 说明 |
|---|---|
| `./BRANDING.md` | ellamaka 品牌注入点清单与合并注意事项 |
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md` | 产品级 setup integration flow 与系统分层 |
| `../../wopal-cli/docs/DESIGN.md` | CLI 的 setup / engine / space orchestration 边界 |
| `../../wopal-cli/docs/DISTRIBUTION.md` | CLI 对 ellamaka release 的消费契约 |
| `../../../.wopal/docs/DESIGN.md` | ontology 的 template、command 与 runtime maintenance 设计 |
| `../../../.wopal/docs/DISTRIBUTION.md` | ontology materialization 与 runtime handoff 边界 |

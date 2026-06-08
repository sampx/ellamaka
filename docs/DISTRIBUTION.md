# Ellamaka — Distribution

> **状态**: Active
> **更新时间**: 2026-06-01
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> **项目设计**: `./DESIGN.md`

## 0. Change Log

| Date | Type | Summary |
|---|---|---|
| 2026-06-08 | Updated | 切换为 R2 CDN 主分发；GitHub/Gitee Release 只保留 markdown 索引；macOS 归档格式对齐为 `.tar.gz`。 |
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

P1 延续上游 OpenCode CLI release pipeline 作为发布骨架。ellamaka 是 OpenCode 的 fork，构建体系通过 `@opencode-ai/script` 包引入上游脚本，`packages/ellamaka/build.ts` 注入品牌（`BINARY_NAME=ellamaka`）与裁剪。ellamaka 对上游的裁剪仅限于：

- **平台裁剪**：`--arch primary` 只构建 4 个 P1 平台（见 §3.2），明确排除 baseline / musl / arm64 变体
- **发布位置**：binary 分发从 GitHub Release 迁移到 Cloudflare R2

P1 的 canonical release source：

- **Cloudflare R2**（`https://download.coursedao.com/ellamaka/`）— 唯一 binary 分发源
- `wopal-cn/ellamaka` GitHub Releases — 仅保留 markdown 索引页面，**不携带 binary 附件**
- `wopal-cn/ellamaka` Gitee Releases — 同上，仅 markdown 索引
- `wopal-cn/wopal-space-ontology` GitHub Releases — 同上
- `wopal-cn/wopal-space-ontology` Gitee Releases — 同上

P1 的 canonical consumer：

1. `wopal ellamaka install`（稍后切换为 R2 下载 URL）
2. `wopal setup`（通过 `wopal ellamaka install`）
3. 人工从 GitHub/Gitee Release 页面点击 R2 链接下载

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
bun packages/ellamaka/build.ts --arch primary
```

`--arch primary` 裁剪为 4 个 P1 目标平台。过滤逻辑明确排除 baseline（`avx2: false`）、musl、arm64 等变体：

| OS | Arch | 条件 |
|---|---|---|
| darwin | arm64 | `avx2 !== false` |
| darwin | x64 | `avx2 !== false` |
| linux | x64 | `avx2 !== false`, `abi === undefined` |
| windows | x64 | `avx2 !== false` |

**Step 3 — 打包上传**：

上游 `build.ts` 最后一步 `Script.release` 会直接上传到 GitHub Release。ellamaka fork 裁剪此行为：由 CI workflow 接管打包逻辑。归档规则与 wopal-cli 对齐：

- macOS / Linux → `.tar.gz`
- Windows → `.zip`

4 个平台产物分别通过 `actions/upload-artifact` 上传：

```
dist/ellamaka-darwin-arm64.tar.gz      # ← 从 .zip 改为 .tar.gz
dist/ellamaka-darwin-x64.tar.gz        # ← 从 .zip 改为 .tar.gz
dist/ellamaka-linux-x64.tar.gz
dist/ellamaka-windows-x64.zip
```

**Step 4 — 生成元数据并发布**（`release` job，仅 `release=true` 时运行）：

1. 下载 4 个 artifact
2. 验证 4 个文件存在
3. 运行 `scripts/package-release.mjs manifest` 生成 `manifest.json`、`checksums.txt`、`release-notes.md`
   - `manifest.json` 中 artifact `url` 指向 R2 版本化路径
   - `release-notes.md` 包含平台下载表的 markdown 表格
4. 上传全部 6 个文件到 R2 版本化路径 `s3://wopal-release/ellamaka/v$VERSION/`
5. 上传 `manifest.json` 到 R2 latest 别名 `s3://wopal-release/ellamaka/latest/manifest.json`
6. 创建 4 个 release 条目（均使用同一份 `release-notes.md`，**不挂 binary**）：
   - GitHub `wopal-cn/ellamaka`：`gh release create v$VERSION --repo wopal-cn/ellamaka --notes-file`
   - GitHub `wopal-cn/wopal-space-ontology`：`gh release create v$VERSION --repo wopal-cn/wopal-space-ontology --notes-file`（需 PAT）
   - Gitee `wopal-cn/ellamaka`：`node scripts/create-gitee-release.mjs --repo wopal-cn/ellamaka`
   - Gitee `wopal-cn/wopal-space-ontology`：`node scripts/create-gitee-release.mjs --repo wopal-cn/wopal-space-ontology`

**仓库守卫**：所有 job 都有 `if: github.repository == 'wopal-cn/ellamaka'`，防止 fork 误触发。

**缓存策略**：版本化路径 `max-age=604800`（1 周），latest 别名 `max-age=300`（5 分钟）。同版本覆盖最多 1 周内生效。

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
| P1 构建成功（4 平台，无 baseline 变体） | `BINARY_NAME=ellamaka bun packages/ellamaka/build.ts --arch primary` |
| 产物数正确 | `dist/` 下恰好 4 个目录：`ellamaka-darwin-arm64`、`ellamaka-darwin-x64`、`ellamaka-linux-x64`、`ellamaka-windows-x64`；无 `*-baseline` 目录 |
| 版本号正确 | `./dist/ellamaka-darwin-arm64/bin/ellamaka --version` 输出 `ellamaka/x.y.z` |
| manifest 生成 | `manifest.json` 包含 4 个 artifact，`url` 指向 `download.coursedao.com/ellamaka/v$VERSION/` |
| checksums 正确 | `sha256sum dist/ellamaka-*.tar.gz dist/ellamaka-*.zip` 与 `checksums.txt` 对比 |
| R2 上传成功 | `aws s3 ls s3://wopal-release/ellamaka/v$VERSION/` 可见 6 个文件 |
| GitHub Release 无 binary | Release 页面有 markdown 下载表，Assets 区域无附件（或仅 manifest/checksums 文本） |

### 3.5 与上游 opencode 的区别

| | opencode `script/publish.ts` | ellamaka `publish-ellamaka.yml` |
|---|---|---|
| 触发方式 | 手动运行脚本 | git tag push / workflow_dispatch |
| 平台范围 | 完整矩阵（含 musl, baseline, arm64） | `--arch primary` 裁剪为 4 平台，排除 baseline |
| 发布内容 | npm 包 (CLI/SDK/Plugin) + Desktop finalize | CLI 二进制 × 4 平台 |
| 版本管理 | 遍历所有 `package.json` 替换版本号 | 通过 `OPENCODE_VERSION` env 传入 |
| Tag 管理 | 脚本内创建/删除/推送 tag | CI 由 tag push 触发，不在 workflow 内操作 tag |
| 产物目标 | npm registry + GitHub Release（带 binary） | R2 CDN + GitHub Release（仅 markdown 索引） |
| 归档格式 | macOS `.zip`，Linux `.tar.gz` | macOS/Linux `.tar.gz`，Windows `.zip`（与 wopal-cli 对齐） |

---

## 4. Release Contract

### 4.1 Stable release

stable release 是 P1 唯一的自动消费通道。

每个 stable release 包含：

1. 版本 tag `v<version>`
2. P1 官方平台 artifacts（4 个）
3. `manifest.json`（installer 机器入口，artifact URL 指向 R2）
4. `checksums.txt`
5. `release-notes.md`（markdown 下载表，供 GitHub/Gitee Release 页面使用）

P1 的默认 version discovery 使用 `https://download.coursedao.com/ellamaka/latest/manifest.json`。显式指定版本时，consumer 使用对应的 `v<version>` release tag 和稳定 artifact naming。

P1 的信任边界是 R2 HTTPS 下载与 SHA-256 完整性校验。`checksums.txt` 用于发现下载损坏、传输错误和 artifact 不匹配。签名、attestation、provenance 和独立透明日志属于后续阶段。

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
| macOS | arm64 | native | `ellamaka-darwin-arm64.tar.gz` |
| macOS | x64 | native | `ellamaka-darwin-x64.tar.gz` |
| Linux | x64 | glibc | `ellamaka-linux-x64.tar.gz` |
| Windows | x64 | native | `ellamaka-windows-x64.zip` |

Contract：

1. archive 内的 binary 名称固定为 `ellamaka` / `ellamaka.exe`。
2. consumer 依赖稳定文件名，无需人工解释 release 页面。
3. `manifest.json` 是 installer 的机器可读入口，其中 `url` 指向 R2 自定义域名；`checksumsUrl` 指向同版本 `checksums.txt` 的 R2 地址。
4. `checksums.txt` 与 `release-notes.md` 作为元数据文件与 artifacts 一同发布到 R2。
5. 归档格式与 wopal-cli 对齐：macOS / Linux 使用 `.tar.gz`，Windows 使用 `.zip`。
6. release build 的 channel 对外固定为 `ellamaka`（`packages/ellamaka/branding.ts:CHANNEL_RELEASE`）；本地开发 channel 保持 `ellamaka-main`（`CHANNEL_DEV`）。
7. release workflow 的发布目标为 R2 + GitHub Release（markdown）+ Gitee Release（markdown）。

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

## 8. R2 CDN Distribution

Cloudflare R2 是 ellamaka P1 的唯一 binary 分发源。R2 bucket `wopal-release` 与 wopal-cli 共享，通过 Cloudflare 自定义域名 `download.coursedao.com` 暴露给公网，由 Cloudflare 全球 CDN（含中国大陆节点）提供低延迟下载。

### 存储结构

```
s3://wopal-release/
├── wopal-cli/                 ← wopal-cli（已实施）
│   └── ...
└── ellamaka/
    ├── v0.1.0/                ← 版本化、不可变
    │   ├── ellamaka-darwin-arm64.tar.gz
    │   ├── ellamaka-darwin-x64.tar.gz
    │   ├── ellamaka-linux-x64.tar.gz
    │   ├── ellamaka-windows-x64.zip
    │   ├── manifest.json
    │   ├── checksums.txt
    │   └── release-notes.md
    ├── v0.2.0/
    │   └── ...
    └── latest/                ← 仅 manifest.json，5 分钟 TTL
        └── manifest.json
```

### URL 结构

- 版本化：`https://download.coursedao.com/ellamaka/v$VERSION/<file>`
- Latest 别名：`https://download.coursedao.com/ellamaka/latest/manifest.json`

### 缓存策略

| 路径 | Cache-Control | 含义 |
|------|---------------|------|
| `v$VERSION/*` | `public, max-age=604800` | 1 周、覆盖后最多 1 周生效 |
| `latest/*` | `public, max-age=300` | 5 分钟、新版本发布后最多 5 分钟生效 |

### 与 wopal-cli 的一致性

ellamaka 与 wopal-cli 共享同一套 R2 bucket `wopal-release`、同一个自定义域名 `download.coursedao.com`，以及相同的缓存策略、latest 别名设计和去重原则。差异仅在于产品级顶层目录（`ellamaka/` vs `wopal-cli/`）和 tag 命名格式（`v0.1.0` vs `cli-v0.3.0`）。

---

## 9. Out of Scope for P1

1. 自定义安装目录
2. npm / brew / winget / choco 等多渠道适配
3. 自动后台更新
4. R2 以外的镜像/分发渠道
5. 在分发阶段替代 wopal-space mode 的配置融合与 runtime loading
6. 独立 ellamaka installer 脚本
7. `engine.ts` 下载 URL 切换为 R2（wopal-cli 侧，稍后实施）

---

## 10. Related Documents

| 文档 | 说明 |
|---|---|
| `./BRANDING.md` | ellamaka 品牌注入点清单与合并注意事项 |
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md` | 产品级 setup integration flow 与系统分层 |
| `../../wopal-cli/docs/DESIGN.md` | CLI 的 setup / engine / space orchestration 边界 |
| `../../wopal-cli/docs/DISTRIBUTION.md` | CLI 对 ellamaka release 的消费契约 |
| `../../../.wopal/docs/DESIGN.md` | ontology 的 template、command 与 runtime maintenance 设计 |
| `../../../.wopal/docs/DISTRIBUTION.md` | ontology materialization 与 runtime handoff 边界 |

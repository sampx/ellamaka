# Ellamaka — Distribution

> **状态**: Active
> **更新时间**: 2026-07-24
> **上级架构**:
> - `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> - `../../../docs/products/wopal-space/DESIGN-onboarding.md`（P2 统一入口设计）
> **项目设计**: `./DESIGN.md`

## 0. Change Log

| Date | Type | Summary |
|---|---|---|
| 2026-07-24 | Updated | P2 收尾：缓存策略对齐（versioned 30 天、latest 60 秒 + 主动 purge）；Desktop 自动更新 P2 完成项（增量更新验证、跨 channel 隔离）；ellamaka CLI 降级为 Desktop 依赖；修正 `wopal ellamaka install` 已切 R2 的过时说明。 |
| 2026-07-18 | Updated | 修正 §3.2/§3.4/§5：`--arch primary` 实际产出 7 个目标（含 3 baseline 变体），与 R2 生产 manifest 一致；重写 §9 Desktop Distribution：基于实际代码（build-node.ts sidecar + electron-builder），明确 sidecar 为 Node.js runtime 无 AVX2 二分，补充 wopal-site 安装入口，厘清 electron-updater P1 行为（检测通知、非自动安装）；新增 §3.6 Re-release Versioning：semver prerelease 后缀方案解决同版本重复发布问题，`tag-release.sh` 自动递增 `-N` 后缀 |
| 2026-07-16 | Updated | 新增 §9 Desktop Distribution：明确桌面端为独立发布单元，定义 artifact contract、CI matrix、R2 独立路径、electron-updater feed 与签名公证分阶段方案；原 §9/§10 顺延为 §10/§11。 |
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

项目职责、配置链路与 runtime loading 见 `DESIGN.md`。桌面端的分发方案见 §9，其架构与运行时行为见 `DESKTOP.md`。

---

## 2. Release Backbone

P1 延续上游 OpenCode CLI release pipeline 作为发布骨架。ellamaka 是 OpenCode 的 fork，构建体系通过 `@opencode-ai/script` 包引入上游脚本，`packages/ellamaka/build.ts` 注入品牌（`BINARY_NAME=ellamaka`）与裁剪。ellamaka 对上游的裁剪仅限于：

- **平台裁剪**：`--arch primary` 构建 7 个 P1 平台（4 native + 3 baseline），排除 musl、arm64 变体
- **发布位置**：binary 分发从 GitHub Release 迁移到 Cloudflare R2

P1 的 canonical release source：

- **Cloudflare R2**（`https://download.coursedao.com/ellamaka/`）— 唯一 binary 分发源
- `wopal-cn/ellamaka` GitHub Releases — 仅保留 markdown 索引页面，**不携带 binary 附件**
- `wopal-cn/ellamaka` Gitee Releases — 同上，仅 markdown 索引
- `wopal-cn/wopal-space-ontology` GitHub Releases — 同上
- `wopal-cn/wopal-space-ontology` Gitee Releases — 同上

P2 的 canonical consumer：

1. `wopal ellamaka install`（已切换为 R2 下载，参见 `projects/wopal-cli/src/lib/engine.ts:11`）
2. `wopal setup`（通过 `wopal ellamaka install`）
3. **Desktop onboarding**（P2 阶段新主路径：Desktop 通过 `engine.ts` 的 R2 下载逻辑在 onboarding step 3 安装 ellamaka CLI）
4. 人工从 GitHub/Gitee Release 页面点击 R2 链接下载

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

**触发条件**：仅 `workflow_dispatch`。由 `scripts/tag-release.sh` 推 tag 后通过 `gh workflow run --ref <tag> -f version=<ver>` 按需触发；workflow 不监听 `push: tags`。

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
bun packages/ellamaka/build.ts --arch primary --web-ui ellamaka-app
```

`--arch primary` 裁剪为 7 个 P1 目标平台（4 个 native + 3 个 baseline 变体）。过滤逻辑排除 musl、arm64 等变体，保留 baseline 以兼容老 x64 CPU（无 AVX2 指令集）：

| OS | Arch | 条件 |
|---|---|---|
| darwin | arm64 | — |
| darwin | x64 | — |
| darwin | x64 | baseline 变体（`avx2: false`） |
| linux | x64 | `abi === undefined` |
| linux | x64 | baseline 变体（`avx2: false`, `abi === undefined`） |
| windows | x64 | — |
| windows | x64 | baseline 变体（`avx2: false`） |

`--web-ui` 默认嵌入 `ellamaka-app`。手动发布可以选择 `app` 基线或 `none`。

**Step 3 — 打包上传**：

上游 `build.ts` 最后一步 `Script.release` 会直接上传到 GitHub Release。ellamaka fork 裁剪此行为：由 CI workflow 接管打包逻辑。归档规则与 wopal-cli 对齐：

- macOS / Linux → `.tar.gz`
- Windows → `.zip`

7 个平台产物分别通过 `actions/upload-artifact` 上传：

```
dist/ellamaka-darwin-arm64.tar.gz
dist/ellamaka-darwin-x64.tar.gz
dist/ellamaka-darwin-x64-baseline.tar.gz
dist/ellamaka-linux-x64.tar.gz
dist/ellamaka-linux-x64-baseline.tar.gz
dist/ellamaka-windows-x64.zip
dist/ellamaka-windows-x64-baseline.zip
```

**Step 4 — 生成元数据并发布**（`release` job，仅 `release=true` 时运行）：

1. 下载 7 个 artifact
2. 验证 7 个文件存在
3. 运行 `scripts/package-release.mjs manifest` 生成 `manifest.json`、`checksums.txt`、`release-notes.md`
   - `manifest.json` 中 artifact `url` 指向 R2 版本化路径
   - `release-notes.md` 包含平台下载表的 markdown 表格
4. 上传全部 10 个文件到 R2 版本化路径 `s3://wopal-release/ellamaka/v$VERSION/`（7 个 artifact + manifest.json + checksums.txt + release-notes.md）
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
bun packages/ellamaka/build.ts --web-ui ellamaka-app
```

等价于 `BINARY_NAME=ellamaka OPENCODE_CHANNEL=main bun run build -- --p1`，版本号自动推导为 `0.0.0-main-{timestamp}`。

### 3.4 发布验证清单

| 检查项 | 命令 / 方法 |
|---|---|
| TypeScript 类型检查 | `bun typecheck` |
| P1 构建成功（7 平台，含 baseline 变体） | `BINARY_NAME=ellamaka bun packages/ellamaka/build.ts --arch primary --web-ui ellamaka-app` |
| 产物数正确 | `dist/` 下恰好 7 个目录：`ellamaka-darwin-arm64`、`ellamaka-darwin-x64`、`ellamaka-darwin-x64-baseline`、`ellamaka-linux-x64`、`ellamaka-linux-x64-baseline`、`ellamaka-windows-x64`、`ellamaka-windows-x64-baseline` |
| 版本号正确 | `./dist/ellamaka-darwin-arm64/bin/ellamaka --version` 输出 `ellamaka/x.y.z` |
| manifest 生成 | `manifest.json` 包含 7 个 artifact，`url` 指向 `download.coursedao.com/ellamaka/v$VERSION/` |
| checksums 正确 | `sha256sum dist/ellamaka-*.tar.gz dist/ellamaka-*.zip` 与 `checksums.txt` 对比 |
| R2 上传成功 | `aws s3 ls s3://wopal-release/ellamaka/v$VERSION/` 可见全部产物 |
| GitHub Release 无 binary | Release 页面有 markdown 下载表，Assets 区域无附件（或仅 manifest/checksums 文本） |

### 3.5 与上游 opencode 的区别

| | opencode `script/publish.ts` | ellamaka `publish-ellamaka.yml` |
|---|---|---|
| 触发方式 | 手动运行脚本 | workflow_dispatch（由 tag-release.sh dispatch） |
| 平台范围 | 完整矩阵（含 musl, baseline, arm64） | `--arch primary` 裁剪为 7 平台（4 native + 3 baseline），排除 musl、arm64 |
| 发布内容 | npm 包 (CLI/SDK/Plugin) + Desktop finalize | CLI 二进制 × 7 平台（4 native + 3 baseline） |
| 版本管理 | 遍历所有 `package.json` 替换版本号 | 通过 `OPENCODE_VERSION` env 传入 |
| Tag 管理 | 脚本内创建/删除/推送 tag | tag 由 tag-release.sh 推送，workflow 由 dispatch 触发，不在 workflow 内操作 tag |
| 产物目标 | npm registry + GitHub Release（带 binary） | R2 CDN + GitHub Release（仅 markdown 索引） |
| 归档格式 | macOS `.zip`，Linux `.tar.gz` | macOS/Linux `.tar.gz`，Windows `.zip`（与 wopal-cli 对齐） |

### 3.6 Re-release Versioning

ellamaka 无法及时跟踪上游 OpenCode 版本，需要在上游基线版本（如 `1.15.13`）上修复问题后重复发布。同版本号重复发布会带来 R2 CDN 缓存冲突（同路径覆盖后旧缓存最多 1 周才过期）和 `wopal ellamaka install` 幂等性失效（版本号不变无法触发更新检测）。

ellamaka 采用 **semver prerelease 后缀** 解决此问题：在 base 版本号后追加 `-N` 递增后缀（如 `1.15.13-1`、`1.15.13-2`），每次重发自增。semver prerelease 是标准格式，`semver.valid()` 接受，`semver.compare()` 排序正确，所有依赖 semver 的代码（`Script.version`、`getReleaseType()`、`Installation.latest()`）正常工作。`wopal ellamaka install` 的版本比较走 string `===`，`1.15.13-1` !== `1.15.13`，能正确检测到新版本。

`tag-release.sh` 实现自动递增逻辑：

1. 用户传 base 版本（如 `1.15.13`）
2. 检查远程 `v1.15.13` 是否存在
3. 不存在 → 用 `v1.15.13`
4. 存在 → 用正则 `^(.*)-([0-9]+)$` 拆分 base 和 suffix，从 1 开始递增，试 `v1.15.13-1`、`v1.15.13-2`...直到找到远程不存在的 tag

用户也可显式传带后缀的版本（如 `1.15.13-1`），脚本同样检测并在已存在时递增。

此机制与上游 opencode 的区别：

| | opencode | ellamaka |
|---|---|---|
| 重发方式 | 删除旧 tag 重建同名 tag | 保留旧 tag，自动递增 `-N` 后缀 |
| `package.json` version | `publish.ts` 遍历所有 `package.json` 统一替换 | 不自动修改，版本号仅存在于 tag 和 `OPENCODE_VERSION` 环境变量 |
| R2 路径 | 同版本覆盖 | 每个后缀独立路径（`v1.15.13-1/`、`v1.15.13-2/`），无缓存冲突 |
| latest manifest | 指向同版本 | 指向最新后缀版本 |

等 ellamaka 合并上游新版本时，用正常的三位版本号（如 `1.16.0`），自然回归标准格式，`-N` 后缀的历史版本保留在 R2 上作为不可变归档。

---

## 4. Release Contract

### 4.1 Stable release

stable release 是 P1 唯一的自动消费通道。

每个 stable release 包含：

1. 版本 tag `v<version>`
2. P1 官方平台 artifacts（7 个）
3. `manifest.json`（installer 机器入口，artifact URL 指向 R2）
4. `checksums.txt`
5. `release-notes.md`（markdown 下载表，供 GitHub/Gitee Release 页面使用）

P1 的默认 version discovery 使用 `https://download.coursedao.com/ellamaka/latest/manifest.json`。显式指定版本时，consumer 使用对应的 `v<version>` release tag 和稳定 artifact naming。

P1 的信任边界是 R2 HTTPS 下载与 SHA-256 完整性校验。`checksums.txt` 用于发现下载损坏、传输错误和 artifact 不匹配。签名、attestation、provenance 和独立透明日志属于后续阶段。

### 4.2 Local development channel

`main` 保持本地开发特例语义：

1. `bun packages/ellamaka/build.ts` 本地构建
2. 本地验证
3. 手动 rebuild / replace

`main` 走独立的手动路径，与 released channel 分离。

---

## 5. Artifact Contract

ellamaka 的发布产物使用 `ellamaka` 品牌。

P1 平台矩阵收缩为 one-click 主路径所需的官方优先平台。ellamaka 单包体积较大，musl、Linux arm64 和 Windows arm64 变体属于后续扩展。x64 平台同时产出 native 与 baseline 变体，baseline 兼容不支持 AVX2 的老 x64 CPU。

| OS | Arch | Variant | Artifact |
|---|---|---|---|
| macOS | arm64 | native | `ellamaka-darwin-arm64.tar.gz` |
| macOS | x64 | native | `ellamaka-darwin-x64.tar.gz` |
| macOS | x64 | baseline | `ellamaka-darwin-x64-baseline.tar.gz` |
| Linux | x64 | glibc | `ellamaka-linux-x64.tar.gz` |
| Linux | x64 | glibc-baseline | `ellamaka-linux-x64-baseline.tar.gz` |
| Windows | x64 | native | `ellamaka-windows-x64.zip` |
| Windows | x64 | baseline | `ellamaka-windows-x64-baseline.zip` |

Contract：

1. archive 内的 binary 名称固定为 `ellamaka` / `ellamaka.exe`。
2. consumer 依赖稳定文件名，无需人工解释 release 页面。
3. `manifest.json` 是 installer 的机器可读入口，其中 `url` 指向 R2 自定义域名；`checksumsUrl` 指向同版本 `checksums.txt` 的 R2 地址。
4. `checksums.txt` 与 `release-notes.md` 作为元数据文件与 artifacts 一同发布到 R2。
5. 归档格式与 wopal-cli 对齐：macOS / Linux 使用 `.tar.gz`，Windows 使用 `.zip`。
6. release build 的 channel 对外固定为 `latest`（`packages/ellamaka/branding.ts:CHANNEL_RELEASE`）；本地开发 channel 保持 `main`（`CHANNEL_DEV`）。
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
2. 自动检测到 WopalSpace 后加载 `<space>/.wopal/`
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
├── wopal-cli/                            ← wopal-cli
│   └── ...
├── ellamaka/                             ← ellamaka CLI 二进制
│   ├── v0.1.0/
│   │   ├── ellamaka-darwin-arm64.tar.gz
│   │   ├── ellamaka-darwin-x64.tar.gz
│   │   ├── ellamaka-darwin-x64-baseline.tar.gz
│   │   ├── ellamaka-linux-x64.tar.gz
│   │   ├── ellamaka-linux-x64-baseline.tar.gz
│   │   ├── ellamaka-windows-x64.zip
│   │   ├── ellamaka-windows-x64-baseline.zip
│   │   ├── manifest.json
│   │   ├── checksums.txt
│   │   └── release-notes.md
│   ├── v0.2.0/
│   │   └── ...
│   └── latest/
│       └── manifest.json
└── ellamaka-desktop/                     ← 桌面安装包（见 §9）
    ├── v0.1.0/
    │   ├── ellamaka-desktop-mac-arm64.dmg
    │   ├── ellamaka-desktop-mac-arm64.zip
    │   ├── ellamaka-desktop-mac-x64.dmg
    │   ├── ellamaka-desktop-mac-x64.zip
    │   ├── ellamaka-desktop-win-x64.exe
    │   ├── ellamaka-desktop-linux-x64.AppImage
    │   ├── ellamaka-desktop-linux-x64.deb
    │   ├── ellamaka-desktop-linux-x64.rpm
    │   ├── manifest.json
    │   ├── latest-mac.yml
    │   ├── latest.yml
    │   ├── latest-linux.yml
    │   ├── checksums.txt
    │   └── release-notes.md
    ├── v0.2.0/
    │   └── ...
    ├── latest/                           ← prod updater payload、blockmap 与 latest-*.yml
    │   ├── latest-mac.yml
    │   ├── latest.yml
    │   ├── latest-linux.yml
    │   └── ellamaka-desktop-*
    └── beta/                             ← beta channel（见 §9.5）
```

### URL 结构

CLI：

- 版本化：`https://download.coursedao.com/ellamaka/v$VERSION/<file>`
- Latest 别名：`https://download.coursedao.com/ellamaka/latest/manifest.json`

Desktop：

- Prod 版本化：`https://download.coursedao.com/ellamaka-desktop/v$VERSION/<file>`
- Prod Latest（updater feed）：`https://download.coursedao.com/ellamaka-desktop/latest/<feed>`
- Beta 版本化：`https://download.coursedao.com/ellamaka-desktop/beta/v$VERSION/<file>`
- Beta Latest：`https://download.coursedao.com/ellamaka-desktop/beta/latest/<feed>`

### 缓存策略（P2 对齐）

| 路径 | Cache-Control | 含义 |
|------|---------------|------|
| `v$VERSION/*` | `public, max-age=2592000` | 30 天，文件不可变 |
| `latest/*` | `public, max-age=60` | 60 秒，发版时主动 purge |

缓存策略对 CLI 与 Desktop 一致。Desktop 的 `latest/*` 同时承载 `manifest.json` 与 `latest-*.yml` 自动更新 feed，TTL 一致。

**实现契约**（所有 release workflow 必须遵守）：

1. 上传前先 `delete-object` 清掉旧内容（R2 自定义域名不主动 invalidate）—— `publish-ellamaka.yml:142-144` 和 `publish-ellamaka-desktop.yml:195-196` 已实现
2. `put-object` 时显式设置 `--cache-control` —— `publish-ellamaka.yml:160` 和 `publish-ellamaka-desktop.yml:210` 已实现
3. 发版完成后主动 purge `latest/*` 路径（Cloudflare API 或 cache-buster 请求）

### Desktop 独立路径

`ellamaka-desktop/` 与 `ellamaka/` 并列，共享同一 bucket、同一自定义域名与缓存策略，但为独立发布单元：版本化目录、latest 别名、beta channel 和去重原则均独立。差异在于顶层产品目录与产物形态（安装包 + updater feed，而非 CLI 二进制归档）。详见 §9。

### 与 wopal-cli 的一致性

ellamaka 与 wopal-cli 共享同一套 R2 bucket `wopal-release`、同一个自定义域名 `download.coursedao.com`，以及相同的缓存策略、latest 别名设计和去重原则。差异仅在于产品级顶层目录（`ellamaka/` vs `wopal-cli/`）和 tag 命名格式（`v0.1.0` vs `cli-v0.3.0`）。

---

## 9. Desktop Distribution

> **状态**: Draft（架构见 `DESKTOP.md`，打包配置见 `packages/ellamaka-desktop/electron-builder.config.ts`）

桌面端（`ellamaka-desktop`）是 Electron 应用，承载 `ellamaka-app` Workbench。与 CLI 共享同一 `v$VERSION` tag，但作为**独立发布单元**：R2 子路径独立、CI 构建独立、manifest / updater feed 机制独立。

### 9.1 系统构成

Desktop 由两层组成：

| 层 | 是什么 | 构建方式 |
|---|---|---|
| Electron 壳子 | 窗口、菜单、系统集成、electron-updater | `electron-builder` 打包 |
| Sidecar 引擎 | Ellamaka HTTP/WS/PTY 后端 | `packages/opencode/script/build-node.ts` → Node.js runtime bundle |

Sidecar 是 Node.js runtime（`build-node.ts` 产 `dist/node/`），**不是** Bun compile 的 CLI binary，因此不存在 CLI 的 native vs baseline（AVX2）二分——Node.js 代码由 V8 JIT 在运行时自适应 CPU 指令集。`packages/ellamaka-desktop/scripts/utils.ts` 中的 `SIDECAR_BINARIES` 保留自上游 OpenCode 的旧 sidecar 嵌入机制（构建时从 GitHub Release 下载预编译 CLI binary，在 PR #17803 之前使用），ellamaka fork 跟随上游 #17803 改为 `prebuild.ts → build-node.ts` 本地构建 Node.js runtime，`SIDECAR_BINARIES` 相关的下载函数不再被构建流程调用。

### 9.2 构建链路

```
bun install
  ↓
bun packages/opencode/script/build-node.ts    ← 构建 sidecar（Node.js runtime）
  ↓
cd packages/ellamaka-desktop
bun run build                                   ← electron-vite 编译 main/preload/renderer
bun run package:mac   (或 :win / :linux)       ← electron-builder 打包安装包
```

本地开发快捷方式：`./scripts/build.sh desktop [--channel main|beta|prod] [--install]`。

### 9.3 Artifact Contract

产物由 `electron-builder` 按 `packages/ellamaka-desktop/electron-builder.config.ts` 生成，`artifactName` 模板为 `ellamaka-desktop-${os}-${arch}.${ext}`。

| OS | Arch | 产物 | 说明 |
|----|------|------|------|
| macOS | arm64 | `ellamaka-desktop-mac-arm64.dmg` + `.zip` | DMG 是用户安装包；ZIP 供 electron-updater 使用 |
| macOS | x64 | `ellamaka-desktop-mac-x64.dmg` + `.zip` | 同上 |
| Windows | x64 | `ellamaka-desktop-win-x64.exe`（NSIS） | 一键安装及 updater payload |
| Linux | x64 | `ellamaka-desktop-linux-x64.AppImage` + `.deb` + `.rpm` | AppImage 免安装，deb/rpm 可选 |

Contract：

1. `main` 只用于本地构建；发布 workflow 只接受 `beta` / `prod`。
2. `prod` channel 的 `appId` 为 `ai.ellamaka.desktop`，deep link scheme 为 `ellamaka://`。
3. beta 与 prod 的版本化目录和 latest feed 相互独立，也不与 CLI 混用。
4. 自动更新 feed（`latest-mac.yml` / `latest.yml` / `latest-linux.yml`）与安装包同传 R2。
5. Release 下载表展示 DMG、EXE、AppImage、deb 和 rpm。ZIP 与 blockmap 属于 updater 资产。

### 9.4 CI 构建（matrix）

新增 `publish-ellamaka-desktop.yml`，触发条件与 CLI 一致（仅 `workflow_dispatch`，由 `tag-release.sh` dispatch），仓库守卫 `if: github.repository == 'wopal-cn/ellamaka'`。

原生安装包无法在单一 runner 跨平台生成，必须用 matrix：

| Runner | 产物 |
|--------|------|
| `macos-latest` | dmg + zip（arm64 + x64） |
| `windows-latest` | NSIS（`.exe`） |
| `ubuntu-latest` | AppImage + deb + rpm |

workflow 在整个 matrix job 注入同一组 `OPENCODE_CHANNEL`、`OPENCODE_VERSION` 和 `OPENCODE_RELEASE`。`bun run build` 的 prebuild 负责构建 sidecar，随后 electron-builder 使用相同 context 打包。产物经 sha256 校验后上传到对应 channel 的版本路径，updater payload、blockmap 与 feed 同步到该 channel 的 latest 路径。

R2 上传、manifest 校验与 CDN purge 复用 CLI 的既有机制（单 PUT 防多部件损坏 + 回比 manifest hash + 主动 purge）。

### 9.5 R2 存储与 URL

见 §8 存储结构：`s3://wopal-release/ellamaka-desktop/v$VERSION/` 与 `.../latest/`。

- Prod 版本化：`https://download.coursedao.com/ellamaka-desktop/v$VERSION/<file>`
- Prod Latest（updater feed）：`https://download.coursedao.com/ellamaka-desktop/latest/<feed>`
- Prod Latest（manifest，给下载页用）：`https://download.coursedao.com/ellamaka-desktop/latest/manifest.json`
- Beta 版本化：`https://download.coursedao.com/ellamaka-desktop/beta/v$VERSION/<file>`
- Beta Latest：`https://download.coursedao.com/ellamaka-desktop/beta/latest/<feed>`

缓存策略与 CLI 一致（`v$` 30 天、`latest` 60 秒）。

### 9.5.1 latest 目录下的两类消费者

`ellamaka-desktop/latest/` 目录服务两类不同消费者：

| 消费者 | 读取文件 | 用途 |
|--------|---------|------|
| electron-updater（应用内） | `latest-mac.yml` / `latest.yml` / `latest-linux.yml` | 启动时检测更新、增量下载、签名校验 |
| wopal-site 下载页（人工） | `manifest.json` | 渲染下载卡片、获取 macOS/Windows/Linux 平台 URL |

**两者职责独立、格式不同**：
- yml 是 electron-updater 的硬契约（sha512、相对路径、平台分文件）
- manifest.json 是下载页/CLI 的下载入口（sha256、绝对 URL、单文件含全平台）

**当前缺口（P2 收尾项）**：`publish-ellamaka-desktop.yml` 上传 `v$VERSION/manifest.json` 后**没有**把它复制/重新上传到 `latest/manifest.json`。下载页因此无法用 manifest 模式获取 Desktop 最新版本，fallback 只能写死 URL。修复方法：workflow 加 1 行：

```yaml
put_with_cache "release-output/manifest.json" "${LATEST_PREFIX}/manifest.json" "public, max-age=60" "application/json"
```

### 9.6 安装入口

Desktop 不走 `wopal ellamaka install`——安装包是自包含原生安装程序，与 CLI 的 binary + 固定路径模型不同。

P1 安装入口为 **wopal-site 下载页面**，链接指向 `download.coursedao.com/ellamaka-desktop/`。用户下载对应平台安装包后自行安装。安装路径由各平台安装程序默认决定（macOS `/Applications`、Windows `Program Files`、Linux 用户自定）。Sidecar 和 Ellamaka 配置仍写入 `~/.wopal/`（与 CLI 共享 Install Contract §6 的 runtime roots），安装包只负责桌面外壳。

### 9.7 自动更新（electron-updater）

`electron-builder` 的 `publish` 配置使用 generic provider，feedURL 指向 R2 `ellamaka-desktop/latest/`，**不走 GitHub Release**（与 CLI canonical source 一致）。

- macOS：`latest-mac.yml`
- Windows：`latest.yml`
- Linux：`latest-linux.yml`

beta 与 prod 启用 electron-updater。prod 使用稳定 latest feed；beta 使用独立 beta latest feed并允许 prerelease。main 本地构建不启用 updater。macOS ZIP、Windows NSIS EXE、AppImage 及对应 blockmap 位于 updater latest 路径，普通下载表只展示用户安装产物。

#### 9.7.1 Channel 隔离（P2 明确）

不同 channel 是**独立应用**（`electron-builder.config.ts:88-117` 分配不同 appId）：

| Channel | appId |
|---------|-------|
| main | `ai.ellamaka.desktop.main` |
| beta | `ai.ellamaka.desktop.beta` |
| prod | `ai.ellamaka.desktop` |

**不允许跨 channel 升级**：
- prod 用户**不能直接升到 beta**——macOS/Windows 视为不同应用，必须卸载后重装
- beta 用户**不能直接切到 prod**——同上
- `autoUpdater.allowDowngrade = true`（`src/main/updater.ts:17`）只在**同一 channel 内**生效

**理由**：
- beta 是测试渠道，prod 用户主动切到 beta 意味着接受不稳定
- 强隔离防止 beta bug 污染 prod 用户群
- 切换 channel 是显式操作（卸载重装），不应该是自动行为

#### 9.7.2 P1→P2 更新功能验证

`src/main/updater.ts` 当前实现：
- `autoUpdater.channel = "latest"`
- `autoUpdater.allowPrerelease = CHANNEL === "beta"`
- `autoUpdater.allowDowngrade = true`
- `autoUpdater.autoDownload = false`（手动下载）
- `autoUpdater.autoInstallOnAppQuit = false`（手动安装）

| 功能 | P1 状态 | P2 目标 |
|------|---------|---------|
| 检测新版本 | ✅ 可用 | 三平台验证（macOS arm64/x64、Windows x64、Linux x64） |
| 手动下载 | ✅ `autoDownload=false` | 验证三平台增量更新 |
| 增量更新（NSIS/ZIP/AppImage） | 未验证 | 开启后验证 blockmap 生成和增量下载 |
| DMG 全量更新 | N/A（DMG 不支持增量） | 确认全量下载正常工作 |
| 用户确认后安装 | ✅ `quitAndInstall` | 验证三平台重启流程 |
| 跨 channel 升级 | 不支持 | 不实现（见 §9.7.1） |

#### 9.7.3 增量更新机制

electron-updater 的增量更新基于 blockmap：
- **macOS ZIP** + **Windows NSIS** + **Linux AppImage** 支持增量
- **macOS DMG** 不支持（必须全量下载）
- blockmap 在 `publish-ellamaka-desktop.yml` 中由 electron-builder 自动生成

增量更新生效条件：
1. electron-builder 生成的 `latest-mac.yml` / `latest.yml` / `latest-linux.yml` 包含 `packages[].path` 和 `sha2` 字段
2. R2 上传时包含对应 `.blockmap` 文件
3. 客户端版本号必须**严格小于** feed 中版本号

P2 验证步骤：
1. 在 prod channel 发版 v1.0.0 → 安装
2. 发版 v1.0.1 → 启动 Desktop，验证检测到更新
3. 确认下载 → 验证只下载差异块（不是全量）
4. 确认安装 → 验证成功升级到 v1.0.1

#### 9.7.4 macOS 特殊处理

macOS 上 ad-hoc 签名的 app 升级时，electron-updater 的 `autoUpdater.quitAndInstall` 可能因 quarantine 导致启动失败。处理：
- 安装前 `xattr -d com.apple.quarantine` 新版本（如果可能）
- 引导用户在新版本首次启动时执行"右键 → 打开"操作
- P2 阶段不解决代码签名问题（见 §9.8）

### 9.8 代码签名

P1 使用 ad-hoc 签名。该签名保证 macOS app bundle 结构完整并通过 `codesign --verify --deep --strict`，不提供开发者身份认证或 Apple notarization。

未签名的用户体验约束：

- macOS：首次打开需右键 → 打开，或在"隐私与安全性"中选择"仍要打开"
- Windows：SmartScreen 警告，需"仍要运行"
- Linux：AppImage 需 `chmod +x`

签名属于后续阶段：

| 平台 | 要求 | electron-builder 配置 |
|------|------|----------------------|
| macOS | Apple Developer ID Application 证书 + `notarytool` 公证 | 启用 `hardenedRuntime` / `notarize` |
| Windows | 代码签名证书（OV 或 EV） | `CSC_LINK` / `CSC_KEY_PASSWORD` 通过 CI secrets 注入 |
| Linux | 可选 GPG 签名 | 不强制 |

### 9.9 分阶段实施

| 阶段 | 范围 | 退出标准 |
|------|------|----------|
| P1（已完成） | CI matrix + R2 + channel feed + updater 资产 + wopal-site 下载页 + GH/Gitee 索引；macOS ad-hoc 签名 | 三平台安装包可从 R2 下载；macOS 用户可主动接受风险后运行；electron-updater 检测+手动下载已可用 |
| P2（收尾中） | 三平台更新检测验证；NSIS/ZIP/AppImage 增量更新验证（DMG 全量）；用户确认后安装流程验证；缓存策略对齐；ellamaka CLI 降级为 Desktop 依赖；**Desktop workflow 补 `latest/manifest.json` 上传**（见 §9.5.1） | 三平台增量更新全流程通过；缓存 TTL 对齐（versioned 30 天、latest 60 秒）；`latest/manifest.json` 可被下载页 fetch |
| P2 之后 | mac/win 签名 + 公证；electron-updater 切换为自动下载安装 | 无 Gatekeeper / SmartScreen 拦截，应用内自动更新可用 |

### 9.10 验证清单

| 检查项 | 方法 |
|--------|------|
| 三平台产物存在 | R2 `ellamaka-desktop/v$VERSION/` 下 dmg/zip/exe/AppImage/deb/rpm 齐全 |
| feed 生成 | `latest-mac.yml` / `latest.yml` / `latest-linux.yml` 上传至 `latest/` |
| sha256 一致 | `checksums.txt` 与各产物比对 |
| 版本检测 | 旧版本启动后 electron-updater 检测到新版本并提示 |
| 签名（阶段 2） | mac `spctl -a -vv` 通过；win 右键属性显示数字签名 |
| 自动安装（阶段 2） | 应用内确认更新后自动下载并安装 |
| GH/Gitee 索引 | Release 页面含桌面下载表，无 binary 附件（或仅元数据） |

---

## 10. Out of Scope

以下适用于 Engine。Desktop 的 out of scope 见 §9.9。

1. 自定义安装目录
2. npm / brew / winget / choco 等多渠道适配
3. 自动后台更新（Engine；Desktop 已通过 electron-updater 提供检测通知）
4. R2 以外的镜像/分发渠道
5. 在分发阶段替代 wopal-space mode 的配置融合与 runtime loading
6. 独立 ellamaka installer 脚本
7. **P1 已移除**：`engine.ts` 下载 URL 切换为 R2——`projects/wopal-cli/src/lib/engine.ts:11` 已定义 `R2_BASE_URL = "https://download.coursedao.com/ellamaka"`，R2 切换早已完成

---

## 11. Related Documents

| 文档 | 说明 |
|---|---|
| `./DESKTOP.md` | ellamaka-desktop 架构、状态所有权、PTY 生命周期与验证契约 |
| `./BRANDING.md` | ellamaka 品牌注入点清单与桌面分发身份（§17） |
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md` | 产品级 setup integration flow 与系统分层 |
| `../../../docs/products/wopal-space/DESIGN-onboarding.md` | P2 统一入口设计：Desktop onboarding、缓存策略对齐、Desktop auto-update |
| `../../wopal-cli/docs/DESIGN.md` | CLI 的 setup / engine / space orchestration 边界 |
| `../../wopal-cli/docs/DISTRIBUTION.md` | CLI 对 ellamaka release 的消费契约 |
| `../../../.wopal/docs/DESIGN.md` | ontology 的 template、command 与 runtime maintenance 设计 |
| `../../../.wopal/docs/DISTRIBUTION.md` | ontology materialization 与 runtime handoff 边界 |

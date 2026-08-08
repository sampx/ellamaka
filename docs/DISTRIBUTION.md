# Ellamaka — Distribution

> **状态**: Active
> **更新时间**: 2026-08-03
> **上级架构**:
>
> - `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> - `../../../docs/products/wopal-space/DESIGN-onboarding.md`（P2 统一入口设计）
>   **项目设计**: `./DESIGN.md`
>   **版本契约**: `./RELEASE-IDENTITY.md`

## 0. Change Log

| Date       | Type    | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | Updated | 采用独立产品 SemVer + 结构化 ReleaseIdentity：CLI/Desktop 使用 namespaced tag 与独立 workflow；OpenCode baseline 改由 upstream lock 提供；完整安装校验 CLI stable latest；旧 `X.Y.Z-N` 仅作为历史迁移格式。                                                                                                                                                                                                                                          |
| 2026-07-24 | Updated | P2 收尾：缓存策略对齐（versioned 30 天、latest 60 秒 + 主动 purge）；Desktop 自动更新 P2 完成项（增量更新验证、跨 channel 隔离）；ellamaka CLI 降级为 Desktop 依赖；修正 `wopal ellamaka install` 已切 R2 的过时说明。                                                                                                                                                                                                                               |
| 2026-07-18 | Updated | 修正 §3.2/§3.4/§5：`--arch primary` 实际产出 7 个目标（含 3 baseline 变体），与 R2 生产 manifest 一致；重写 §9 Desktop Distribution：基于实际代码（build-node.ts sidecar + electron-builder），明确 sidecar 为 Node.js runtime 无 AVX2 二分，补充 wopal-site 安装入口，厘清 electron-updater P1 行为（检测通知、非自动安装）；新增 §3.6 Re-release Versioning：semver prerelease 后缀方案解决同版本重复发布问题，`tag-release.sh` 自动递增 `-N` 后缀 |
| 2026-07-16 | Updated | 新增 §9 Desktop Distribution：明确桌面端为独立发布单元，定义 artifact contract、CI matrix、R2 独立路径、electron-updater feed 与签名公证分阶段方案；原 §9/§10 顺延为 §10/§11。                                                                                                                                                                                                                                                                       |
| 2026-06-08 | Updated | 切换为 R2 CDN 主分发；GitHub/Gitee Release 只保留 markdown 索引；macOS 归档格式对齐为 `.tar.gz`。                                                                                                                                                                                                                                                                                                                                                    |
| 2026-06-01 | Updated | §4.2 补充本地构建入口；§5 标注 channel 值来源；§9 添加 BRANDING.md 引用。                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-06-01 | Updated | 新增 §3 Publish Procedure：版本模型、CI 自动发布步骤、手动发布步骤、验证清单、与上游 opencode 的差异对比。                                                                                                                                                                                                                                                                                                                                           |
| 2026-06-01 | Updated | 明确 P1 publish workflow 必须脱离 upstream repository guard 并产出 ellamaka 品牌 artifacts。                                                                                                                                                                                                                                                                                                                                                         |
| 2026-05-30 | Updated | 优化语言表达，明确独立分发定位。                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-05-30 | Updated | 精简为分发特有内容，避免与 `DESIGN.md` 重复。                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-30 | Created | 定义 ellamaka 的 release backbone、artifact contract、固定安装路径与 runtime handoff。                                                                                                                                                                                                                                                                                                                                                               |

---

## 1. Scope

本文件定义 Ellamaka CLI 与 Desktop 的 release backbone、artifact naming、固定安装路径和消费边界。产品版本、OpenCode baseline、构建身份与兼容规则由 `RELEASE-IDENTITY.md` 唯一定义。

Ellamaka CLI 与 Desktop 分别发布为独立制品，使用各自的 SemVer、namespaced tag、workflow、R2 latest 和回滚边界。Desktop manifest 声明兼容约束，Wopal 读取并校验 CLI stable latest，把两个制品组合为一个可安装产品。默认 `wopal ellamaka install` 安装完整产品，`wopal setup` 复用该能力并启动 Desktop onboarding。

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

1. `wopal ellamaka install`：默认安装 Desktop latest + CLI stable latest，并在落盘前校验兼容性。
2. `wopal ellamaka install --cli`：只安装外部 Ellamaka CLI。
3. `wopal setup`：确保完整产品并拉起 Desktop onboarding。
4. Desktop-first：Desktop bootstrap Wopal CLI 后，通过 machine operation 安装并校验 CLI stable latest。
5. 人工从 GitHub/Gitee Release 页面点击 R2 链接下载。

---

## 3. Publish Procedure

### 3.1 Version Model

Ellamaka CLI 与 Desktop 均使用标准 SemVer，但不共享产品版本：

```text
ellamaka-cli-v1.17.1
ellamaka-cli-v1.18.0-rc.1
ellamaka-desktop-v1.16.2
ellamaka-desktop-v1.17.0-beta.1
```

产品 version 从触发发布的 namespaced tag 派生；OpenCode Engine baseline 从 `release/upstreams.lock.json` 的 `sources.opencode` 读取；Ellamaka source identity 从 workflow checkout commit 读取。冻结的 `packages/app` / `packages/desktop` 来源读取各自 `componentBaselines` entry，只参与 drift 审计，不替代 Engine compatibility baseline。workflow input 和环境变量不得成为第二真相源。

`@opencode-ai/script` 的 `Script` 类仍作为 CLI 构建接口使用，但注入的是已经由 release context 验证的 Ellamaka CLI 产品版本：

| 环境变量           | 作用                            | `Script` 行为                                                                                                                              |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENCODE_VERSION` | 兼容上游构建接口                | release build 必须等于 namespaced tag 中的 CLI 产品版本；不能表达 OpenCode baseline                                                        |
| `OPENCODE_RELEASE` | 上游构建接口的 release 模式开关 | `Script.release = !!OPENCODE_RELEASE`；Ellamaka wrapper 必须拦截上游 tag/GitHub Release 副作用，正式 tag 与 publication 只由 workflow 拥有 |
| `OPENCODE_CHANNEL` | 更新渠道                        | 设置时作为 `Script.channel`；未设置时自动推导（`OPENCODE_VERSION` 为非 `0.0.0-*` 时 → `"latest"`，否则 → git branch 名）                   |
| `BINARY_NAME`      | 产物名前缀                      | 构建时替换所有硬编码 `"opencode"`，控制输出目录名、binary 名、archive 名                                                                   |

这些变量是上游 `Script` 类的构建接口，不是 Ellamaka release identity 的权威存储。完整版本、上游、channel 和 build identity 由 `RELEASE-IDENTITY.md` 与生成的 `release-context.json` 约束。

### 3.2 自动化发布（CI）

**触发条件**：仅 `workflow_dispatch`。由 `scripts/tag-release.sh` 创建并推送 namespaced tag 后，以该 tag 作为 `--ref` 触发目标 workflow；workflow 不监听 `push: tags`。

**工作流文件**：`.github/workflows/publish-ellamaka.yml`

**Step 1 — Release context**：

```
ellamaka-cli-v1.17.1
  → product=ellamaka-cli
  → version=1.17.1
  → channel=stable
  → upstream=release/upstreams.lock.json
  → build.gitCommit=checked-out commit
```

release job 必须验证 tag 指向当前 checkout、version/channel 合法、`sources.opencode.gitCommit` 是当前 release commit 的祖先，并对每个冻结 component baseline 执行目录 drift check。手动开发构建不发布 versioned path 或 latest。

**Step 2 — 构建 CLI**（`build-cli` job）：

```bash
bun install
BINARY_NAME=ellamaka \
OPENCODE_VERSION=1.17.1 \
OPENCODE_RELEASE=true \
bun packages/ellamaka/build.ts --arch primary --web-ui ellamaka-app
```

`--arch primary` 裁剪为 7 个 P1 目标平台（4 个 native + 3 个 baseline 变体）。过滤逻辑排除 musl、arm64 等变体，保留 baseline 以兼容老 x64 CPU（无 AVX2 指令集）：

| OS      | Arch  | 条件                                                |
| ------- | ----- | --------------------------------------------------- |
| darwin  | arm64 | —                                                   |
| darwin  | x64   | —                                                   |
| darwin  | x64   | baseline 变体（`avx2: false`）                      |
| linux   | x64   | `abi === undefined`                                 |
| linux   | x64   | baseline 变体（`avx2: false`, `abi === undefined`） |
| windows | x64   | —                                                   |
| windows | x64   | baseline 变体（`avx2: false`）                      |

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
3. 运行 `scripts/package-release.mjs manifest`，从同一个 `release-context.json` 生成 `manifest.json`、`checksums.txt`、`release-notes.md`
   - `manifest.json` 中 artifact `url` 指向 R2 版本化路径
   - `release-notes.md` 包含平台下载表的 markdown 表格
4. 先上传全部文件到 workflow-run staging prefix 并回读校验，再以禁止覆盖的写入复制 artifacts、checksums 和 release notes 到 `s3://wopal-release/ellamaka/v$VERSION/`；最后写入 `manifest.json` 作为正式发布提交点
5. 回读 versioned manifest/artifacts 并校验 identity、SHA-256 和完整性；有效 manifest 已存在时 fail closed，禁止覆盖。只有 partial objects、没有 manifest/latest/updater/Release 页面引用且能证明 attempt ownership 时，可显式清理后从修复 commit 同版本重试
6. 直接更新 CLI stable latest——CLI 是独立产品，发布不受任何 Desktop 版本约束（见 RELEASE-IDENTITY.md §11）
7. 整对象替换 cli-only/full-product 共用的 stable latest `s3://wopal-release/ellamaka/latest/manifest.json`
8. 主动 purge latest 的 CDN cache；mutable alias 更新失败时 workflow 失败，但不得回滚或覆盖 versioned release，只能基于已提交 manifest 单独重试 promotion
9. 创建 4 个 release 条目（均使用本次 CLI 的 `release-notes.md`，**不挂 binary**）：
   - GitHub `wopal-cn/ellamaka`：`gh release create ellamaka-cli-v$VERSION --repo wopal-cn/ellamaka --notes-file`
   - GitHub `wopal-cn/wopal-space-ontology`：使用独立索引 tag/body，不复用 Ellamaka 产品 tag namespace（需 PAT）
   - Gitee `wopal-cn/ellamaka`：`node scripts/create-gitee-release.mjs --repo wopal-cn/ellamaka`
   - Gitee `wopal-cn/wopal-space-ontology`：`node scripts/create-gitee-release.mjs --repo wopal-cn/wopal-space-ontology`

**仓库守卫**：所有 job 都有 `if: github.repository == 'wopal-cn/ellamaka'`，防止 fork 误触发。

**缓存策略**：已提交版本化路径 `max-age=2592000`（30 天）且不可覆盖；latest 使用 `max-age=60`（60 秒）。新发布使用新的 SemVer 和完整版本路径，并在发布后主动 purge mutable aliases。latest 只能在不可变 release 回读验证与兼容 promotion gate 完成后更新。提交前 failed attempt 只能精确清理自身对象；提交后重大失败按 `RELEASE-IDENTITY.md` §9.2 整版撤回、永久跳号。

### 3.3 手动发布（本地开发）

**本地复现 release 构建**：

```bash
BINARY_NAME=ellamaka OPENCODE_VERSION=1.17.1 OPENCODE_RELEASE=true \
  bun run build -- --p1
```

本地命令只用于复现构建与验证，产物输出到 `packages/opencode/dist/ellamaka-{platform}/bin/ellamaka`，不得上传 versioned path、更新 latest 或创建 tag。正式发布必须 checkout 已存在的 namespaced tag 并由 CI 生成 release context。

**本地开发快捷方式**：

```bash
bun packages/ellamaka/build.ts --web-ui ellamaka-app
```

等价于 `BINARY_NAME=ellamaka OPENCODE_CHANNEL=main bun run build -- --p1`，版本号自动推导为 `0.0.0-main-{timestamp}`。

### 3.4 发布验证清单

| 检查项                                  | 命令 / 方法                                                                                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 类型检查                     | `bun typecheck`                                                                                                                                                                                                       |
| P1 构建成功（7 平台，含 baseline 变体） | `BINARY_NAME=ellamaka bun packages/ellamaka/build.ts --arch primary --web-ui ellamaka-app`                                                                                                                            |
| 产物数正确                              | `dist/` 下恰好 7 个目录：`ellamaka-darwin-arm64`、`ellamaka-darwin-x64`、`ellamaka-darwin-x64-baseline`、`ellamaka-linux-x64`、`ellamaka-linux-x64-baseline`、`ellamaka-windows-x64`、`ellamaka-windows-x64-baseline` |
| 版本号正确                              | `./dist/ellamaka-darwin-arm64/bin/ellamaka --version` 输出 `ellamaka/x.y.z`                                                                                                                                           |
| manifest 生成                           | `manifest.json` 包含 7 个 artifact，`url` 指向 `download.coursedao.com/ellamaka/v$VERSION/`                                                                                                                           |
| checksums 正确                          | `sha256sum dist/ellamaka-*.tar.gz dist/ellamaka-*.zip` 与 `checksums.txt` 对比                                                                                                                                        |
| R2 上传成功                             | `aws s3 ls s3://wopal-release/ellamaka/v$VERSION/` 可见全部产物                                                                                                                                                       |
| latest promotion gate                   | CLI 独立发布，latest 直接更新；Desktop 发布前校验 CLI stable latest 满足其 requirements；latest 内容与 versioned manifest 完全一致                                                                                  |
| immutable guard                         | 重跑同一 product tag/version 时在上传前失败，不删除或覆盖既有 versioned objects                                                                                                                                       |
| failed attempt retry                    | 无有效 manifest/alias/Release 页面引用时，只清理可证明 ownership 的 partial objects/tag，并允许修复 commit 后同版本重试                                                                                               |
| whole-version withdrawal                | 版本先记入 `release/withdrawn-versions.json`，再恢复并验证健康 aliases、purge CDN，最后删除该版本 R2 prefix、Release 页面和 product tag；版本永久禁用                                                                 |
| GitHub Release 无 binary                | Release 页面有 markdown 下载表，Assets 区域无附件（或仅 manifest/checksums 文本）                                                                                                                                     |

### 3.5 与上游 opencode 的区别

|          | opencode `script/publish.ts`               | ellamaka `publish-ellamaka.yml`                                                        |
| -------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| 触发方式 | 手动运行脚本                               | workflow_dispatch（由 tag-release.sh dispatch）                                        |
| 平台范围 | 完整矩阵（含 musl, baseline, arm64）       | `--arch primary` 裁剪为 7 平台（4 native + 3 baseline），排除 musl、arm64              |
| 发布内容 | npm 包 (CLI/SDK/Plugin) + Desktop finalize | CLI 二进制 × 7 平台（4 native + 3 baseline）                                           |
| 版本管理 | 遍历所有 `package.json` 替换版本号         | product SemVer 从 namespaced tag 派生，构建层再注入 `OPENCODE_VERSION`                 |
| Tag 管理 | 脚本内创建/删除/推送 tag                   | `tag-release.sh` 创建产品 namespaced tag；提交后不覆盖，整版 withdraw 可删除但永久跳号 |
| 产物目标 | npm registry + GitHub Release（带 binary） | R2 CDN + GitHub Release（仅 markdown 索引）                                            |
| 归档格式 | macOS `.zip`，Linux `.tar.gz`              | macOS/Linux `.tar.gz`，Windows `.zip`（与 wopal-cli 对齐）                             |

### 3.6 Standard Release Versioning

新发布只使用 `X.Y.Z`、`X.Y.Z-beta.N` 和 `X.Y.Z-rc.N`。有效 versioned manifest 是正式提交点；提交后任何 source、配置或 artifact 变化都必须创建新版本，禁止覆盖 tag、manifest 或 versioned R2 path。提交前 failed attempt 可在精确清理后从修复 commit 同版本重试。提交后的重大失败版本可整版 withdraw 删除，但必须写入 `release/withdrawn-versions.json` 并永久跳号。build date、Git hash 和 workflow run ID 放入结构化 build metadata，不进入版本字符串。

stable latest 不引用 prerelease。Desktop beta 使用独立 appId/feed；CLI RC 在独立 RC feed 落地前只发布 versioned manifest，必须显式指定版本安装。

### 3.7 Legacy Migration

历史 `X.Y.Z-N` 和 `X.Y.Z-N.rcM` 保持不可变归档，只由 legacy reader 识别。新 publisher、tag allocator、latest 和 cleanup 不再生成或依赖这些格式。

迁移 release 必须在标准 SemVer precedence 上高于所有已发布 legacy 版本。完整迁移、双写、比较、不可变性和 channel 规则见 `RELEASE-IDENTITY.md` §8–§12。

---

## 4. Release Contract

### 4.1 Stable release

stable release 是默认自动消费通道。prerelease 不提升 stable latest。

每个 stable release 包含：

1. 产品 tag `ellamaka-cli-v<version>`
2. P1 官方平台 artifacts（7 个）
3. `manifest.json`（installer 机器入口，artifact URL 指向 R2）
4. `checksums.txt`
5. `release-notes.md`（markdown 下载表，供 GitHub/Gitee Release 页面使用）

Headless 与完整产品安装都从 `https://download.coursedao.com/ellamaka/latest/manifest.json` 发现 CLI stable latest。完整产品安装还必须用 Desktop requirements 校验该 manifest；不兼容时 fail closed 并提示刷新或重试，不搜索历史 CLI。consumer 不根据 Git tag 拼装下载地址。

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

| OS      | Arch  | Variant        | Artifact                              |
| ------- | ----- | -------------- | ------------------------------------- |
| macOS   | arm64 | native         | `ellamaka-darwin-arm64.tar.gz`        |
| macOS   | x64   | native         | `ellamaka-darwin-x64.tar.gz`          |
| macOS   | x64   | baseline       | `ellamaka-darwin-x64-baseline.tar.gz` |
| Linux   | x64   | glibc          | `ellamaka-linux-x64.tar.gz`           |
| Linux   | x64   | glibc-baseline | `ellamaka-linux-x64-baseline.tar.gz`  |
| Windows | x64   | native         | `ellamaka-windows-x64.zip`            |
| Windows | x64   | baseline       | `ellamaka-windows-x64-baseline.zip`   |

Contract：

1. archive 内的 binary 名称固定为 `ellamaka` / `ellamaka.exe`。
2. consumer 依赖稳定文件名，无需人工解释 release 页面。
3. `manifest.json` 是 installer 的机器可读入口，其中 `url` 指向 R2 自定义域名；`checksumsUrl` 指向同版本 `checksums.txt` 的 R2 地址。
4. `checksums.txt` 与 `release-notes.md` 作为元数据文件与 artifacts 一同发布到 R2。
5. 归档格式与 wopal-cli 对齐：macOS / Linux 使用 `.tar.gz`，Windows 使用 `.zip`。
6. release build 的 channel 对外固定为 `latest`（`packages/ellamaka/branding.ts:CHANNEL_RELEASE`）；本地开发 channel 保持 `main`（`CHANNEL_DEV`）。
7. release workflow 的发布目标为 R2 + GitHub Release（markdown）+ Gitee Release（markdown）。

#### 5.1 Schema 契约单一真相源

ellamaka 的 Wopal 集成模块（`packages/opencode/src/wopal/`）通过 npm 依赖消费共享契约包 `@wopal/cli-capability-schema`（`^` 下界，如 `^0.3.13`），不再维护手写 Schema 副本。npm `^` 语义即最低版本语义：编译期类型、运行时最低版本检查、发布门禁三环节复用同一声明。

- 数据 schema（`spaceListSchema`/`spaceProjectsListSchema`/`spaceSearchSchema`/`skillsListSchema`）从共享包导入，运行时用 `Value.Check`/`Value.Errors` 验证。
- `CliEnvelope`（稳定协议层）保留本地 TypeBox 定义；运行时错误类（`CapabilityContractError`/`SpaceControlUnavailable`/`StableErrorCode`）保留 Effect。
- `MIN_WOPAL_CLI_VERSION` 构建注入：`.ci/versions.json` 的 `minWopalCli` 构建时自动跟随依赖下界（`scripts/lib/version.sh` 的 `resolve_min_wopal_cli_version` 取依赖下界与配置的更高者），可手动覆盖（提前声明）。`build.sh`/`dev.sh`/`build-node.ts`/`build.ts`/`electron.vite.config.ts` 统一注入。
- 开发联调用 `bun link` 本地 schema 包（不修改 package.json），发布前 `bun unlink` 切回 npm 包。

---

## 6. Install Contract

所有用户级路径都解析到 `WOPAL_HOME`。默认值：macOS / Linux 为 `~/.wopal`，Windows 为 `%USERPROFILE%\.wopal`。

| Platform      | Binary path                    | Runtime roots                                    |
| ------------- | ------------------------------ | ------------------------------------------------ |
| macOS / Linux | `$WOPAL_HOME/bin/ellamaka`     | `$WOPAL_HOME/ellamaka/{config,data,cache,state}` |
| Windows       | `$WOPAL_HOME/bin/ellamaka.exe` | `$WOPAL_HOME/ellamaka/{config,data,cache,state}` |

### 分发渠道

ellamaka CLI 通过以下渠道分发到用户本地：

- **主路径**：`wopal ellamaka install` 完整安装或 Desktop onboarding 的 `install-engine` machine operation。
- **CLI-only 路径**：`wopal ellamaka install --cli`。
- **手动下载**：用户从 GitHub/Gitee Release 页面点击 R2 链接下载。

### 安装契约

consumer（wopal-cli 或 Desktop）在安装 ellamaka 时须遵循以下契约：

- 只从 R2 读取机器契约：cli-only 读取 CLI `latest/manifest.json`；完整产品读取 Desktop channel latest 与 CLI stable latest。
- CLI-only 安装默认使用 Engine stable latest；完整产品安装和 onboarding 根据 Desktop requirements 校验同一个 CLI stable latest。
- 修改本机前解析并验证完整安装计划；CLI latest 不兼容时明确失败并建议刷新或重试，不搜索历史版本或回退到 `testedWith`。
- 根据平台和稳定 artifact naming 计算目标文件名，不依赖 GitHub API 解析 release 页面。
- 安装目标固定为上述 binary path。
- 放置前必须校验 SHA-256。
- 安装后执行 `ellamaka --version` 作为健康验证。
- `$WOPAL_HOME/bin/` 只保存 executable。artifact 收据写入 `$WOPAL_HOME/ellamaka/state/ellamaka-install.json`。
- 旧 `$WOPAL_HOME/bin/.ellamaka.meta.json` 在成功安装时迁移并删除。

### 职责边界

- consumer 负责下载、校验、放置和状态报告；ellamaka 的运行目录（`$WOPAL_HOME/ellamaka/`）由 ellamaka 自身管理。
- `ellamaka-main` 保持本地开发语义，走手动 build/rebuild 路径。

### Channel Consumption

`wopal ellamaka install --beta` 安装 beta Desktop 与满足其 requirements 的 stable CLI。`--beta` 只影响 Desktop manifest 来源，不把 CLI 隐式切换到 prerelease channel。

完整 beta 安装流程：

1. 从 `ellamaka-desktop/beta/latest/manifest.json` 读取 beta Desktop manifest。
2. 读取 `ellamaka/latest/manifest.json`，校验 product、stable channel、upstream baseline 和 engine API range。
3. 安装 Desktop + CLI，并校验实际 release identity。

`wopal ellamaka install --beta --cli` 是无意义的参数组合，必须返回 option conflict；cli-only stable 使用 `--cli`。本期 Wopal 公共安装命令不安装 CLI prerelease；CLI prerelease 只保留 versioned artifact 供发布验证和人工诊断。

`wopal setup` 默认安装或复用 stable Desktop。`wopal setup --beta` 显式选择 beta Desktop；不在 Desktop 安装前增加 channel prompt。`--beta` 与 `--terminal` 冲突，因为 terminal setup 不安装 Desktop。

CLI stable latest 永不包含 RC。RC 在独立 feed 落地前只存在于 versioned path；Desktop beta 也不会自动获得 CLI RC。

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

> R2 bucket 结构、URL 格式、缓存策略、安全配置和 Release 页面策略的完整定义见 `DESIGN-distribution.md` §2-§5。
>
> Ellamaka CLI 的 R2 路径为 `ellamaka/v$VERSION/`（版本化）和 `ellamaka/latest/`（stable latest）。Desktop 的 R2 路径为 `ellamaka-desktop/v$VERSION/`、`ellamaka-desktop/latest/`（stable）和 `ellamaka-desktop/beta/`（beta channel）。

Ellamaka 与 wopal-cli 共享同一 R2 bucket、自定义域名和缓存策略，但 Git tag 必须使用各自产品命名空间。R2 的 `v$VERSION` 是路径格式，不表示共享 Git tag。

Desktop 的 `latest/` 目录服务两类消费者：

| 消费者                     | 读取文件                                             | 用途                                                       |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| electron-updater（应用内） | `latest-mac.yml` / `latest.yml` / `latest-linux.yml` | 启动时检测更新、增量下载、签名校验                         |
| wopal-site 下载页（人工）  | `manifest.json`                                      | 渲染下载卡片、获取各平台 URL                               |
| wopal-cli 完整安装         | `manifest.json`                                      | 获取 Desktop artifact、ReleaseIdentity 与兼容 requirements |

Desktop manifest 同时服务下载页和完整产品安装。它包含 `releaseIdentity`、`embeddedComponents.sidecar`、`requirements.externalCli`、`requirements.wopalCli`、`testedWith` 与 `artifacts[]`。迁移期可双写顶层 `version`/`minWopalCli`，但不得继续发布精确 `engineVersion` pin。Workflow 将相同内容上传到 versioned 路径与 channel 的 `latest/manifest.json`。

---

## 9. Desktop Distribution

> **状态**: Draft（架构见 `DESKTOP.md`，打包配置见 `packages/ellamaka-desktop/electron-builder.config.ts`）

桌面端（`ellamaka-desktop`）是 Electron 应用，承载 `ellamaka-app` Workbench。它与 CLI 是两个独立发布单元：使用 `ellamaka-desktop-v<version>` namespaced tag，R2 子路径、CI build、manifest、updater feed 和回滚边界均独立。

### 9.1 系统构成

Desktop 由两层组成：

| 层            | 是什么                                 | 构建方式                                                          |
| ------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Electron 壳子 | 窗口、菜单、系统集成、electron-updater | `electron-builder` 打包                                           |
| Sidecar 引擎  | Ellamaka HTTP/WS/PTY 后端              | `packages/opencode/script/build-node.ts` → Node.js runtime bundle |

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

| OS      | Arch  | 产物                                                    | 说明                                           |
| ------- | ----- | ------------------------------------------------------- | ---------------------------------------------- |
| macOS   | arm64 | `ellamaka-desktop-mac-arm64.dmg` + `.zip`               | DMG 是用户安装包；ZIP 供 electron-updater 使用 |
| macOS   | x64   | `ellamaka-desktop-mac-x64.dmg` + `.zip`                 | 同上                                           |
| Windows | x64   | `ellamaka-desktop-win-x64.exe`（NSIS）                  | 一键安装及 updater payload                     |
| Linux   | x64   | `ellamaka-desktop-linux-x64.AppImage` + `.deb` + `.rpm` | AppImage 免安装，deb/rpm 可选                  |

Contract：

1. `main` 只用于本地构建；发布 workflow 只接受 `beta` / `prod`。
2. `prod` channel 的 `appId` 为 `ai.ellamaka.desktop`，deep link scheme 为 `ellamaka://`。
3. beta 与 prod 的版本化目录和 latest feed 相互独立，也不与 CLI 混用。
4. 自动更新 feed（`latest-mac.yml` / `latest.yml` / `latest-linux.yml`）与安装包同传 R2。
5. Release 下载表展示 DMG、EXE、AppImage、deb 和 rpm。ZIP 与 blockmap 属于 updater 资产。
6. Desktop manifest 包含结构化 ReleaseIdentity、内嵌 sidecar identity、外部 CLI compatibility requirements 与 `testedWith`。workflow 在发布前验证 CLI stable latest 满足 requirements；`testedWith` 用于审计，不作为安装 pin。

### 9.4 CI 构建（matrix）

新增 `publish-ellamaka-desktop.yml`，触发条件与 CLI 一致（仅 `workflow_dispatch`，由 `tag-release.sh` dispatch），仓库守卫 `if: github.repository == 'wopal-cn/ellamaka'`。Desktop workflow 在发布前验证 CLI stable latest 满足自身 requirements；不满足时 fail closed。不存在跨产品 release-set 协调流程——CLI 独立发布，Desktop 自我适配（见 RELEASE-IDENTITY.md §11）。

原生安装包无法在单一 runner 跨平台生成，必须用 matrix：

| Runner           | 产物                     |
| ---------------- | ------------------------ |
| `macos-latest`   | dmg + zip（arm64 + x64） |
| `windows-latest` | NSIS（`.exe`）           |
| `ubuntu-latest`  | AppImage + deb + rpm     |

workflow checkout 精确 `ellamaka-desktop-v<version>` tag，生成一次 release context；matrix job、prebuild sidecar、electron-builder、manifest 和 updater feed 使用同一个 product version、upstream lock 和 source commit。`bun run build` 的 prebuild 负责构建 sidecar，产物经 SHA-256 校验后上传到对应 channel 的版本路径，updater payload、blockmap 与 feed 同步到该 channel 的 latest 路径。

R2 上传、manifest 校验与 CDN purge 复用 CLI 的既有机制（单 PUT 防多部件损坏 + 回比 manifest hash + 主动 purge）。

### 9.5 R2 存储与 URL

见 §8 和 `DESIGN-distribution.md` §2。Desktop prod/beta 的 URL 结构与缓存策略已统一定义。

### 9.6 安装入口

Desktop 有两个安装入口：wopal-site 下载页和 `wopal ellamaka install`。两者消费相同 Desktop manifest 与原生安装包。

手动入口由用户下载对应平台安装包。CLI 入口优先发现已有系统安装。缺失时，macOS 从 ZIP 安装到 `~/Applications/Ellamaka.app`，Windows 通过 NSIS current-user 模式安装到 `%LOCALAPPDATA%\Programs\Ellamaka`，Linux 把 AppImage 安装到 `${XDG_DATA_HOME:-~/.local/share}/ellamaka/` 并创建 desktop entry。完成后重新探测应用版本。Sidecar 和 Ellamaka 配置仍写入 `WOPAL_HOME`。

`wopal ellamaka install --beta` 安装 beta Desktop 到独立位置（不同 appId，不覆盖 prod 安装）：

| 平台    | CLI-managed beta Desktop 位置                                           |
| ------- | ----------------------------------------------------------------------- |
| macOS   | `~/Applications/Ellamaka Beta.app`                                      |
| Windows | `%LOCALAPPDATA%\Programs\Ellamaka Beta\`                                |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/ellamaka-beta/Ellamaka Beta.AppImage` |

Beta Desktop 与 prod Desktop 可共存。CLI 通过 appId 区分，不混淆安装位置。

### 9.7 自动更新（electron-updater）

`electron-builder` 的 `publish` 配置使用 generic provider，feedURL 指向 R2 `ellamaka-desktop/latest/`，**不走 GitHub Release**（与 CLI canonical source 一致）。

- macOS：`latest-mac.yml`
- Windows：`latest.yml`
- Linux：`latest-linux.yml`

beta 与 prod 启用 electron-updater。prod 使用稳定 latest feed；beta 使用独立 beta latest feed并允许 prerelease。main 本地构建不启用 updater。macOS ZIP、Windows NSIS EXE、AppImage 及对应 blockmap 位于 updater latest 路径，普通下载表只展示用户安装产物。

#### 9.7.1 Channel 隔离（P2 明确）

不同 channel 是**独立应用**（`electron-builder.config.ts:88-117` 分配不同 appId）：

| Channel | appId                      |
| ------- | -------------------------- |
| main    | `ai.ellamaka.desktop.main` |
| beta    | `ai.ellamaka.desktop.beta` |
| prod    | `ai.ellamaka.desktop`      |

**不允许跨 channel 升级**：

- prod 用户**不能直接升到 beta**——macOS/Windows 视为不同应用，必须卸载后重装
- beta 用户**不能直接切到 prod**——同上
- `autoUpdater.allowDowngrade` 即使因兼容 electron-updater 的技术路径暂时保留，也不能授权更新；ReleaseIdentity policy gate 只允许同一 product/channel 的标准 SemVer 前进

**理由**：

- beta 是测试渠道，prod 用户主动切到 beta 意味着接受不稳定
- 强隔离防止 beta bug 污染 prod 用户群
- 切换 channel 是显式操作（卸载重装），不应该是自动行为

#### 9.7.2 P1→P2 更新功能验证

目标更新链路：

```text
fetch Desktop manifest
  → validate ReleaseIdentity/product/channel/build
  → standard SemVer compare
  → authorize expected version
  → runtime version checks (wopal-cli floor + engine major.minor)
  → electron-updater check/download/install
  → require updateInfo.version === expected version
```

更新事务在 policy 授权通过后、下载前执行运行时版本检查（`authorizeVersionChecks`，见 `src/main/version-check.ts`）：

1. 本机 wopal-cli 必须 `>= MIN_WOPAL_CLI_VERSION`（协议兼容域下界，构建注入，见 §5）。
2. 本机 ellamaka CLI 主版本 `vX.Y` 必须与目标 Desktop 主版本一致（同一引擎两种形态，`major.minor` 相等即匹配）。

任一检查不满足 → 拒绝更新并提示（先升级 wopal-cli / 重装 engine 后重试），不静默放行。本机 wopal-cli / ellamaka CLI 版本无法探测时跳过对应检查并记日志，不阻塞更新。本 Plan 只做检查与拒绝/提示，不自动升级 wopal-cli（自动升级复用 onboarding 的 `installWopalCli`）。

`src/main/updater.ts` 当前的 electron-updater 参数需要在迁移中收敛：

- `autoUpdater.channel = "latest"`
- `autoUpdater.allowPrerelease = CHANNEL === "beta"`
- `autoUpdater.allowDowngrade = true`（技术兼容开关，不是业务授权）
- `autoUpdater.autoDownload = false`（手动下载）
- `autoUpdater.autoInstallOnAppQuit = false`（手动安装）

| 功能                          | P1 状态                 | P2 目标                                               |
| ----------------------------- | ----------------------- | ----------------------------------------------------- |
| 检测新版本                    | ✅ 可用                 | 三平台验证（macOS arm64/x64、Windows x64、Linux x64） |
| 手动下载                      | ✅ `autoDownload=false` | 验证三平台增量更新                                    |
| 增量更新（NSIS/ZIP/AppImage） | 未验证                  | 开启后验证 blockmap 生成和增量下载                    |
| DMG 全量更新                  | N/A（DMG 不支持增量）   | 确认全量下载正常工作                                  |
| 用户确认后安装                | ✅ `quitAndInstall`     | 验证三平台重启流程                                    |
| 跨 channel 升级               | 不支持                  | 不实现（见 §9.7.1）                                   |

#### 9.7.3 增量更新机制

electron-updater 的增量更新基于 blockmap：

- **macOS ZIP** + **Windows NSIS** + **Linux AppImage** 支持增量
- **macOS DMG** 不支持（必须全量下载）
- blockmap 在 `publish-ellamaka-desktop.yml` 中由 electron-builder 自动生成

增量更新生效条件：

1. electron-builder 生成的 `latest-mac.yml` / `latest.yml` / `latest-linux.yml` 包含 `packages[].path` 和 `sha2` 字段
2. R2 上传时包含对应 `.blockmap` 文件
3. 客户端 Desktop SemVer 必须严格小于已经通过 manifest policy gate 授权的 feed 版本

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

| 平台    | 要求                                                    | electron-builder 配置                                |
| ------- | ------------------------------------------------------- | ---------------------------------------------------- |
| macOS   | Apple Developer ID Application 证书 + `notarytool` 公证 | 启用 `hardenedRuntime` / `notarize`                  |
| Windows | 代码签名证书（OV 或 EV）                                | `CSC_LINK` / `CSC_KEY_PASSWORD` 通过 CI secrets 注入 |
| Linux   | 可选 GPG 签名                                           | 不强制                                               |

### 9.9 分阶段实施

| 阶段             | 范围                                                                                                                       | 退出标准                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P1（已完成）     | CI matrix + R2 + channel feed + updater 资产 + wopal-site 下载页 + GH/Gitee 索引；macOS ad-hoc 签名                        | 三平台安装包可从 R2 下载；macOS 用户可主动接受风险后运行；electron-updater 检测+手动下载已可用  |
| P2（收尾中）     | 三平台更新检测验证；NSIS/ZIP/AppImage 增量更新验证（DMG 全量）；用户确认后安装流程验证；缓存策略对齐                       | 三平台增量更新全流程通过；缓存 TTL 对齐（versioned 30 天、latest 60 秒）                        |
| Release Identity | CLI/Desktop 独立 SemVer、namespaced tag、upstream lock、latest promotion 与 updater policy gate                            | 新发布不依赖 legacy comparator；latest/cleanup 使用同一规则；manifest 可审计                    |
| 统一 Setup       | Desktop manifest 发布完整兼容 requirements；CLI 可安装 Desktop latest + CLI stable latest；onboarding 收敛首次配置 | CLI-first 与 Desktop-first 汇合；完整安装通过 upstream/engine API 检查；`bin/` 无 metadata 污染 |
| P2 之后          | mac/win 签名 + 公证；electron-updater 切换为自动下载安装                                                                   | 无 Gatekeeper / SmartScreen 拦截，应用内自动更新可用                                            |

### 9.10 验证清单

| 检查项             | 方法                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| 三平台产物存在     | R2 `ellamaka-desktop/v$VERSION/` 下 dmg/zip/exe/AppImage/deb/rpm 齐全 |
| feed 生成          | `latest-mac.yml` / `latest.yml` / `latest-linux.yml` 上传至 `latest/` |
| sha256 一致        | `checksums.txt` 与各产物比对                                          |
| 版本检测           | 旧版本启动后 electron-updater 检测到新版本并提示                      |
| 签名（阶段 2）     | mac `spctl -a -vv` 通过；win 右键属性显示数字签名                     |
| 自动安装（阶段 2） | 应用内确认更新后自动下载并安装                                        |
| GH/Gitee 索引      | Release 页面含桌面下载表，无 binary 附件（或仅元数据）                |

---

## 10. Related Documents

| 文档                                                        | 说明                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `./DESKTOP.md`                                              | ellamaka-desktop 架构、状态所有权、PTY 生命周期与验证契约                |
| `./RELEASE-IDENTITY.md`                                     | 产品 SemVer、OpenCode upstream lock、构建身份、latest 兼容校验与迁移契约 |
| `./BRANDING.md`                                             | ellamaka 品牌注入点清单与桌面分发身份（§17）                             |
| `../../../docs/products/wopal-space/DESIGN-distribution.md` | 产品级分发总设计：R2 架构、缓存策略、完整性模型、Release 页面策略        |
| `../../../docs/products/wopal-space/DESIGN-wopalspace.md`   | 产品级架构与版本体系                                                     |
| `../../../docs/products/wopal-space/DESIGN-onboarding.md`   | onboarding 架构、setup 完整流程、版本兼容矩阵维护                      |
| `../../wopal-cli/docs/DESIGN.md`                            | CLI 的 setup / engine / space orchestration 边界                         |
| `../../wopal-cli/docs/DISTRIBUTION.md`                      | CLI 对 ellamaka release 的消费契约                                       |
| `../../../.wopal/docs/DESIGN.md`                            | ontology 的 template、command 与 runtime maintenance 设计                |
| `../../../.wopal/docs/DISTRIBUTION.md`                      | ontology materialization 与 runtime handoff 边界                         |

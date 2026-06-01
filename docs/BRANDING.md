# ellamaka Branding Guide

ellamaka 对上游 opencode 源码的品牌化改造清单。每条记录：改了什么、在哪、用什么模式、为什么。

---

## 0. 项目精简清单

品牌化第一步：删除与 ellamaka CLI 分发无关的上游模块和文件。以下目录/文件已在首次 fork 时移除，后续合并通过 `UPSTREAM-MERGE-LOG.md` 的精简清单自动排除。

### 已删除目录

| 路径 | 原用途 | 删除原因 |
|---|---|---|
| `packages/desktop/`、`desktop-electron/` | 桌面端（Electron + Tauri） | ellamaka 仅发布 CLI |
| `packages/enterprise/`、`console/`、`function/` | SaaS/Cloud 后台 | ellamaka 无云端服务 |
| `packages/containers/` | Docker 构建 | 不通过 Docker 分发 |
| `packages/web/` | 网站 | 不在本仓库维护 |
| `packages/extensions/`、`identity/` | VS Code 扩展、品牌素材 | 无 VS Code 插件计划 |
| `packages/slack/`、`zen/` | Slack bot、API 代理 | 无 Slack 集成计划 |
| `sdks/` | Python SDK + VS Code 扩展 | 仅 CLI 二进制分发 |
| `github/` | GitHub Action | 上游 CI，ellamaka 用自己的 |
| `infra/` | SST 基础设施（AWS/Cloudflare） | 无云端部署 |
| `nix/` | Nix 构建文件 | ellamaka 不使用 Nix |
| `specs/` | 上游设计 spec 文档 | 不参与构建 |
| `script/` | 上游发布/变更日志脚本（`publish.ts`、`raw-changelog.ts`） | ellamaka 用 `publish-ellamaka.yml` + `build.ts --p1` |
| `.opencode/` | opencode 项目级开发配置（agent、plugin、theme 等） | 上游 IDE 配置，ellamaka 开发不依赖 |

### 已删除文件

| 文件 | 原用途 | 删除原因 |
|---|---|---|
| `CONTRIBUTING.md` | opencode 贡献指南 | 链接指向 `anomalyco/opencode` |
| `README.zh.md` | opencode 中文 README | opencode 品牌展示；ellamaka 的中文 README 使用 `README.zh-CN.md` |
| `SECURITY.md` | opencode 安全策略 | 内容引用 "OpenCode" 产品名 |
| `flake.nix`、`flake.lock` | Nix flake 配置 | 不使用 Nix |
| `sst.config.ts`、`sst-env.d.ts` | SST 部署配置 | 无云端部署 |
| `install` | Shell 安装脚本 | 上游安装脚本，ellamaka 通过 wopal-cli 安装 |
| `.github/ISSUE_TEMPLATE/` | 上游 issue 模板（bug-report、feature-request、question） | ellamaka 用自己的模板 |
| `.github/workflows/publish.yml` | 上游发布 CI（npm + Desktop） | ellamaka 用 `publish-ellamaka.yml` |
| `.github/workflows/deploy.yml` | 上游部署 CI | ellamaka 无云端部署 |

### 保留说明

| 路径 | 原因 |
|------|------|
| `.github/TEAM_MEMBERS` | `@opencode-ai/script` 模块初始化时读取，运行时依赖，不可删除 |

| 路径 | 保留原因 |
|---|---|
| `README.md`、`README.zh-CN.md` | ellamaka 自己的项目 README（已替换上游版本） |
| `AGENTS.md`、`AGENTS.zh-CN.md` | ellamaka 开发规范 |
| `scripts/` | ellamaka 自己的脚本（`build.sh`、`dev.sh`、`check-cleanup.sh`），与上游 `script/` 是两个不同目录 |
| `.github/workflows/publish-ellamaka.yml` | ellamaka 发布流程 |
| `package.json` | 构建入口，`"name": "opencode"` 不影响用户可见品牌（非产品表面） |
| `patches/` | npm 补丁，构建需要 |
| `LICENSE` | MIT 许可证 |

首次 fork 精简共移除 1830+ 文件（-396k 行，`77585fa19`）。

---

## 2. 核心品牌常量

**位置**：`packages/ellamaka/branding.ts`

```ts
export const BINARY_NAME = "ellamaka"
export const BINARY_TITLE = "Ellamaka"
export const VERSION_PREFIX = "ellamaka"
export const CHANNEL_RELEASE = "ellamaka"
export const CHANNEL_DEV = "ellamaka-main"
```

**模式**：独立包（零侵入）。所有上游文件通过 env 或 import 引用这些常量，不在上游源码中硬编码品牌值。

---

## 3. 构建产物品牌

### 3.1 Binary 名称

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | `const BINARY_NAME = process.env.BINARY_NAME \|\| "opencode"` → 构建循环中所有硬编码 `"opencode"` 替换为 `BINARY_NAME` | **env 驱动**：默认保持上游行为 `"opencode"`，打包时 `BINARY_NAME=ellamaka` |
| `packages/ellamaka/build.ts` | 包装脚本：设置 `BINARY_NAME=ellamaka` 环境变量后调用上游 build.ts | **独立文件** |

**上游侵入**：build.ts 中 4 行（BINARY_NAME 常量 + outfile/name/execArgv/smoke test 中的替换）。文件中不包含 `"ellamaka"` 硬编码。

### 3.2 Release channel

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | 定义 `OPENCODE_CHANNEL` 时使用 `Script.channel`（上游原生行为） | **无侵入**：`Script` 类已支持 `OPENCODE_CHANNEL` env |
| `packages/ellamaka/build.ts` | 设置 `OPENCODE_CHANNEL=${CHANNEL_RELEASE\|CHANNEL_DEV}` | **独立文件** |

### 3.3 P1 平台矩阵

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | `--p1` flag + `p1Targets` 过滤逻辑 | **argv 驱动**：只添加 flag 和通用 filter，不包含品牌特定值 |

**上游侵入**：build.ts 中约 10 行（flag 定义 + filter 逻辑）。

### 3.4 本地构建脚本

| 文件 | 变更 | 模式 |
|------|------|------|
| `scripts/build.sh` | dist 路径 `opencode-darwin` → `ellamaka-darwin`，binary 名 `ellamaka` | **独立文件**：`scripts/` 不在上游仓库中 |

---

## 4. CLI 运行时品牌

### 4.1 版本号标识

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/index.ts` | `import { VERSION_PREFIX } from "../../ellamaka/branding"` → `.version(...)` 使用 `` `${VERSION_PREFIX}/${InstallationVersion}` `` | **import 注入**：只增加 1 行 import + 1 行模板字面量，品牌值不在文件中 |

**上游侵入**：2 行。

### 4.2 Debug 信息

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/cmd/debug/index.ts` | `import { VERSION_PREFIX } from "../../../../../ellamaka/branding"` → `console.log(\`${VERSION_PREFIX} version: ${InstallationVersion}\`)` | **import 注入**：同上 |

### 4.3 CLI 命令名与 help 文本

`.scriptName(BINARY_NAME)` 是 yargs CLI 框架的品牌入口，控制所有自动生成的输出：usage 行（`ellamaka [command]`）、帮助文本前缀、错误信息前缀。改变此值 = 一步覆盖大部分 CLI 用户界面品牌。

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/index.ts` | `import { BINARY_NAME } from "../../ellamaka/branding"` → `.scriptName(BINARY_NAME)` + `startsWith(BINARY_NAME + " ")` | **import 注入**：2 行，品牌值不在文件中 |
| `packages/opencode/src/temporary.ts` | `import { BINARY_NAME } from "../../ellamaka/branding"` → `.scriptName(BINARY_NAME)` | **import 注入**：2 行 |

### 4.4 CLI 命令描述与用户提示

以下文件中的命令 describe、prompts 输出、错误提示显式引用 `"opencode"`，需替换为 branding 常量。

| 文件 | 变更 | 涉及行数 |
|------|------|---------|
| `src/cli/cmd/upgrade.ts` | describe + prompts 输出 | 3 处 |
| `src/cli/cmd/uninstall.ts` | describe + intro + goodbye | 3 处 |
| `src/cli/cmd/web.ts` | describe | 1 处 |
| `src/cli/cmd/tui/thread.ts` | describe ×2 | 2 处 |
| `src/cli/error.ts` | 3 处错误提示文字 | 3 处 |
| `src/cli/cmd/providers.ts` | config 引导文字 | 2 处 |
| `src/cli/cmd/mcp.ts` | config 引导文字 | 1 处 |

所有替换使用同一模式：`import { BINARY_NAME } from "../../ellamaka/branding"` → 字符串中 `` `${BINARY_NAME}` `` 或 `BINARY_NAME` 模板替换。

**不替换的内容**：
- `uninstall.ts` 中的包管理器命令（`npm uninstall -g opencode-ai` 等）——这些是上游 npm 包名，不受 ellamaka 控制
- `"# opencode"` shell 配置标记——属 ellamaka 安装程序写入的标记，不修改
- `Log.Default.info("opencode", ...)`——非用户可见的日志标识

### 4.5 上游 URL 保留

`opencode.ai` 及其子域名（`api.opencode.ai`、`app.opencode.ai`）出现在 providers.ts、github.ts、server/shared/ui.ts 中。ellamaka 目前没有替代域名，保留不变。待 ellamaka 自有网站上线后批量替换。

---

## 5. 数据路径品牌

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/core/src/global.ts` | **完全替换** xdg 路径系统：`~/.config/opencode/` → `~/.wopal/ellamaka/data/`、`cache/`、`config/`、`state/`，临时目录 `/tmp/opencode` → `/tmp/ellamaka` | **核心身份变更**：这不是附加功能，而是 ellamaka 的根基——所有持久化数据、配置、缓存的存储位置。上游永远不会修改 xdg 路径逻辑 |

**上游侵入**：18 行。冲突风险极低（上游不改路径系统）。

---

## 6. 安装与分发品牌

### 6.1 安装 channel

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/installation/index.ts` | `"ellamaka-main"` channel 检测，提示用户手动重建 | **嵌入**：channel 名是运行时概念，需要与 build.ts 的 channel 逻辑对齐 |

### 6.2 Release 工作流

| 文件 | 变更 | 模式 |
|------|------|------|
| `.github/workflows/publish-ellamaka.yml` | 独立于上游 `publish.yml`，只构建 CLI、4 平台矩阵、`checksums.txt`、GitHub Release | **独立文件**（零侵入） |

---

## 7. 配置系统品牌

### 7.1 WopalSpace 配置层

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/config/wopal-space.ts` | 读取 `settings.jsonc` 中的 `ellamaka` 字段 | **独立文件**（零侵入） |

### 7.2 TUI 配置路径提示

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | `~/.wopal/ellamaka/config/tui.json` 路径提示 | **嵌入**：TUI 提示文案，与 global.ts 路径对齐 |

---

## 8. 品牌注入模式总结

| 模式 | 侵入程度 | 适用场景 | 本项目中采用的文件 |
|------|----------|----------|-------------------|
| **新文件** | 零 | 完整独立的逻辑模块 | `packages/ellamaka/branding.ts`、`build.ts`、`wopal-space.ts`、`publish-ellamaka.yml`、`scripts/build.sh` |
| **env 驱动** | 最小（1-4 行） | 构建时参数、运行时 flag | `build.ts`（BINARY_NAME）、`build.ts`（OPENCODE_CHANNEL） |
| **import 注入** | 极小（2 行） | 需要类型/常量引用的场景 | `src/index.ts`、`debug/index.ts` |
| **核心替换** | 中等（~18 行） | 不可回避的系统级身份变更 | `global.ts`（路径系统） |
| **嵌入** | 不定 | 运行时概念或文案 | `installation/index.ts`、`tips-view.tsx` |

---

## 9. 上游合并策略

### 9.1 合并保护文件

以下文件由 ellamaka 维护，合并时如与上游冲突，**始终保留 ellamaka 版本**：

| 文件 | 原因 |
|---|---|
| `README.md`、`README.zh-CN.md` | ellamaka 项目 README，已替换上游版本 |
| `AGENTS.md`、`AGENTS.zh-CN.md` | ellamaka 开发规范 |
| `docs/DESIGN.md`、`docs/DISTRIBUTION.md`、`docs/BRANDING.md` | ellamaka 设计文档 |
| `docs/UPSTREAM-MERGE-LOG.md` | 合并历史记录 |
| `scripts/` | ellamaka 自己的脚本（区别于上游 `script/`） |
| `.github/workflows/publish-ellamaka.yml` | ellamaka CI |
| `packages/ellamaka/` | ellamaka 品牌包装 |

**注意**：`README.md` 不在 §0 精简清单中（它是 ellamaka 自己的文件）。精简清单中保留 `README.zh.md` 以捕获上游同名文件（ellamaka 的中文 README 使用 `README.zh-CN.md`）。

### 9.2 定制代码最小侵入原则

为最小化每次上游合并的冲突面，所有 ellamaka 定制必须遵循：

1. **新文件优先**：定制逻辑放在独立新文件（如 `wopal-space.ts`），不嵌入上游源文件。上游文件只保留最小注入点（一个 `import` + 一个调用）。
2. **闭包注入代替 Service 传递**：新模块需要访问上游内部时，通过回调接口注入——不直接传递 Service 对象，避免上游类型变更泄漏。
3. **提前返回门卫**：定制分支用 `if (flag) { ... return result }` 在上游主流程之前执行，确保上游变更永不与定制代码同区域冲突。
4. **提取共享辅助函数**：当上游逻辑需被定制分支复用时，提取为命名辅助函数，两路径共用——不复制逻辑。
5. **禁止格式化重排**：不对上游文件的 import 顺序、依赖项、对象 key 做任何重排。这些噪音 diff 会成倍放大合并冲突窗口。

### 9.3 合并流程

从 `upstream/dev` 拉取 → `git merge upstream/dev` → 解决冲突 → `./scripts/check-cleanup.sh` 检查 → 若发现则 `--clean` 清理 → 验证 → 提交。

### 9.4 合并冲突热点

以下文件在上游改动频繁，注入点应尽可能小（1-2 行）：

- `packages/opencode/script/build.ts`（构建流程）
- `packages/opencode/src/index.ts`（CLI 入口）
- `packages/opencode/src/cli/cmd/debug/index.ts`（debug 信息）
- `packages/core/src/global.ts`（路径系统）

### 9.5 合并后验证清单

1. `bun typecheck`
2. `BINARY_NAME=ellamaka bun run build -- --p1`
3. `./dist/ellamaka-darwin-*/bin/ellamaka --version` 输出 `ellamaka/x.y.z`
4. `./scripts/check-cleanup.sh` 通过

---

## 10. 文件系统路径品牌决策

以下路径保留 `opencode` 命名，**不替换为 `ellamaka`**：

| 路径/文件 | 类型 | 保留原因 |
|-----------|------|----------|
| `.opencode/` 目录（项目级配置） | 文件系统约定 | 历史兼容；非 wopal-space 模式下的配置文件目录 |
| `opencode.json` / `opencode.jsonc`（配置文件） | 配置文件 | 同上 |
| `opencode.db`（SQLite 数据库） | 数据文件 | 同上 |
| `opencode-sfx`（音效临时目录） | 临时目录 | 运行时缓存 |
| `opencode-clipboard.png`（剪贴板图片） | 临时文件 | 运行时缓存 |
| `"opencode-oauth-dummy-key"`（OAuth 占位） | 运行时标识 | 内部密钥名 |
| `ProviderID.opencode`（provider 标识符） | API 枚举 | 内部 provider 标识 |
| `"# opencode"`（shell PATH 标记） | 安装产物 | 历史兼容，已安装用户 |
| `"opencode.local"`（mDNS 域名） | 网络标识 | 本地网络服务名 |

**设计原则**：ellamaka 的设计目标是——在非 wopal-space 模式下，表现与上游 opencode **完全一致**。这意味着 `.opencode/` 配置目录、`opencode.json` 配置文件名、数据路径等文件系统约定必须与 opencode 保持兼容。改变这些路径 = 破坏所有现有 opencode 用户的配置迁移路径。文件系统路径是**兼容性约定**，不是品牌声明。

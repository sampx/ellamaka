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
| `packages/shared/` | 旧共享包（上游 v1.14.25 重命名为 `packages/core/`） | 上游 rename 后残留，合并时清理 |
| `packages/web/` | 网站 | 不在本仓库维护 |
| `packages/extensions/`、`identity/` | VS Code 扩展、品牌素材 | 无 VS Code 插件计划 |
| `packages/slack/`、`zen/` | Slack bot、API 代理 | 无 Slack 集成计划 |
| `sdks/` | Python SDK + VS Code 扩展 | 仅 CLI 二进制分发 |
| `github/` | GitHub Action | 上游 CI，ellamaka 用自己的 |
| `infra/` | SST 基础设施（AWS/Cloudflare） | 无云端部署 |
| `nix/` | Nix 构建文件 | ellamaka 不使用 Nix |
| `specs/` | 上游设计 spec 文档 | 不参与构建 |
| `script/` | 上游发布/变更日志脚本（`publish.ts`、`raw-changelog.ts`） | ellamaka 用 `publish-ellamaka.yml` + `packages/ellamaka/build.ts --arch primary` |
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

### 3.1 Binary 名称与构建脚本

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | **零侵入**：保持上游原样，不做任何修改 | **上游 untouched** |
| `packages/ellamaka/build.ts` | 基于 `packages/opencode/script/build.ts` 的独立 copy，应用品牌定制（见下方 4 类定制） | **独立 copy** |
| `packages/opencode/script/build-darwin.ts` | 已删除：原 darwin 专用构建脚本，功能已被 `packages/ellamaka/build.ts` 完全覆盖 | **已删除** |

`packages/ellamaka/build.ts` 的 4 类定制（与上游 build.ts 的唯一差异）：

1. **路径调整**：`dir` → `../opencode`，import 路径加 `../opencode/` 前缀
2. **品牌注入**：从 `./branding` import `BINARY_NAME`/`CHANNEL_*`，替换 `pkg.name` 和硬编码 `"opencode"`
3. **`--arch` 参数**：支持 `--arch primary`（4 个主流目标）或 `--arch x64,arm64`（按 arch 过滤），与 `--single` 组合
4. **Channel**：使用 `CHANNEL_RELEASE`/`CHANNEL_DEV` 替代 `Script.channel`

**上游侵入**：`packages/opencode/script/build.ts` 零行改动。所有定制在 `packages/ellamaka/build.ts` 中完成，两文件可 `diff` 比对追踪上游变更。

### 3.2 Release channel

`packages/ellamaka/build.ts` 使用 `CHANNEL_RELEASE` / `CHANNEL_DEV`（来自 `branding.ts`）替代上游 `Script.channel`。无需 env 变量或上游文件修改。

### 3.3 --arch 平台矩阵

`packages/ellamaka/build.ts` 提供 `--arch` 参数替代上游的 `--p1`：

| 参数组合 | 行为 |
|----------|------|
| `--arch primary` | 构建预设 4 个主流目标（darwin-arm64/x64, linux-x64, win32-x64） |
| `--arch x64` | 按指定 arch 过滤所有目标 |
| `--arch x64,arm64` | 按多个 arch 过滤 |
| `--single` | 仅构建当前平台 + host arch |
| `--single --arch x64` | 当前平台 + 指定 arch（交叉编译） |

上游 `packages/opencode/script/build.ts` 无 `--arch` 参数，零侵入。

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
| `src/cli/error.ts` | 错误提示文字 | 3 处 |
| `src/cli/cmd/serve.ts` | describe + console.log | 2 处 |
| `src/cli/cmd/run.ts` | describe ×2 | 2 处 |
| `src/cli/cmd/tui/attach.ts` | describe | 1 处 |
| `src/cli/cmd/pr.ts` | describe + println + spawn ×2 + die | 5 处 |
| `src/cli/cmd/providers.ts` | config 引导文字 | 2 处 |
| `src/cli/cmd/mcp.ts` | config 引导文字 | 1 处 |

所有替换使用同一模式：`import { BINARY_NAME } from "../../ellamaka/branding"` → 字符串中 `` `${BINARY_NAME}` `` 或 `BINARY_NAME` 模板替换。

**不替换的内容**：
- `uninstall.ts` 中的包管理器命令（`npm uninstall -g opencode-ai` 等）——这些是上游 npm 包名，不受 ellamaka 控制
- `"# opencode"` shell 配置标记——属 ellamaka 安装程序写入的标记，不修改
- `Log.Default.info("opencode", ...)`——非用户可见的日志标识

### 4.5 上游 URL 保留

`opencode.ai` 及其子域名（`api.opencode.ai`、`app.opencode.ai`）出现在 providers.ts、github.ts、server/shared/ui.ts 中。ellamaka 目前没有替代域名，保留不变。待 ellamaka 自有网站上线后批量替换。

### 4.6 CLI/TUI Logo 品牌

CLI 启动时的 ASCII art logo 和 TUI 首页动画 logo 使用 ELLAMAKA 字模。

#### 4.6.1 字模数据

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/logo.ts` | `logo.left` / `logo.right` glyph 数据替换为 ELLAMAKA 块字符画（4 行 × 19 列，每半部 3 行实际内容），`go` 变体、`marks` 标记字符同步更新 | **核心替换**：完全改写字模数据，通过 `_` `^` `~` `,` 标记字符控制 OpenTUI 着色器渲染 |

`logo.left` 拼写 "ELLA"，`logo.right` 拼写 "MAKA"。TUI 的 `<Logo />` 组件（`tui/component/logo.tsx`）直接读取此数据驱动 shimmer 动画——**零侵入**，组件代码不改。

#### 4.6.2 非 TTY 降级与模式守卫

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/ui.ts` | `UI.logo()` 增加 `Flag.WOPAL_SPACE` 守卫：wopal-space 模式使用 `packages/ellamaka/logo.ts` 的 `ellamaka` 字模和 `wordmark`，普通模式使用上游 opencode 字模 | **注入守卫**：不替换上游常量，通过条件分支切换品牌 |
| `packages/ellamaka/logo.ts` | 导出 `ellamaka`（字模数据）和 `wordmark`（`left[i] + " " + right[i]` 拼接），供 `ui.ts` 模式守卫引用 | **独立文件** |

#### 4.6.3 Logo 音效兼容 compile 模式

TUI logo 交互音效（4 个 `.wav` 文件）在 bun compile 后不再存在于真实文件系统，而是以 bunfs 虚拟路径（`/$bunfs/root/xxx.wav`）存在。外部音频播放器（afplay/mpv/ffplay）无法读取 bunfs 路径。

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/cmd/tui/util/sound.ts` | `copyFileSync(path, next)` → `await Bun.write(next, Bun.file(path))`；移除无用 `copyFileSync` import | **核心替换**：`Bun.file()` 可以读取 bunfs 虚拟路径，`Bun.write()` 写出到真实文件系统供外部播放器使用 |

**设计原则**：编译后二进制内嵌的静态资源（`.wav` 通过 `import ... with { type: "file" }`）只能通过 Bun 原生 API 读取，不能使用 Node.js `fs` API。

### 4.7 TUI 品牌插件

WopalSpace 模式下，通过 TUI 插件系统注入额外的品牌元素。

| 文件 | 变更 | 模式 |
|------|------|------|
| `.wopal/plugins/tui-ellamaka.tsx` | TUI 品牌插件：3 个注册 slot（`home_logo` 块字符画 + 阴影、`home_prompt_right` 紧凑 logo、`session_prompt_right` logo + session ID 截取）。无 demo 代码，RGBA 颜色类型 | **独立文件**（ontology worktree）：零侵入上游源码 |
| `.wopal/plugins/ellamaka-theme.json` | Nord 系 TUI 主题 | **独立文件** |
| `.wopal/config/themes/ellamaka-theme.json` | 主题副本（WOPAL_SPACE 主题扫描用） | **独立文件** |
| `.wopal/config/settings.jsonc` | TUI 插件配置：`enabled: true`、`label: "ELLAMAKA"` | **独立文件** |

> **注意**：上述 4 个文件位于 `.wopal/` ontology worktree（`wopal-space-ontology` 仓库），不属于 `projects/ellamaka/` 仓库。列在此处以完整记录品牌化版图。

---

## 5. 数据路径品牌

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/core/src/global.ts` | **完全替换** xdg 路径系统：所有持久化目录统一在 `WOPAL_HOME`（默认 `~/.wopal`）下，`config/`、`ellamaka/data/`、`ellamaka/cache/`、`ellamaka/state/`，临时目录 `/tmp/ellamaka` | **核心身份变更**：所有持久化数据、配置、缓存的存储位置。上游永远不会修改 xdg 路径逻辑 |

### 路径映射

| 用途 | 上游 opencode | ellamaka |
|------|-------------|----------|
| data | `~/.local/share/opencode` | `~/.wopal/ellamaka/data` |
| cache | `~/.cache/opencode` | `~/.wopal/ellamaka/cache` |
| **config** | `~/.config/opencode` | `~/.wopal/config` |
| state | `~/.local/state/opencode` | `~/.wopal/ellamaka/state` |
| tmp | `/tmp/opencode` | `/tmp/ellamaka` |

`WOPAL_HOME` 可通过环境变量或 `.wopal/.env` 覆盖（默认 `~/.wopal`）。

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

### 7.2 全局配置文件

ellamaka 的全局配置文件是 `WOPAL_HOME/config/settings.jsonc`，这是唯一的全局配置入口。不使用 opencode 的 `config.json`/`opencode.json`/`opencode.jsonc` 文件名，不执行 TOML legacy 迁移。

`Global.Path.config`（`~/.wopal/config/`）是纯配置目录——两种模式下都不在该目录安装插件或扫描能力（agents/commands/plugins）。

### 7.3 配置加载策略

ellamaka 有两种运行模式，配置加载链路完全不同：

#### 普通模式（opencode 兼容）

用户未启用 `--wopal-space` 时，ellamaka 兼容 opencode 的配置和能力体系，让 opencode 老用户无缝迁移。

```
优先级从低到高：

① opencode 全局配置（XDG 兼容层）
   ~/.config/opencode/config.json
   ~/.config/opencode/opencode.json[c]
   ↓ merge
② ellamaka 全局配置（覆盖）
   WOPAL_HOME/config/settings.jsonc
   ↓ merge
③ 项目级配置
   opencode.jsonc（项目根向上 findUp）
   .opencode/opencode.json[c]（项目级 + ~/.opencode/）
   ↓ merge
④ 能力加载
   ~/.opencode/ → agents/plugins/commands（全局能力）
   .opencode/   → agents/plugins/commands（项目级能力）
   ~/.config/opencode/ → agents/plugins/commands（XDG 全局能力）
   WOPAL_HOME/config/  → ✗ 跳过（纯配置目录）
```

#### wopal-space 模式（短路）

wopal-space 模式的激活方式：

| 方式 | 行为 |
|------|------|
| `--wopal-space` 显式传入 | 直接启用（最高优先级） |
| `--no-wopal-space` 显式传入 | 强制禁用，跳过自动检测（逃逸阀） |
| 未传参（默认） | **自动检测**：从 cwd 向上查找 `.wopal/config/settings.json[c]`，若文件含 `"ellamaka"` 键则自动启用 |

启用后直接短路到 wopal-space 配置体系，不碰任何 opencode 路径。

```
① ~/.wopal/ 全局配置 + 能力（agents/plugins/commands）
② 空间 .wopal/ 配置（settings.jsonc 中的 ellamaka 字段）+ 能力
③ ~/.wopal/config/ → ✗ 跳过能力加载（纯配置目录）
```

#### 自动检测实现

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/ellamaka/detect.ts` | 导出 `detectWopalSpace(cwd)` — 从 cwd 向上查找 `.wopal/config/settings.json[c]`，若文件含 `"ellamaka"` 键名返回 true | **独立文件** |
| `packages/opencode/src/index.ts` | yargs 中间件调用 `detectWopalSpace(process.cwd())`，检测到则设置 `WOPAL_SPACE=1` | **注入**：几行调用，逻辑在独立文件中 |

检测算法：
1. 从 cwd 向上逐级查找 `.wopal` 目录
2. 找到后检查 `config/settings.jsonc`（优先）或 `settings.json`
3. 用正则 `/"ellamaka"\s*:/` 匹配键名，无需完整解析 JSONC（避免 URL 中 `//` 被误当注释）
4. 匹配成功 → 启用 wopal-space；不匹配或无文件 → 返回 false（普通模式）

### 7.4 TUI 配置路径提示

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | `~/.wopal/config/settings.jsonc` 路径提示 | **嵌入**：TUI 提示文案，与 global.ts 路径对齐 |

---

## 8. 品牌注入模式总结

| 模式 | 侵入程度 | 适用场景 | 本项目中采用的文件 |
|------|----------|----------|-------------------|
| **新文件** | 零 | 完整独立的逻辑模块 | `packages/ellamaka/branding.ts`、`logo.ts`、`detect.ts`、`test/branding.test.ts`、`build.ts`（上游 copy + 4 类定制）、`wopal-space.ts`、`publish-ellamaka.yml`、`scripts/build.sh`、`.wopal/plugins/tui-ellamaka.tsx`、`.wopal/plugins/ellamaka-theme.json` |
| **独立 copy** | 零（上游 untouched） | 需要深度定制的上游文件 | `packages/ellamaka/build.ts`（基于 `packages/opencode/script/build.ts` 的 branded copy） |
| **import 注入** | 极小（2 行） | 需要类型/常量引用的场景 | `src/index.ts`、`debug/index.ts`、12 个 CLI cmd 文件（§4.4） |
| **核心替换** | 中等（~18 行） | 不可回避的系统级身份变更 | `global.ts`（路径系统）、`logo.ts`（字模数据）、`sound.ts`（bunfs 音效兼容）、`ui.ts`（mode guard） |
| **嵌入** | 不定 | 运行时概念或文案 | `installation/index.ts`、`tips-view.tsx`、`.wopal/config/settings.jsonc` |

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

- `packages/opencode/src/index.ts`（CLI 入口）
- `packages/opencode/src/cli/cmd/debug/index.ts`（debug 信息）
- `packages/core/src/global.ts`（路径系统）

### 9.5 合并后验证清单

1. `bun typecheck`
2. `bun packages/ellamaka/build.ts --arch primary`
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

**设计原则**：ellamaka 的设计目标是——在非 wopal-space 模式下，兼容 opencode 的配置和能力体系。这意味着 `.opencode/` 配置目录、`opencode.json` 配置文件名等文件系统约定必须与 opencode 保持兼容。改变这些路径 = 破坏所有现有 opencode 用户的配置迁移路径。文件系统路径是**兼容性约定**，不是品牌声明。

### 10.1 opencode 兼容层

普通模式下，ellamaka 通过兼容层让 opencode 老用户零迁移使用：

| 兼容项 | opencode 原始路径 | ellamaka 行为 |
|--------|-------------------|--------------|
| 全局配置 | `~/.config/opencode/`（XDG） | 加载 `config.json`/`opencode.json[c]`，作为底配置被 `settings.jsonc` 覆盖 |
| 全局能力 | `~/.opencode/` | 正常扫描 agents/plugins/commands |
| 全局能力 | `~/.config/opencode/`（XDG） | 正常扫描 agents/plugins/commands |
| 项目级配置 | `opencode.jsonc` / `.opencode/opencode.json[c]` | 保持不变 |
| 项目级能力 | `.opencode/` | 保持不变 |
| 状态/数据 | `~/.local/share/opencode` 等 | **不兼容** — ellamaka 状态数据在 `~/.wopal/ellamaka/` 下 |

**不兼容项**：状态数据（数据库、缓存、session）无法迁移，两类路径格式和 schema 可能随版本变化。

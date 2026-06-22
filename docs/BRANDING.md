# ellamaka — 品牌化与定制设计

> **状态**: Active
> **更新时间**: 2026-06-11
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> **配套文档**: `./DESIGN.md`（架构概览）、`./DISTRIBUTION.md`（分发设计）

本文档是 ellamaka 品牌化定制的唯一真相源。记录每项定制设计的**目的、内容、要求和实现逻辑**。具体文件级变更由 `git diff upstream/dev` 回答，不在本文档中维护。

## 变更记录

| 日期 | 类型 | 摘要 |
|------|------|------|
| 2026-06-22 | Updated | §6.2 补充普通模式插件依赖安装机制说明（复用 `localPluginInstallDeps`） |
| 2026-06-18 | Updated | §6.2 放弃 opencode 配置兼容；§7.1 TUI 配置统一；新增 §14 TUI tips 和 sidebar 品牌化：所有模式下移除 opencode 相关 tips，CLI 命令引用使用 BINARY_NAME，sidebar 版本署名使用 BINARY_TITLE |
| 2026-06-18 | Updated | §6.2 放弃 opencode 配置兼容：所有模式仅加载 ellamaka 自身配置，不再加载 opencode XDG 全局配置和项目级 opencode.jsonc |
| 2026-06-15 | Updated | §6.1 加载链路增加 `settings.local.jsonc`（公开/私有配置拆分） |
| 2026-06-11 | Updated | channel 改名 `latest`/`main`（与 opencode 一致）；update guard 从 channel 判断改为路径判断 `isWopalInstall()`；数据库剥离逻辑移除 |
| 2026-06-01 | Created | 初始版本，以文件级变更清单形式记录 |

## 0. 项目精简

品牌化第一步：删除与 ellamaka CLI 分发无关的上游模块和文件。

### 已删除目录

| 路径 | 原用途 | 删除原因 |
|------|--------|----------|
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
| `nix/` | Nix 构建文件 | 不使用 Nix |
| `specs/` | 上游设计 spec 文档 | 不参与构建 |
| `script/` | 上游发布/变更日志脚本 | ellamaka 用 `publish-ellamaka.yml` + `build.ts --arch primary` |
| `.opencode/` | opencode 项目级开发配置 | 上游 IDE 配置，ellamaka 开发不依赖 |
| `packages/stats/` | 云监控面板 | v1.15.x 新增，CLI 分发无云监控需求 |
| `packages/opencode/test/installation/` | 安装/升级测试 | 测试 opencode 的 npm/brew/GitHub 升级链路，ellamaka 由 wopal-cli 接管，该路径为死代码 |

### 已删除文件

| 文件 | 删除原因 |
|------|----------|
| `CONTRIBUTING.md`、`SECURITY.md` | 内容引用 "OpenCode" 产品名 |
| `README.zh.md` | 上游中文 README（ellamaka 使用 `README.zh-CN.md`） |
| `flake.nix`、`flake.lock` | 不使用 Nix |
| `sst.config.ts`、`sst-env.d.ts` | 无云端部署 |
| `install` | 上游安装脚本（ellamaka 通过 wopal-cli 安装） |
| `.github/ISSUE_TEMPLATE/` | 上游 issue 模板 |
| `.github/workflows/publish.yml`、`deploy.yml` | 上游 CI（ellamaka 用 `publish-ellamaka.yml`） |

### 保留文件

| 路径 | 保留原因 |
|------|----------|
| `README.md`、`README.zh-CN.md` | ellamaka 项目 README（已替换上游版本） |
| `AGENTS.md`、`AGENTS.zh-CN.md` | ellamaka 开发规范 |
| `scripts/` | ellamaka 自有脚本（区别于上游 `script/`） |
| `.github/workflows/publish-ellamaka.yml` | ellamaka 发布 CI |
| `.github/TEAM_MEMBERS` | 上游构建脚本初始化依赖 |
| `package.json` | 构建入口，`"name": "opencode"` 是内部标识不影响用户可见品牌 |
| `patches/`、`LICENSE` | 构建和授权需要 |

首次 fork 精简共移除 1830+ 文件（-396k 行）。

---

## 1. 品牌常量

### 目的

将品牌标识集中定义为常量，所有上游文件通过 import 引用，不在源码中硬编码品牌值。上游合并时冲突面为零。

### 内容

| 常量 | 值 | 用途 |
|------|-----|------|
| `BINARY_NAME` | `ellamaka` | CLI 命令名、help 文本、错误前缀 |
| `BINARY_TITLE` | `Ellamaka` | 用户界面标题 |
| `VERSION_PREFIX` | `ellamaka` | `--version` 输出前缀（`ellamaka/x.y.z`） |
| `CHANNEL_RELEASE` | `latest` | 发布渠道标识，与 opencode 标准 channel 一致 |
| `CHANNEL_DEV` | `main` | 本地开发渠道标识，对应 ellamaka 主分支名 |

### 实现逻辑

独立文件 `packages/ellamaka/branding.ts`，零侵入上游源码。消费者通过相对 import 引用，品牌值不在上游文件中出现。

---

## 2. 路径体系

### 目的

将 ellamaka 的持久化数据、配置、缓存从 opencode 的 XDG 路径体系完全迁移到 Wopal 生态的统一路径 `~/.wopal/` 下。

### 内容

| 用途 | 上游 opencode | ellamaka |
|------|-------------|----------|
| 配置 | `~/.config/opencode/` | `~/.wopal/config/` |
| 数据 | `~/.local/share/opencode/` | `~/.wopal/ellamaka/data/` |
| 缓存 | `~/.cache/opencode/` | `~/.wopal/ellamaka/cache/` |
| 状态 | `~/.local/state/opencode/` | `~/.wopal/ellamaka/state/` |
| 临时 | `/tmp/opencode/` | `/tmp/ellamaka/` |

根路径 `WOPAL_HOME` 可通过环境变量覆盖，默认 `~/.wopal`。

### 环境变量加载

启动时按优先级加载 `.env` 文件：
1. **空间级**（高优先级）：从 cwd 向上查找 `.wopal/.env`，找到即停止
2. **全局级**（低优先级）：`WOPAL_HOME/.env`，填充空间级未覆盖的变量

### 实现逻辑

完全替换 `global.ts` 中的路径常量。同时保留 `opencodeConfig` 变量（指向 `~/.config/opencode/`）供非空间模式兼容层使用。`WOPAL_HOME/config/` 是纯配置目录，两种模式下都不在该目录扫描 agents/commands/plugins。

### 系统管理配置

企业 MDM 场景下，系统管理配置域为 `ai.wopal.managed`，路径为 `/Library/Application Support/wopal`（macOS）、`%ProgramData%/wopal`（Windows）或 `/etc/wopal`（Linux）。

---

## 3. 构建系统

### 目的

在不修改上游构建脚本的前提下，替换二进制名称、发布渠道和平台矩阵。

### 内容

**上游 `script/build.ts` 零侵入**。ellamaka 通过独立 copy 文件 `packages/ellamaka/build.ts` 实现 4 类定制：

1. **品牌注入**：`BINARY_NAME` 替换硬编码 `"opencode"`，`CHANNEL_RELEASE`/`CHANNEL_DEV` 替换上游渠道
2. **平台裁剪**：`--arch primary` 仅构建 4 个主流目标（darwin-arm64/x64, linux-x64, win32-x64），排除 baseline/musl/arm64 变体
3. **路径适配**：import 路径加 `../opencode/` 前缀，指向引擎源码
4. **单平台构建**：`--single` 仅构建当前平台

### 要求

- 上游 `build.ts` 零行改动，可通过 `diff` 比对追踪上游变更
- `--arch primary` 必须恰好产出 4 个平台，不得混入 baseline 变体

### 本地构建

`scripts/build.sh` 是一键构建脚本，dist 路径和 binary 名均已品牌化。

---

## 4. CLI 身份与 Logo

### 目的

CLI 的所有用户可见输出——命令名、帮助文本、版本号、启动画面——体现 ellamaka 品牌。

### 版本号

`--version` 输出格式 `ellamaka/x.y.z`，通过 `.version(VERSION_PREFIX + "/" + InstallationVersion)` 注入。

### 命令名

`.scriptName(BINARY_NAME)` 一步覆盖所有 yargs 自动生成的输出：usage 行（`ellamaka [command]`）、帮助文本前缀、错误信息前缀。

### 命令描述与提示

 所有 CLI 命令的 `describe`、`prompts` 输出、错误提示中出现的 `"opencode"` 均替换为 `` `${BINARY_NAME}` ``，通过 `import { BINARY_NAME }` 注入。不替换的内容：
- 包管理器命令（`npm uninstall -g opencode-ai`）—— 上游 npm 包名，不受 ellamaka 控制
- `Log.Default.info("opencode", ...)` —— 非用户可见日志

### Logo

CLI 启动时的 ASCII art logo 和 TUI 首页动画 logo 使用 ELLAMAKA 块字符画（4 行 × 19 列，左半 "ELLA" + 右半 "MAKA"）。

**字模数据**：完全替换 `logo.ts` 中的 glyph 数据，通过标记字符控制 OpenTUI 着色器渲染。TUI 的 `<Logo />` 组件直接读取此数据驱动 shimmer 动画，组件代码不改。

**非 TTY 降级**：仅 1 行 import 注入 `wordmark`（`left[i] + " " + right[i]` 拼接结果），函数体零改动。

### 错误上报 URL

GitHub issue URL 从 `anomalyco/opencode` 替换为 `wopal-cn/${BINARY_NAME}`，issue 模板参数名从 `opencode-version` 改为 `ellamaka-version`。

---

## 5. WopalSpace 自动检测

### 目的

使 ellamaka 在进入 WopalSpace 时自动激活空间模式，无需用户显式传参。

### 检测算法

1. 从 cwd 向上逐级查找 `.wopal/.git`
2. `.wopal/.git` 是**文件**（非目录）→ 这是 ontology worktree 标记，返回此目录作为空间根
3. `.wopal/.git` 不存在或是目录（普通 git 仓库）→ 跳过，继续向上
4. 到达用户 home 目录 → 停止，返回 undefined（普通模式）

### 空间根契约

- `WOPAL_SPACE=1`：触发下游所有空间模式行为
- `WOPAL_SPACE_ROOT=<绝对路径>`：配置和能力加载器直接消费
- `--disable-wopalspace` 显式传入 → 清除两者，强制禁用（逃生舱）

> CLI flag 命名为 `--disable-wopalspace`（无 `no-` 前缀），避开 yargs 对 `--no-XXX` 的内置取反解析。yargs 会把它解析为 `disableWopalspace` 字段。

### 启动安全

CLI 入口中间件**始终先清除**用户环境中的 `WOPAL_SPACE`/`WOPAL_SPACE_ROOT`，再执行自动检测。防止继承环境变量导致的误判。

### 实现逻辑

独立文件 `packages/ellamaka/detect.ts`，CLI 入口仅注入几行调用。检测到后通过 `process.env` 传递结果，由 downstream 的 `Flag.WOPAL_SPACE` 和 `RuntimeFlags.wopalSpace` 消费。

---

## 6. 配置加载体系

### 目的

ellamaka 提供两种运行模式的配置加载，均从 ellamaka 自身配置路径加载，不与 opencode 配置体系交互：
- **空间模式**：叠加空间级 `.wopal/` 配置和能力
- **普通模式**：仅使用 `~/.wopal/config/settings.jsonc` 全局配置

### 6.1 空间模式配置加载

#### 加载链路（优先级从低到高）

```
① ~/.wopal/config/settings.jsonc          — 全局配置（ellamaka 字段作为默认值）
② ~/.wopal/                                — 全局能力（agents/commands/plugins/skills）
③ <space>/.wopal/config/settings.jsonc     — 空间公开配置（提交至 ontology，提取 ellamaka + tui 字段）
④ <space>/.wopal/config/settings.local.jsonc — 空间私有配置（深度合并覆盖 ③，gitignored，不提交）
⑤ <space>/.wopal/                          — 空间能力
⑥ <space>/.wopal/agents/{name}.md          — agent frontmatter（权限最高优先级）
⑦ OPENCODE_CONFIG_CONTENT                  — 环境变量覆盖（最高）
```

##### 公开/私有配置拆分（settings.local.jsonc）

`config/settings.jsonc` 是 ontology 的一部分，随 `space/<name>` 分支提交和分发。其中 `ellamaka` 字段包含适用于所有用户的公共默认值（如 `default_agent`、`autoupdate`、通用 permission 规则）。

`config/settings.local.jsonc` 是用户私有配置，已加入 `.gitignore`。其中 `ellamaka` 和 `tui` 字段包含用户特定的覆盖值（provider 定义、per-agent model 分配、install 路径、shell 偏好、MCP 配置等）。

合并顺序：`settings.jsonc` 先加载，`settings.local.jsonc` 通过 `mergeDeep` 深度合并覆盖。目录级合并独立于全局配置合并。

#### 目录解析

`wopalSpaceDirectories()` 构建的目录序列（去重，后覆盖前）：

```
~/.wopal/config → ~/.wopal/ → <space>/.wopal/
```

#### 短路设计

`tryLoadWopalSpaceConfig()` 在 WOPAL_SPACE 激活时：
1. 调用 `loadWopalSpaceSettingsFiles()` 获取目录列表和设置文件
2. 合并全局配置，然后遍历空间设置文件（`settings.jsonc` → `settings.local.jsonc`）提取 `ellamaka` 字段并合并
3. 从目录加载 agents（含 frontmatter mergeDeep）、commands、plugins
4. 返回完整结果，`config.ts` 中 **直接短路返回**，不执行后续任何 opencode 配置加载（remote wellknown、`~/.config/opencode/`、项目 `opencode.jsonc`、`.opencode/` 扫描等）

### 6.2 普通模式配置加载

空间模式未激活时，ellamaka 仅从自身配置路径加载配置，不与 opencode 配置体系产生交互：

```
① ~/.wopal/config/settings.jsonc  — ellamaka 全局配置
```

`settings.jsonc` 若包含 `ellamaka` 字段，提取该字段作为配置主体。

**设计决策**：不再加载 opencode XDG 全局配置文件（`~/.config/opencode/{config.json, opencode.json[c]}`）和项目级 `opencode.jsonc`。原因：ellamaka 版本可能与用户机器上的 opencode 版本不一致，opencode 配置格式的跨版本不兼容变更会导致 ellamaka 解析失败。

#### 能力加载（优先级从低到高）

能力扫描（agents/commands/plugins/skills）覆盖以下目录，**后加载者覆盖先加载者**：

```
① .opencode/、~/.opencode/、~/.config/opencode/   — opencode 生态能力（原生路径）
② ~/.wopal/                                         — ellamaka 全局能力（最后加载，覆盖 ①）
```

`~/.wopal/`（由 `WOPAL_HOME` 定位）下的 agents/commands/plugins/skills 等 capability 目录在普通模式**最后**加载，作为全局能力底座覆盖 opencode 生态同名能力。这使非空间模式下也能使用 ellamaka 自带的能力（如 wopal/faq/rook 等 agent、wopal 命令、wopal-plugin 等）。

`~/.wopal/config/` 是纯配置目录，不参与能力扫描——能力只来自 `~/.wopal/` 根下的 capability 子目录。

#### 插件依赖安装（ellamaka 增强）

**upstream 行为**：opencode 的配置加载循环（`config.ts` 目录扫描）对每个能力目录只调用 `npmSvc.install(dir, { add: [{ name: "@opencode-ai/plugin" }] })`，仅安装 plugin SDK 公共头文件。对 `file://` 本地插件，`resolvePluginTarget`（`plugin/shared.ts`）只解析路径、检查 `package.json` 存在，**不安装插件自身的 `dependencies`**。upstream 的设计假设是：`file://` 插件由开发者自行 `npm install` 管理依赖，opencode 不代劳。若插件 `import` 了未安装的包（如 `openai`），运行时会报 `Cannot find package 'openai'`。

**ellamaka 增强**：普通模式扫描到 `~/.wopal/`（`Global.Path.wopalHome`）时，额外为该目录下的本地插件自动安装其 `package.json` 中声明的 `dependencies`。实现上复用了 wopal-space 模式的 `localPluginInstallDeps(dir)` 函数（定义在 `wopal-space.ts`），该函数：

1. 扫描目录下所有本地插件（通过 `ConfigPlugin.load`）
2. 读取每个插件的 `package.json`，提取 `name`
3. 生成 `{ name, version: "file:<插件目录>" }` 形式的 install 请求
4. 返回依赖列表，与 `@opencode-ai/plugin` 一起交给 `npmSvc.install` 安装到该目录的 `node_modules`

**范围限定**：仅对 `Global.Path.wopalHome` 目录触发 `localPluginInstallDeps`，其他能力目录（`.opencode/`、`~/.opencode/`、`~/.config/opencode/`）仍按 upstream 默认行为，只装 `@opencode-ai/plugin`。原因：这些目录是 opencode 生态的 npm 插件（通过 `npm:` 协议安装，依赖随包发布），没有需要额外收集的 `file:` 依赖；只有 `~/.wopal/` 下维护着 ellamaka 自有的本地插件（如 wopal-plugin）。

**与空间模式的关系**：`localPluginInstallDeps` 本是为空间模式写的（`tryLoadWopalSpaceConfig` 遍历空间配置目录时调用）。普通模式直接 import 同一个函数，不重写一份。

### 6.3 目录扫描守卫

`ConfigPaths.directories()` 中 `!Flag.WOPAL_SPACE` guard：空间模式下不将 `~/.config/opencode/` 纳入能力扫描目录。

---

## 7. TUI 配置与品牌

### 目的

TUI 的配置加载和视觉元素与 WopalSpace 模式深度整合。所有模式下 TUI 配置仅从 ellamaka 自身路径加载，不与 opencode 配置体系交互。

### 7.1 TUI 配置加载

TUI 加载流程中的统一行为（空间/非空间模式一致）：

1. **跳过 opencode 配置**：不加载 `~/.config/opencode/tui.*`，`.opencode/` 目录的能力扫描（agents/commands/plugins）不受影响
2. **全局 TUI 配置**：从 `~/.wopal/config/settings.jsonc` 提取 `tui` 字段 → 合并到 TUI 配置
3. **空间 TUI 配置**（空间模式）：调用 `tryLoadWopalSpaceTuiConfig()` → 复用 `loadWopalSpaceSettingsFiles()` → 从空间级 `settings.jsonc` 提取 `tui` 字段 → 合并覆盖
4. **目录过滤**（空间模式）：主题扫描目录仅保留 `~/.wopal/config/`，跳过所有 `.opencode/` 目录
5. **配置迁移跳过**：所有模式下跳过 opencode 配置文件中的旧 TUI key 迁移

### 7.2 TUI 品牌插件

空间模式下通过 ontology 插件注入额外品牌元素：
- `tui-ellamaka.tsx`：home_logo 块字符画 + 阴影、home_prompt_right 紧凑 logo、session_prompt_right logo + session ID
- `ellamaka-theme.json`：Nord 系 TUI 主题

上述文件位于 `.wopal/` ontology worktree（`wopal-space-ontology` 仓库），不属于 ellamaka 引擎仓库。

### 7.3 主题安装路径

插件安装主题时检测来源目录：若从 `.wopal/config/` 加载的插件，主题安装到 `.wopal/config/themes/`；否则安装到对应 `.opencode/themes/` 目录。

### 7.4 配置路径提示

TUI 首页提示文案显示 `~/.wopal/config/settings.jsonc` 路径，与 ellamaka 实际配置根对齐。

---

## 8. 运行时标志集成

### 目的

利用 WOPAL_SPACE 环境变量驱动运行时行为，在空间模式下自动调整与 opencode 生态相关的功能。

### WOPAL_SPACE 驱动的标志

| 标志 | 行为 |
|------|------|
| `RuntimeFlags.wopalSpace` | 反射 WOPAL_SPACE 状态，供所有 downstream 模块消费 |
| `disableClaudeCodePrompt` | 空间模式下自动禁用 Claude Code prompt（避免注入 opencode 生态提示词） |
| `disableClaudeCodeSkills` | 空间模式下自动禁用 `.claude/skills/` 扫描（技能由 Wopal 生态管理） |

### 实现逻辑

`RuntimeFlags` 是 Effect Config 层，`disableClaudeCodePrompt` 和 `disableClaudeCodeSkills` 由三个来源取或：通用禁用环境变量 + 专属禁用环境变量 + `WOPAL_SPACE`。这意味着：
- 空间模式自动禁用（wopal=true）
- 用户仍可通过 `OPENCODE_DISABLE_CLAUDE_CODE=0` 等显式覆盖（如果真有需要）

`Flag.WOPAL_SPACE` 是同步 getter，供 config 加载等需要立即判断的场景使用（如 `tryLoadWopalSpaceConfig` 的入口 guard）。

### Skill 加载中的消费

`skill/index.ts` 的 `discoverSkills()` 接收 `disableClaudeCodeSkills` 和 `disableAgentsSkills` 参数，在扫描外部技能目录（`.claude/`、`.agents/`）时根据标志跳过。空间模式下 Claude Code 技能目录自动被跳过。

---

## 9. 安装与更新保护

### 目的

ellamaka 通过 wopal-cli 分发和更新（`wopal ellamaka install`），不走 opencode 的自动更新通道（npm/brew/GitHub）。必须在 ellamaka 二进制内部阻止误触发 opencode 更新机制。

### 三层守卫

所有守卫使用 `isWopalInstall()` 函数——检查 `process.execPath` 是否位于 `WOPAL_HOME/bin/`（wopal-cli 的固定安装路径）。不依赖 channel 名。

| 层级 | 触发场景 | 行为 |
|------|---------|------|
| 自动更新 worker | TUI 后台定时检查更新 | `isWopalInstall()` → 直接 return，不发起网络请求 |
| 版本查询 | `Installation.latest()` 被调用 | `isWopalInstall()` → 返回当前版本，跳过 GitHub/npm/brew 查询 |
| 手动升级 | 用户执行 `upgrade` 命令或被触发 `Installation.upgrade()` | `isWopalInstall()` → 拦截，引导用户使用 `wopal ellamaka update` |

### 实现逻辑

`isWopalInstall()` 实现为独立文件 `packages/ellamaka/is-wopal-install.ts`，在 4 处 guard 点通过 import 注入，每处仅替换 1 行 guard 表达式。使用 `WOPAL_HOME` 环境变量（支持 `~/` 前缀扩展）确定安装根路径，与 `global.ts` 路径体系对齐。

---

## 10. 插件去重

### 目的

空间模式下，`~/.wopal/`（全局 ontology）和 `<space>/.wopal/`（空间 ontology）可能包含同一插件（不同文件路径、相同 runtime ID）。按 file URL 去重无法识别，导致插件被加载两次。

### 实现

`deduplicateLoadedPluginsByRuntimeId()`：插件模块加载完成后、执行 `server()` 前，按 runtime `id` 去重。同 id 保留后加载的（高优先级）插件。

### 要求

- 纯追加逻辑，不改动上游加载链
- 去重时机：模块加载完毕 → 去重 → 执行 `server()`/`tui()`
- 对 config 层无侵入

---

## 11. 注入原则

ellamaka 对上游源码的所有修改遵循以下原则，以最小化每次上游合并的冲突面：

| 原则 | 说明 |
|------|------|
| **新文件优先** | 定制逻辑放在独立新文件，上游文件只保留最小注入点（import + 调用） |
| **提前返回 guard** | 定制分支用 `if (flag) { ... return }` 在上游主流程之前执行 |
| **闭包注入** | 新模块需要上游内部能力时通过回调接口注入，不直接传递 Service 对象 |
| **提取共享辅助** | 上游逻辑需被定制分支复用时提取为命名 helper，两路径共用 |
| **禁止格式化重排** | 不对上游文件的 import 顺序、依赖项、object key 做任何重排 |

### 注入模式

| 模式 | 适用场景 | 侵入程度 |
|------|---------|----------|
| 独立文件 | 完整逻辑模块（branding.ts、detect.ts、is-wopal-install.ts、wopal-space.ts 等） | 零 |
| import 注入 | 需要引用品牌常量或工具函数（BINARY_NAME、wordmark、detectWopalSpace、isWopalInstall） | 1-2 行 |
| 核心替换 | 不可回避的系统级身份变更（global.ts 路径、logo 字模） | 中等 |
| 前置返回 guard | 拦截不应执行的上游行为（更新检查、配置加载） | 2-6 行 |
| runtime 追加 | 在上游加载链中插入处理逻辑（plugin 去重） | 纯追加 |

---

## 12. 上游合并策略

### 合并保护文件

合并时如与上游冲突，以下文件始终保留 ellamaka 版本：

| 文件 | 原因 |
|------|------|
| `README.md`、`README.zh-CN.md` | ellamaka 项目 README |
| `AGENTS.md`、`AGENTS.zh-CN.md` | ellamaka 开发规范 |
| `docs/DESIGN.md`、`docs/DISTRIBUTION.md`、`docs/BRANDING.md` | ellamaka 设计文档 |
| `docs/UPSTREAM-MERGE-LOG.md` | 合并历史记录 |
| `scripts/` | ellamaka 自有脚本 |
| `.github/workflows/publish-ellamaka.yml` | ellamaka CI |
| `packages/ellamaka/` | ellamaka 品牌包 |

### 合并冲突热点

以下文件在上游改动频繁，注入点应尽可能小：

- `src/index.ts` — CLI 入口
- `src/cli/cmd/debug/index.ts` — debug 信息
- `core/src/global.ts` — 路径系统


### 合并后验证

1. `bun typecheck`
2. `bun packages/ellamaka/build.ts --arch primary`
3. `./dist/ellamaka-darwin-*/bin/ellamaka --version` 输出 `ellamaka/x.y.z`
4. `./scripts/check-cleanup.sh` 通过

---

## 13. 文件系统兼容性决策

### 已品牌化

| 路径/名称 | 说明 |
|-----------|------|
| `ellamaka.db` / `ellamaka-{channel}.db` | 数据库文件名（`~/.wopal/ellamaka/data/` 下）。channel 规则与 opencode 一致：`latest` 进标准列表 → `ellamaka.db`，其他 channel 用 `ellamaka-{channel}.db` |
| `# ellamaka` | shell PATH 标记，写入 `.zshrc`/`.bashrc`，卸载时通过此标记识别 |
| `ellamaka.local` | mDNS 默认域名（`network.ts` 通过 `BINARY_NAME` 注入） |

### 保留 `opencode` 命名

| 路径/名称 | 类型 | 保留原因 |
|-----------|------|----------|
| `.opencode/` 目录 | 能力目录 | 非空间模式下用于能力扫描（agents/commands/plugins），配置不再从此目录加载 |
| `opencode.json` / `opencode.jsonc` | 配置文件 | 不再加载 — 非空间模式下仅使用 `~/.wopal/config/settings.jsonc` |
| `opencode-clipboard.png` | 临时文件 | 运行时缓存，用户不可见 |
| `"opencode-oauth-dummy-key"` | 运行时标识 | 内部变量名，改名引入风险无收益 |
| `ProviderID.opencode` | API 枚举 | 内部 provider 标识 |

### 待定

| 残留项 | 当前值 | 说明 |
|--------|--------|------|
| Provider 插件 HTTP header | `https://opencode.ai/`、`X-Title: opencode` 等 | 发给第三方 AI provider 的身份标识。待定替换为 `wopal.cn` |
| mDNS 运行时兜底值 | `mdns.ts` 硬编码 `"opencode.local"` | CLI 默认已是 `ellamaka.local`，但 fallback 路径未更新 |
| mDNS 配置 schema 描述 | `server.ts` schema annotation | 描述文字仍写 `opencode.local`

---

## 14. TUI tips 与 sidebar 品牌化

### 目的

TUI 首页 tips 系统和 sidebar 版本署名中不再出现 `OpenCode` 引用，全部替换为 ellamaka 品牌。

### 14.1 Tips 列表

原创 tips 列表定义在 `packages/ellamaka/tips.ts`，导出 `ELLAMAKA_TIPS`。tips-view.tsx 通过 import 引用，不再内联定义。

**策展原则**：
- 保留所有通用功能 tips（快捷键、agent、权限、配置等）
- 移除 opencode 特有功能 tips（GitHub 集成、share at opencode.ai、opencode.ai Zen、docker 镜像）
- CLI 命令引用使用 `BINARY_NAME` 常量（`ellamaka run`、`ellamaka serve` 等）
- 配置文件引用从 `opencode.json` 更新为 `settings.jsonc`

### 14.2 Sidebar 版本署名

sidebar footer（`footer.tsx`）和 sidebar 缺省署名（`sidebar.tsx`）中的 `OpenCode` → `BINARY_TITLE`（`Ellamaka`）。通过 import `BINARY_TITLE` from `packages/ellamaka/branding` 注入。

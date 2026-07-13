# ellamaka — 品牌化与定制设计

> **状态**: Active
> **更新时间**: 2026-07-13
> **上级架构**: `../../../docs/products/wopal-space/DESIGN-wopalspace.md`
> **配套文档**: `./DESIGN.md`（架构概览）、`./DISTRIBUTION.md`（分发设计）

本文档是 ellamaka 品牌化定制的唯一真相源。记录每项定制设计的**目的、内容、要求和实现逻辑**。具体文件级变更由 `git diff upstream/dev` 回答，不在本文档中维护。

## 变更记录

| 日期 | 类型 | 摘要 |
|------|------|------|
| 2026-07-13 | Updated | §17 简化桌面 PTY 生命周期：Web 与 Desktop 共用 sidecar 断连宽限回收，移除 Electron Main PTY 注册表与专用 IPC 设计；同步更新 `DESKTOP.md` 和 Workbench 设计 |
| 2026-07-13 | Updated | 新增 `docs/DESKTOP.md`，建立 ellamaka-desktop 独立架构文档；§17 关联桌面架构真相源 |
| 2026-07-13 | Updated | §0 更新桌面端裁剪决策；新增 §17 ellamaka-desktop，采用 OpenCode v1.15.13 Electron desktop 作为固定复制基线，由独立包承载 ellamaka-app、sidecar 与桌面进程生命周期 |
| 2026-07-11 | Updated | §9 重写：恢复自动更新，改用 ellamaka CDN（`download.coursedao.com/ellamaka/latest/manifest.json`）；安装方法从 `"wopal"` 重命名为 `"ellamaka"`；`upgrade()` 不再检测安装方式，直接走 CDN |
| 2026-07-07 | Updated | §16 扩展 Workbench 会话归组 API：新增 spaceOverview/nonSpaceOverview/searchDirectories/recentDirectories 四端点，完全按 Workbench 自有归组模型（空间→项目→子目录/worktree→会话），不沿用 opencode project_id 归组；引入 stale 检测、会话标记（目录/工作树）、realpath 统一匹配 |
| 2026-07-07 | Updated | §16 扩展项目目录聚合端点：新增 `/wopal-space/projects` 和 `/wopal-space/non-space-projects`，按空间路径过滤 project 表 ∪ session 表并聚合会话数；realpath 统一匹配；为 Workbench 三级 Session Browser 提供数据源 |
| 2026-07-07 | Updated | 新增 §16 WopalSpace 空间注册表 API;§15.2/§15.6 更新为实际实施文件清单和进度 |
| 2026-07-06 | Updated | §7.5 新增 WopalSpace 模式下 `/help` 命令覆盖机制：TUI palette 的 `help.show` 在空间模式下不注册 `slashName`，使 `/help` 回落到服务端命令系统，由 `commands/help.md` 接管 |
| 2026-06-22 | Updated | §6.2 补充普通模式插件依赖安装机制说明（复用 `localPluginInstallDeps`） |
| 2026-06-18 | Updated | §6.2 放弃 opencode 配置兼容；§7.1 TUI 配置统一；新增 §14 TUI tips 和 sidebar 品牌化：所有模式下移除 opencode 相关 tips，CLI 命令引用使用 BINARY_NAME，sidebar 版本署名使用 BINARY_TITLE |
| 2026-06-18 | Updated | §6.2 放弃 opencode 配置兼容：所有模式仅加载 ellamaka 自身配置，不再加载 opencode XDG 全局配置和项目级 opencode.jsonc |
| 2026-06-15 | Updated | §6.1 加载链路增加 `settings.local.jsonc`（公开/私有配置拆分） |
| 2026-06-11 | Updated | channel 改名 `latest`/`main`（与 opencode 一致）；update guard 从 channel 判断改为路径判断 `isWopalInstall()`；数据库剥离逻辑移除 |
| 2026-06-01 | Created | 初始版本，以文件级变更清单形式记录 |

## 0. 项目精简

品牌化第一步：删除不由 ellamaka 产品直接继承的上游模块和文件。需要保留的产品能力由独立品牌包承接。

### 已删除目录

| 路径 | 原用途 | 删除原因 |
|------|--------|----------|
| `packages/desktop/` | OpenCode v1.15.13 Electron 桌面端 | 上游包不直接保留；桌面产品由独立 `packages/ellamaka-desktop/` 承接（§17） |
| `packages/enterprise/`、`console/`、`function/` | SaaS/Cloud 后台 | ellamaka 无云端服务 |
| `packages/containers/` | Docker 构建 | 不通过 Docker 分发 |
| `packages/shared/` | 旧共享包（上游 v1.14.25 重命名为 `packages/core/`） | 上游 rename 后残留，合并时清理 |
| `packages/web/` | 网站 | 不在本仓库维护 |
| `packages/extensions/`、`identity/` | VS Code 扩展、品牌素材 | 无 VS Code 插件计划 |
| `packages/slack/`、`zen/` | Slack bot、API 代理 | 无 Slack 集成计划 |
| `sdks/` | Python SDK + VS Code 扩展 | ellamaka 不单独分发 Python SDK 或 VS Code 扩展 |
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

**上游 `script/build.ts` 零侵入**。ellamaka 通过独立 copy 文件 `packages/ellamaka/build.ts` 实现 5 类定制：

1. **品牌注入**：`BINARY_NAME` 替换硬编码 `"opencode"`，`CHANNEL_RELEASE`/`CHANNEL_DEV` 替换上游渠道
2. **平台裁剪**：`--arch primary` 仅构建 4 个主流目标（darwin-arm64/x64, linux-x64, win32-x64），排除 baseline/musl/arm64 变体
3. **路径适配**：import 路径加 `../opencode/` 前缀，指向引擎源码
4. **单平台构建**：`--single` 仅构建当前平台
5. **Web UI 选择**：`--web-ui ellamaka-app|app|none` 选择嵌入 ellamaka UI、上游 UI 或不嵌入 UI

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

`--version` 输出纯 `InstallationVersion`（如 `1.15.13` 或开发构建的 `local`），与上游 opencode 完全一致，不添加品牌前缀。

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

### 7.5 WopalSpace 模式 `/help` 命令覆盖

#### 目的

WopalSpace 模式下，`/help` 命令由空间级 `commands/help.md` 接管，而非 TUI 内置的 `DialogHelp` 弹窗。使空间可以自定义帮助内容（空间结构、命令列表、技能说明等）。

#### 问题背景

ellamaka 有两套独立的命令系统：

| 系统 | 注册位置 | 触发方式 | 分发方式 |
|------|---------|---------|---------|
| TUI Palette 命令 | `app.tsx` keymap（`appCommands()`） | keymap 拦截 `/` + `slashName` | `keymap.dispatchCommand()` |
| 服务端命令 | `command/index.ts` `Command.Service` | `parseSlashCommand()` 匹配 | 发送到服务端 → LLM 处理模板 |

`/init` 能通过 `commands/init.md` 覆盖，是因为它的"内置"在服务端命令注册表（`Command.Default.INIT`）。`/help` 的"内置"在 TUI 的 keymap 层（`app.tsx:794-802`，`slashName: "help"`），两套系统不互通——`commands/*.md` 只能覆盖服务端命令，碰不到 TUI 层。

#### 实现

`app.tsx` 中 `help.show` 命令的 `slashName` 根据 `Flag.WOPAL_SPACE` 条件化：

```tsx
slashName: Flag.WOPAL_SPACE ? undefined : "help",
```

| 模式 | `slashName` | `/help` 行为 |
|------|-------------|-------------|
| 非 WopalSpace | `"help"` | TUI keymap 拦截 → 打开 DialogHelp（保持不变） |
| WopalSpace | `undefined` | keymap 不拦截 → 落入 `parseSlashCommand` → 服务端 `Command.Service.get("help")` → 使用 `commands/help.md` 模板 |

**不影响的部分**：
- `help.show` 命令仍在命令面板（Ctrl+P）中可用
- 其余带 `slashName` 的 palette 命令（`/new`、`/exit`、`/status` 等）不受影响
- 非 WopalSpace 模式行为零变化

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

## 9. 安装与自动更新

### 目的

ellamaka 通过 wopal-cli 分发安装（`wopal ellamaka install`），同时使用自有 CDN（`download.coursedao.com/ellamaka/`）实现版本检查和自动更新，不依赖 opencode 的 GitHub/npm/brew 更新通道。

### 9.1 安装方法

`Installation.method()` 检测当前运行环境的安装方式，返回 `"ellamaka"` 表示通过 wopal-cli 安装。检测逻辑：`isUnderWopalBin()` 检查 `process.execPath` 或 `process.argv[0]` 是否包含 `.wopal/bin`。

`"ellamaka"` 方法已加入 `Method` 类型和 `upgrade` 命令的合法选项。

### 9.2 自动更新

TUI 启动后 1 秒触发 `checkUpgrade()` → `upgrade()`，流程如下：

1. **配置检查**：读取 workspace `settings.local.jsonc` / `settings.jsonc` 中的 `ellamaka.autoupdate` 字段
   - `false` → 跳过
   - `"notify"` → 仅通知，不自动安装
   - `true` 或未配置 → 启用（patch 版本自动安装，minor/major 仅通知）
2. **版本查询**：`Installation.latest("ellamaka")` 直接请求 `https://download.coursedao.com/ellamaka/latest/manifest.json`，不走 GitHub API
3. **版本比对**：对比 `InstallationVersion`（编译时版本号）与 CDN 返回的版本
4. **通知/升级**：
   - 版本相同 → 跳过
   - minor/major 版本 → 通过 Bus 事件通知 UI 显示更新提示，不自动安装
   - patch 版本且 autoupdate 未设为 notify → 自动下载安装

### 9.3 CDN 版本清单

`latest()` 请求 `manifest.json`，格式：

```json
{
  "version": "1.15.14",
  "artifacts": [
    { "name": "ellamaka-darwin-arm64.tar.gz", "os": "darwin", "arch": "arm64", "url": "...", "sha256": "..." }
  ],
  "checksumsUrl": "..."
}
```

`upgrade()` 根据目标版本请求 `https://download.coursedao.com/ellamaka/v{version}/manifest.json`，通过 `findEllamakaArtifact()` 匹配当前平台架构的制品，下载 → 解压 → 安装 → codesign。

### 9.4 与 opencode 的差异

| 维度 | opencode | ellamaka |
|------|----------|----------|
| 版本查询 | GitHub API `/repos/anomalyco/opencode/releases/latest` | ellamaka CDN `download.coursedao.com/ellamaka/latest/manifest.json` |
| 安装方法检测 | 检测 npm/brew/curl/scoop/choco 等包管理器 | 检测 `WOPAL_HOME/bin/` 路径 |
| 自动更新入口 | 同 opencode | `upgrade()` 直接 `latest("ellamaka")`，不检测安装方式 |
| 升级通道 | npm/brew/curl/GitHub | CDN 下载 tar.gz + shell 脚本安装 |

### 实现逻辑

`upgrade()` 位于 `packages/opencode/src/cli/upgrade.ts`，是独立的异步函数，不依赖 Effect 服务层。`Installation.latest("ellamaka")` 和 `Installation.upgrade("ellamaka", target)` 在 `packages/opencode/src/installation/index.ts` 中实现。

`upgrade` 命令（`cli/cmd/upgrade.ts`）支持手动升级，接受 `--method ellamaka` 指定安装方式。`isWopalInstall()` 仍用于安装路径检测，但不再拦截更新流程。

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
- `src/cli/cmd/run/splash.ts` — 启动/退出画面，退出 resume 命令通过 `BINARY_NAME` 注入
- `core/src/global.ts` — 路径系统


### 合并后验证

1. `bun typecheck`
2. `bun packages/ellamaka/build.ts --arch primary --web-ui ellamaka-app`
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

---

## 15. ellamaka-app Web UI

### 目的

`packages/ellamaka-app` 是 ellamaka 的官方 web UI,通过 fork 上游
`packages/app` 创建。承接从 `poc/web` 验证的产品形态(三栏 IDE 工作台),
同时保持与上游 `opencode` 能力更新的同步能力。

**设计决策与架构详见 [ELLAMAKA-WORKBENCH.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/ELLAMAKA-WORKBENCH.md) / [ELLAMAKA-WORKBENCH.zh-CN.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/ELLAMAKA-WORKBENCH.zh-CN.md) 以及 [DESIGN.md §8](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/DESIGN.md)。** 本节记录品牌化实施细节。

### 15.1 包级差异(相对于上游 `packages/app`)

| 维度 | 上游 `packages/app` | `packages/ellamaka-app` |
|------|---------------------|-------------------------|
| 包名 | `@opencode-ai/app` | `@opencode-ai/ellamaka-app` |
| 功能范围 | 通用 AI Agent UI | WopalSpace 工作台 + 空间管理 |
| 上游同步 | 跟随上游 | 选择性同步(§15.3) |
| 构建嵌入 | opencode 二进制 | ellamaka 二进制 |

### 15.2 文件级差异

`ellamaka-app` 在 `app` 基线上的新增部分:

| 文件 | 差异类型 | 说明 |
|------|---------|------|
| `package.json` | 修改 | `name`: `@opencode-ai/ellamaka-app`;"workspace:*" 依赖保持一致 |
| `src/app.tsx` | 追加 | 注册 `/workbench` 路由和 ViewProvider |
| `src/pages/workbench/index.tsx` | 新增 | 工作台页面主布局(TopBar + ActivityBar + Sidebar + Workspace + StatusBar) |
| `src/pages/workbench/view.tsx` | 新增 | 视图切换 Provider(TUI/Chat/Split),持久化到 localStorage |
| `src/pages/workbench/space-store.tsx` | 新增 | 空间列表 + tab 状态 Provider,通过 SDK `client.wopalSpace.spaces()` 拉取空间(详见 §16) |
| `src/pages/workbench/parts/*` | 新增 | 工作台部件:top-bar / activity-bar / sidebar / workspace / status-bar |
| `src/i18n/{en,zh}.ts` | 追加 | 12 个 `workbench.*` 翻译键(视图名、面板、侧栏、空状态) |
| `AGENTS.md` | 新增 | 包级开发规则 |

**非侵入原则**:尽量不修改 app/ 现有结构,定制通过新增文件和入口追加方式注入。

### 15.3 构建嵌入

`packages/ellamaka/build.ts` 的 `--web-ui` 参数选择嵌入源:

```bash
bun packages/ellamaka/build.ts --web-ui ellamaka-app  # ellamaka 官方 Web UI
bun packages/ellamaka/build.ts --web-ui app           # 上游 app 基线
bun packages/ellamaka/build.ts --web-ui none          # 不嵌入 Web UI
```

默认值是 `ellamaka-app`。嵌入机制不变:Vite build → dist/ → `opencode-web-ui.gen.ts` 编译入二进制。

### 15.4 上游同步策略

详见 `docs/DESIGN.md §8.4`。`.gitattributes` 保护规则:

| 目录 | 合并保护 | 说明 |
|------|---------|------|
| `packages/app/` | `merge=ours` | 上游对照基线,不接受上游覆盖 |
| `packages/ellamaka-app/` | `merge=ours` | ellamaka 定制,不接受上游覆盖 |
| `packages/ellamaka-app/` 新增目录 | 无保护 | 无上游对应,不参与合并冲突 |

上游 `packages/app` 有更新时,通过人工或脚本 review → cherry-pick 到 `ellamaka-app`。

### 15.5 与 poc/web 的关系

| 阶段 | poc/web | ellamaka-app |
|------|---------|--------------|
| 现状 | 原型验证中 | 待创建 |
| 验证完成后 | 保留作为探索参考 | 承接产品化代码和架构决策 |
| 后续 | 能力逐步迁移,最终归档 | 唯一 web UI 产品形态 |

### 15.6 实施范围

**已完成(基础设施跑通 → 空间侧栏接通)**:
1. 复制 `packages/app` → `packages/ellamaka-app`(排除 node_modules/dist/.turbo)
2. 修改 `package.json` 元数据
3. 在 `packages/ellamaka/build.ts` 切换嵌入源
4. 注册 `/workbench` 路由 + 三栏布局骨架(TopBar/ActivityBar/Sidebar/Workspace/StatusBar)
5. 视图切换 Provider(TUI/Chat/Split)持久化到 localStorage
6. 空间侧栏接通真实数据:通过 `wopalSpace.spaces` SDK 方法(后端 §16)拉取 `~/.wopal/config/settings.jsonc` 的 WopalSpace 注册表
7. 点击空间在 workbench 内开 tab,不跳转官方 session 路由(符合 PoC 设计)

**后续迭代**:TUI 视图接入(复用 terminal.tsx) → Chat 视图接入(复用 session 组件) → Split 分屏 → 命令面板集成 → 上游 app 同步。

### 15.7 相关文档

| 文档 | 说明 |
|------|------|
| `packages/ellamaka-app/AGENTS.md` | 包级开发规则 |
| `docs/ELLAMAKA-WORKBENCH.zh-CN.md` | ellamaka-app 详细设计与架构设计 |
| `poc/web/OVERVIEW.md` | PoC 验证结果 |

---

## 16. WopalSpace 空间注册表 API

### 目的

ellamaka-app workbench 侧栏需要展示用户通过 `wopal-cli` 注册的 WopalSpace 空间列表。wopal CLI 把空间注册表写入 `~/.wopal/config/settings.jsonc` 的 `spaces` 字段。ellamaka 后端暴露一个只读 HTTP endpoint,让 web UI 通过 SDK 拉取这份注册表。

数据源是 wopal CLI 管理的 settings.jsonc,不是 ellamaka 自己的 project 持久化层。ellamaka 只读不写这份注册表。

### 16.1 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/wopal-space/spaces` | 返回 `~/.wopal/config/settings.jsonc` 中所有注册的 WopalSpace 空间 |
| `GET` | `/wopal-space/space-overview` | 返回指定空间的完整会话归组（Workbench 自有模型：project→子目录/worktree→会话），query: `spaceName` |
| `GET` | `/wopal-space/non-space-overview` | 返回不在任何已注册空间下的 session 按 directory 分组 |
| `GET` | `/wopal-space/search-directories` | 模糊搜索空间下子目录（用于空 Panel 装载器），query: `spaceName`, `query` |
| `GET` | `/wopal-space/recent-directories` | 返回空间下最近开过 session 的目录，query: `spaceName` |

`/wopal-space/spaces` 响应体 schema:

```ts
{
  spaces: Array<{
    name: string      // 空间名(注册表 key)
    path: string      // 空间根目录绝对路径
    type?: string     // 空间类型:"coding" | "common" 等(wopal CLI 定义)
  }>
}
```

`/wopal-space/space-overview` 响应体 schema（核心归组结构）:

```ts
{
  spaceName: string,
  spacePath: string,
  spaceRootSessionCount: number,        // directory=spacePath 的会话数（空间根本身非 git repo 时的兜底）
  spaceRootSessions: Array<WorkbenchSessionSummary>,
  projects: Array<{
    path: string,                        // 项目根真实路径
    displayPath: string,
    name?: string,
    vcs?: "git",
    sessionCount: number,                // 会话总数（含子目录和 worktree）
    rootSessions: Array<WorkbenchSessionSummary>,    // directory=项目根的会话（marker=""）
    directories: Array<{                // 子目录分组（marker="directory"）
      path: string,
      sessionCount: number,
      sessions: Array<WorkbenchSessionSummary>,
    }>,
    worktrees: Array<{                  // 工作树分组（marker="worktree"）
      worktreePath: string,
      branch?: string,
      stale: boolean,                   // worktree 已删除/状态不正常
      sessionCount: number,             // stale 时为 0
      sessions: Array<WorkbenchSessionSummary>,  // stale 时为空
    }>,
  }>
}

// WorkbenchSessionSummary 含 marker 字段标记会话来源
type WorkbenchSessionMarker = "" | "directory" | "worktree"
```

`/wopal-space/non-space-overview` 响应体 schema:

```ts
{
  orphanDirectories: Array<{
    path: string,
    sessionCount: number,
    sessions: Array<WorkbenchSessionSummary>,
  }>
}
```

`/wopal-space/search-directories` 和 `/wopal-space/recent-directories` 响应体 schema:

```ts
{
  directories: Array<{
    path: string            // 真实路径
    displayPath: string
    isGitRepo: boolean      // 是否 git repo
  }>
}
```

`space-overview` query: `{ spaceName: string }`
`search-directories` query: `{ spaceName: string, query: string }`
`recent-directories` query: `{ spaceName: string }`

### 16.2 实现位置

ellamaka 定制遵循"新文件优先 + 最小注入点"原则:

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` | 新增 | `WopalSpaceApi` HttpApiGroup 定义,endpoint `GET /wopal-space/spaces` |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` | 新增 | handler 实现:读 `Global.Path.config/settings.jsonc` → 解析 JSONC → 提取 `spaces` 字段 |
| `packages/opencode/src/server/routes/instance/httpapi/api.ts` | 注入(1 行) | `RootHttpApi.addHttpApi(WopalSpaceApi)` |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 注入(2 行) | import + `rootApiRoutes` Layer.provide 添加 `wopalSpaceHandlers` |

### 16.3 路由层级

`WopalSpaceApi` 挂在 `RootHttpApi`(与 `ControlApi`/`GlobalApi` 同级),**不挂** `InstanceHttpApi`。原因:

- WopalSpace 注册表是**全局**的,与具体 instance directory/workspace 无关
- 不需要 `InstanceContextMiddleware` / `WorkspaceRoutingMiddleware`(那些 middleware 依赖 request-scoped directory)
- 只需 `Authorization` middleware(继承 RootHttpApi 的 auth 声明)

### 16.4 数据读取

handler 直接读文件系统,不走 ellamaka config schema:

```ts
const SPACES_FILE = path.join(Global.Path.config, "settings.jsonc")
const text = yield* fs.readFileStringSafe(SPACES_FILE).pipe(Effect.catch(() => Effect.succeed(undefined)))
if (!text) return []
const raw = ConfigParse.jsonc(text, SPACES_FILE)
const spaces = (raw as { spaces?: Record<string, { path: string; type?: string }> })?.spaces
```

- 用 `ConfigParse.jsonc` 解析(支持 JSONC 注释,与 ellamaka config 加载一致)
- 文件不存在或解析失败时返回空数组,不抛错
- `Global.Path.config` 是 `~/.wopal/config`(受 `WOPAL_HOME` 环境变量覆盖,与 ellamaka 路径体系 §2 一致)

### 16.5 SDK 自动生成

ellamaka 的 SDK 由 `packages/sdk/js/script/build.ts` 从后端 OpenAPI spec 自动生成。新增 `WopalSpaceApi` 后:

- `bun dev generate` 重新生成 openapi.json(含 `/wopal-space/spaces` operation)
- `@hey-api/openapi-ts` 生成 `WopalSpace` 客户端类,挂在 `OpencodeClient` 上
- 前端调用:`sdk.client.wopalSpace.spaces()`(连字符 operationId `wopal-space.spaces` 转驼峰为 `wopalSpace`)

**生成产物**(自动,无需手写):

| 文件 | 变更 |
|------|------|
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | 新增 `WopalSpace` 类 + `OpencodeClient.wopalSpace` getter |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | 新增 `WopalSpaceSpacesResponses` / `WopalSpaceSpacesErrors` 类型 |

### 16.6 上游隔离

`wopal-space` group/handler 是 ellamaka 定制,上游 opencode 不存在。上游合并时:

- 新文件不受影响(无上游对应,不参与合并冲突)
- `api.ts` 和 `server.ts` 是注入点,各 1-2 行追加,合并时需人工确认保留

如果上游未来也加同类型 endpoint,需在合并时评估是否替换为本实现。

### 16.7 项目目录聚合端点（Workbench 自有归组模型）

`spaceOverview`、`nonSpaceOverview`、`searchDirectories`、`recentDirectories` 四个端点为 Workbench 左侧"Space → Project → Session"三级会话浏览器和空 Panel 目录搜索提供数据。

**关键设计：完全按 Workbench 自有归组，不沿用 opencode 的 project_id 归组**。opencode 的 project 模型用 git worktree 根向上查找，非 git 目录归入 "global" project（id="global", worktree="/"）。这导致空间根本身非 git repo 时所有会话被归入 global，多个空间的会话混在一起无法区分。Workbench 重新归组：

```
Space
├── 会话（directory = 空间根，挂 Space 下，不进任何 project）
├── Project（空间下的一级 git repo，不含空间根本身）
│   ├── 会话（directory = 项目根，无标记）
│   ├── 📁子目录
│   │   └── 会话（directory = 子目录，标记"目录"）
│   └── 工作树
│       └── 会话（directory = .worktrees/xxx，标记"工作树"，归主项目）
│           worktree 已删除/状态不正常 → 会话不展示
```

#### 数据来源

- **session**：`Session.Service.list()` 获取所有 session，用 `session.directory` 归组（不用 `session.project_id`）。**已归档会话（`timeArchived != null`）过滤掉**，不进入任何归组，左侧树不展示
- **project name**：`Project.Service.list()` 仅用于取 project.name（opencode project 表记录），归组逻辑不依赖它
- **一级 git repo**：扫描 `spaceRealPath` 下一层目录（不含 spaceRealPath 本身），`git -C <child> rev-parse --show-toplevel` 检测是否 git repo
- **worktree**：对每个 project root 执行 `git worktree list --porcelain`，关联独立 worktree 回主项目

#### 软链接 realpath 处理

- `space.path`（来自 settings.jsonc）→ `fs.realpath()` → spaceRealPath（失败回退原 path）
- `session.directory` 和 `project.worktree` 已是真实路径（opencode 存储时已 realpath），直接用
- 匹配规则：`dir === root || dir.startsWith(root + "/")`

#### stale 检测

- `fs.existsSync(worktreePath)` 为 false → stale=true
- `git -C <worktreePath> status` 失败 → stale=true
- stale=true 时 sessionCount=0, sessions=[]（归档语义，视图层不展示该 worktree 的会话）

#### 会话标记

| marker 值 | 含义 | 触发条件 |
|-----------|------|----------|
| `""` | 项目根会话 | directory === project root |
| `"directory"` | 子目录会话 | directory 是 project root 的子目录 |
| `"worktree"` | 工作树会话 | directory 落在 project 的某个 worktree 下 |

#### 实现位置

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/opencode/src/server/routes/instance/httpapi/groups/wopal-space.ts` | 修改 | 追加 4 个端点定义 + Workbench 归组 schema |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space.ts` | 修改 | 追加 4 个 handler，组合 Session.Service + 归组模块 |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/wopal-space-grouping.ts` | 创建 | 归组工具模块：扫描一级 git repo、git worktree list、session 归组、stale 检测、realpath |

#### 路由层级

4 个端点与 `spaces` 一致，挂在 `RootHttpApi`，只需 `Authorization` middleware。原因是 spaceName 是 wopal 概念，不依赖 instance directory/workspace 路由。

#### handler 逻辑

**spaceOverview({ spaceName })**：读 space.path → realpath → 调归组模块 → 返回 WorkbenchProject[] + spaceRootSessions

**nonSpaceOverview()**：所有 space.path realpath 集合 → 过滤 session.directory 不在任何空间下的 → 按 directory 分组 → orphanDirectories

**searchDirectories({ spaceName, query })**：递归扫描空间下子目录（深度限制 3-4 层），模糊匹配 query，限制前 50，对每个结果检测 isGitRepo

**recentDirectories({ spaceName })**：过滤空间下 session，按 directory 去重 + timeCreated 倒序取前 20

#### 上游隔离

归组模块和 4 个 handler 是 ellamaka 定制，上游 opencode 不存在。新增端点只追加到现有 wopal-space.ts 文件和新建归组模块，不触碰上游 project/session handler。

### 16.8 相关文档

| 文档 | 说明 |
|------|------|
| `docs/ELLAMAKA-WORKBENCH.zh-CN.md` | ellamaka-app 详细 architecture (workbench 侧栏数据源契约) |
| `docs/ELLAMAKA-WORKBENCH-STEP5-DESIGN.zh-CN.md` | Step 5 补充设计 §3.4 数据源 |
| `docs/plans/feature-workbench-wopal-space-projects-and-non-space-projects-api.md` | 后端 API 实现 Plan |
| `docs/BRANDING.md §2` | 路径体系(`Global.Path.config` = `~/.wopal/config`) |
| `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` | HttpApi 路由模式规范 |

---

## 17. ellamaka-desktop 桌面应用

### 目的

`packages/ellamaka-desktop` 是 ellamaka 的官方桌面应用。它承载 `ellamaka-app` Workbench。Electron 主进程管理窗口和本地 sidecar，sidecar 统一管理 Web 与 Desktop 的 PTY 生命周期。

完整架构、状态所有权和生命周期契约见 [`DESKTOP.md`](./DESKTOP.md)。本节记录桌面产品的品牌化基线和包级差异。

### 17.1 固定基线

桌面包从 OpenCode `v1.15.13` 的 `packages/desktop` 独立复制，基线 commit 为 `385cb694419f98103af0e8fc6187ddcbcbb6eecb`。该基线已经使用 Electron，不包含 Tauri 运行时。

| 维度 | 上游基线 | ellamaka-desktop |
|------|----------|-------------------|
| 包路径 | `packages/desktop` | `packages/ellamaka-desktop` |
| 包名 | `@opencode-ai/desktop` | `@opencode-ai/ellamaka-desktop` |
| 桌面框架 | Electron 41.2.1 | Electron，与 1.15.13 基线保持兼容 |
| 渲染应用 | `@opencode-ai/app` | `@opencode-ai/ellamaka-app` |
| 默认界面 | OpenCode 主界面 | Ellamaka Workbench `/workbench` |
| 本地运行时 | OpenCode node sidecar | Ellamaka/WopalSpace node sidecar |

### 17.2 包边界

`ellamaka-desktop` 与 `ellamaka-app` 采用相同的独立复制模式。上游 `packages/desktop` 保持裁剪状态，桌面定制集中在 `packages/ellamaka-desktop`。

- Renderer 依赖 `ellamaka-app` 的根导出、Vite 插件、CSS、public 资源和 i18n 字典。
- Main Process 与 Preload 负责窗口、IPC、系统能力、更新和 sidecar 生命周期。
- Sidecar 构建使用当前仓库的 `packages/opencode` node runtime，并启用 Ellamaka 与 WopalSpace 能力。
- `ellamaka-app` 与 `ellamaka-desktop` 跟随 ellamaka 引擎版本同步升级，保持同一上游版本基线。

### 17.3 PTY 生命周期

桌面端将页面状态与进程所有权分离：

| 所有者 | 职责 |
|--------|------|
| `ellamaka-app` Renderer | 持久化 Workbench 布局和 PTY ID 重连提示；探测、连接和显式删除 PTY |
| Electron Main Process | 管理窗口与 sidecar；应用退出时停止 sidecar |
| Ellamaka sidecar | 管理 PTY Session、subscribers、断连宽限任务和操作系统进程 |

目标行为：

- Web 与 Desktop 共用 sidecar 的断连宽限机制。最后一个 WebSocket subscriber 断开后，PTY 进入 10 秒 Grace。
- Renderer 刷新只重载界面。`localStorage` 保留 PTY ID 提示，新 Renderer 在 Grace 内探测并重连原 PTY，sidecar 取消回收任务。
- Panel 或 Space 主动关闭时，Renderer 立即终止对应 PTY，不等待 Grace。
- 浏览器 Tab 或桌面窗口关闭后没有新连接，sidecar 在 Grace 结束时自动终止 PTY。
- 应用退出时，Main Process 停止 sidecar，Instance finalizer 立即终止全部 PTY 和子进程。
- PTY 所有权集中在 sidecar；Electron Main 与 Preload 保持窗口、系统能力和 sidecar 生命周期边界。

### 17.4 上游同步策略

`ellamaka-desktop` 的功能基线固定在 OpenCode v1.15.13。桌面包不整体引入 1.17 或其他跨版本实现。

- 上游同版本修复通过人工 review 后选择性移植。
- Electron 安全修复、进程生命周期修复和平台兼容修复可独立回移，并通过桌面测试验证。
- ellamaka 升级到新的 OpenCode 基线时，`ellamaka-app`、`ellamaka-desktop` 和 sidecar 一起评估并升级。
- 独立包保留基线来源和定制差异记录，确保后续同步可审计。

### 17.5 实施边界

本节确立桌面产品的目标架构与版本基线。包创建、品牌资源、构建发布、签名、公证、自动更新和 sidecar 断连宽限机制由独立 Plan 实施和验收。

### 17.6 相关文档

| 文档 | 说明 |
|------|------|
| `docs/DESKTOP.md` | ellamaka-desktop 架构、状态所有权、PTY 生命周期与验证契约 |
| `docs/ELLAMAKA-WORKBENCH.zh-CN.md` | ellamaka-app Workbench 详细设计 |
| `docs/DISTRIBUTION.md` | Ellamaka 构建与分发设计 |

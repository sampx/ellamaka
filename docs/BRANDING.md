# Ellamaka 品牌化定制

> 更新: 2026-06-09

## 1. 合并速查

merge 时三张表定位：§1.1 删、§1.2 改、§1.3 增。

### 1.1 删除（modify/delete → git rm）

`packages/desktop/` `enterprise/` `console/` `function/` `containers/` `web/` `slack/` `zen/` `extensions/` `identity/` `stats/`
`sdks/` `github/` `infra/` `nix/` `specs/` `script/` `.opencode/`
`CONTRIBUTING.md` `SECURITY.md` `README.zh.md` `sst-env.d.ts` `sst.config.ts` `flake.nix` `flake.lock`

### 1.2 修改（内容冲突 → 保留 ellamaka）

| 文件 | 定制 | 风险 |
|------|------|------|
| `runtime-flags.ts` | +wopalSpace +disableAgentsSkills，WOPAL_SPACE 集成到 disableClaudeCode*/ExternalSkills | 低 |
| `config/config.ts` | wopal-space early return + `loadGlobal` 改读 `settings.jsonc` + `Global.Path.config` 跳过能力扫描 | **高** |
| `skill/index.ts` | disableAgentsSkills + `.agents` 目录 + WOPAL_SPACE gate | **高** |
| `installation/index.ts` | `.wopal/bin`、channel 守卫、USER_AGENT | **高** |
| `session/llm.ts` | plugin systemMetadata hook | **高** |
| `cli/cmd/run.ts` | BINARY_NAME（仅 imports 冲突） | **高** |
| `global.ts` | WOPAL_HOME → `~/.wopal/` | 低 |
| `index.ts` | BINARY_NAME/VERSION_PREFIX、wopal-space 检测 | 低 |
| `cli/logo.ts` | "ELLA"+"MAKA" 字模 | 低 |
| `cli/ui.ts` | wordmark import | 低 |
| `cli/error.ts` | 3 处 BINARY_NAME | 中 |
| `cli/network.ts` | 1 处 BINARY_NAME | 中 |
| `cli/upgrade.ts` | channel 守卫 | 中 |
| `cli/cmd/providers.ts` | BINARY_NAME | 中 |
| `cli/cmd/debug/index.ts` | BINARY_NAME | 中 |
| `permission/index.ts` | 权限合并 | 中 |
| `tui/app.tsx` | ellamaka TUI 入口（mod/del 保留 HEAD） | 中 |
| `tui/component/error-component.tsx` | 错误上报 URL → `wopal-cn/ellamaka` | 中 |
| `tui/config/tui.ts` | wopal-space TUI 配置注入 | 中 |
| `cli/cmd/{upgrade,uninstall,web,tui/thread,serve,tui/attach,pr,mcp}.ts` | BINARY_NAME | 低 |
| `tui/feature-plugins/home/tips-view.tsx` | settings 路径提示 | 低 |

### 1.3 新增（不冲突）

`packages/ellamaka/`（branding/logo/build/detect）|
`packages/opencode/src/config/wopal-space*.ts`|
`tui/config/wopal-space.ts`|
`scripts/` `.github/workflows/publish-ellamaka.yml`|
`.wopal/plugins/tui-ellamaka.tsx` `.wopal/plugins/ellamaka-theme.json`

## 2. 双模架构

ellamaka 有两种运行模式，配置加载链路完全不同。

### 2.1 普通模式（opencode 兼容）

wopal-space 未激活时，兼容 opencode 配置体系，让老用户零迁移使用。

```
优先级从低到高：
① opencode XDG 全局配置
   ~/.config/opencode/config.json
   ~/.config/opencode/opencode.json[c]
② ellamaka 全局配置（覆盖）
   WOPAL_HOME/config/settings.jsonc
③ 项目级配置
   opencode.jsonc（项目根 findUp）
   .opencode/opencode.json[c]（项目级 + ~/.opencode/）
④ 能力加载
   ~/.opencode/ → agents/plugins/commands（全局）
   .opencode/   → agents/plugins/commands（项目级）
   ~/.config/opencode/ → agents/plugins/commands（XDG 全局）
   WOPAL_HOME/config/  → ✗ 纯配置目录，不扫描能力
```

### 2.2 wopal-space 模式（短路）

激活后直接短路到 wopal-space 体系，不碰任何 opencode 路径。

**激活方式**：

| 方式 | 行为 |
|------|------|
| `--wopal-space` | 直接启用 |
| `--no-wopal-space` | 强制禁用（逃逸阀） |
| 未传参 | 自动检测：从 cwd 向上找 `.wopal/config/settings.json[c]`，含 `"ellamaka"` 键 → 启用 |

**配置链**：
```
① WOPAL_HOME/config/settings.jsonc  全局配置（ellamaka 字段）
② WOPAL_HOME/                        全局能力（agents/commands/plugins/skills）
③ .wopal/config/settings.json[c]    空间配置（ellamaka + tui 字段）
④ .wopal/                            空间能力（agents/commands/plugins/skills）
⑤ .wopal/agents/{name}.md           agent frontmatter（permission 最高优先级）
```

**能力加载**（`wopal-space.ts` `tryLoadWopalSpaceConfig`）：

| 步骤 | 行为 |
|------|------|
| 发现 | `findWopalDirs()` 从 cwd 向上查找 `.wopal/` 目录 |
| 目录构建 | `Global.Path.config` + `~/.wopal/` + 空间 `.wopal/` |
| 配置 | 每个 `.wopal/` 的 `settings.jsonc` → `ellamaka` 字段 merge |
| agents | `ConfigAgent.load(dir)` → `.wopal/agents/*.md` |
| commands | `ConfigCommand.load(dir)` → `.wopal/commands/` |
| plugins | `ConfigPlugin.load(dir)` → `.wopal/plugins/` + 本地 plugin deps 安装 |
| 跳过 | `if (dir === Global.Path.config) continue` — 配置目录不扫描能力 |
| skills | 由 `skill/index.ts` 独立处理：`~/.wopal/skills/` → 空间 `.wopal/skills/`（并发解析 + 按序覆盖） |

与上游关键差异：上游扫描 `.opencode/`（项目级）+ `~/.opencode/`（全局）加载 agents/commands/plugins；wopal-space 模式扫描 `.wopal/`（空间级）+ `~/.wopal/`（全局），**不碰 `.opencode/`**。

`config.ts` 中 `tryLoadWopalSpaceConfig` 返回后直接 return——**不加载项目级 `opencode.jsonc`**。

wopal-space 模式下额外跳过上游的外部目录扫描：
- `~/.claude/` `~/.agents/`（全局） + `.claude/` `.agents/`（项目向上查找）
- `WOPAL_SPACE` 已集成到 `disableClaudeCodeSkills`、`disableExternalSkills`、`disableAgentsSkills`（RuntimeFlags `Config.all()` + `||`）

## 3. 环境变量

| 变量 | 作用 | 设置者 |
|------|------|--------|
| `WOPAL_SPACE=1` | 激活 wopal-space 模式 | yargs `--wopal-space` 或自动检测 |
| `WOPAL_HOME` | 全局数据根目录（默认 `~/.wopal`） | 用户 env 或默认 |

WOPAL_SPACE 存储于 `packages/opencode/src/effect/runtime-flags.ts`（`wopalSpace: bool("WOPAL_SPACE")`），并集成到 `disableClaudeCodePrompt`/`Skills`/`ExternalSkills`（`Config.all()` + `||` 模式）。`flag.ts` 无 ellamaka 定制。

### 3.1 .env 文件加载

`packages/core/src/global.ts` 在模块加载时自动读取两个 `.env` 文件（上游无此逻辑）：

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 高 | `<space>/.wopal/.env` | 从 cwd 向上查找 `.wopal/` 目录，加载其中的 `.env` |
| 低 | `WOPAL_HOME/.env` | 全局 `.env`，空间 `.env` 未设置的 key 在此补齐 |

**规则**：
- `key=value` 格式，`#` 开头为注释
- 已在 `process.env` 中的 key **不覆盖**（先到先得）
- 支持单引号/双引号包裹值

## 4. 数据路径与能力隔离

| 用途 | 路径 |
|------|------|
| 全局配置 | `WOPAL_HOME/config/settings.jsonc`（唯一入口，两种模式共用） |
| Runtime data | `WOPAL_HOME/ellamaka/data/` |
| 缓存 | `WOPAL_HOME/ellamaka/cache/` |
| 进程状态 | `WOPAL_HOME/ellamaka/state/` |
| 安装路径 | `WOPAL_HOME/bin/ellamaka` |
| 空间 ontology | `<space>/.wopal/` |

**`WOPAL_HOME/config/` 是纯配置目录**。`config.ts` 的 `loadInstanceState` 中 for-loop 迭代所有目录做 npm install + 能力扫描时，**跳过 `Global.Path.config`**（`if (dir === Global.Path.config) continue`）。避免在配置目录安装 `node_modules/`、拖慢启动速度。

不使用 opencode 的 `config.json`/`opencode.json[c]` 文件名，不执行 TOML legacy 迁移。`loadGlobal` 改读 `settings.jsonc`。

## 5. 品牌常量

`packages/ellamaka/branding.ts`

```ts
BINARY_NAME = "ellamaka"
VERSION_PREFIX = "ellamaka"
CHANNEL_RELEASE = "ellamaka"
CHANNEL_DEV = "ellamaka-main"
```

12 个 CLI cmd 文件 + `index.ts` + `error.ts` + `network.ts` 通过 import 引用，不硬编码。

## 6. 日志

- 默认日志级别：`"INFO"`
- 日志文件：`ellamaka.log`（非 `opencode.log`）
- 尊重 `OPENCODE_LOG_LEVEL` 环境变量覆盖

## 7. TUI 品牌

- `cli/logo.ts`：ASCII 字模拼写 "ELLA"+"MAKA"
- `cli/ui.ts`：wordmark import（非 TTY 降级时用）
- `tui-ellamaka.tsx`：3 个 slot（home_logo、home_prompt_right、session_prompt_right），通知迁移至 `api.attention.notify()`（v1.15.13 上游移除 `sound.ts`）
- `error-component.tsx`：错误上报 URL → `wopal-cn/ellamaka`

## 8. 自动更新拦截

三层 channel 守卫：

| 文件 | 机制 |
|------|------|
| `cli/upgrade.ts` | `startsWith("ellamaka")` → 前置返回，不触发自动更新 |
| `installation/index.ts` | `latest()`/`upgrade()` 守卫 + 错误提示 `wopal ellamaka update` |
| `cli/cmd/upgrade.ts` | 前置返回块，引导用户用 wopal-cli |

## 9. 上游侵入原则

1. 新文件优先：定制逻辑独立文件，上游文件只留最小注入点
2. 提前返回 guard：`if (flag) { ... return }` 在上游主流程之前
3. 禁止格式化重排：不改 import 顺序、对象 key 等

## 10. 构建

CI：`publish-ellamaka.yml` → `bun packages/ellamaka/build.ts --arch primary`
本地：`packages/ellamaka/build.ts`（基于上游 build.ts 的 branded copy）
产物：多平台 standalone binary → `~/.wopal/bin/ellamaka`

## 11. 合并后验证

```
bun typecheck                         # packages/opencode
bun test --timeout 30000              # 通过率 ≥ 90%
./scripts/build.sh --install
ellamaka --version                    # ellamaka/x.y.z
ellamaka --help | rg -c opencode      # 0
scripts/dev.sh --debug -w             # 无 .opencode/ 路径
```

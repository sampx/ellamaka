# chore-ellamaka-merge-upstream-opencode-v11513

## Metadata

- **Type**: chore
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka/
- **Project Type**: standard
- **Created**: 2026-06-08
- **Updated**: 2026-06-09（v1.15.13 tag 精准合并版）
- **Status**: planning


## Scope Assessment

- **Complexity**: High
- **Confidence**: High
- **Scope Note**: 本计划修改跨 `projects/ellamaka` 与 `.wopal/plugins/`，后者是上游 API 变更（`ToolContext.ask` Promise 化、`TuiAttention` 新增）的**下游联动改造**，必须与合并同批次原子完成，否则 merge commit 入 main 后旧版 plugin 将无法正常工作。另立 Plan 拆分平台层的 plugin 变更会导致中间态不可用。
- **Atomic Merge Note**: 12 个 Task 虽然数量较大，但 upstream merge 是**单次原子提交**——不能拆成多个 Plan 分别生成多个 merge commit，否则失去合并的原子性、产生多份中间态的无效历史。所有 Task 共享同一次 merge 上下文，最终产出 1 个 merge commit。

## Goal

合并 opencode 上游 **tag v1.15.13**（commit `74ce1a1edf`）到 ellamaka，保留全部 13 项 ellamaka 定制。

⚠️ **Merge 约束**：使用 `git merge v1.15.13`（锁定 git tag），严禁 `git merge upstream/dev`（移动目标）。

## Technical Context

### Architecture Context

ellamaka 是 OpenCode 的 WopalSpace 引擎 fork，承载 `--wopal-space` 模式下的配置加载、ontology 运行时物化、plugin 执行与权限系统。本次合并跨越上游 14 个小版本（含 v1.14.40-v1.15.13），其中发生三项**架构级别重构**：

1. **Zod → Effect Schema 全面迁移**（v1.14.43 起，至 v1.15.5 完成）：`util/effect-zod.ts` 删除，17+ 模块的 schema 改用 `Schema.Class`/`Schema.TaggedErrorClass`，影响 `installation`、`permission`、`skill`、`config`、`bus`、`tool` 等核心域。

2. **Effect Service 化**（v1.14.41-v1.15.5）：
   - **`RuntimeFlags` service**（`#27181`）替代静态 `Flag` 对象，20+ 运行时 flag 迁移到此
   - **`AppProcess` service**（`#27178`）统一进程调用
   - **`BackgroundJob` service**（`#27033`）通用后台任务
   - **`serviceUse` 模式**（`#28576`）在 14 个 service 中推广，替代直接 `Layer.effect`

3. **TUI Plugin API 重写**（v1.14.51-v1.15.11）：
   - 全面重写 keybind 系统（`@opentui/keymap`）
   - 引入 `TuiAttention` 通知 + 音效 API（`#26980`）
   - 引入 `TuiModeApi`、`TuiKeymap`、`Hooks.dispose`
   - `ToolContext.ask` 从 `Effect.Effect<void>` 改为 `Promise<void>`
   - `TuiCommandApi` 废弃，建议用 `api.keymap.registerLayer`
   - 音效系统用 `@opentui/core` 的 `Audio.create()` + `Bun.file().bytes()` 内存加载，自动兼容 bunfs 虚拟路径

ellamaka 当前共有 **13 项定制**（详见 `BRANDING.md` §0-§10 与 `AGENTS.md`）。`WOPAL_SPACE` flag 保留 backward-compat getter 在 `flag.ts`，不迁移。

### Research Findings

**冲突面调研结果**（基于 `git merge v1.15.13 --no-commit --no-ff` dry-run 实测）：

- **总冲突数**：357 个
- **内容冲突**（双方都修改，31 个）：含 5 个高风险、10 个中风险、16 个低风险
- **modify/delete 冲突**（326 个）：覆盖 `.github/`、`packages/desktop/`、`script/`、`sdks/`、`specs/`、`packages/web/`、`packages/enterprise/`、`packages/console/`、`packages/function/`、`packages/containers/`、`packages/slack/`、`packages/zen/`、`packages/extensions/`、`packages/identity/` 等精简目录
- **新增 package**（v1.15.x 引入）：`packages/cli/`、`packages/docs/`、`packages/effect-drizzle-sqlite/`、`packages/llm/`、`packages/http-recorder/`、`packages/stats/`
- **删除的文件**（v1.15.x 上游删除）：`packages/opencode/src/cli/cmd/tui/util/sound.ts`、`packages/opencode/src/util/keybind.ts`、`packages/opencode/src/util/lock.ts`、`packages/opencode/src/util/scrap.ts`、`packages/opencode/src/util/network.ts`、`packages/opencode/src/util/abort.ts`、`packages/opencode/src/util/color.ts`、`packages/opencode/src/util/effect-zod.ts`、`packages/opencode/src/util/fn.ts`、`packages/opencode/src/util/named-schema-error.ts`、`packages/opencode/src/util/update-schema.ts`、`packages/opencode/src/server/adapter.{bun,node,ts}`、`packages/opencode/src/server/proxy.ts`、`packages/opencode/src/server/middleware.ts`、`packages/opencode/src/server/error.ts`、`packages/opencode/src/server/workspace.ts`、`packages/opencode/src/server/routes/instance/{config,event,experimental,file,index,mcp,middleware,permission,project,provider,pty,question,session,sync,trace,tui}.ts`

**ellamaka 13 项定制的当前状态**（基于 `git log main --oneline -- <file>` 与 `git show main:<file>` 实地验证）：

| 定制项 | 位置 | 当前形态 |
|--------|------|---------|
| WOPAL_HOME 路径体系 | `packages/core/src/global.ts` | ellamaka 自有，`WOPAL_HOME` env 覆盖，路径在 `~/.wopal/` 下 |
| `WOPAL_SPACE` flag | `packages/core/src/flag/flag.ts` | ellamaka 自有（commit `6877c14537`） |
| `OPENCODE_DISABLE_AGENTS_SKILLS` | `packages/opencode/src/skill/index.ts` 运行时 | ellamaka 自有，commit `24f95f2040`，`flag.ts` 中无对应 flag（运行时读取） |
| `BINARY_NAME`/`VERSION_PREFIX` 注入 | `packages/opencode/src/index.ts`、`packages/ellamaka/branding.ts` | ellamaka 自有，commit `c136da4b28`、`838973027d`、`64c4131002` |
| `.wopal/bin` 路径检测 | `packages/opencode/src/installation/index.ts` | ellamaka 自有，commit `29e688bcbc`，line 175 |
| channel 守卫 `startsWith("ellamaka")` | `installation/index.ts`（line 209, 270）、`cli/upgrade.ts`、`cli/cmd/upgrade.ts` | ellamaka 自有，commit `29e688bcbc` |
| `USER_AGENT` 品牌化 | `packages/opencode/src/installation/index.ts` | ellamaka 自有，commit `29e688bcbc`（`${BINARY_NAME}/${InstallationChannel}/...`） |
| wopal-space 配置加载 | `packages/opencode/src/config/wopal-space.ts`、`wopal-space-settings.ts`、`cli/cmd/tui/config/wopal-space.ts` | ellamaka 自有，commit `b6e72de64a`、`fb8b9030bb` |
| 12 个 CLI cmd 文件的 BINARY_NAME 字符串 | `cli/cmd/{upgrade,uninstall,web,tui/thread,serve,run,tui/attach,pr,providers,mcp,error,debug/index}.ts` | ellamaka 自有，commit `64c4131002`、`29e688bcbc` |
| TUI logo 字模 | `packages/opencode/src/cli/logo.ts` | ellamaka 自有，commit `29e688bcbc`、`9deafc82f`，数据为 "ELLA"+"MAKA" 块字符画 |
| wordmark 注入 | `packages/opencode/src/cli/ui.ts` | ellamaka 自有，commit `29e688bcbc`，`import { wordmark } from "../../ellamaka/logo"` |
| 错误上报 URL 品牌化 | `packages/opencode/src/cli/cmd/tui/component/error-component.tsx` | ellamaka 自有，commit `29e688bcbc`，URL `wopal-cn/ellamaka` |
| tips 提示文案 | `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | ellamaka 自有，commit `b40ffa0c94`（如有），`~/.wopal/config/settings.jsonc` 路径提示 |

**Plugin API 调研**（基于 `git diff 6e7c9eb82..74ce1a1edf -- packages/plugin/src/`）：

- `ToolContext.ask`：`Effect.Effect<void>` → `Promise<void>`（`#28217`）
- `ToolResult`：新增 `title` 字段和 `attachments: ToolAttachment[]` 数组
- `Hooks`：新增 `dispose?: () => Promise<void>`
- `AuthHook.success` 和 `{ key: string }` 结果：新增 `metadata?: Record<string, string>`
- `TuiCommandApi`：标记 `@deprecated`，改用 `api.keymap.registerLayer` + `api.keymap.dispatchCommand`
- `TuiKeybind/TuiKeybindMap/TuiKeybindSet`：标记 `@deprecated`，改用 `@opentui/keymap` 的 `Binding<Renderable, KeyEvent>`
- `TuiConfigView.keybinds`：`TuiKeybindMap` → `TuiBindingLookupView`
- `TuiHostSlotMap.home_prompt_right`：移除 `workspace_id` 字段
- `TuiPluginApi` 新增 `attention: TuiAttention`、`keymap: TuiKeymap`、`mode: TuiModeApi`、`keys: TuiKeys`
- `TuiState.session`：新增 `get(sessionID: string) => Session | undefined`
- `TuiAttentionSoundName` 等音效相关类型新增

**音效兼容原理核实**（基于 `git show 74ce1a1edf:packages/opencode/src/cli/cmd/tui/util/audio.ts`）：

上游 v1.15.13 的音效系统**不是**沿用 ellamaka 之前的 `Bun.write()` 写出真实文件 + 外部播放器方式，而是采用：

- `Audio.create()` 来自 `@opentui/core`（第三方库）
- 加载音频用 `Bun.file(file).bytes()`（line 35-37），自动支持 bunfs 虚拟路径
- 播放由 `@opentui/core` 内部处理（不调用 afplay/mpv 等外部播放器）

这意味着：
- ellamaka 之前在 `BRANDING.md §4.6.3` 中记录的 "Bun.file() 可以读取 bunfs 虚拟路径" 原则**确实被上游采用**，但**实现方式不同**（上游用内存加载到 `@opentui/core` Audio，ellamaka 是写出真实文件给外部播放器）
- 迁移到 `TuiAttention` 后，bunfs 兼容问题**自动解决**，无需 ellamaka 手动处理
- ellamaka `tui-ellamaka.tsx` 现有 `afplay` + 真实文件路径的独立实现（line 70-80）需在迁移到 `TuiAttention` 后**废弃**

**参考资料**：
- `projects/ellamaka/docs/BRANDING.md` — ellamaka 品牌化定制总览
- `projects/ellamaka/docs/UPSTREAM-MERGE-LOG.md` — 历史上 5 次合并记录与策略
- `projects/ellamaka/docs/DESIGN.md` — ellamaka 设计文档
- `projects/ellamaka/docs/plans/done/20260507-chore-ellamaka-merge-upstream-opencode-v11439.md` — 上次合并 Plan（参考实施模式）

### Key Decisions

- **D-01**：`WOPAL_SPACE` flag 保留 backward-compat getter 在 `flag.ts`，**不迁移**到 RuntimeFlags
  - **理由**：`Flag.WOPAL_SPACE` 作为 `process.env.WOPAL_SPACE` 的同步 getter 在启动链中全程可用（yargs middleware → env var → config loading）。RuntimeFlags 是 Effect service layer，在 config 初始化时未就绪，迁移会导致时序断裂。本次合并不改动 WOPAL_SPACE 存储位置。

- **D-02**：接受上游删除 `packages/opencode/src/cli/cmd/tui/util/sound.ts`
  - **理由**：上游音效系统迁移到 `cli/cmd/tui/util/audio.ts` + `cli/cmd/tui/attention.ts`，通过 `@opentui/core` 的 `Audio.create()` + `Bun.file().bytes()` 自动兼容 bunfs 虚拟路径；ellamaka 之前在 `BRANDING.md §4.6.3` 的"通过 Bun.write 写出真实文件给外部播放器"方案已被上游新方案替代（无需写出真实文件）；`tui-ellamaka.tsx` 现有独立 `afplay` 实现需在 Task 6 迁移到 TuiAttention 时废弃
  - **事实更正**：之前在对话中称"ellamaka 的 bunfs 兼容改造原则已融入上游 attention 系统"是**对方向的猜测**——真实情况是上游采用完全不同的实现（内存加载到第三方 Audio 库），但**结论相同**（ellamaka 现有 sound.ts 改造无需保留）

- **D-03**：本次合并将 `tui-ellamaka.tsx` 的 notification 实现迁移到 `api.attention.notify`
  - **理由**：上游 v1.15.x 新增 `TuiAttention` API 提供 `notify({ message, sound, notification })`，统一管理通知 + 音效；`tui-ellamaka.tsx` 当前 home_logo / home_prompt_right / session_prompt_right 三个 slot 与 `api.attention` 可协同工作；保持 ellamaka 品牌化同时利用上游新基础设施；推迟会导致未来合并更复杂
  - **实现**：在 `tui-ellamaka.tsx` 的 `tui` 入口函数中调用 `api.attention.notify(...)` 替代现有自实现的 `home_logo` slot 中 notification 部分；保留品牌化的"ELLAMAKA"标签和 prompt_right slot；废弃独立的 afplay 音效调用

- **D-04**：在 `flow.sh approve --confirm` 时通过标准 worktree 流程创建隔离环境，验证通过后 `verify --confirm` 合并到 main
  - **理由**：dev-flow 流程契约要求实施在 worktree 中进行，验证通过后 `flow.sh verify --confirm` 推进到 `done` 状态；`feature/ellamaka-logo-branding` 和 `refactor/rename-to-ellamaka-v1.1.31` 分支的工作**不在本次合并范围**，不与本次混合
  - **实现**：worktree 路径 `.worktrees/ellamaka-chore-ellamaka-merge-upstream-opencode-v11513`，基线 `main`，merge target `main`

- **D-05**：扩展精简清单纳入 `packages/stats/`，但保留 `packages/llm/`、`packages/effect-drizzle-sqlite/`、`packages/http-recorder/`
  - **`packages/stats/` 精简理由**：anomalyco 监控面板（athena + honeycomb + Vercel），ellamaka 是 CLI 分发无云监控需求
  - **`packages/llm/` 保留理由**：v1.15.x 引入的独立 LLM 协议包，是后续 v2 session runtime 的核心依赖；精简会导致运行时错误
  - **`packages/effect-drizzle-sqlite/` 保留理由**：数据库 Effect 包装器，与新 `storage/db.ts` 配合（即便 ellamaka 暂未启用 v2 session，db.ts 仍引用此包）
  - **`packages/http-recorder/` 保留理由**：虽为独立测试录制工具，但 ellamaka 后续可能需要 LLM 录制回放测试，且精简风险大于收益
  - **更新位置**：`docs/BRANDING.md §0` 精简清单新增 `packages/stats/`

- **D-06**：保守精简策略——只精简明显与 ellamaka CLI 分发无关且不构成运行时依赖的目录
  - **保留运行时依赖链**：所有被 `packages/opencode/src/**` 实际 import 的新包都保留
  - **精简判定原则**：① 桌面/SaaS 客户端 ② 云端服务 ③ 仅品牌站点 ④ 上游发布脚本
  - **不可精简项警告**：`packages/llm/` 是 v2 session runtime 依赖，精简会导致 storage/db.ts 引入失败；`packages/effect-drizzle-sqlite/` 是数据库迁移工具，精简会导致 migration 失败

### Key Interfaces

**`RuntimeFlags.Info` 扩展**（v1.15.x 上游接口 + ellamaka 扩展）：

```ts
// packages/core/src/effect/runtime-flags.ts（上游 v1.15.13）
export const Info = Schema.Struct({
  // ... 上游现有字段
  disableAgentsSkills: Schema.Boolean,  // D-01：ellamaka 新增
  wopalSpace: Schema.Boolean,            // D-01：ellamaka 新增
})
```

**`TuiAttention` API**（上游 v1.15.13 plugin API）：

```ts
// packages/plugin/src/tui.ts（上游 v1.15.13）
export interface TuiAttention {
  notify(input: TuiAttentionNotifyInput): Promise<TuiAttentionNotifyResult>
  soundboard: TuiAttentionSoundboard
}
```

**`User-Agent` 派生函数**（上游 v1.15.13 installation/index.ts）：

```ts
// 上游已将 const USER_AGENT 改为函数
export function userAgent(client = "cli") {
  return `opencode/${InstallationChannel}/${InstallationVersion}/${client}`
}
// ellamaka 需将硬编码的 "opencode" 替换为 BINARY_NAME
```

## In Scope

- 合并上游 tag `v1.15.13`（v1.14.39 `6e7c9eb82` → v1.15.13 `74ce1a1edf`）
- 解决 **31 个内容冲突文件**（详见 Affected Files 表）
- 自动清理 **326 个 modify/delete 冲突**（精简清单内的目录）
- 扩展精简清单：`docs/BRANDING.md §0` 新增 `packages/stats/`
- 迁移 `tui-ellamaka.tsx` 的 notification 实现到 `api.attention.notify`，废弃独立 afplay 音效
- 适配 `cli/upgrade.ts` 的 `Bus.publish` → `GlobalBus.emit`
- 适配 `installation/index.ts` 的 Service 化重构（`AppProcess` 替代 `ChildProcessSpawner`、`EventV2` + `GlobalBus` 替代 `Bus.publish`、`userAgent()` 函数化）
- 适配 `config/config.ts` 的 Zod → Effect Schema 迁移（`serviceUse` 模式、`wellKnownRemoteConfig`）
- 适配 `skill/index.ts` 的 Schema 迁移 + RuntimeFlags 接入
- 适配 `db.ts` 的 RuntimeFlags 接入（`disableChannelDb`/`skipMigrations`）
- 适配 `permission/index.ts` 的 `PermissionV2` 拆分（`@opencode-ai/core/permission`）
- 适配 `tui/cmd/tui.ts`、`tui/config/tui.ts`（v1.15.x 新增结构）中的 wopal-space 注入
- 适配 `config/tui.ts`（v1.15.x 新增结构）中的 `tryLoadWopalSpaceTuiConfig`
- Plugin API 同步改造：
  - 审查 `wopal-plugin` 中 `ToolContext.ask` 调用并适配 Promise 化
  - 审查 `tui-ellamaka.tsx` 中 `home_prompt_right` slot 使用（已确认不使用 `workspace_id`）
- 13 项 ellamaka 定制全部保留（详见 Research Findings 表格）
- TDD 测试覆盖关键行为：
  - RuntimeFlags 接入（`disableAgentsSkills`、`wopalSpace`、`disableChannelDb`、`skipMigrations`）
  - channel 守卫（`InstallationChannel.startsWith("ellamaka")`）
  - USER_AGENT 品牌化（`ellamaka/<channel>/<version>/<client>`）
  - WOPAL_HOME 路径解析
  - TuiAttention notification 迁移后功能
- typecheck + test 验证
- 更新 `docs/UPSTREAM-MERGE-LOG.md` 新增 v1.15.13 条目
- 更新 `docs/BRANDING.md`：
  - §0 精简清单加入 `packages/stats/`
  - §4.6.3 删除 sound.ts 改造记录（上游已替代）
  - §4.6 新增 TuiAttention 适配说明
- 更新 `packages/ellamaka/branding.ts`（如需新增 TuiAttention 相关常量）

## Out of Scope

- 启用 v2 session runtime（`packages/llm/` + `v2/` 相关）——仅保留依赖，不激活
- v1.15.x 范围外的上游变更（v1.16.0-v1.16.2 的 V2 Session Runtime、Command Registry、Skill Registry、Scout Agent、Background Subagents、Diff Viewer、FFF Search Tools、File Tree、HTTP Recorder）——另开 Plan 合并
- Desktop 端变更（ellamaka 不打包桌面端）—— `packages/desktop/` 保持精简
- SaaS/Cloud 后台变更（enterprise、console、function、slack、zen 已删除）
- `feature/ellamaka-logo-branding` 和 `refactor/rename-to-ellamaka-v1.1.31` 分支的合入——另开 Plan
- `packages/llm/`/`packages/effect-drizzle-sqlite/`/`packages/http-recorder/` 的代码探索和启用——保留即满足本次范围
- 上游新增的 Go page / DeepSeek pricing 等产品页面变更
- 优化 TUI 插件的具体 UI 设计——保持现有 home_logo / home_prompt_right / session_prompt_right 三个 slot 不变
- 修改 `feature/ellamaka-logo-branding` 分支上的 TUI 插件设计改造——待合入 main 后另开 Plan

## Business Rules Impact

N/A — 无业务规则变更。本次合并是代码级同步，不引入新业务约束。

## Affected Files

### 内容冲突文件（31 个，需手动解决）

| Component | Files | Operation | ellamaka 定制 | 上游 v1.15.x 变更 | Risk |
|-----------|-------|-----------|--------------|-------------------|------|
| Installation | `packages/opencode/src/installation/index.ts` | 修改 | channel 守卫（line 209, 270）、`.wopal/bin` 检测（line 175）、`USER_AGENT = BINARY_NAME/...` | 全面重写：Service 化、`AppProcess`、`EventV2` + `GlobalBus`、`userAgent()` 函数化（235+/232-） | **高** |
| Config | `packages/opencode/src/config/config.ts` | 修改 | `tryLoadWopalSpaceConfig` 注入点、WOPAL_HOME、wopal-space 配置加载链 | Zod→Effect Schema、`serviceUse`、`wellKnownRemoteConfig`、`ConfigAttachment`/`ConfigReference`（164+/64-） | **高** |
| Skill | `packages/opencode/src/skill/index.ts` | 修改 | `OPENCODE_DISABLE_AGENTS_SKILLS` 守卫（commit `24f95f2040`）、`.agents` 独立技能目录、确定性 skill 加载 | Zod→Effect Schema、`RuntimeFlags` 接入、CUSTOMIZE_OPENCODE_SKILL 内置（92+/36-） | **高** |
| CLI run | `packages/opencode/src/cli/cmd/run.ts` | 修改 | `BINARY_NAME` 字符串替换 | 大幅重构：demo、footer、keymap、prompt、runtime、scrollback、splash、stream、subagent、theme、tool、trace、types、variant、permission、question、entry.body、session-replay、session-data、session.shared（512+/308-） | **高** |
| Session LLM | `packages/opencode/src/session/llm.ts` | 修改 | 1 处小改（plugin systemMetadata hook 增强） | session/llm 重构为 ai-sdk + native-runtime + request + native-request（165+/244-） | **高** |
| Flag | `packages/core/src/flag/flag.ts` | 修改 | `WOPAL_SPACE` flag | 清理 20+ flag 迁出到 RuntimeFlags（9+/54-） | **中** |
| CLI entry | `packages/opencode/src/index.ts` | 修改 | `BINARY_NAME`/`VERSION_PREFIX` 注入、wopal-space 检测、yargs `.scriptName(BINARY_NAME)` | 错误处理逻辑重排（11+/7-） | **中** |
| Upgrade guard | `packages/opencode/src/cli/upgrade.ts` | 修改 | channel 守卫（`startsWith("ellamaka")`） | `Bus.publish` → `GlobalBus.emit`、`Installation.Event` 改 `EventV2`（24+/4-） | **中** |
| Permission | `packages/opencode/src/permission/index.ts` | 修改 | 权限合并 | `PermissionV2` 拆分（`@opencode-ai/core/permission`）、location-based permission 引入（40+/52-） | **中** |
| CLI error | `packages/opencode/src/cli/error.ts` | 修改 | 3 处 BINARY_NAME 字符串替换 | 错误格式化逻辑扩展（65+/36-） | **中** |
| CLI logo | `packages/opencode/src/cli/logo.ts` | 修改 | ellamaka 定制字模（"ELLA"+"MAKA"） | 上游未变（v1.15.13 保留原 opencode 字模） | **中** |
| CLI network | `packages/opencode/src/cli/network.ts` | 修改 | 1 处 BINARY_NAME 改动 | 4 行变更 | **中** |
| CLI providers | `packages/opencode/src/cli/cmd/providers.ts` | 修改 | BINARY_NAME 字符串 | 5 行变更 | **中** |
| CLI debug | `packages/opencode/src/cli/cmd/debug/index.ts` | 修改 | BINARY_NAME 字符串 | 2 行变更 | **中** |
| CLI tui（新增） | `packages/opencode/src/cli/cmd/tui.ts` | 自动接受上游新增 | ellamaka 不存在 | 上游 v1.15.x 新增（commit `f8588a959f`、`106f8e94d6`）——`tui` 拆包入口 | **中** |
| Config tui（新增） | `packages/opencode/src/config/tui.ts` | 自动接受上游新增 | ellamaka 不存在 | 上游 v1.15.x 新增——tui config 加载新结构 | **中** |
| Tests | `packages/opencode/test/config/config.test.ts` | 修改 | ellamaka 配置行为测试 | 1412+/1917-（Zod→Effect Schema 测试同步） | 中 |
| Tests | `packages/opencode/test/config/tui.test.ts` | 修改 | TUI 配置测试 | 819+/610- | 中 |
| Tests | `packages/opencode/test/session/prompt.test.ts` | 修改 | session prompt 测试 | 1662+/1378- | 中 |
| Tests | `packages/opencode/test/skill/skill.test.ts` | 修改 | 技能测试 | 187 行变更 | 低 |
| Tests | `packages/opencode/test/plugin/trigger.test.ts` | 修改 | plugin trigger 测试 | 31 行变更 | 低 |
| CLI tui（新增） | `packages/opencode/src/cli/cmd/tui/app.tsx` | modify/delete | ellamaka 当前 TUI 入口 | 上游删除（重构为 `cli/cmd/tui.ts`） | 中 |
| CLI tui（删除） | `packages/opencode/src/cli/cmd/tui/util/sound.ts` | modify/delete | ellamaka 自有 sound.ts | 上游删除（迁移到 `attention.ts`） | 中 |
| CLI tui（删除） | `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | modify/delete | ellamaka 自有提示文案 | 上游删除 | 中 |
| bun.lock | `bun.lock` | 修改 | ellamaka 自有依赖 | 上游依赖升级（508+/580-） | 低 |
| package.json | `package.json`、`packages/core/package.json`、`packages/opencode/package.json` | 修改 | 依赖引用 | 上游版本升级 | 低 |
| turbo.json | `turbo.json` | 修改 | turbo 配置 | 4 行变更 | 低 |
| AGENTS | `AGENTS.md`、`packages/opencode/AGENTS.md` | 修改 | ellamaka 规范 | 上游规范演进 | 低 |
| README | `README.md` | 修改 | ellamaka README | 6 行变更 | 低 |
| 元数据 | `.github/TEAM_MEMBERS` | 修改 | ellamaka 团队成员 | 2 行变更 | 低 |
| 新增 | `packages/tui/src/component/error-component.tsx`、`packages/tui/src/theme/index.ts` | 自动接受上游新增 | ellamaka 不存在 | 上游 v1.15.x 提取 `tui` 包时新增 | 低 |

### modify/delete 冲突（326 个，自动 git rm）

按 `docs/BRANDING.md §0` 精简清单 + 扩展 `packages/stats/`：
- `.github/CODEOWNERS`、`ISSUE_TEMPLATE/`、`actions/`、`workflows/`（除 `publish-ellamaka.yml`）
- `script/`、`sdks/`、`specs/`、`infra/`、`nix/`、`.opencode/`
- `sst-env.d.ts`、`sst.config.ts`
- `packages/web/`（文档）、`packages/desktop/`、`packages/enterprise/`、`packages/console/`、`packages/function/`、`packages/containers/`、`packages/slack/`、`packages/zen/`、`packages/extensions/`、`packages/identity/`
- `packages/shared/`（已被 `packages/core/` 取代）
- `flake.nix`、`flake.lock`、`install`、`README.zh.md`、`SECURITY.md`
- **`packages/stats/`**（v1.15.x 新增，云监控，扩展清单）

### 保留的新增 packages（不精简）

- `packages/cli/`（v1.15.x 新增，CLI 引擎）
- `packages/docs/`（v1.15.x 新增，文档）
- `packages/llm/`（v1.15.x 新增，v2 session runtime 核心）
- `packages/effect-drizzle-sqlite/`（v1.15.x 新增，db.ts 依赖）
- `packages/http-recorder/`（v1.15.x 新增，LLM 录制回放）

### Plugin SDK 改造

- `packages/plugin/src/tool.ts`：`ask()` 返回类型 Effect → Promise（**不直接影响 ellamaka**，但需审查 `wopal-plugin` 中是否调用）
- `packages/plugin/src/tui.ts`：新增 `TuiAttention`、`TuiKeymap`、`TuiModeApi`、`TuiKeys` API
- `packages/plugin/src/index.ts`：`Hooks.dispose?` 新增

### TUI 插件（`.wopal/`）改造

- `.wopal/plugins/tui-ellamaka.tsx`：迁移 notification 到 `api.attention.notify`，废弃独立 afplay 音效实现
- `.wopal/plugins/ellamaka-theme.json`：保持不变
- `.wopal/plugins/session-notify.ts`：审查是否需要适配新 attention API

### 文档更新

- `docs/UPSTREAM-MERGE-LOG.md`：新增 v1.15.13 合并条目
- `docs/BRANDING.md`：
  - §0 精简清单加入 `packages/stats/`
  - §4.6.3 删除 sound.ts 改造记录（上游已替代）
  - §4.6 新增 TuiAttention 适配说明
  - §8 品牌注入模式表新增 RuntimeFlags service 模式
- `docs/DESIGN.md`：如有 RuntimeFlags 集成描述更新

## Conflict Resolution Strategy

> 以下是 5 个高风险冲突文件的逐文件解决策略。实施时按此策略执行，不可自由发挥。

### installation/index.ts（高风险）

**当前 ellamaka**：4 项定制嵌入在函数式代码中——
1. `USER_AGENT` = `${BINARY_NAME}/${InstallationChannel}/...`（line ~170）
2. `.wopal/bin` 检测：`process.execPath.includes(".wopal/bin")` 分支（line ~175）
3. `latest()` channel 守卫：`InstallationChannel.startsWith("ellamaka")` 直接返回当前版本（line ~209）
4. `upgrade()` channel 守卫：`startsWith("ellamaka")` 返回 `wopal ellamaka update` 错误提示（line ~270）

**v1.15.13 变化**：全面重写为 Service 模式——
- `AppProcess` service 替代 `ChildProcessSpawner`
- `EventV2` + `GlobalBus` 替代 `Bus.publish`
- `USER_AGENT` 改为 `userAgent()` 函数（接受 `client` 参数）
- `latest()` 和 `upgrade()` 仍在但接口可能变化

**解决策略**（接受上游 Service 结构，重新植入 4 项定制）：
1. 接受上游 v1.15.13 完整版本
2. `userAgent()` 函数中：将 `opencode/` 替换为 `${BINARY_NAME}/`（1 行改动）
3. 在 `method()` 函数中（v1.15.13 重构后）：恢复 `process.execPath.includes(".wopal/bin")` 分支（~5 行）
4. `latest()` 中：在函数开头加 `if (InstallationChannel.startsWith("ellamaka")) return Effect.succeed(currentVersion)`（~3 行）
5. `upgrade()` 中：同样前置守卫，错误信息改为 `wopal ellamaka update`（~5 行）
6. `Event` 定义：适配 `EventV2.define`（上游已处理，检查即可）

### config/config.ts（高风险）

**当前 ellamaka**：`tryLoadWopalSpaceConfig` 注入点位于 `loadInstanceState` 中特定行，wopal-space 模式调用后直接 return

**v1.15.13 变化**：Zod → Effect.Schema 迁移——
- `loadInstanceState` 改为 `Effect.fn` + `serviceUse` 模式
- `loadFile`/`loadConfig` 签名可能变化
- 新增 `wellKnownRemoteConfig`、`ConfigAttachment`/`ConfigReference`

**解决策略**（在 Effect 流程中找到正确的提前返回位置）：
1. 接受上游 v1.15.13 完整版本
2. 确认 `tryLoadWopalSpaceConfig` import 仍在（barrels 移除后可能需调整路径）
3. 在 `loadInstanceState` 内全局 config merge 之后、OPENCODE_CONFIG 加载之前，植入 wopal-space 早期返回：
   ```ts
   if (Flag.WOPAL_SPACE && ctx.worktree) {
     const wopalResult = yield* tryLoadWopalSpaceConfig(deps, ctx)
     if (wopalResult) return wopalResult
   }
   ```
4. 所有 opencode 加载路径（OPENCODE_CONFIG、project opencode.json[c]、.opencode/、OPENCODE_CONFIG_CONTENT、account/org、managed、MDM）在早期 return 之后，wopal-space 模式不会走到
5. `loadGlobal` 中：wopal-space 模式只加载 `settings.jsonc` 的 `ellamaka` 字段，不加载 `opencode.json[c]`

### skill/index.ts（高风险）

**当前 ellamaka**：3 项定制——
1. `OPENCODE_DISABLE_AGENTS_SKILLS` 运行时 flag 守卫（commit `24f95f2040`）
2. `.agents` 独立技能目录扫描
3. 确定性 skill 加载顺序

**v1.15.13 变化**：Zod → Effect.Schema 迁移、RuntimeFlags 接入、CUSTOMIZE_OPENCODE_SKILL 内置

**解决策略**（接受上游，保留定制）：
1. 接受上游 v1.15.13 完整版本
2. RuntimeFlags 已包含 `disableAgentsSkills`（上游 v1.15.13 自带），验证 `discoverSkills` 中 `disableAgentsSkills` 参数正确传递
3. 确认 `.agents` 目录扫描仍在 `externalDirs` 列表中（`AGENTS_EXTERNAL_DIR = ".agents"`）
4. wopal-space 模式守卫：在外部目录扫描块加 `!Flag.WOPAL_SPACE` 条件（`.claude/` 和 `.agents/` 技能不加载）
5. 确定性加载顺序：base/user 并发解析 + space overlay 按序覆盖，上游已支持此模式，验证即可

### cli/cmd/run.ts（高风险）

**当前 ellamaka**：BINARY_NAME 字符串替换（多处 describe/prompt 输出）

**v1.15.13 变化**：大幅重构——demo、footer、keymap、prompt 等子模块拆分

**解决策略**（接受上游重构，逐处替换 BINARY_NAME）：
1. 接受上游 v1.15.13 完整版本
2. `import { BINARY_NAME } from "../../../ellamaka/branding"` 
3. 全文搜索 `"opencode"` 硬编码字符串（describe、console.log、spawn 参数等），替换为 `${BINARY_NAME}` 或 `BINARY_NAME`
4. 不替换：npm 包名（`"opencode-ai"`）、URL（`opencode.ai`）、provider ID、数据库文件名

### session/llm.ts（高风险）

**当前 ellamaka**：1 处改动——plugin systemMetadata hook 增强

**v1.15.13 变化**：session/llm 重构为 ai-sdk + native-runtime + request + native-request

**解决策略**（接受上游新结构，找对应位置重新注入 hook）：
1. 接受上游 v1.15.13 完整版本
2. 找到上游 v1.15.13 中 plugin systemMetadata 调用位置（可能在 ai-sdk 或 native-runtime 路径中）
3. 如果新架构中不存在对应 hook 点：检查是否为上游已内建此功能，若没有则在 plugin context 初始化位置追加 ellamaka hook
4. 若上游 v1.15.13 已有等效功能：不重复添加

## Acceptance Criteria

### Agent Verification

1. [ ] 实际内容冲突文件数 ≤ 35（差异已记录）
2. [ ] 全部 31 个内容冲突文件无 conflict marker（`rg -c '^<<<<<<<\|^=======$\|^>>>>>>>$' packages/opencode/src packages/core/src` 返回 0）
3. [ ] 326 个 modify/delete 冲突全部按精简清单自动 `git rm`（`rg -c 'opencode-sfx\|opencode-sound\|packages/stats' packages/` 返回 0）
4. [ ] `flag.ts` 保留 `WOPAL_SPACE` backward-compat getter（`rg -c 'WOPAL_SPACE' packages/core/src/flag/flag.ts` ≥ 1）
5. [ ] `InstallationChannel.startsWith("ellamaka")` 守卫仍存在于 `installation/index.ts`、`cli/upgrade.ts`、`cli/cmd/upgrade.ts`（`rg -c 'startsWith."ellamaka"' packages/opencode/src/installation/index.ts packages/opencode/src/cli/upgrade.ts packages/opencode/src/cli/cmd/upgrade.ts` ≥ 3）
6. [ ] `USER_AGENT` 派生包含 `BINARY_NAME`（`rg -c 'BINARY_NAME' packages/opencode/src/installation/index.ts` ≥ 1）
7. [ ] `tui-ellamaka.tsx` 包含 `api.attention.notify` 调用（`rg -c 'attention\.notify' .wopal/plugins/tui-ellamaka.tsx` ≥ 1）
8. [ ] `tui-ellamaka.tsx` 不再使用 `afplay` 外部播放器（`rg -c 'afplay' .wopal/plugins/tui-ellamaka.tsx` 返回 0）
9. [ ] `BRANDING.md §0` 精简清单包含 `packages/stats/`（`rg -c 'packages/stats' docs/BRANDING.md` ≥ 1）
10. [ ] `UPSTREAM-MERGE-LOG.md` 包含 v1.15.13 合并条目（`rg -c 'v1.15.13' docs/UPSTREAM-MERGE-LOG.md` ≥ 1）
11. [ ] `bun typecheck` 通过（`cd packages/opencode && bun run typecheck` 退出码 0）
12. [ ] `bun test` 通过率 ≥ 90%
13. [ ] 关键 ellamaka 行为 TDD 测试全部通过：channel 守卫、USER_AGENT、WOPAL_HOME 路径、TuiAttention notification
14. [ ] 构建产物输出 `ellamaka/x.y.z` 格式（`./dist/ellamaka-darwin-*/bin/ellamaka --version` 匹配 `^ellamaka/`）
15. [ ] 13 项 ellamaka 定制全部保留（逐项行为验证，非仅 rg 字符串匹配）
16. [ ] 合并版本验证：`grep '"version"' packages/opencode/package.json` 输出 `"1.15.13"`
17. [ ] `scripts/dev.sh --debug -w` 启动后日志无 `.opencode/` 路径加载
18. [ ] `scripts/dev.sh --debug -w` 启动后日志无 `.claude/` `.agents/` 技能加载
19. [ ] `scripts/dev.sh --debug -w` 启动后日志无 `opencode.json` 或 `config.json` 文件加载
18. [ ] `session-notify.ts` 已审查并确认独立于 TUI attention API（server-side event hook + 系统 afplay，无需适配；`rg -c 'session\.idle\|Bun\.spawn.*afplay' .wopal/plugins/session-notify.ts` ≥ 2）
19. [ ] `wopal-plugin/src/` 中所有 `ToolContext.ask()` 调用已适配 Promise 化（`rg 'yield\*.*\.ask\(' .wopal/plugins/wopal-plugin/src/ 2>/dev/null` 返回空，含 `await .ask(` 则通过）

### User Validation

#### Scenario 1: ellamaka CLI 正常启动
- Goal: 合并后 ellamaka 二进制能正常启动并输出 ellamaka 品牌版本
- Precondition: worktree 中已完成 typecheck + 关键测试通过
- User Actions:
  1. `./scripts/build.sh --install` 构建并安装 ellamaka
  2. `ellamaka --version` 查看版本
  3. `ellamaka --help` 查看帮助
- Expected Result: 输出 `ellamaka/x.y.z`，帮助文本不含"opencode"字样

#### Scenario 2: wopal-space 模式自动检测
- Goal: wopal-space 配置仍能正确加载
- Precondition: 存在 `<space>/.wopal/config/settings.jsonc` 含 `"ellamaka"` 键
- User Actions:
  1. 在 wopal 空间目录下启动 `ellamaka`
  2. 观察日志中 wopal-space 加载信息
- Expected Result: 日志输出 wopal-space 加载信息，TUI 启动正常

#### Scenario 3: TUI 品牌插件渲染
- Goal: tui-ellamaka.tsx 的 home_logo / prompt_right slot 正常显示
- Precondition: 启用 wopal-space 模式 + tui-ellamaka 插件
- User Actions:
  1. 启动 ellamaka TUI
  2. 观察首页 logo 渲染
  3. 观察 prompt 输入框右侧 ELLAMAKA 标签
  4. 切换 session 观察 session prompt 标签
- Expected Result: 显示 "ELLA"+"MAKA" 自定义 logo，prompt 右侧显示 "ELLAMAKA" 标签和 session ID 截取

#### Scenario 4: TUI 通知迁移
- Goal: 验证 notification 迁移到 TuiAttention 后功能正常
- Precondition: TUI 启动，权限请求被触发
- User Actions:
  1. 启动 ellamaka TUI
  2. 触发权限请求（运行命令前需确认）
  3. 等待通知出现
- Expected Result: 通知以 TuiAttention 方式呈现（可能含音效），无错误日志

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: 预演合并 + 冲突文件清单核实

**Verification Intent**: AC#1, AC#2, AC#3, AC#17

**Behavior**: 工作树处于合并状态，31 个内容冲突文件已识别，326 个 modify/delete 冲突已记录

**Files**: 全部（checkpoint — 全局预演任务，非文件级变更）

**Pre-read**:
- `docs/BRANDING.md` §0 精简清单
- `docs/UPSTREAM-MERGE-LOG.md` 上次合并记录

**Design**:
1. 在 worktree 中执行 `git fetch upstream`
2. 执行 `git merge v1.15.13 --no-commit --no-ff` 预演合并（**锁定 tag，非 upstream/dev**）
 3. **验证版本**：`grep '"version"' packages/opencode/package.json` 确认输出 `"1.15.13"`
3. 提取所有冲突文件列表，按"内容冲突 / modify/delete / auto-merged"分类
4. 对比方案预期（31 + 326），记录差异
5. 自动 `git rm` 精简清单内所有 modify/delete 冲突文件
6. 扩展 `DELETED_PREFIXES` 包含 `packages/stats/`
7. 验证 `.worktrees/ellamaka-chore-ellamaka-merge-upstream-opencode-v11513/` 路径存在

**TDD**: false — 预演任务，无代码变更

**Changes**:
 1. `git fetch upstream --tags` 拉取上游标签
 2. `git merge v1.15.13 --no-commit --no-ff` 预演合并（**锁定 tag**）
 3. **验证版本**：`grep '"version"' packages/opencode/package.json` 确认 `"1.15.13"`
 4. 提取冲突文件列表：`git diff --name-only --diff-filter=U > /tmp/conflicts.txt`
4. 分类：内容冲突（base+head+upstream 都有版本）vs modify/delete（base 不存在或 head 不存在）
5. 扩展精简清单并自动 `git rm`：`xargs git rm` 命中 `DELETED_PREFIXES` 的 modify/delete 文件
6. `bun install` 更新依赖（如 bun.lock 冲突可暂存）

**Verify**:
- `wc -l /tmp/conflicts.txt` 输出 357（±10）
- `git diff --name-only --diff-filter=U | xargs -I {} sh -c 'git show :1:{} >/dev/null 2>&1 && git show :2:{} >/dev/null 2>&1 && git show :3:{} >/dev/null 2>&1 && echo {}' | wc -l` 输出 31（±5）
- `git ls-files packages/stats/ | wc -l | xargs -I{} test {} -eq 0`（stats 文件已从索引移除）

**Done**:
任务产出：worktree 已创建，合并预演完成，冲突文件清单已分类记录
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 2: 解决 core 层冲突（flag.ts + global.ts）

**Verification Intent**: AC#2, AC#3

**Behavior**: `flag.ts` 保留 `WOPAL_SPACE` backward-compat getter；`global.ts` 的 `repos` 路径追加保留 ellamaka 现有 `WOPAL_HOME` 路径系统

**Files**: 
- `packages/core/src/flag/flag.ts`
- `packages/core/src/global.ts`

**Pre-read**:
- `docs/BRANDING.md §2` 核心品牌常量

**Design**:
- `flag.ts`：保留 ellamaka 添加的 `WOPAL_SPACE` backward-compat getter（`get WOPAL_SPACE() { return truthy("WOPAL_SPACE") }`），接受上游其他 flag 变更
- `global.ts`：接受上游版本，保留 ellamaka 已有 WOPAL_HOME 路径系统（`WOPAL_HOME` env → `~/.wopal/` 默认值 + `repos` 路径追加）
- **不迁移** WOPAL_SPACE 到 RuntimeFlags（D-01）

**TDD**: true

**Changes**:
1. **RED**：编写 `test/core/flag.test.ts` 测试 `Flag.WOPAL_SPACE` getter 存在且工作
2. **GREEN**：接受 `flag.ts` 上游版本，手动保留 `WOPAL_SPACE` getter（1 个 getter，~5 行）
3. **GREEN**：接受 `global.ts` 上游版本，手动保留 WOPAL_HOME 路径系统（~15 行）
4. **REFACTOR**：验证 `Flag.WOPAL_SPACE` 在 `wopal-space.ts:74`、`config.ts`、`paths.ts`、`skill/index.ts` 中正常工作

**Verify**:
- `bun test packages/core/test/effect/runtime-flags.test.ts --timeout 30000` 通过
- `rg -c 'WOPAL_SPACE' packages/core/src/flag/flag.ts` ≥ 1
- `rg -c 'repos' packages/core/src/global.ts` ≥ 1

**Done**:
任务产出：`flag.ts` 保留 `WOPAL_SPACE` getter，`global.ts` 保留 WOPAL_HOME 路径系统
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 3: 解决 storage / installation 冲突（含 RuntimeFlags 接入）

**Verification Intent**: AC#6, AC#7

**Behavior**: `db.ts` 通过 `RuntimeFlags.disableChannelDb`/`skipMigrations` 控制；`installation/index.ts` 在新 Service 结构中保留 channel 守卫、`.wopal/bin` 检测、`USER_AGENT` 品牌化；`cli/upgrade.ts` 适配 `GlobalBus.emit`

**Files**:
- `packages/opencode/src/storage/db.ts`
- `packages/opencode/src/installation/index.ts`
- `packages/opencode/src/cli/upgrade.ts`
- `packages/opencode/src/cli/cmd/upgrade.ts`

**Pre-read**:
- `packages/opencode/src/installation/index.ts`（v1.15.13 上游版本，commit `618dca9de4` 之前）
- `packages/opencode/src/effect/runtime-flags.ts`（已扩展）
- `docs/BRANDING.md §4.8` 自动更新与 channel 守卫

**Design**:
- `storage/db.ts`：
  - 接受上游版本（已用 `RuntimeFlags` 替代 `Flag.OPENCODE_DISABLE_CHANNEL_DB` 和 `Flag.OPENCODE_SKIP_MIGRATIONS`）
  - 验证 `getChannelPath(flags)` 正确读取 `flags.disableChannelDb`
- `installation/index.ts`（高风险，Wopal 亲自）：
  - 在新 Service 结构中重新集成 4 项定制：
    1. `USER_AGENT`：将 `userAgent()` 函数改写为使用 `BINARY_NAME`
    2. `.wopal/bin` 检测：在 `method()` 函数（v1.15.13 已重构）中保留 `process.execPath.includes(path.join(".wopal", "bin"))` 分支
    3. channel 守卫 `latest()`：在 `InstallationChannel.startsWith("ellamaka")` 时直接返回当前版本
    4. channel 守卫 `upgrade()`：在 `startsWith("ellamaka")` 时返回带 `wopal ellamaka update` 错误信息
  - `Event` 定义已从 `BusEvent.define` 改为 `EventV2.define`，适配新 API
- `cli/upgrade.ts`：
  - 接受上游版本（已用 `GlobalBus.emit` 替代 `Bus.publish`）
  - 保留 ellamaka channel 守卫 `if (InstallationChannel.startsWith("ellamaka")) return`
- `cli/cmd/upgrade.ts`：
  - 接受上游版本，保留 channel 守卫和 `wopal ellamaka update` 提示

**TDD**: true

**Changes**:
1. **RED**：编写 `test/storage/db.test.ts` 测试 `getChannelPath` 在 `disableChannelDb=true/false` 下的行为
2. **RED**：编写 `test/installation/installation.test.ts` 测试 channel 守卫触发条件和 USER_AGENT 品牌化
3. **GREEN**：接受 `db.ts` 上游版本，验证 RuntimeFlags 接入
4. **GREEN**：在 `installation/index.ts` 新 Service 中集成 4 项定制
5. **GREEN**：接受 `cli/upgrade.ts` 上游版本，保留 channel 守卫
6. **GREEN**：接受 `cli/cmd/upgrade.ts` 上游版本，保留 channel 守卫
7. **REFACTOR**：抽取 `userAgentWithBrand()` 辅助函数，统一 ellamaka 品牌化

**Verify**:
- `bun test packages/opencode/test/storage/db.test.ts packages/opencode/test/installation/installation.test.ts --timeout 30000` 全部通过
- `rg -c 'startsWith..ellamaka' packages/opencode/src/installation/index.ts` ≥ 2
- `rg -c 'BINARY_NAME' packages/opencode/src/installation/index.ts` ≥ 1
- `rg -c '.wopal..bin' packages/opencode/src/installation/index.ts` ≥ 1
- `rg -c 'startsWith..ellamaka' packages/opencode/src/cli/upgrade.ts` ≥ 1

**Done**:
任务产出：`storage/db.ts`、`installation/index.ts`、`cli/upgrade.ts`、`cli/cmd/upgrade.ts` 全部解决，4 项 installation 定制重新集成到新 Service 结构
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 4: 解决 config / skill / permission 冲突

**Verification Intent**: AC#4（skill 部分）

**Behavior**: `config.ts` 在新 Schema 模式中保留 `tryLoadWopalSpaceConfig` 注入点；`skill/index.ts` 通过 `RuntimeFlags.disableAgentsSkills` 控制；`permission/index.ts` 适配 `PermissionV2` 拆分

**Files**:
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/skill/index.ts`
- `packages/opencode/src/permission/index.ts`
- `packages/opencode/src/bus/bus-event.ts`（自动合并）

**Pre-read**:
- `packages/opencode/src/config/wopal-space.ts`（ellamaka 自有，不动）
- `packages/opencode/src/skill/discovery.ts`（v1.15.13 新增）
- `@opencode-ai/core/permission`（v1.15.13 拆分）

**Design**:
- `config/config.ts`（高风险，Wopal 亲自）：
  - 接受上游版本（Zod→Effect Schema 已迁移）
  - 验证 `tryLoadWopalSpaceConfig` 注入点仍存在并在新 Schema 模式下工作
  - 检查 ellamaka 的 `wopal-space.ts` import 路径适配（barrels 移除后）
- `skill/index.ts`（高风险，Wopal 亲自）：
  - 接受上游版本（Zod→Effect Schema 已迁移）
  - 将运行时 `Flag.OPENCODE_DISABLE_AGENTS_SKILLS` 读取改为 `RuntimeFlags.Service.useSync((f) => f.disableAgentsSkills)`
  - 保留 ellamaka 的 `.agents` 独立技能目录扫描逻辑
  - 保留确定性 skill 加载顺序
- `permission/index.ts`（中风险，可委派）：
  - 接受上游版本（`PermissionV2` 已拆分到 `@opencode-ai/core/permission`）
  - 验证 location-based permission 不破坏 ellamaka 权限合并逻辑

**TDD**: true

**Changes**:
1. **RED**：编写 `test/skill/discovery.test.ts` 测试 `disableAgentsSkills=true/false` 下技能目录扫描
2. **RED**：编写 `test/permission/next.test.ts` 测试权限合并
3. **GREEN**：接受 `config.ts` 上游版本
4. **GREEN**：接受 `skill/index.ts` 上游版本，替换 `Flag` 读取为 `RuntimeFlags` 读取
5. **GREEN**：接受 `permission/index.ts` 上游版本
6. **REFACTOR**：将 `tryLoadWopalSpaceConfig` 与上游 `loadConfig` 适配

**Verify**:
- `bun test packages/opencode/test/skill/discovery.test.ts packages/opencode/test/permission/next.test.ts --timeout 30000` 全部通过
- `rg -c 'tryLoadWopalSpaceConfig' packages/opencode/src/config/config.ts` ≥ 1
- `rg -c 'disableAgentsSkills' packages/opencode/src/skill/index.ts` ≥ 1
- `rg -c '.agents' packages/opencode/src/skill/index.ts` ≥ 1（独立技能目录）
- `rg -c 'RuntimeFlags' packages/opencode/src/skill/index.ts` ≥ 1

**Done**:
任务产出：`config.ts`、`skill/index.ts`、`permission/index.ts` 全部解决，wopal-space 注入点保留，skill 迁移到 RuntimeFlags 读取
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 5: 解决 CLI / TUI 冲突

**Verification Intent**: AC#7（部分））

**Behavior**: 12 个 CLI cmd 文件的 BINARY_NAME 字符串保留；`index.ts` 的 BINARY_NAME/VERSION_PREFIX 注入和 wopal-space 检测保留；`logo.ts` 自有字模保留；`error-component.tsx` 错误上报 URL 品牌化保留；`tui.ts`、`config/tui.ts` 上游新增结构中适配 wopal-space 注入；`session/llm.ts` 的 plugin systemMetadata hook 增强保留

**Files**:
- `packages/opencode/src/index.ts`
- `packages/opencode/src/cli/logo.ts`
- `packages/opencode/src/cli/ui.ts`
- `packages/opencode/src/cli/error.ts`
- `packages/opencode/src/cli/network.ts`
- `packages/opencode/src/cli/cmd/{debug/index,providers,run,upgrade,uninstall,web,tui/thread,serve,tui/attach,pr,mcp}.ts`
- `packages/opencode/src/cli/cmd/tui.ts`（v1.15.13 新增，wopal-space 注入）
- `packages/opencode/src/config/tui.ts`（v1.15.13 新增，wopal-space 注入）
- `packages/opencode/src/cli/cmd/tui/component/error-component.tsx`
- `packages/opencode/src/cli/cmd/tui/config/tui.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/cli/cmd/tui/app.tsx`（modify/delete）

**Pre-read**:
- `packages/ellamaka/branding.ts`（5 个常量）
- `packages/ellamaka/logo.ts`（wordmark 数据）
- `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`（ellamaka 自有）
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`（ellamaka 自有，modify/delete）

**Design**:
- `index.ts`：接受上游版本（错误处理重排），保留 `import { BINARY_NAME, VERSION_PREFIX } from "../../ellamaka/branding"`，适配 `.version(\`${VERSION_PREFIX}/${InstallationVersion}\`)` 和 `.scriptName(BINARY_NAME)` 在重排后位置
- `logo.ts`：接受上游版本但**保留 ellamaka 字模**（手动编辑字模数据）
- `ui.ts`：接受上游版本，保留 `import { wordmark } from "../../ellamaka/logo"`，适配 wordmark 在新 UI 函数中的位置
- 12 个 CLI cmd 文件：分别接受上游版本，**保留 BINARY_NAME 字符串替换**（手动编辑每个文件）
- `error.ts`：接受上游版本，保留 3 处 BINARY_NAME 字符串替换
- `tui.ts`（新增）：在 v1.15.13 新结构中重新植入 ellamaka 现有 `tryLoadWopalSpaceTuiConfig` 注入点
- `config/tui.ts`（新增）：在 v1.15.13 新结构中重新植入 wopal-space 配置加载
- `error-component.tsx`：在 v1.15.13 新结构中重新植入 `BINARY_NAME` import + `wopal-cn/ellamaka` 错误上报 URL
- `tui/config/tui.ts` 和 `tui/plugin/runtime.ts`：在 v1.15.13 新结构中适配 wopal-space 注入
- `session/llm.ts`：接受上游版本（session/llm 重构为 ai-sdk + native-runtime + request），保留 1 处 plugin systemMetadata hook 增强

**TDD**: true

**Changes**:
1. **RED**：编写 `test/cli/help/help-snapshots.test.ts` 确保 CLI help 不含 "opencode" 字样
2. **RED**：编写 `test/cli/error.test.ts` 测试 MCP 错误、model 错误信息含 BINARY_NAME
3. **GREEN**：接受 `index.ts` 上游版本，保留 BINARY_NAME/VERSION_PREFIX 注入
4. **GREEN**：接受 `logo.ts` 上游版本，**手动替换字模数据为 ellamaka 版本**
5. **GREEN**：接受 `ui.ts` 上游版本，保留 wordmark 注入
6. **GREEN**：接受 12 个 CLI cmd 文件上游版本，**每个文件保留 BINARY_NAME 字符串替换**
7. **GREEN**：接受 `error.ts` 上游版本，保留 3 处 BINARY_NAME 字符串
8. **GREEN**：接受 `tui.ts` 新增版本，植入 wopal-space TUI 配置加载
9. **GREEN**：接受 `config/tui.ts` 新增版本，植入 wopal-space 注入
10. **GREEN**：接受 `error-component.tsx` 新增版本，植入 BINARY_NAME 和错误上报 URL
11. **REFACTOR**：抽取 `binaryNameOrFallback()` 辅助函数
12. **GREEN**：接受 `session/llm.ts` 上游版本，保留 plugin systemMetadata hook 增强（1 行改动）

**Verify**:
- `bun test packages/opencode/test/cli/help/help-snapshots.test.ts packages/opencode/test/cli/error.test.ts --timeout 30000` 全部通过
- `rg -c 'BINARY_NAME' packages/opencode/src/index.ts` ≥ 1
- `rg -c 'VERSION_PREFIX' packages/opencode/src/index.ts` ≥ 1
- `rg -c 'BINARY_NAME' packages/opencode/src/cli/cmd/{upgrade,uninstall,web,tui/thread,serve,run,tui/attach,pr,providers,mcp,debug/index}.ts` 总和 ≥ 12
- `rg -c 'BINARY_NAME' packages/opencode/src/cli/error.ts` ≥ 3
- `rg -c 'ellamaka' packages/opencode/src/cli/logo.ts` ≥ 1（字模数据）
- `rg -c 'wopal-cn/ellamaka' packages/opencode/src/cli/cmd/tui/component/error-component.tsx` ≥ 1
- `rg -c 'tryLoadWopalSpaceTuiConfig\|wopal-space' packages/opencode/src/cli/cmd/tui.ts packages/opencode/src/config/tui.ts` ≥ 2
- `rg -c 'systemMetadata\|plugin.*hook' packages/opencode/src/session/llm.ts` ≥ 1

**Done**:
任务产出：12 个 CLI cmd 文件 + index.ts + logo.ts + ui.ts + error.ts + tui.ts + config/tui.ts + error-component.tsx 全部解决，13 项 ellamaka 定制全部保留
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 6: 插件同步改造（tui-ellamaka.tsx + wopal-plugin）

**Verification Intent**: AC#8, AC#9, AC#18, AC#19

**Behavior**: `tui-ellamaka.tsx` 的 notification 实现迁移到 `api.attention.notify`；独立 afplay 音效废弃；`wopal-plugin` 中 `ToolContext.ask` 调用适配 Promise 化

**Files**:
- `.wopal/plugins/tui-ellamaka.tsx`
- `.wopal/plugins/session-notify.ts`
- `.wopal/plugins/wopal-plugin/src/**`（审查 ask() 调用）

**Pre-read**:
- `packages/plugin/src/tool.ts`（v1.15.13 工具上下文 ask 改为 Promise）
- `packages/plugin/src/tui.ts`（v1.15.13 TuiAttention API）

**Design**:
- `tui-ellamaka.tsx`：
  - 审查现有 `home_logo`、`home_prompt_right`、`session_prompt_right` slot
  - 在 `tui(api, options)` 入口函数中：
    - 删除独立的 `soundStart`/`soundStop`/`afplay` 调用
    - 调用 `api.attention.notify({ message: ..., sound: true })` 替代
  - 保留 home_logo 块字符画 + home_prompt_right 标签
  - 保留 session_prompt_right 标签 + session_id 截取
- `wopal-plugin`：审查 src/ 中是否有 `.ask(...)` 调用并改为 `await ...`
- `session-notify.ts`：无需适配——该文件使用 server-side `event` hook 监听 `session.idle` 事件，通过系统级 `afplay`（macOS 内置）播放音效，不依赖上游 TUI 层的 `sound.ts` 或 `TuiAttention` API，代码无需修改

**TDD**: false — 视觉效果迁移靠 User Validation 验收；`wopal-plugin`/`session-notify.ts` 代码适配部分在下文 Changes 中标注，由 Task Verify 用 `rg` 命令验证

**Changes**:
1. 审查 `tui-ellamaka.tsx` 现有音效实现（line 70-80）并记录
2. 在 `tui()` 入口函数中调用 `api.attention.notify` 替代独立音效
3. 删除 `soundStart`/`soundStop` 函数和 `afplay` 引用
4. 保留 `home_logo`、`home_prompt_right`、`session_prompt_right` 三个 slot
5. 审查 `wopal-plugin/src/` 中 `ask()` 调用并适配 Promise 化
6. 审查 `session-notify.ts`，确认无需适配（server-side event hook + 系统 afplay 不依赖上游 TUI API）

**Verify**:
- `rg -c 'api\.attention\.notify' .wopal/plugins/tui-ellamaka.tsx` ≥ 1
- `rg -c 'afplay' .wopal/plugins/tui-ellamaka.tsx` 返回 0
- `rg 'yield\*.*\.ask\(' .wopal/plugins/wopal-plugin/src/ 2>/dev/null` 返回空（无 Effect-style ask() 残留——旧 Effect 模式含 `yield*`，Promise 适配后改用 `await`）
- `rg -c 'session\.idle\|Bun\.spawn.*afplay' .wopal/plugins/session-notify.ts` ≥ 2（核心模式未变，无需适配）

**Done**:
任务产出：`tui-ellamaka.tsx` 迁移到 `api.attention.notify`，独立 afplay 音效废弃
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 7: 接受 12 个低风险冲突文件

**Verification Intent**: AC#1, AC#2

**Behavior**: 测试文件、配置文件、AGENTS.md、README.md 接受上游版本，ellamaka 已有演进被吸收

**Files**:
- `bun.lock`、`package.json`、`packages/core/package.json`、`packages/opencode/package.json`
- `turbo.json`、`.github/TEAM_MEMBERS`
- `AGENTS.md`、`packages/opencode/AGENTS.md`、`README.md`
- `packages/opencode/test/config/config.test.ts`、`packages/opencode/test/config/tui.test.ts`、`packages/opencode/test/session/prompt.test.ts`、`packages/opencode/test/skill/skill.test.ts`、`packages/opencode/test/plugin/trigger.test.ts`
- `packages/tui/src/component/error-component.tsx`、`packages/tui/src/theme/index.ts`（v1.15.13 新增，自动接受）
- `packages/opencode/src/cli/cmd/tui/app.tsx`
- `packages/opencode/src/cli/cmd/tui/util/sound.ts`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`

**Pre-read**:
- 上次合并 Plan `20260507-chore-ellamaka-merge-upstream-opencode-v11439.md` 了解 ellamaka 哪些测试已演进

**Design**:
- `bun.lock`：接受上游版本（如 ellamaka 引入 `WOPAL_SPACE` 相关的 `process.env` 读取可保留）
- `package.json`：接受上游版本
- 测试文件：接受上游版本（Zod→Effect Schema 测试同步），验证 ellamaka 关键行为测试不丢失
- `AGENTS.md`、`README.md`：接受上游版本（ellamaka 已有演进被吸收）
- 配置文件：接受上游版本

**TDD**: false — 配置/测试同步任务

**Changes**:
1. 接受 `bun.lock` 上游版本
2. 接受 `package.json` 三个版本
3. 接受 `turbo.json` 上游版本
4. 接受 `.github/TEAM_MEMBERS` 上游版本
5. 接受 `AGENTS.md` 两个版本
6. 接受 `README.md` 上游版本
7. 接受 5 个测试文件上游版本
8. 接受 2 个 v1.15.13 新增文件（`packages/tui/src/...`）
9. 接受 `packages/opencode/src/cli/cmd/tui/app.tsx` modify/delete（**保留 ellamaka HEAD 版本**，与 Task 5 一致——Task 5 将此文件纳入 CLI/TUI 改造范围，Task 7 仅执行保留操作不重复处理）
10. 接受 `packages/opencode/src/cli/cmd/tui/util/sound.ts` modify/delete（**接受上游删除**，D-02 决定此文件无需保留——上游音效已迁移到 `attention.ts` + `@opentui/core` Audio）
11. 接受 `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` modify/delete（保留 ellamaka HEAD 版本）

**Verify**:
- 所有 12 个文件无 conflict marker
- `rg -c '^<<<<<<<\|^=======$\|^>>>>>>>$' bun.lock package.json packages/core/package.json packages/opencode/package.json turbo.json .github/TEAM_MEMBERS AGENTS.md packages/opencode/AGENTS.md README.md packages/opencode/test/config/config.test.ts packages/opencode/test/config/tui.test.ts packages/opencode/test/session/prompt.test.ts packages/opencode/test/skill/skill.test.ts packages/opencode/test/plugin/trigger.test.ts packages/tui/src/component/error-component.tsx packages/tui/src/theme/index.ts` 返回 0

**Done**:
任务产出：12 个低风险冲突文件全部接受上游版本或保留 ellamaka HEAD 版本
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 8: 类型检查（必须先于测试）

**Verification Intent**: AC#12

**Behavior**: typecheck 通过，零类型错误

**Files**: 全部（checkpoint — 全局验证任务）

**Pre-read**:
- `packages/core/src/effect/runtime-flags.ts`（已扩展）
- `packages/opencode/src/installation/index.ts`（已重写）

**Design**:
- 在 `packages/opencode` 目录运行 `bun run typecheck`
- 修复类型错误（预期：import 路径调整、类型推断、RuntimeFlags service Layer 依赖）
- 重复 typecheck 直到通过

**TDD**: false — 验证任务

**Changes**:
1. `cd packages/opencode && bun run typecheck` 类型检查
2. 修复类型错误（如有）
3. 记录修复内容

**Verify**:
- `cd packages/opencode && bun run typecheck` 退出码 0

**Done**:
任务产出：typecheck 通过
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 9: 测试回归验证

**Verification Intent**: AC#13, AC#14

**Behavior**: test 通过率 ≥ 90%（v1.14.39 基线 2357 pass / 25 fail）

**Files**: 全部（checkpoint — 全局验证任务）

**Pre-read**:
- `docs/UPSTREAM-MERGE-LOG.md` v1.14.39 合并条目了解基线

**Design**:
- 在 `packages/opencode` 目录运行 `bun test --timeout 30000`
- 统计 pass/fail 数
- 对比基线
- 修复超出基线的额外失败

**TDD**: false — 验证任务

**Changes**:
1. `cd packages/opencode && bun test --timeout 30000 2>&1 | tee /tmp/test-v11513.log` 运行测试并保存完整日志
2. 从日志尾部摘要行提取 pass/fail 数，计算通过率 `pass/(pass+fail)` ≥ 0.9
3. `grep -oP 'FAIL\s+\K[^\s]+\.test\.ts' /tmp/test-v11513.log | sort > /tmp/test-v11513-failures.txt` 提取失败文件列表
4. 对比 v1.14.39 基线（25 fail，记录于 `docs/UPSTREAM-MERGE-LOG.md`），确认无新增异常失败

**Verify**:
- `grep -oP '\d+(?= pass)|\d+(?<=pass )\d+(?= fail)|(?<=fail )\d+' /tmp/test-v11513.log | tail -3` 提取 pass/fail/total，手动计算 `pass/(pass+fail) ≥ 0.9`
- `grep -oP 'FAIL\s+\K[^\s]+\.test\.ts' /tmp/test-v11513.log | sort > /tmp/test-v11513-failures.txt` 失败文件列表已生成
- Manual: 失败文件列表与 v1.14.39 基线对比无新增异常项（已知：网络超时测试、E2E 外部服务测试）

**Done**:
任务产出：test 通过率符合基线
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 10: 构建验证

**Verification Intent**: AC#15

**Behavior**: `ellamaka` 二进制构建成功，输出 `ellamaka/x.y.z` 格式

**Files**: 全部（checkpoint — 全局验证任务）

**Pre-read**:
- `scripts/build.sh`

**Design**:
- 在 worktree 根目录运行 `./scripts/build.sh --install`
- 验证 ellamaka 二进制可启动
- 输出 `ellamaka/x.y.z` 格式

**TDD**: false — 验证任务

**Changes**:
1. `./scripts/build.sh --install` 构建并安装
2. `ellamaka --version` 验证
3. `ellamaka --help | head -5` 验证 help 输出

**Verify**:
- `./dist/ellamaka-darwin-*/bin/ellamaka --version` 输出 `^ellamaka/[0-9]`
- `ellamaka --help | head -5` 不含 "opencode" 字样
- `ellamaka --help | rg -c 'opencode'` 返回 0（全文校验）

**Done**:
任务产出：ellamaka 二进制构建成功并验证
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 11: 更新合并记录

**Verification Intent**: AC#10, AC#11

**Behavior**: `UPSTREAM-MERGE-LOG.md` 和 `BRANDING.md` 反映本次合并

**Files**:
- `docs/UPSTREAM-MERGE-LOG.md`
- `docs/BRANDING.md`

**Pre-read**:
- `docs/UPSTREAM-MERGE-LOG.md` 上次合并条目格式

**Design**:
- `UPSTREAM-MERGE-LOG.md`：新增 v1.15.13 合并条目（日期、commit、上游范围、冲突策略、验证结果）
- `BRANDING.md`：
  - §0 精简清单加入 `packages/stats/`
  - §4.6.3 删除 sound.ts 改造记录（上游已替代）
  - §4.6 新增 TuiAttention 适配说明
  - §8 品牌注入模式表新增 RuntimeFlags service 模式

**TDD**: false — 文档任务

**Changes**:
1. 在 `UPSTREAM-MERGE-LOG.md` 新增 v1.15.13 合并条目
2. 更新 `BRANDING.md §0` 精简清单
3. 更新 `BRANDING.md §4.6.3` 删除 sound.ts 改造记录
4. 更新 `BRANDING.md §4.6` 新增 TuiAttention 适配
5. 更新 `BRANDING.md §8` 品牌注入模式表

**Verify**:
- `rg -c 'v1.15.13' docs/UPSTREAM-MERGE-LOG.md` ≥ 1
- `rg -c 'packages/stats' docs/BRANDING.md` ≥ 1
- `rg -c 'TuiAttention' docs/BRANDING.md` ≥ 1
- `rg -c 'RuntimeFlags' docs/BRANDING.md` ≥ 1

**Done**:
任务产出：`UPSTREAM-MERGE-LOG.md` 和 `BRANDING.md` 更新
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 12: 提交合并

**Verification Intent**: AC#17

**Behavior**: 合并 commit 提交到 worktree 分支

**Files**: 全部（checkpoint — 收尾任务）

**Pre-read**:
- `AGENTS.md` 提交格式规范

**Design**:
- 检查 git 状态
- 暂存所有文件
- 使用提交格式 `chore(ellamaka): merge upstream opencode v1.15.13`
- 提交

**TDD**: false — 收尾任务

**Changes**:
1. `git status` 检查
2. `git add .` 暂存
3. `git commit -m "chore(ellamaka): merge upstream opencode v1.15.13"` 提交
4. 验证 commit 成功

**Verify**:
- `git log --oneline -1` 输出 `chore(ellamaka): merge upstream opencode v1.15.13`
- `git status` 输出 "nothing to commit, working tree clean"

**Done**:
任务产出：合并 commit 提交成功
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1: 预演合并 | **Wopal** | 无 | 涉及 flow.sh 状态管理、冲突预演、worktree 创建 |
| 2 | Task 2: core 层冲突 | **Wopal** | Task 1 | 涉及 RuntimeFlags service 扩展（核心架构决策） |
| 3 | Task 3: storage/installation | **Wopal** | Task 2 | 高风险，5 项 ellamaka 定制重新集成 |
| 4 | Task 4: config/skill/permission | **Wopal** | Task 2 | 高风险，wopal-space 注入点 + skill 守卫迁移 |
| 5 | Task 5: CLI/TUI | **Wopal** | Tasks 3, 4 | 涉及 12+ 文件 BINARY_NAME 字符串保留，跨多个 cmd 文件需统一协调 |
| 6 | Task 6: 插件同步 | **Wopal** | Task 5 | TuiAttention 迁移是 ellamaka 特有改造 |
| 7 | Task 7: 12 个低风险文件 | **fae** | Tasks 3, 4, 5 | 机械性接受上游版本 |
| 8 | Task 8: typecheck | **Wopal** | Task 7 | typecheck 失败需 Wopal 协调 |
| 9 | Task 9: 测试回归 | **fae** | Task 8 | 测试运行和统计 |
| 10 | Task 10: 构建验证 | **Wopal** | Task 9 | 构建是合并成功的最终验证 |
| 11 | Task 11: 更新记录 | **fae** | Task 10 | 文档更新 |
| 12 | Task 12: 提交 | **Wopal** | Task 11 | 最终提交由 Wopal 执行（commit 到 feature 分支，用户验证在 dev-flow `verifying` 阶段执行，不在本 Plan Task 范围内） |

**强依赖说明**：
- Task 2、3、4 强依赖（都是核心层 + RuntimeFlags 接入），整组委派给单个 Wopal 流程
- Task 5、6 强依赖（CLI/TUI/Plugin 一致性），Wopal 亲自处理
- Task 7 可独立委派（fae 接受上游版本）
- Task 8-11 顺序依赖（Task 12 后进入 dev-flow `verifying` 阶段，用户验证在 `flow.sh complete` 之后执行）

**Wopal 直接执行的理由**：
- 所有核心冲突（Task 2、3、4、5、6）由 Wopal 亲自处理（用户决策 D-07）
- Task 1、10、12 是流程节点和验证
- Task 8 是失败回退点（typecheck 不过需要 Wopal 协调修改）

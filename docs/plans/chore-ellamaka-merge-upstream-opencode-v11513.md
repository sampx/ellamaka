# chore-ellamaka-merge-upstream-opencode-v11513

## Metadata

- **Type**: chore
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka/
- **Project Type**: standard
- **Created**: 2026-06-08
- **Updated**: 2026-06-09（dry-run 验证版，tag `385cb69441`）
- **Status**: reviewing


## Scope Assessment

- **Complexity**: High
- **Confidence**: High
- **Scope Note**: 本计划修改跨 `projects/ellamaka` 与 `.wopal/plugins/`，后者是上游 API 变更（`ToolContext.ask` Promise 化、`TuiAttention` 新增）的**下游联动改造**，必须与合并同批次原子完成，否则 merge commit 入 main 后旧版 plugin 将无法正常工作。另立 Plan 拆分平台层的 plugin 变更会导致中间态不可用。
- **Atomic Merge Note**: 12 个 Task 虽然数量较大，但 upstream merge 是**单次原子提交**——不能拆成多个 Plan 分别生成多个 merge commit，否则失去合并的原子性、产生多份中间态的无效历史。所有 Task 共享同一次 merge 上下文，最终产出 1 个 merge commit。

## Goal

合并 opencode 上游 **tag v1.15.13**（commit `385cb69441`）到 ellamaka，保留全部 13 项 ellamaka 定制。

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

ellamaka 当前共有 **13 项定制**（详见 `BRANDING.md` §0-§10 与 `AGENTS.md`）。

### Research Findings

**冲突面调研结果**（基于 `git merge v1.15.13 --no-commit --no-ff` dry-run 实测，2026-06-09 验证）：

- **总冲突数**：329 个
- **内容冲突**（双方都修改，29 个）：含 5 个高风险、9 个中风险、15 个低风险
- **modify/delete 冲突**（~300 个）：覆盖 `.github/`、`packages/desktop/`、`script/`、`sdks/`、`specs/`、`packages/web/`、`packages/enterprise/`、`packages/console/`、`packages/function/`、`packages/containers/`、`packages/slack/`、`packages/zen/`、`packages/extensions/`、`packages/identity/` 等精简目录
- **新增 package**（v1.15.x 引入）：`packages/cli/`、`packages/docs/`、`packages/effect-drizzle-sqlite/`、`packages/llm/`、`packages/http-recorder/`、`packages/stats/`
- **删除的文件**（v1.15.x 上游删除）：`packages/opencode/src/cli/cmd/tui/util/sound.ts`、`packages/opencode/src/util/keybind.ts`、`packages/opencode/src/util/lock.ts`、`packages/opencode/src/util/scrap.ts`、`packages/opencode/src/util/network.ts`、`packages/opencode/src/util/abort.ts`、`packages/opencode/src/util/color.ts`、`packages/opencode/src/util/effect-zod.ts`、`packages/opencode/src/util/fn.ts`、`packages/opencode/src/util/named-schema-error.ts`、`packages/opencode/src/util/update-schema.ts`、`packages/opencode/src/server/adapter.{bun,node,ts}`、`packages/opencode/src/server/proxy.ts`、`packages/opencode/src/server/middleware.ts`、`packages/opencode/src/server/error.ts`、`packages/opencode/src/server/workspace.ts`、`packages/opencode/src/server/routes/instance/{config,event,experimental,file,index,mcp,middleware,permission,project,provider,pty,question,session,sync,trace,tui}.ts`

**13 项定制**：详见 `BRANDING.md` §0-§10。关键位置：`flag.ts`（WOPAL_SPACE）、`global.ts`（WOPAL_HOME）、`installation/index.ts`（channel 守卫/USER_AGENT/`.wopal/bin` 检测）、`config/config.ts`（wopal-space 注入点）、`skill/index.ts`（DISABLE_AGENTS_SKILLS/`.agents` 目录）、12 个 CLI cmd 文件（BINARY_NAME 字符串）、`logo.ts`（字模）、`ui.ts`（wordmark）、`error-component.tsx`（错误上报 URL）、`tips-view.tsx`（settings 路径提示）。

**自动合并验证**（dry-run 确认，以下文件 git 自动合并且 ellamaka 定制完整保留）：
`index.ts`、`logo.ts`、`ui.ts`、`global.ts`、`log.ts`、`upgrade.ts`、`cli/cmd/upgrade.ts`、`mcp.ts`、`serve.ts`、`web.ts`、`tui/thread.ts`、`tui/attach.ts`、`pr.ts`、`uninstall.ts`、`tips-view.tsx`。这些文件无需手动解决冲突，仅需 Task Verify 时 grep 验证定制存在。

**参考资料**：`BRANDING.md`、`UPSTREAM-MERGE-LOG.md`、`DESIGN.md`。
- `projects/ellamaka/docs/plans/done/20260507-chore-ellamaka-merge-upstream-opencode-v11439.md` — 上次合并 Plan（参考实施模式）

### Key Decisions

- **D-01**：`WOPAL_SPACE` 从 `flag.ts` 移入 `RuntimeFlags`（`wopalSpace: bool("WOPAL_SPACE")`），`flag.ts` 中删除全部 WOPAL_SPACE 相关代码
  - **理由**：v1.15.13 已将运行时 flag 统一迁入 RuntimeFlags。`loadInstanceState` 在 Effect 上下文中执行，可直接访问 RuntimeFlags service；`paths.ts` 的 `directories()` 在 wopal-space early-return 之后不会被调用，无需 WOPAL_SPACE guard。WOPAL_SPACE 集成到 `disableClaudeCodePrompt`/`disableClaudeCodeSkills`/`disableExternalSkills` 等关联 flag 使用 upstream 已有的 `Config.all()` + `||` 模式，最小侵入。

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

- `TuiAttention.notify()`: 上游 v1.15.13 新增通知 API，`tui-ellamaka.tsx` 需迁移到此外废弃独立 afplay
- `userAgent(client)`: 上游将 `USER_AGENT` 常量改为函数，ellamaka 需将 `opencode/` 替换为 `BINARY_NAME/`

## In Scope

- 合并上游 tag `v1.15.13`（`6e7c9eb82` → `385cb69441`）
- 解决 **29 个内容冲突文件**（详见 Affected Files 表）
- 自动清理 **~300 个 modify/delete 冲突**（精简清单内 `git rm`）
- 扩展精简清单：`docs/BRANDING.md §0` 新增 `packages/stats/`
- 迁移 `tui-ellamaka.tsx` notification 到 `api.attention.notify`
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

### 内容冲突（29 个，需手动解决）

| File | Task | Risk | Note |
|------|------|------|------|
| `packages/opencode/src/installation/index.ts` | T3 | **高** | 4 块冲突：USER_AGENT、`.wopal/bin`、channel 守卫×2 |
| `packages/opencode/src/config/config.ts` | T4 | **高** | 3 块冲突：wopal-space 注入点位置迁移 |
| `packages/opencode/src/skill/index.ts` | T4 | **高** | 2 块冲突：`.agents` 守卫改为 `disableAgentsSkills` 参数 |
| `packages/opencode/src/effect/runtime-flags.ts` | T2 | **中** | v1.15.13 新文件，事后追加 `disableAgentsSkills` 字段 |
| `packages/opencode/src/cli/cmd/run.ts` | T5 | **高** | 1 块冲突（imports），其余自动合并 BINARY_NAME 完整 |
| `packages/opencode/src/session/llm.ts` | T5 | **高** | 1 块冲突：plugin systemMetadata hook |
| `packages/core/src/flag/flag.ts` | T2 | **中** | 2 块冲突：WOPAL_SPACE getter 保留 |
| `packages/opencode/src/cli/upgrade.ts` | T3 | **中** | channel 守卫 + GlobalBus.emit 适配 |
| `packages/opencode/src/permission/index.ts` | T4 | **中** | PermissionV2 拆分 |
| `packages/opencode/src/cli/error.ts` | T5 | **中** | 3 处 BINARY_NAME |
| `packages/opencode/src/cli/network.ts` | T5 | **中** | 1 处 BINARY_NAME |
| `packages/opencode/src/cli/cmd/providers.ts` | T5 | **中** | BINARY_NAME |
| `packages/opencode/src/cli/cmd/debug/index.ts` | T5 | **中** | BINARY_NAME |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | T5 | **中** | modify/delete，保留 ellamaka HEAD |
| `packages/opencode/src/cli/cmd/tui/component/error-component.tsx` | T5 | **中** | BINARY_NAME + 错误上报 URL |
| `packages/opencode/src/cli/cmd/tui/config/tui.ts` | T5 | **中** | wopal-space 注入 |
| `packages/opencode/src/cli/cmd/tui/util/sound.ts` | T7 | **低** | modify/delete，接受上游删除 |
| 5× test files (`config.test`, `tui.test`, `prompt.test`, `skill.test`, `trigger.test`) | T7 | **低** | 接受上游版本 |
| `bun.lock` | T7 | **低** | 依赖同步 |
| `package.json` + `packages/core/package.json` + `packages/opencode/package.json` | T7 | **低** | 版本同步 |
| `turbo.json` | T7 | **低** | 配置同步 |
| `AGENTS.md` + `packages/opencode/AGENTS.md` | T7 | **低** | 规范同步 |
| `README.md` | T7 | **低** | 接受上游 |
| `.github/TEAM_MEMBERS` | T7 | **低** | 保留 ellamaka |

### 自动合并验证清单（无需手动解决，Task 5 内 grep 验证定制存在）

`index.ts`、`logo.ts`、`ui.ts`、`global.ts`、`log.ts`、`cli/cmd/upgrade.ts`、`mcp.ts`、`serve.ts`、`web.ts`、`tui/thread.ts`、`tui/attach.ts`、`pr.ts`、`uninstall.ts`、`tips-view.tsx`

### modify/delete 冲突（~300 个，自动 `git rm`）

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

1. [ ] 实际内容冲突文件数 ≤ 30（29 已记录）
2. [ ] 全部 29 个内容冲突文件无 conflict marker（`rg -c '^<<<<<<<\|^=======$\|^>>>>>>>$' packages/opencode/src packages/core/src` 返回 0）
3. [ ] ~300 个 modify/delete 冲突全部按精简清单自动 `git rm`（`rg -c 'opencode-sfx\|opencode-sound\|packages/stats' packages/` 返回 0）
4. [ ] `flag.ts` 已完全清理：无 `WOPAL_SPACE` getter，无 WOPAL_SPACE 集成残留（`rg 'WOPAL_SPACE' packages/core/src/flag/flag.ts` 返回空）
5. [ ] `RuntimeFlags` 含 `wopalSpace` + `disableAgentsSkills` 字段，且 WOPAL_SPACE 已集成到 `disableClaudeCodePrompt`/`disableClaudeCodeSkills`/`disableExternalSkills`（`rg -c 'wopalSpace' packages/opencode/src/effect/runtime-flags.ts` ≥ 4）
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

**Behavior**: 工作树处于合并状态，29 个内容冲突文件已识别，~300 个 modify/delete 冲突已记录

**Files**: 全部（checkpoint — 全局预演任务，非文件级变更）

**Pre-read**:
- `docs/BRANDING.md` §0 精简清单
- `docs/UPSTREAM-MERGE-LOG.md` 上次合并记录

**Design**:
1. 在 worktree 中执行 `git fetch upstream`
2. 执行 `git merge v1.15.13 --no-commit --no-ff` 预演合并（**锁定 tag，非 upstream/dev**）
 3. **验证版本**：`grep '"version"' packages/opencode/package.json` 确认输出 `"1.15.13"`
3. 提取所有冲突文件列表，按"内容冲突 / modify/delete / auto-merged"分类
4. 对比方案预期（29 + ~300），记录差异
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

### Task 2: core 层：flag.ts 冲突 + RuntimeFlags 扩展

**Verification Intent**: AC#2, AC#5

**Behavior**: `flag.ts` 接受 v1.15.13 版本，**不添加**任何 ellamaka 定制；`RuntimeFlags` 新增 `wopalSpace` 和 `disableAgentsSkills`，并集成 WOPAL_SPACE 到关联 flag。

**清理原则**：v1.15.13 已将运行时 flag 统一迁入 RuntimeFlags。`WOPAL_SPACE` 不再存在于 `flag.ts`。`loadInstanceState` 在 Effect 上下文执行，可直接通过 RuntimeFlags service 访问 `flags.wopalSpace`。

**Files**:
- `packages/core/src/flag/flag.ts`（内容冲突，接受上游版本）
- `packages/opencode/src/effect/runtime-flags.ts`（新文件，事后修改）
- `packages/core/src/global.ts`（自动合并，grep 验证）

**Design**:
- `flag.ts`：接受 v1.15.13 版本（无 ellamaka 定制）
- `runtime-flags.ts`：追加 2 个新字段，修改 3 个现有字段集成 WOPAL_SPACE（沿用 upstream `Config.all` + `||` 模式）：
  ```ts
  wopalSpace: bool("WOPAL_SPACE"),
  disableAgentsSkills: bool("OPENCODE_DISABLE_AGENTS_SKILLS"),
  // 修改现有字段，追加 wopal 分支：
  disableClaudeCodePrompt: Config.all({
    broad: bool("OPENCODE_DISABLE_CLAUDE_CODE"),
    direct: bool("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT"),
    wopal: bool("WOPAL_SPACE"),  // ← 新增
  }).pipe(Config.map((f) => f.broad || f.direct || f.wopal)),
  // disableClaudeCodeSkills, disableExternalSkills 同理
  ```

**TDD**: true

**Verify**:
- `rg 'WOPAL_SPACE' packages/core/src/flag/flag.ts` 返回空（flag.ts 完全清理）
- `rg -c 'wopalSpace' packages/opencode/src/effect/runtime-flags.ts` ≥ 4（定义 + 3 处集成）
- `rg -c 'disableAgentsSkills' packages/opencode/src/effect/runtime-flags.ts` ≥ 1
- `rg -c 'WOPAL_HOME' packages/core/src/global.ts` ≥ 1（路径体系保留）
- `rg -c 'loadEnvFile' packages/core/src/global.ts` ≥ 1（.env 加载保留）
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
基于 v1.15.13 实测架构
- `config/config.ts`：v1.15.13 版本在 `loadGlobal` merge（line ~599）后加载 OPENCODE_CONFIG。wopal-space 注入点放在此 merge 之后、OPENCODE_CONFIG 之前：
  ```ts
  yield* merge(Global.Path.config, global, "global")  // line ~599
  // ⬇️ wopal-space 注入点
  if (Flag.WOPAL_SPACE && ctx.worktree) {
    const wopalResult = yield* tryLoadWopalSpaceConfig(...)
    if (wopalResult) return wopalResult
  }
  ```
  额外两处非冲突区修改（自动合并，事后追加）：
  1. **`loadGlobal`**：v1.15.13 读 `config.json`/`opencode.json`/`opencode.jsonc` + TOML legacy → 替换为 `loadSettingsFile(globalConfigFile())` 读 `settings.jsonc`；删除 `$schema` seed 和 TOML 块
  2. **for-loop 迭代目录**（`loadInstanceState` 中）：v1.15.13 对所有目录做 npm install + 能力扫描 → 添加 `if (dir === Global.Path.config) continue`，`WOPAL_HOME/config/` 是纯配置目录，不装插件不扫描能力
- `skill/index.ts`：v1.15.13 `discoverSkills` 签名：
  ```ts
  function*(config, discovery, fsys, global,
    disableExternalSkills: boolean,   // ← RuntimeFlags 传入
    disableClaudeCodeSkills: boolean, // ← RuntimeFlags 传入
    directory, worktree)
  ```
  需新增 `disableAgentsSkills: boolean` 参数（由 Task 2 中 RuntimeFlags 提供），并在 `.agents` push 处加 guard。调用方 line ~262 需传入 `flags.disableAgentsSkills`。WOPAL_SPACE 守卫（跳过 `.claude/` `.agents/` 扫描）使用 `Flag.WOPAL_SPACE` 在外层控制 `disableExternalSkills=true`。
- `permission/index.ts`：接受 v1.15.13 `PermissionV2` 结构，验证不破坏 ellamaka 权限合并

**TDD**: true

**Changes**:
1. **RED**：编写 `test/skill/discovery.test.ts` 测试 `disableAgentsSkills=true/false` 下技能目录扫描
2. **RED**：编写 `test/permission/next.test.ts` 测试权限合并
3. **GREEN**：解决 `config.ts` 冲突——wopal-space early return + `tryLoadWopalSpaceConfig` import
4. **GREEN**：`config.ts` 非冲突区修改：`loadGlobal` 替换为 `loadSettingsFile(globalConfigFile())`，删除 TOML legacy 和 `$schema` seed
5. **GREEN**：`config.ts` 非冲突区修改：for-loop 中添加 `if (dir === Global.Path.config) continue`
6. **GREEN**：解决 `skill/index.ts` 冲突——新增 `disableAgentsSkills` 参数 + 调用方传入
7. **GREEN**：解决 `permission/index.ts` 冲突——保留权限合并

**Verify**:
- `bun test packages/opencode/test/skill/discovery.test.ts packages/opencode/test/permission/next.test.ts --timeout 30000` 全部通过
- `rg -c 'tryLoadWopalSpaceConfig' packages/opencode/src/config/config.ts` ≥ 1
- `rg -c 'globalConfigFile' packages/opencode/src/config/config.ts` ≥ 1
- `rg -c 'settings\.jsonc' packages/opencode/src/config/config.ts` ≥ 1
- `rg 'config\.json.*opencode\.json|toml.*legacy' packages/opencode/src/config/config.ts` 返回空（已清理）
- `rg -c 'Global\.Path\.config.*continue' packages/opencode/src/config/config.ts` ≥ 1
- `rg -c 'disableAgentsSkills' packages/opencode/src/skill/index.ts` ≥ 1
- `rg -c 'RuntimeFlags' packages/opencode/src/skill/index.ts` ≥ 1

**Done**:
任务产出：`config.ts`、`skill/index.ts`、`permission/index.ts` 全部解决，wopal-space 注入点保留，skill 迁移到 RuntimeFlags 读取
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 5: 解决 CLI / TUI / Session 冲突

**Verification Intent**: AC#6, AC#7, AC#8

**Behavior**: 解法冲突文件，保留 BINARY_NAME 字符串和 ellamaka 品牌注入；grep 验证自动合并文件的定制完整。

**Design**:
9 个冲突文件逐一接受 v1.15.13 版本，保留 ellamaka 字符串差异。15 个自动合并文件 grep 验证即可。

**冲突文件**（7 个内容冲突 + 1 个 mod/del）：
- `cli/error.ts`：接受上游版本，保留 3 处 BINARY_NAME 
- `cli/network.ts`：接受上游版本，保留 1 处 BINARY_NAME
- `cli/cmd/run.ts`：接受上游版本，解决 imports 冲突块（BINARY_NAME 已自动保留）
- `cli/cmd/providers.ts`：接受上游版本，保留 BINARY_NAME
- `cli/cmd/debug/index.ts`：接受上游版本，保留 BINARY_NAME
- `cli/cmd/tui/component/error-component.tsx`：接受上游版本，保留 `BINARY_NAME` + `wopal-cn/ellamaka` 错误上报 URL
- `cli/cmd/tui/config/tui.ts`：接受上游版本，保留 wopal-space 注入
- `session/llm.ts`：接受上游版本，保留 plugin systemMetadata hook
- `cli/cmd/tui/app.tsx`（mod/del）：**保留 ellamaka HEAD 版本**

**自动合并验证**（grep 确认，无需编辑）：
`index.ts`、`logo.ts`、`ui.ts`、`cli/cmd/{upgrade,uninstall,web,tui/thread,serve,tui/attach,pr,mcp}.ts` — BINARY_NAME/ellamaka 字符串存在

**TDD**: true

**Changes**:
1. **RED**：编写 `test/cli/help/help-snapshots.test.ts` 确保 CLI help 不含 "opencode"
2. **GREEN**：逐一解决 9 个冲突文件（接受 v1.15.13，保留 ellamaka 字符串差异）
3. **VERIFY**：grep 自动合并文件确认 BINARY_NAME/ellamaka 定制存在

**Verify**:
- `bun test packages/opencode/test/cli/help/help-snapshots.test.ts --timeout 30000` 通过
- `rg -c 'BINARY_NAME' packages/opencode/src/cli/error.ts` ≥ 3
- `rg -c 'BINARY_NAME' packages/opencode/src/cli/network.ts` ≥ 1
- `rg -c 'BINARY_NAME' packages/opencode/src/cli/cmd/{upgrade,uninstall,web,tui/thread,serve,run,tui/attach,pr,providers,mcp,debug/index}.ts` 总和 ≥ 12
- `rg -c 'wopal-cn/ellamaka' packages/opencode/src/cli/cmd/tui/component/error-component.tsx` ≥ 1
- `rg -c 'systemMetadata' packages/opencode/src/session/llm.ts` ≥ 1
- 自动合并文件 grep 验证通过（参考 Auto-merge Verification Checklist）

**Done**:
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

### Task 7: 接受低风险冲突文件

**Verification Intent**: AC#1, AC#2

**Behavior**: 剩余 14 个低风险内容冲突 + mod/del 文件，接受上游版本。

**Design**:
内容冲突文件全部接受 v1.15.13。mod/del 文件按 §1 精简清单 `git rm`。

**内容冲突**（接受 v1.15.13）：
`bun.lock`、`package.json`（×3）、`turbo.json`、`.github/TEAM_MEMBERS`、`AGENTS.md`（×2）、`README.md`、5× test files

**mod/del**：`sound.ts`（接受上游删除）、~300 个精简目录 `git rm`

**TDD**: false

**Verify**:
- 以上文件无 conflict marker
- `git ls-files packages/stats/` 为空（精简）

**Done**:
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

| Wave | Task | 执行者 | 依赖 | 说明 |
|------|------|--------|------|------|
| 1 | Task 1: 预演合并 | **Wopal** | 无 | worktree 创建、冲突预演、mod/del 清理 |
| 2 | Task 2: core 层冲突 | **Wopal** | Task 1 | flag.ts WOPAL_SPACE getter 保留 |
| 3 | Task 3: storage/installation | **Wopal** | Task 2 | 高风险，4 项定制重新植入 |
| 4 | Task 4: config/skill/permission | **Wopal** | Task 2 | wopal-space 注入点 + skill 守卫迁移 |
| 5 | Task 5: CLI/TUI/Session | **Wopal** | Tasks 3, 4 | 7 个内容冲突 + mod/del + 自动合并验证 |
| 6 | Task 6: 插件同步 | **Wopal** | Task 5 | TuiAttention 迁移，`.wopal/` 目录 |
| 7 | Task 7: 低风险文件 | **fae** | Tasks 3-5 | 机械接受上游版本 + git rm mod/del |
| 8 | Task 8: typecheck | **Wopal** | Task 7 | 类型错误修复 |
| 9 | Task 9: 测试回归 | **fae** | Task 8 | 运行测试，统计通过率 |
| 10 | Task 10: 构建验证 | **Wopal** | Task 9 | 构建 + version 验证 |
| 11 | Task 11: 更新记录 | **fae** | Task 10 | 文档更新 |
| 12 | Task 12: 提交合并 | **Wopal** | Task 11 | 最终 commit（实施产物）|

**依赖说明**：Task 2/3/4 强依赖核心层，Wopal 串行处理。Task 7 可并行委派 fae。Task 8-11 严格顺序。Task 12 后进入 dev-flow `verifying` 阶段。

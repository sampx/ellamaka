# PLAN — Bun 宿主稳定性与适配（B1–B4）

> 状态：待确认 | 分支：`poc-ellamaka-cordis` | 执行模式：dsh subagent 委派（wopal 规划验证，fae 实施，rook 审查）
> 设计真相：`DESIGN-dsh-poc.md`「Bun 宿主 HMR 与闭包升级」；本计划是该设计的实施分解。

## 目标

发布态 `ellamaka serve`（单 Bun 进程）完整承载 DSH：不伪造 Node 内部 loader、配置热加载可用、闭包跟进官方 0.1.2-rc.1、创造模式技能不再误导 agent 污染 state。

## 阶段总览

| 阶段 | 内容 | 委派 | 验收门 |
|------|------|------|--------|
| S | 解析缝 Spikes（B1 前置决策） | fae | 决策记录落盘：Path 1 或 Path 2 |
| B1 | 拆雷：删除伪造 `loader.internal`，显式解析裸包名 | fae 实施 + rook 审查 | 回归清单全绿 |
| B3 | 闭包升级 0.1.2-rc.1 | fae 实施 + rook 审查 | 回归清单全绿（serve + Desktop） |
| B2 | bun-hmr 适配器 | fae 实施 + rook 审查 | patch 热加载契约达成 |
| B4 | 创造模式技能适配 dsh-in-ellamaka | fae（文档） | 技能含约束章节 |

执行顺序：S → B1 → B3 ∥ B2；B4 随时可做。每阶段完成后向用户汇报验证，经用户确认才提交。

---

## 阶段 S：解析缝 Spikes

目标：确定「删除伪造 `loader.internal` 后，裸包名在 Bun 下如何解析」的技术路径。产物写入 `.wopal-space/.tmp/spike-result.md`。

**S-1 Bun 原生裸名解析验证**（决定 Path 1 / Path 2）：

- 构造最小脚本：以绝对 `file://` URL 加载闭包内 `@deepseek-ai/cordis-plugin-loader` 的构建产物，在其中执行 `await import('@deepseek-ai/dsh-base')`（闭包内存在的包）与 `await import('<用户插件名>')`（仅存在于 `profiles/node_modules` 的包）。
- 判定：闭包内包 → 原生解析成功 = Path 1 候选；失败 = Path 2。
- 同时验证 `bun --preload` 场景（dev.sh 实际启动形态）下结论不变。

**S-2 Bun runtime resolver 能力探测**（仅 Path 2 时需要）：

- 探测 `Bun.plugin` 运行时插件是否支持模块解析拦截（onResolve 语义）；记录可用性与限制。

**Path 1**（原生解析可用）：B1 = 纯删除 + Bridge 自有行的显式重写（见 B1 步骤 2）。
**Path 2**（原生不可用）：B1 = 删除伪造 internal + Bridge 自有行显式重写 + preset 行依赖「官方 `PresetTree.import` 在 `internal === undefined` 时回落原生 `import()`」——若 S-1 证明原生对闭包包失败，则保留最小 honest shim（仅 `import` 成员，启动时断言两个容器 `hmr` 行均 disabled 并 fail-loud），并在设计文档记录该 shim 为「Bun 解析缝」及移除条件。Path 2 是受控退路，不是默认。

---

## 阶段 B1：拆雷

**现状**：`packages/ellamaka-cordis/src/dsh-web.ts` 在 `loader.internal === undefined` 时注入 `{ import }` 假对象（closureRequire → profilesRequire 兜底）；Node 路径则包装真 internal 的 import 加 profiles 兜底。假对象骗过官方 hmr 的能力守卫，是 rc.2 事故的温床。

**目标态**：

1. Bun 路径不再注入任何 `loader.internal`。
2. Bridge 自有的补丁行（`stateHomePatches`、插件 store 组合层 `composePluginLayers` 产出的行）在组合前经显式 resolver：裸包名 → 绝对 `file://` URL（`@deepseek-ai/*` 走闭包 `node_modules`，用户插件走 `profiles/node_modules`，复用 D-05 heal 后的 symlink）。
3. Node 路径保留现有 internal.import + profiles 兜底包装（Desktop sidecar 语义不变）。
4. 官方 `cordis-plugin-hmr` 在 Bun 下构造器确定抛错 = 预期行为；两个容器组合中 `hmr` 行 disabled 由回归测试钉住。

**实施步骤**（TDD，先红后绿）：

1. 写失败测试：`mountProfile` 在不注入 internal 的 Bun 环境下挂载含裸名官方行 + 用户插件行的组合，断言全部激活。
2. 实现显式 resolver（新文件 `src/plugins/resolve-specifiers.ts`，单测覆盖：闭包包、用户插件包、已绝对 URL、未知名字抛原始错误）。
3. 删除 `dsh-web.ts` 假 internal 注入分支；Node 包装分支保留并加注释指向「Bun 宿主 HMR 与闭包升级」设计章节。
4. 按 Path 1/2 决策处理 preset 行路径。
5. 回归：`packages/ellamaka-cordis` 全部测试 + `packages/opencode` cordis 集成测试。

**验收**：serve（Bun）真实启动，web+tools 双容器挂载；wopal/fae/rook/standard 配置单会话创建成功；插件 add/remove 热挂载；`/global/health` 正常。用户实机验证后提交。

**回滚**：单 commit 变更，revert 即回滚；闭包不受影响。

---

## 阶段 B3：闭包升级 0.1.2-rc.1

1. `packages/ellamaka-cordis/package.json` 六个直接依赖 `0.1.1-rc.2` → `0.1.2-rc.1`（`@deepseek-ai/cordis` 4.0.2 与 `cordis-plugin-loader` 1.0.3 不动，官方未变更）。
2. `bun install` 更新锁 → 构建再生 `dsh-runtime-manifest.json` / `dsh-runtime-lock.json` → 下次启动 Runtime Manager 自动物化新指纹闭包（旧闭包保留）。
3. `stateHomePatches` 逐行复核 rc.1：六个 `config.dshHome` 行、`dshHomePath` override（rc.1 `app-boot/src/index.ts:803` seam 未变）、web 容器 `session-persistence-jsonl` 禁用、Bun 下 `code-runtime` 禁用、tools 容器 `hmr` 禁用；核对新 base 行（如 `deepseek-llm-api-extensions`）是否需要隔离注入。
4. 配置单 schema 复核：rc.1 工具行 required 字段对照（`tool-fs-search.sampleOverCapGlobResults`、`tool-todo.allowParallelInProgress` 等）。
5. 回归清单（Bun serve + Desktop sidecar 双跑）：双容器挂载、五份配置单会话、插件热挂载、health、iframe 全链路、短对话 E2E（验证 agent-loop 流式持久化在 rc.1 行为）。

**回滚**：revert 版本 pin + manifest 提交即可；不可变闭包保证运行进程安全。

---

## 阶段 B2：bun-hmr 适配器（B1 后细化）

范围按设计章节：`registerConfig` 等价实现（chokidar 单文件监听）+ generation 候选隔离校验 + 空闲窗口原子替换（复用插件供应链的隔离挂载与 `startDshPluginService` 组合逻辑）。Bun 路径以同 `hmr` 服务位挂载 `@wopal/ellamaka-cordis/bun-hmr`；Node 路径不挂载。详细 Plan 在 B1 落地后单独编写（此时解析缝已定型，接口不再漂移）。

## 阶段 B4：创造模式技能适配（独立可先行）

对象：`$WOPAL_HOME/dsh/state/.agent-presets/wopal/skills/` 下 `editing-cordis-compositions`、`cordis-plugin-development` 两份副本（闭包内原件不可变）+ 样例源 `.wopal/docs/agent-preset-samples/` 同步说明。

新增「dsh in ellamaka」约束章节：唯一 home = `$WOPAL_HOME/dsh`（闭包/profiles/state 三分）；**禁止设置或使用 `DSH_HOME`**，官方 CLI 试验必须 `DSH_HOME=$(mktemp -d)`；配置单双根路径与优先序；preset 属用户根可编辑、官方 preset 不可变；Bun 兼容性门禁（`DshPluginBunIncompatible`）；state 目录哨兵 README 的存在与含义。经 `skill-creator` 修订流程，frontmatter `name`/`description` 不变。

---

## 委派与协作规则

- 委派前 wopal 加载 `agents-collab` 技能；prompt 一律使用空间根绝对路径或基于空间根的相对路径，并携带项目路径上下文（`.worktrees/poc-ellamaka-cordis/`）。
- fae 只做实施与测试运行；rook 审查点：B1 实施后（对照设计章节 + 测试充分性）、B3 回归证据、B2 接口与回滚语义。
- wopal 负责每次验收门的实机验证（serve 启动、会话创建、health 探测）与汇报；重启 ellamaka 由用户执行。
- 代码变更经用户验证并明确确认后才提交；提交语言英文、格式遵循空间守则。

## 风险与决策门

| 风险 | 缓解 |
|------|------|
| S-1 证明原生解析不可用且 Bun 无 resolver 拦截能力 | 走 Path 2 受控退路（最小 honest shim + 启动断言 + 设计记录），不阻塞 B3 |
| rc.1 行为回归（schema required、新行、presets 契约） | 回归清单双跑 + 旧闭包保留可即时回滚 |
| B1 删除后用户插件行解析回归 | 显式 resolver 单测覆盖 + heal symlink 复用 |
| 大会话事件膨胀复发 | 上游缺陷（逐 delta + 无界 FrameQueue）宿主不可修；以「大会话不自动 resume」缓解并跟踪上游 |

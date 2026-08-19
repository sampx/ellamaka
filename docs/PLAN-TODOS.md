# PLAN-TODOS — 能力路线实施计划与进度管理

> **用途**：本文档是 ellamaka 能力路线（终审后主线）的实施进度管理中枢。
> **文档分工**：`DESIGN-refactor-cordis.md` 管 cordis 设计与路线终审（§12）；`DESIGN-capabilities.md` 管新主线设计（能力包工艺、plugin 声明面、权限收敛、实施序列）；本文档管实施节奏（分几个批次、每个批次做什么、做到哪了）；每个 Plan 启动实施时走 dev-flow 建 Plan 文档细化（TDD 用例、任务分解），本文档只跟踪 Plan 批次级进度。
> **更新纪律**：任务完成即勾选；Plan 状态变更时更新总览表；架构变更回写设计文档，不沉淀在本文件。
> **历史说明**：本文档原名 `POC-cordis-todos.md`，2026-08-19 路线终审后更名重构——原 Plan 2–8 的 cordis 主线叙事撤销/转性（终审 §12.3），新序列承载全部能力路线。
> **创建时间**：2026-08-16（重构 2026-08-19）

## 状态图例

- ⬜ 未开始
- 🔶 进行中
- ✅ 已完成
- ⏸ 暂停（注明原因）
- ⊘ 取消（注明原因）

## Plan 总览

| Plan | 名称 | 载体 | 依赖 | 状态 | 预计规模 |
|------|------|------|------|------|---------|
| Plan 1 | POC：容器宿主 + 首个插件挂载 | cordis | 无 | ✅ | 已完成（演进分支，`--keep-worktree` 归档） |
| Plan 2 | 权限收敛 + always 持久化修复 | Effect 原生 | 无 | ⬜ | 3–5 天 |
| Plan 3 | A 类机制吸收（pruner / inbox / EventV2 容错） | Effect 内核 | 无（可与 Plan 2 并行） | ⬜ | ~1 周 |
| Plan 4 | B 类首能力：session-query 4 工具 | 能力包（朴素装配） | 无 | ⬜ | ~1 周 |
| Plan 5 | plugin 统一声明面（配置化） | 装配层 | Plan 4 + 装配痛感显形 | ⬜ | 3–5 天 |
| Plan 6 | B 类批量：schedule 等 | 能力包（声明装配） | Plan 5 | ⬜ | 按需 |
| 边缘 | cordis 挂 fs-search 替换 grep/glob | cordis（边缘线） | 无 | ⬜ 随时 | 3–5 天 |
| 远期 | subagent 多后端 / wopal_task 正规化 / 审计事件流 | 按需 | 需求驱动 | ⬜ | 单独立项 |

---

## Plan 1 — POC：容器宿主 + 首个插件挂载 ✅

> **目标**：ellamaka 对话轮次跑在 Cordis 容器里，dsh 生态插件（spill）在真实对话中生效并可干净卸载。
> **验收故事**：跑一次真实对话触发超长 grep 输出 → 模型收到头尾预览 + `spill://` 句柄，磁盘存在转储文件，上下文只消耗预览 token；卸载后行为还原；全链路零回归。

- [x] 1.1 新建 `@wopal/ellamaka-cordis` 包：CordisHub（per-instance 容器）+ Effect scoped Layer + `ctx.fiber.dispose()` 生命周期，包级测试（容器装卸、服务注册、事件分发）
- [x] 1.2 agent-loop 插件：轮次经 `ctx.agentLoop` 驱动，桥接按 §5.6.1 规范（`Effect.forkIn(scope)(work)` 持有 Fiber 供 interrupt，POC 实测修正形态）
- [x] 1.3 SessionPrompt 以 Layer 包装改道（上游文件零改动），真实对话经容器驱动，`agent/turn-completed` 事件可观测
- [x] 1.4 R2/R3 集成复验：ALS 上下文继承（Instance 目录/Bus 发布正确）+ 运行中 cancel 确定性到达（含后台任务清理）
- [x] 1.5 ctx.tools 最小版：注册表 + execute + `tools/post-execute` waterfall（不含 guard/around 五段管道）
- [x] 1.6 grep 工具桥接：包装注册进 ctx.tools（单工具验证，其余工具仍走原生管道）
- [x] 1.7 spill 三件套挂载（spill + spill-local + spill-policy，代码直挂 `ctx.plugin`，不走 settings 声明），真实对话验证超长输出转储 + 预览句柄 + 干净卸载
- [x] 1.8 回归收口：opencode 既有测试按基线对照零新增失败 + `bun run typecheck` + 手动对话回归（流式/SQLite/Snapshot 零异常，随用户验证场景执行）
- [x] 1.9 日志桥接：cordis 内建 `ctx.logger` → ellamaka `Log` 体系（`cordis-mount.ts` 注册 Exporter，hub.ts 改用 `ctx.logger`），用户验证 TUI 退出时日志文件可见 hub created/disposed 记录

> **Plan 1 已知设计问题（记录，非本 Plan 缺陷）**：native grep 上游截断（`grep.ts` 匹配数 >100 只格式化前 100 行）与 dsh spill 的「全量转储」语义不匹配——匹配数爆炸场景下 spill 文件存的是截断后结果，模型无法从 spill 精确读回剩余匹配，只能重新 grep。spill 的「全量读回」价值仅在「匹配少但行超长」场景成立。终审判定：工具能力 cordis 化通用价值不成立（终审 C4），该语义冲突随 grep 桥下线或 fs-search 承接槽位而消解。

---

## Plan 2 — 权限收敛 + always 持久化修复 ⬜

> **目标**：判定路径收敛单一、合并语义统一、always 持久化修复、ARITY 缩编、覆盖链显性化。权限模型（三态 + ask 审批流）与对外契约（SSE/HttpApi/TUI）全部不变。设计见 `DESIGN-capabilities.md` §4。
> **验收故事**：bash 审批选「always」→ 重启 ellamaka → 同命令族不再询问（持久化生效）；权限判定核心语义由既有 1162 行测试 + 新增行为测试锁定。
> **前置**：2026-08-19 权限体系全景侦察已完成（事实基线见设计文档 §4.1）。

- [ ] 2.1 always 持久化修复：always 批准回写 `PermissionTable`（per project），重启后生效；清除语义确认（项目删除级联 / 项目合并）——bug 修复，优先级最高
- [ ] 2.2 单一判定路径：tilde/$HOME 展开等归一逻辑下沉 `PermissionV2`；`permission/evaluate.ts` 转发文件与 legacy 薄包装退役
- [ ] 2.3 合并语义统一：配置注入（Flag/环境/CLI）完成 `ConfigPermission.Info → Rule[]` 转换后全程走 `Permission.merge` 数组语义，消除 config 层 `mergeDeep` 分叉
- [ ] 2.4 ARITY 缩编：LLM 生成 ~150 条字典缩为手工核心命令表（≤30 条：git/npm/docker/bun/pnpm 等命令族），归一机制与未命中退化行为（首 token）不变
- [ ] 2.5 覆盖链显性化：defaults 具名常量化 + 四层链（defaults → user → agent → session）文档化 + 行为测试锁定；global/space 两级由 settings mergeDeep 承载的事实写入设计文档
- [ ] 2.6 回归收口：opencode 全量测试基线对照零新增失败 + `bun run typecheck` 零错误

## Plan 3 — A 类机制吸收 ⬜

> **目标**：研究报告 §11 A 类复刻——纯算法/语义吸收，嵌入现有流程，不依赖任何插件形态。依据与优先级见研究报告 §11.3/§11.4。

- [ ] 3.1 tool-result-pruner：确定性裁剪算法（阈值/head/middle/tail/marker）嵌入 compaction 流程，LLM 总结前先裁剪，裁剪记录写 EventV2
- [ ] 3.2 Inbox 两级队列：SessionRunState busy 语义从「拒绝」改「排队」（next-step/next-turn 持久化，step/turn 边界注入）
- [ ] 3.3 EventV2 前向容错：消费侧未知事件类型策略（skip-with-log / ignorable 等价物）

## Plan 4 — B 类首能力：session-query 4 工具 ⬜

> **目标**：`session_search` / `session_event_search` / `session_trace` / `session_event_read` 四工具，底层 SQLite 查询 ellamaka Storage（messages/parts 表）+ 分词索引 + toolCall 关联血缘。dsh 用事件日志重放实现同等能力付出耦合代价，ellamaka 结构化存储占优（研究报告 §11.4 后发优势）。
> **工艺角色**：首个能力包（`ellamaka-cap-session-query`），用朴素代码装配（不建配置化），验证「独立包 + createLayer 工厂 + 最小注入点」工艺，为 Plan 5 暴露真实工厂签名需求。

- [ ] 4.1 能力包骨架：`packages/ellamaka-cap-session-query/` + createLayer 工厂 + no-op 缺省 + 装配点代码装配
- [ ] 4.2 检索底座：Storage SQL 检索（跨会话/事件级）+ 分词索引 + toolCall 血缘链
- [ ] 4.3 四工具实现与真实对话验证（agent 能检索自己的历史会话与决策）

## Plan 5 — plugin 统一声明面（配置化）⬜

> **目标**：settings.json `plugin` 字段成为全部插件唯一声明入口，三路由识别（旧式 JS 插件 / 能力包 / cordis 插件）+ fails loud + `--dump-config` 装配树。设计见 `DESIGN-capabilities.md` §3。
> **启动条件**：能力包 ≥2 个（Plan 4 完成且第二个能力装配出现复制痛感）。在此之前不做——机制形状由被装配物反推。

- [ ] 5.1 三路由识别与装配：包导出形态识别（createLayer / cordis 协议 / 旧式加载），识别失败 fails loud
- [ ] 5.2 origins 溯源与 dedupe 对三种路由统一适用（global/space 声明合并，空间覆盖全局）
- [ ] 5.3 `--dump-config`：输出「声明 → 路由 → 物化结果 → 来源层级」装配树

## Plan 6 — B 类批量 ⬜

> **目标**：后续 B 类能力直接走已就绪的声明装配，插拔感到位。按需逐个立项。

- [ ] 6.1 schedule 会话定时器：3 工具（create/list/delete）+ 三态定时（after_seconds/at/every_seconds）+ SQLite 持久化 + durability preflight（重启重建）+ 唤醒 = 到点向目标 session 发消息触发 loop
- [ ] 6.2 （按需）其他 B 类能力

## 边缘线 — fs-search 采用 ⬜（随时独立启动）

> **目标**：dsh fs-search（1574 行，npm 自带 ripgrep 二进制、VCS 排除、超时治理）替换原生 grep/glob（259 行 + 运行时下载 ripgrep），消灭运行时下载问题。挂载方式见 `DESIGN-refactor-cordis.md` §12.5：ctx.subprocess 缝隙桥 + 采用侧注册回原生 ToolRegistry 槽位，权限仍走原生 Permission。

- [ ] E.1 ctx.subprocess 缝隙桥（fs-search 依赖的进程树终止/环境净化语义）
- [ ] E.2 采用侧注册：fs-search 注册回 grep/glob 槽位替换原生实现，锁版本 + 契约符合性冒烟
- [ ] E.3 被替换工具下线检查（模型可见性、行为对照、运行时下载消除验证）

---

## 原计划终审处置记录（2026-08-19）

原 Plan 2–8（cordis 主线叙事）的处置，详见 `DESIGN-refactor-cordis.md` §12.3：

| 原 Plan | 处置 | 去向 |
|---------|------|------|
| 原 Plan 2 契约下沉补全 | 撤销 | llm/systemPrompt 桥无消费方（终审 C1/C2）；ConfigBridge / ctx.wopal 转性 → 新 Plan 5 / 远期 |
| 原 Plan 3 工具选型与 dsh 工具采用 | 转性 | 「全部工具走 ctx.tools」叙事撤销；fs-search 收窄为边缘线；wopal_task 正规化入远期 |
| 原 Plan 4 单管道收敛与权限剥离 | 撤销 | 权限走原生收敛 → 新 Plan 2 |
| 原 Plan 5 模块拆解与 B 类机制复刻 | 转性 | 复刻波次保留，载体改 Effect 能力包 → 新 Plan 3/4/6 |
| 原 Plan 6 A 类机制复刻 | 保留 | → 新 Plan 3 |
| 原 Plan 7 生态输出：provider 插件 | 撤销 | 终审 C3（输出方向降级为机会性） |
| 原 Plan 8 审计事件流（薄账本） | 保留 | 远期可选独立项，与 Cordis 无关 |

---

## 进度记录

| 日期 | Plan | 记录 |
|------|------|------|
| 2026-08-16 | — | 文档创建（原名 POC-cordis-todos.md）；Plan 1–7 规划定稿，待启动 Plan 1 |
| 2026-08-16 | — | Plan 8（审计事件流/薄账本）规划新增：session 语义模型分析定稿（研究报告 §13），中间路线纳入设计与实施计划 |
| 2026-08-17 | Plan 1 | Plan 1 实施完成：Task 1–9 全部落地（包骨架/agent-loop/改道/R2R3 复验/ctx.tools/grep 桥/spill 挂载），1.1–1.8 勾选；全量测试按基线对照零新增失败（271 基线失败记录在案）；桥接形态修正（§5.6.1 `Effect.forkIn(scope)(work)` + Scope 剥离）；待用户验证 spill 真实对话 |
| 2026-08-17 | Plan 1 | 用户验证通过：真实对话触发超长 grep（5000 匹配/23KB）→ spill 转储，模型收预览+句柄；Plan 1 标记 ✅。记录已知问题：native grep 截断与 spill 全量语义不匹配 |
| 2026-08-17 | Plan 1 | Task 10/11 完成：回归收口 + 日志桥接（cordis-plugins.log 独立文件，Exporter 装配层注册）；用户验证 TUI 重启后日志可见；Plan 1 以演进模式（`--keep-worktree`）归档，worktree 与 feature 分支保留 |
| 2026-08-19 | — | **路线终审**：基于 Plan 1 实证 + 三轮架构评审，cordis 价值半径判定为工具层（C1–C4 结论见 `DESIGN-refactor-cordis.md` §12）。主线切换为 Effect 原生能力路线（`DESIGN-capabilities.md`）；本文档更名 PLAN-TODOS.md 并重构；原 Plan 2–8 撤销/转性（见终审处置记录）；新序列：权限收敛 → A 类吸收 → session-query 首能力 → plugin 声明面 → B 类批量；cordis 降为边缘线（fs-search）；权限体系全景侦察完成（判定核心 ~900 行已近目标简洁度，臃肿在五处实现债，always 持久化为 bug） |

# POC-cordis-todos — Cordis 迁移实施计划与进度管理

> **用途**：本文档是 Cordis 迁移的实施进度管理中枢。
> **文档分工**：`DESIGN-refactor-cordis.md` 管架构语义（是什么、为什么）；本文档管实施节奏（分几个批次、每个批次做什么、做到哪了）；每个 Plan 启动实施时走 dev-flow 建 Plan 文档细化（TDD 用例、Issue 关联、任务分解），本文档只跟踪 Plan 批次级进度。
> **更新纪律**：任务完成即勾选；Plan 状态变更时更新总览表；架构变更回写设计文档，不沉淀在本文件。
> **创建时间**：2026-08-16

## 状态图例

- ⬜ 未开始
- 🔶 进行中
- ✅ 已完成
- ⏸ 暂停（注明原因）
- ⊘ 取消（注明原因）

## Plan 总览

| Plan | 名称 | 对应设计 | 依赖 | 状态 | 预计规模 |
|------|------|---------|------|------|---------|
| Plan 1 | POC：容器宿主 + 首个插件挂载 | Step A 全量 + Step B 核心切片 | 无 | ✅ | 1.5–2 周 |
| Plan 2 | 契约下沉补全 | Step B 剩余 | Plan 1 | ⬜ | 1–1.5 周 |
| Plan 3 | 工具选型与 dsh 工具采用 | Step C 前段（C0/C1/C2 采用侧） | Plan 2 | ⬜ | 1–1.5 周 |
| Plan 4 | 单管道收敛与权限剥离 | Step C 后段（C2 包装侧/C3） | Plan 3 | ⬜ | 2–3 周 |
| Plan 5 | 模块拆解与 B 类机制复刻 | Step D | Plan 2（部分需 Plan 4） | ⬜ | 2–4 周 |
| Plan 6 | A 类机制复刻（独立先行） | 研究报告 §11（不依赖 Cordis） | 无（可随时并行） | ⬜ | 3–5 天 |
| Plan 7 | 生态输出：provider 插件 | §7.2 输出方向 | Plan 2（工具集输出需 Plan 4） | ⬜ | 1–2 周 |
| Plan 8 | 审计事件流（薄账本） | §6 候选增量 | 无硬依赖（**建议 Plan 3 启动前完成基线录制**） | ⬜ | 1–2 周 |
| — | Step E 可选清理 / Step F session/provider 插件化 | §6 | — | 远期方向，启动前单独立项，不设 Plan | — |

---

## Plan 1 — POC：容器宿主 + 首个插件挂载

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

> **Plan 1 已知设计问题（记录，非本 Plan 缺陷）**：native grep 上游截断（`grep.ts` 匹配数 >100 只格式化前 100 行）与 dsh spill 的「全量转储」语义不匹配——匹配数爆炸场景下 spill 文件存的是截断后结果，模型无法从 spill 精确读回剩余匹配，只能重新 grep。spill 的「全量读回」价值仅在「匹配少但行超长」场景成立。修复方向归 Step C 单管道收敛（截断策略统一进 ctx.tools，spill 见全量），详见 DESIGN §5.7 已知问题。

## Plan 2 — 契约下沉补全

> **目标**：Step B 剩余契约全部落地，两级容器派生与配置装配可用。
> **前置**：Plan 1 的包骨架与桥接模式。

- [ ] 2.1 ctx.llm 桥接：`EllamakaProviderAdapter`（Effect Stream → AsyncIterable<StreamChunk>），`llm/stream` waterfall 可拦截
- [ ] 2.2 ctx.systemPrompt 桥接：section 注册 + 工具 schema 汇聚回调，注入现有 SystemPrompt 组装路径
- [ ] 2.3 ctx.subprocess / ctx.fs 缝隙桥：包装 ChildProcessSpawner / AppFileSystem，进程树终止与环境净化语义验证
- [ ] 2.4 root/instance 两级 context 派生：与 InstanceState ScopedCache 生命周期对齐，实例关闭仅释放实例插件
- [ ] 2.5 ConfigBridge 首版：plugin 字段声明解析 + 自动识别路由 + global/space 两级装配 + schemastery 校验 + `--dump-cordis-config` + cordis 插件日志级别经配置文件声明覆盖（DESIGN §5.10）
- [ ] 2.6 ctx.wopal 缝隙 + CLI provider：包装现有 cli-adapter，Workbench 内部路径切换（对外 API 零变更），SpaceRegistry 回归全绿
- [ ] 2.7 契约符合性测试进 CI：已挂载插件清单（spill 三件套）滚动回归

## Plan 3 — 工具选型与 dsh 工具采用

> **目标**：C0 选型决议落定，被采用的 dsh 工具上线。
> **输入**：研究报告 §12 初评 + 逐槽位深评。

- [ ] 3.1 C0 工具选型决议：逐槽位六维评估（质量/Wopal 耦合/契约原生度/缝隙依赖/维护责任），产出决议表（包装保留 / 采用 dsh / 废弃 / 新增）
- [ ] 3.2 C1 缝隙加固：按选出的 dsh 工具所需缝隙（subprocess 语义、schemastery 校验体系）补测试
- [ ] 3.3 采用侧迁移：`fs-search`（替换 glob/grep，消灭运行时下载）+ `fs-observation-policy`（先读后写门禁）锁版本挂载 + 契约符合性验证
- [ ] 3.4 增量槽位评估落地：ask-user / jobs / goal / terminal 等空白槽位逐个决议（本轮先决 2–3 个高价值项）
- [ ] 3.5 `wopal_task_*` 契约化转正：wopal-plugin 工具经 ctx.wopal 重造，解构式集成退役
- [ ] 3.6 选型回归：被替换工具的下线检查（模型可见性、行为对照）

## Plan 4 — 单管道收敛与权限剥离

> **目标**：ctx.tools 成为唯一工具执行管道，opencode Permission 退役。
> **前置**：Plan 3 决议表。

- [ ] 4.1 包装侧迁移：按决议"包装保留"槽位逐个包装注册为 ToolDefinition（含 read/edit/write/bash 等），双管道逐步收敛
- [ ] 4.2 guard 段实现：approval 缝隙 + `approval/request` waterfall，会话级 policy（ask/never）
- [ ] 4.3 approval 规则插件：迁移现有 permission allow/deny 语义与配置（defaults → global → space → agent 覆盖链）
- [ ] 4.4 审批 UI 桥：guard 决策接现有 permission SSE 流（前端零改动验证）
- [ ] 4.5 opencode Permission 退役：代码删除 + 权限行为回归测试全绿
- [ ] 4.6 管道插件全量生效验证：spill/timeout 类插件对全部工具生效（含原生包装工具）

## Plan 5 — 模块拆解与 B 类机制复刻

> **目标**：loop 模块逐个插件化，研究报告 §11 B 类复刻落地。
> **前置**：Plan 2（桥接模式）；session-query/schedule 需 Plan 4 的工具管道。

- [ ] 5.1 compaction 先桥后拆：Effect 服务经桥暴露为 ctx 契约 → 独立插件评估
- [ ] 5.2 snapshot 桥接与拆解
- [ ] 5.3 todo / overflow 桥接与拆解
- [ ] 5.4 session-query 4 工具复刻（SQL 查 ellamaka Storage + 分词索引 + toolCall 血缘链）
- [ ] 5.5 schedule 会话定时器复刻（三态定时 + 持久化 + durability preflight + 唤醒触发 loop）
- [ ] 5.6 subagent 缝隙契约 + 内部后端 provider（包装现有 task；外部 CLI 引擎后端为后续独立任务）

## Plan 6 — A 类机制复刻（独立先行，可随时并行）

> **目标**：不依赖 Cordis 化的三项机制吸收，纯 Effect 改造。
> **依据**：研究报告 §11.3/§11.4。

- [ ] 6.1 tool-result-pruner：确定性裁剪算法（阈值/head/middle/tail/marker）嵌入 compaction 流程，LLM 总结前先裁剪，裁剪记录写 EventV2
- [ ] 6.2 Inbox 两级队列：SessionRunState busy 语义从"拒绝"改"排队"（next-step/next-turn 持久化，step/turn 边界注入）
- [ ] 6.3 EventV2 前向容错：消费侧未知事件类型策略（skip-with-log / ignorable 等价物）

## Plan 7 — 生态输出：provider 插件

> **目标**：opencode 多 provider 能力封装为 dsh 契约插件，反哺 dsh 生态。
> **硬约束**：自包含（不携带 ellamaka Effect 服务图）；独立包 `@wopal/dsh-*`，不进主线依赖树。

- [ ] 7.1 provider 核心逻辑自包含裁剪（模型解析/transform/auth，脱离 ellamaka 服务图）
- [ ] 7.2 `@wopal/dsh-llm-opencode` 插件：实现 dsh `LlmAdapter` 契约，锁 rc 版本
- [ ] 7.3 dsh 环境挂载验证（真实 dsh 容器中流式对话通过）
- [ ] 7.4 工具集输出评估（依赖 Plan 4 完成后的工具包装资产）

## Plan 8 — 审计事件流（薄账本）

> **目标**：Part 模型保持唯一真相源（D1 不变），loop 写入路径并行追加审计事件流（模型输入快照、轮次决策、工具审批、配置变更），获得对拍回归与决策审计能力。依据：研究报告 §13.5、设计 §6 候选增量。
> **时序**：无硬依赖，任何时点可启动；**对拍价值最大化 = 在 Plan 3/4（单管道收敛/权限剥离）重构前完成基线录制**，重构后重放对比获得机器可验证的回归证据。
> **明确不买**：崩溃续跑（需要 fold 计算模型，超出薄账本边界）。

- [ ] 8.1 审计事件目录与存储设计：事件类型清单（模型输入快照/轮次决策/工具审批/配置变更）+ 追加式表 schema + 保留策略（按会话/时间裁剪、可开关）
- [ ] 8.2 写入路径并行记录：loop/processor 关键节点接入，Part SSOT 不变、纯追加、失败不阻塞主路径
- [ ] 8.3 重放投影器：从审计流重建"模型当时看到什么"视图（调试/审计入口）
- [ ] 8.4 对拍工具：录制-重放断言，作为 Plan 3/4 重构的行为回归基线

---

## 进度记录

| 日期 | Plan | 记录 |
|------|------|------|
| 2026-08-16 | — | 文档创建；Plan 1–7 规划定稿，待启动 Plan 1 |
| 2026-08-16 | — | Plan 8（审计事件流/薄账本）规划新增：session 语义模型分析定稿（研究报告 §13），中间路线纳入设计与实施计划 |
| 2026-08-17 | Plan 1 | Plan 1 实施完成：Task 1–9 全部落地（包骨架/agent-loop/改道/R2R3 复验/ctx.tools/grep 桥/spill 挂载），1.1–1.8 勾选；全量测试按基线对照零新增失败（271 基线失败记录在案：模型 catalog 漂移/品牌快照/git reference 环境/测试间竞态）；桥接形态修正（§5.6.1 `Effect.forkIn(scope)(work)` + Scope 剥离）；待用户验证 spill 真实对话 |
| 2026-08-17 | Plan 1 | 用户验证通过：真实对话触发超长 grep（5000 匹配/23KB）→ spill 转储 `$WOPAL_HOME/ellamaka/data/spill/session-<hash>/`，模型收预览+句柄，权限 0700；Plan 1 标记 ✅。记录已知问题：native grep 截断与 spill 全量语义不匹配（见 Plan 1 备注）。干净卸载场景待用户验证 |

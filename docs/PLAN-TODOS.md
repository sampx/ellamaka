# PLAN-TODOS — dsh 双引擎融合进度管理

> **用途**：本分支（poc-ellamaka-cordis）进度索引与批次管理。
> **分工**：`DESIGN-dsh-poc.md` 管设计真相（按标题引用，不使用章节号）；dev-flow Plan（`.wopal-space/plans/ellamaka/`）管跨文件、多任务的大步实施；本文件管总览与执行顺序。
> **推进原则**：小步快跑，每一步交付可应用的具体成果，步内不掺杂后续步骤内容。

---

## 已完成批次

| 批次 | 名称 | 完成说明 |
|------|------|----------|
| P1 | 双引擎容器宿主 + 日志桥接 | dsh 引擎在 ellamaka 进程内完整运行 |
| P2 | 工具利用：fs-search 落地 | 桥轨首个实证，基建成本付清 |
| P3/P3.5 | 工具沙箱 + 动态装配 | tool-fs/str_replace/bash 沙箱接入；tool.provider 动态投影 |
| P3.5+ | DSH home 收口 | 物化到 `$WOPAL_HOME/dsh` 唯一锚点 |
| P4 | DSH Web 单端口统一 | `/dsh/*` 同源挂载，dshPort 协议移除 |
| P5 | 运行时隔离 + 物化生产化 | `ELLAMAKA_DSH` 开关、state 隔离、Bridge 随宿主发布、统一 Runtime Manager（生产物化验收基线十项达成，2026-09-01） |
| P6 | 插件供应链 | 命令式 add/remove/enable/disable/list、热挂载（store watch + include 全栈重放）、`--dir` 安装（插件供应链七项验收达成，2026-09-02） |
| P7 | 界面承载 | DSH 从 titlebar 临时按钮迁入「助理」tab（派生可见性 + keep-alive + kill switch 回落，2026-09-03） |

### 已归档 Plan

| Plan | 结果 |
|------|------|
| `feature-dsh-dsh-escalation-approval-bridge-and-sandbox-mode-ui` | 已归档（done，2026-09-02）：审批桥接 + 沙箱三态 UI |
| `feature-ellamaka-dsh-plugin-supply-chain-install-hot-mount-lifecycle` | 已归档（done，2026-09-02）：插件供应链全链路，12 commits，rook 审查 8 Blocker 全修复，用户实机验证通过 |

推进用 dev-flow：`flow.sh plan status / approve / complete / verify / archive`。

---

## 当前主线：空间 × Agent 配置体系（小步快跑）

设计真相见 `DESIGN-dsh-poc.md`「空间 × Agent 配置体系」。主战场是 dsh 界面本身。

| 步 | 名称 | 交付成果 | 验收标准 | 实施形态 | 状态 |
|---|------|---------|---------|---------|------|
| **S1** | 武器架插件 + 手写配置单闭环 | 第一个自建 dsh 插件（`ellamaka-weapon-rack`，经供应链 `--dir` 安装）+ `wopal-workspace × wopal` 第一份配置单 + Bridge roots 注入一行 | dsh 界面可选新配置单；用其建会话：模型工具视野仅含 allow 名单（从模型视图物理移除，token 成本下降）；空间技能目录加载；空间 `AGENTS.md` 规则生效 | 手工验证（无 Plan，产物落 `.wopal-space/.tmp/`，记录进本文件进度表） | **待执行** |
| **S2** | 预设生成器 v1 | Bridge 侧同步模块：`.wopal/agents/*` + 权限 frontmatter → 每空间 × 每灵魂配置单；变更自动重建 | 2 个空间实测生成 N 份配置单；改灵魂定义→重新生成→新会话生效；删空间→配置单消失；幂等且全程无手编 | dev-flow Plan（Bridge 多文件改动，TDD + rook 审查） | 待排期 |
| **S3** | 空间皮肤插件 v1 | 第一个自建 dsh GUI 客户端插件（服务端 cwd→空间识别 + 客户端主题 token + 2–3 个声明式 slots） | 编码/多媒体两演示空间视觉可区分；replaceRisk 全为 none（无破坏性插槽）；插件崩溃被错误隔离，不影响宿主 | dev-flow Plan | 待排期 |
| **S4** | 插件生态使用与运营 | 外部/官方 dsh 插件评估清单（安装、实测、留用结论）+ 自建插件模板与规范；在日常工作中实际使用 | 至少 2 个外部插件在日常中留用；自建插件有标准化模板；产出插件评估报告 | 运营 + 文档 | 待排期 |

**执行顺序**：S1 → S2 → S3（S3 与 S4 可并行）。

---

## 稳定性与 Bun 宿主适配（插队主线，2026-09-03 立项）

设计真相见 `DESIGN-dsh-poc.md`「Bun 宿主 HMR 与闭包升级」。背景：0.1.1-rc.2 连续事故（tool-cordis 注册冲突、29.9 万事件大会话拖垮控制面、state 目录被官方 CLI 污染）。止血项已完成（大会话已备份+删除、state/profiles 污染已清理、state 哨兵 README 已就位）。

| 步 | 名称 | 交付成果 | 验收标准 | 实施形态 | 状态 |
|---|------|---------|---------|---------|------|
| **B1** | 拆雷：移除伪造 loader.internal | `dsh-web.ts` 删除 `loader.internal = { import }` 注入；裸包名解析改为 Bridge 显式 resolver（补丁栈组合前解析为绝对 file:// URL）；Node 路径的 profiles fallback 语义保留 | Bun serve 下 web+tools 双容器挂载全绿；wopal/fae/rook 配置单挂载成功；插件 add/remove 热挂载回归通过；官方 hmr 构造器在 Bun 下确定抛错（预期行为） | dev-flow Plan（TDD + rook 审查） | 待排期 |
| **B2** | bun-hmr 适配器 | `@wopal/ellamaka-cordis/bun-hmr`：`registerConfig` 配置监听等价实现 + generation 候选校验 + 空闲窗口原子替换；Bun 路径以同 `hmr` 服务位挂载，Node 路径保持官方插件 | Bun serve 下编辑 profile 用户补丁层 → 运行中容器热应用；候选校验失败保留旧栈；`patchReload: 'live'` 契约达成 | dev-flow Plan（依赖 B1） | 待排期 |
| **B3** | 闭包升级 0.1.2-rc.1 | 六个直接依赖提升 + manifest/lock 再生 + stateHomePatches 逐行复核 + 回归清单执行 | 设计文档「闭包升级路径」第 5 条回归清单全绿（serve + Desktop sidecar） | dev-flow Plan（依赖 B1，可与 B2 并行验证） | 待排期 |
| **B4** | 创造模式技能适配 dsh-in-ellamaka | `editing-cordis-compositions` 与 `cordis-plugin-development` 两技能补「dsh in ellamaka」章节：唯一 home=$WOPAL_HOME/dsh、禁用 DSH_HOME、state 目录语义、配置单双根路径、 Bun 兼容性门禁 | 技能正文含 dsh-in-ellamaka 约束；明确官方 CLI 试验用临时 DSH_HOME；经 skill-creator 修订 | skill-creator 修订（文档类） | 待排期 |
| ~~B1.5~~ | ~~dump-config 离线诊断子命令~~ | **已完成（2026-09-04）**：`ellamaka dsh dump-config`（--profile/--default-only/--json），不启动引擎、零 state 写入，YAML/JSON 同源组合；补丁构造器提为共享纯函数（dsh-web 重构行为零变化）；`shippedPresetRoot` 迁至 runtime/anchor 破循环依赖；真 home 同内容写跳过（mtime 幂等）；技能修订消灭裸 `dsh plugin` 教唆源。commit `e1666b8a4b`（ellamaka）+ `138434e`（.wopal 技能源） |

**执行顺序**：B1 → B3（升级验证）与 B2（可并行推进）；B4 独立随时可做。

---

## 门槛轨道：workbench × dsh 前端插件互通

设计真相见 `DESIGN-dsh-poc.md`「workbench × dsh 前端插件互通」。

**启动前提**（两条同时满足才排期）：
1. S4 产出至少 1 个在日常中被证明有真实价值、值得搬进 workbench 的 dsh 前端插件。
2. workbench 侧完成 slot 化（3–5 个挂载点与 props 契约）。

启动后按设计文档中的 V1–V5 执行清单分步推进。

---

## 待定事项（未排期）

| 事项 | 说明 | 关联设计 |
|------|------|----------|
| per-角色武器装备（自定义招人 provider） | 仅当 S1–S4 落地后仍存在「队员必须带不同武器」的真需求时才立项 | DESIGN-dsh-poc「组队语义」 |
| 界面演进（iframe → 原生） | S3 的插槽纪律保证定制件可无损迁移 | DESIGN-dsh-poc「空间皮肤插件」 |
| 插件 entry 级配置命令（`plugin config`） | 供应链 Plan 的 Out of Scope，独立后续 | DESIGN-dsh-poc「插件供应链 · 配置与信任」 |
| dsh 协处理器（借引擎跑子任务） | 不紧急；涉及托管会话语义设计，暂挂起 | — |
| **dshmarket 插件市场接入 poc 宿主** | 官方市场已在用户 `~/.dsh` 安装验证（research 文档 2026-09-05）。poc 需「换底座 + 割依赖」：`profileDirectory` + `desktopPnpm` 兼容注入走 Desktop 分支、安装动作转 `installPackage`、禁用市场自带的 hot/patch/restart。**待 B3/B2 完成后执行**，先做只读探针（client.inject 依赖是最大不确定点），再定方案 | DESIGN-dsh-poc「dsh 插件市场在 Ellamaka 宿主中的应用（待实验）」 |

---

## 进度记录

| 日期 | 记录 |
|------|------|
| 2026-08-16 ~ 09-01 | P1–P5 全部完成（明细见 git 历史） |
| 2026-09-02 | 设计文档精简重写；插件供应链定稿；spike 验证热挂载与运行时依赖解析；供应链 Plan 创建并提交审阅 |
| 2026-09-02 | 供应链 Plan 全周期完成：实施 6 Task + rook 审查（8 Blocker 修复）+ Wopal 自审 PASS + 用户实机验证（hello 插件热挂载 + settings 页 GUI）；验收达成进入维护态。审批桥接 Plan 同日归档。hello-dsh-plugin 前置实证（dsh.client 自动手写 bundle）完成 |
| 2026-09-03 | 界面改造：DSH 从 titlebar 临时按钮迁入「助理」tab——health 增加 `dsh` 字段 + SDK 重生成；dshVisible 派生化；iframe keep-alive 化；`ELLAMAKA_DSH=0` 回落原生助理。四场景实机验证通过（记为 P7） |
| 2026-09-03 | 设计文档完全重写为**无章节号**版本（按标题文字交叉引用）；主线确立为「空间 × Agent 配置体系」（设计定稿，S1 待执行）；workbench WC 吸收降级为门槛轨道（前提：插件用起来 + workbench slot 化）；PLAN-TODOS 改为小步快跑（S1–S4）推进模型 |
| 2026-09-04 | B1.5 完成：dump-config 离线诊断子命令（temp-home 全链路验证替代实机 smoke）+ 技能修订（消灭裸 `dsh plugin` 教唆）。**事故教训**：运行中引擎 `profiles/` 是引擎领地——内容幂等写 ≠ mtime 幂等，standing 重建按 mtime/size 触发，测试/dump/诊断一律 temp-home 注入（Live-home quarantine 已写入 poc AGENTS.md）。ellamaka commit `e1666b8a4b`；.wopal 技能源 commit `138434e`（等待 B3 完成后统一合并分支） |
| 2026-09-05 | dshmarket 插件市场接入 poc 宿主的设计思路与实验步骤写入 DESIGN-dsh-poc（待实验）；PLAN-TODOS 待定事项登记，排在 B3/B2 之后 |

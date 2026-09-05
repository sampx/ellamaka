# PLAN-TODOS — dsh 双引擎融合进度管理

> **用途**：本分支（poc-ellamaka-cordis）进度索引与批次管理。
> **分工**：`DESIGN-dsh-poc.md` 管设计真相（按标题引用，不使用章节号）；dev-flow Plan（`.wopal-space/plans/ellamaka/`）管跨文件、多任务的大步实施；本文件管总览与执行顺序。
> **推进原则**：小步快跑，每一步交付可应用的具体成果，步内不掺杂后续步骤内容。
> **编号规则**：P = 已完成批次（历史）；A = 生态对齐（当前执行）；W = wopal 插件包（下一主线）；G = 门槛轨道（workbench 互通）。编号一经分配不复用、不重排。

---

## 已完成批次

| 批次 | 名称 | 完成说明 |
|------|------|----------|
| P1 | 双引擎容器宿主 | dsh 引擎在 ellamaka 进程内完整运行 |
| P2 | fs-search 落地 | 桥轨首个实证 |
| P3/P3.5 | 工具沙箱 + 动态装配 | tool-fs/str_replace/bash 沙箱接入 |
| P3.5+ | DSH home 收口 | 物化到 `$WOPAL_HOME/dsh` 唯一锚点 |
| P4 | Web 单端口统一 | `/dsh/*` 同源挂载 |
| P5 | 运行时隔离 + 物化生产化 | 统一 Runtime Manager，验收基线达成（2026-09-01） |
| P6 | 插件供应链（store 版） | 命令式安装 + 热挂载（2026-09-02；机制由 A 线退役替换） |
| P7 | 界面承载 | DSH 迁入「助理」tab（2026-09-03） |
| P8 | 拆雷 + 闭包升级 | 移除伪造 loader.internal；闭包升 0.1.2-rc.1 + browser-auth（2026-09-05） |
| P9 | dump-config 离线诊断 | `ellamaka dsh dump-config`（2026-09-05） |

---

## 当前执行：A 线（生态对齐，2026-09-05 立项）

设计真相见 `DESIGN-dsh-poc.md`「唯一 home 与目录所有权」「插件供应链」「dshmarket 插件市场接入」。**决策**：dsh 插件生态全面对齐官方契约（声明与终态按官方语义），执行器换成 Bun（零 pnpm、零官方 dsh CLI）；home 布局对齐（`DSH_HOME=$WOPAL_HOME/dsh/home`）。对齐原则：凡是官方生态有既定机制的，对齐它，不自研平行路。

| 步 | 名称 | 交付成果 | 验收标准 | 实施形态 | 状态 |
|---|------|---------|---------|---------|------|
| **A1** | home 布局迁移 | `state/`→`home/`、`profiles/`→`home/profiles/`、`.agent-presets`→`home/.agent-presets`；dev.sh + Desktop sidecar env 改指 `home/`；state README 退役 | preset 发现正常；dsh 会话 bash 的 DSH_HOME 指向 home；官方包 env 直读落 home | 迁移脚本 + 代码 retarget + TDD | **已完成**（代码+脚本+live 迁移落地；待用户验证） |
| **A2** | 安装器 retarget + bun-hmr | 一个 Plan 完成：① Bun 安装器写官方终态（profile node_modules + package.json 声明），`installed.json`/`composePluginLayers`/旧 store 轮询退役（风暴缺陷随之消灭）；② bun-hmr 适配器（`registerConfig` 配置监听 + generation 候选校验 + 空闲窗口原子替换），watch 对象直接指向 profile 组合文件，Node 路径保持官方插件 | add/remove/install 产出官方语义终态；引擎加载新装插件；编辑 profile 补丁层运行中容器热应用；候选校验失败保留旧栈；失败不触碰 profile | dev-flow Plan（TDD + rook 审查） | 待排期 |
| **A3** | 宿主安装工契约 + 市场端到端验收 | `desktopProfiles` + `desktopPnpm` 注入 web 容器；dshmarket 以官方声明形态安装进 poc profile；通过 dshmarket 安装 dsh-better-sidebar | ① dshmarket 安装后 Settings → Plugin Market 页面可见可用；② 通过 market 一键安装 dsh-better-sidebar，引擎加载成功，右侧 sidebar UI 可见（含 explorer/git/terminal tab）；③ 已装列表与 profile package.json 声明一致；④ 禁用/启用 better-sidebar 后引擎热应用生效 | dev-flow Plan（依赖 A2） | 待排期 |
| **A4** | 生态互操作回归 | 官方 CLI（同一 home）↔ 引擎互操作验证；已装 poc 插件迁移官方声明形态 | 官方 CLI 装的插件引擎直接加载；已有 poc 插件迁移后热挂载正常 | 运营 + 回归清单 | 待排期 |

**执行顺序**：A1 → A2 → A3 → A4（严格顺序，每步落地后引擎可运行）。原 B2（bun-hmr）并入 A2，其设计主体不变、watch 对象一步到位（设计依据：`DESIGN-dsh-poc.md`「Bun 宿主 HMR 适配器（bun-hmr）」+「插件供应链 · 实现决策 D-02」）。

---

## 下一主线：W 线（wopal 插件包，A4 之后启动）

设计真相见 `DESIGN-dsh-poc.md`「wopal 插件包（Agent 配置随包发布）」。主战场是 dsh 界面本身。

| 步 | 名称 | 交付成果 | 验收标准 | 实施形态 | 状态 |
|---|------|---------|---------|---------|------|
| **W1** | wopal 插件包 v1 | 标准 dsh 插件包 `@wopal/dsh-wopal-pack`：presets/（wopal/fae/rook 配置单）+ lib/（武器架能力）+ cordis.patch.yml（roots 注册） | `ellamaka dsh plugin add` 后 wopal/fae/rook 配置单出现于配置单列表；用其建会话：模型工具视野仅含 allow 名单；空间技能目录加载；空间 `AGENTS.md` 规则生效 | dev-flow Plan（TDD + rook 审查，依赖 A2） | 待排期 |
| **W2** | 配置单内容打磨 | wopal/fae/rook 配置单按实际使用反馈迭代（工具行、allow 名单、技能路径、团队协作） | 配置单与灵魂意图一致；token 占用随 allow 名单收窄；团队角色分化生效 | 运营 + 文档（废弃自动生成） | 待排期 |
| **W3** | 空间皮肤插件 v1 | 第一个自建 dsh GUI 客户端插件（服务端 cwd→空间识别 + 客户端主题 token + 2–3 个声明式 slots） | 编码/多媒体两演示空间视觉可区分；replaceRisk 全为 none；插件崩溃被错误隔离 | dev-flow Plan | 待排期 |
| **W4** | 插件生态使用与运营 | 外部/官方 dsh 插件评估清单 + 自建插件模板与规范；日常实际使用 | 至少 2 个外部插件留用；自建插件有标准化模板；产出评估报告 | 运营 + 文档 | 待排期 |

**执行顺序**：W1 → W2 → W3（W3 与 W4 可并行）。W 步骤的插件安装全部走 A 线落地的新供应链（官方声明终态）。W2 不含自动生成器（2026-09-05 修订：配置单只能按相似设计意图人工适配，不能自动生成）。

---

## 门槛轨道：G 线（workbench × dsh 前端插件互通）

设计真相与执行清单见 `DESIGN-dsh-poc.md`「workbench × dsh 前端插件互通」（V1–V5）。

**启动前提**（两条同时满足才排期）：
1. W4 产出至少 1 个在日常中被证明有真实价值、值得搬进 workbench 的 dsh 前端插件。
2. workbench 侧完成 slot 化（3–5 个挂载点与 props 契约）。

---

## 独立事项

| 编号 | 事项 | 内容 | 时机 |
|------|------|------|------|
| B4 | 创造模式技能适配 dsh-in-ellamaka | `editing-cordis-compositions` 与 `cordis-plugin-development` 两技能补「dsh in ellamaka」章节；随 A 线各步落地按新布局增量修订 | skill-creator 修订（文档类），随时可做 |

---

## 待定事项（未排期）

| 事项 | 说明 | 关联设计 |
|------|------|----------|
| per-角色武器装备（自定义招人 provider） | 仅当 W1–W4 落地后仍存在「队员必须带不同武器」的真需求时才立项 | DESIGN-dsh-poc「组队语义」 |
| 界面演进（iframe → 原生） | W3 的插槽纪律保证定制件可无损迁移 | DESIGN-dsh-poc「空间皮肤插件」 |
| 插件 entry 级配置命令（`plugin config`） | 供应链 Plan 的 Out of Scope，独立后续 | DESIGN-dsh-poc「插件供应链 · 配置与信任」 |
| dsh 协处理器（借引擎跑子任务） | 不紧急；涉及托管会话语义设计，暂挂起 | — |
| pnpm-lock 兼容生成 | 若市场更新自动回滚的降级语义不可接受，评估 Bun 安装器产出最小合法 pnpm-lock | DESIGN-dsh-poc「插件供应链 · 已知偏差」 |

---

## 进度记录

| 日期 | 记录 |
|------|------|
| 2026-08-16 ~ 09-01 | P1–P5 完成（明细见 git 历史） |
| 2026-09-02 | 插件供应链定稿并全周期完成（Plan 6 Task + rook 8 Blocker 修复 + 实机验证）；审批桥接 Plan 归档 |
| 2026-09-03 | DSH 迁入「助理」tab（P7）；设计文档重写为无章节号版本；主线确立为空间 × Agent 配置体系 |
| 2026-09-04 | B1（拆雷）+ B1.5（dump-config）完成。事故教训：运行中引擎 `profiles/` 是引擎领地——内容幂等写 ≠ mtime 幂等，standing 重建按 mtime/size 触发；测试/dump/诊断一律 temp-home 注入（Live-home quarantine 已写入 poc AGENTS.md） |
| 2026-09-05 | B3 完成（rc.1 闭包 + browser-auth）；B1.5 分支合并回 poc 主线 |
| 2026-09-05 | **生态对齐定稿**：preset 消失事故实证官方包 env 直读绕开 config 注入；确立对齐方向——home 布局对齐官方、真相源改为官方 profile package.json（installed.json 退役）、Bun 执行器 shim 官方 dsh（零 pnpm）、dshmarket 走宿主安装工契约 |
| 2026-09-05 | **编号体系重排**：历史批次统一为 P1–P9；执行轨道重编为 A（生态对齐）、W（wopal 插件包）、G（门槛轨道）；原 B2 并入 A2，原 S 线更名 W 线，B4 保留原名入独立事项 |
| 2026-09-05 | **A1 代码+脚本落地**（Plan feature-dsh-a1-home-layout-migration Task 1–4 + Task 5 脚本，rook 两轮审查通过）：`DshLayout` 单点重定义 `homeDir=dsh/home`、供应链/mount/dump 三层 retarget、`stateHomePatches`→`homePatches`、dev.sh/sidecar env 改指 `home/`、迁移脚本 `scripts/dsh-migrate-home.sh`（幂等+守卫+哨兵）；live home 迁移待引擎停止后执行 |
| 2026-09-05 | **A1 live 迁移完成**（引擎停止后由 wopal 亲自执行）：`state/*`→`home/`、`profiles/*`→`home/profiles/`，state/profiles 退役，`home/README.md` 哨兵就位；AC#5/#6/#7 实证通过，二次执行 no-op。A1 全部落地，待用户验证 |

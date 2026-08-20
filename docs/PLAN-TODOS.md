# PLAN-TODOS — dsh 双引擎融合实验实施计划与进度管理

> **用途**：本文档是 ellamaka 与 dsh 双引擎融合实验（`DESIGN-dsh-poc.md`）的实施进度管理中枢。
> **文档分工**：`DESIGN-dsh-poc.md` 管设计（设计哲学、双引擎现实、桥/吸收双轨、技术事实基线、红线、实验步骤）；本文档管实施节奏（分几个批次、每个批次做什么、做到哪了）。每个 Plan 启动实施时走 dev-flow 建 Plan 文档细化（TDD 用例、任务分解），本文档只跟踪 Plan 批次级进度。
> **更新纪律**：任务完成即勾选；Plan 状态变更时更新总览表；架构变更回写设计文档，不沉淀在本文件。
> **创建时间**：2026-08-16（本次重构 2026-08-20）

## 状态图例

- ⬜ 未开始
- 🔶 进行中
- ✅ 已完成
- ⏸ 暂停（注明原因）
- ⊘ 取消（注明原因）

## 实验定位

**PoC 是长期实验，不合并 main**，直到设计决定（吸收轨载体：ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制）做出。在此之前，本分支（`ellamaka-dsh-poc`）是实验场。实验顺序**从核心到外围**：核心是插件生态融合 + 工具利用，外围是发布层面细节（onboarding 安装、安装位置等）。

## Plan 总览

| Plan | 名称 | 核心度 | 依赖 | 状态 | 预计规模 |
|------|------|--------|------|------|---------|
| Plan 1 | 插件生态融合验证（dsh 插件在 ellamaka 容器内完整运行、动态装载） | 核心 | 无 | ✅ | 已完成（接线） |
| Plan 2 | 工具利用：fs-search 替换 grep/glob（桥首个实证） | 核心 | 无 | ⬜ | 3–5 天 |
| Plan 3 | 配置动态化观察：patch 声明式、增量重扫 | 吸收轨 | 无 | ⬜ | 按需 |
| Plan 4 | 插件规范化观察：dual-face、Loader 动态插拔 | 吸收轨 | 无 | ⬜ | 按需 |
| Plan 5 | 界面演进：iframe → 原生（远期） | 外围 | 设计决定后 | ⬜ | 按需 |
| 远期 | onboarding 安装、安装位置调整、发布层面 | 外围 | 设计决定后 | ⬜ | 单独立项 |

---

## Plan 1 — 插件生态融合验证 ✅

> **目标**：dsh 引擎在 ellamaka 进程内完整运行，动态装载保留，插件生态融合验证。
> **验收故事**：dev 模式 `ELLAMAKA_DSH=1` 时 dsh 引擎挂载于 4098；desktop 模式 sidecar 加载闭包、随机端口通知 renderer。控制台无 dsh 侧错误。

- [x] 1.1 单容器重放 boot：`mountDshWeb(ctx, opts)` 在宿主 ctx 重放 dsh boot 序列，不创建第二个容器
- [x] 1.2 单包：dsh 装配并入 `ellamaka-cordis`（原独立 `ellamaka-dsh-host` 已删除）
- [x] 1.3 版本统一 0.1.0-rc.6（root overrides 锁 58 个 `@deepseek-ai/dsh-*`）
- [x] 1.4 `ELLAMAKA_DSH=1` 开关保留：开启挂载到进程级 CordisHub；关闭零 dsh 挂载
- [x] 1.5 修复 desktop 崩溃：`index.ts` 拆出 dsh-web 顶层导出（改子路径）+ `serve.ts` 动态 import；`dist/node/node.js` Node LOAD OK
- [x] 1.6 `installAnchor` 支持（`DshHostOptions.installAnchor`）
- [x] 1.7 前端 Workbench DSH 视图：顶栏 "DSH" 按钮 + 全屏 iframe 覆盖 SpaceRail + Workspace
- [x] 1.8 iframe src 读 dshPort（dev 回落 4098）
- [x] 1.9 desktop sidecar 接线：`bootDshWeb` + `$DSH_HOME` 缺省 + 闭包缺失 kill switch + dshPort 贯穿 ready→supervisor→preload→renderer
- [x] 1.10 回归收口：cordis/desktop/app 三包 typecheck 过；desktop 338 测试、app 863 测试、cordis dsh-web 2 测试全过

> **Plan 1 已知设计问题（记录，非本 Plan 缺陷）**：native grep 上游截断（`grep.ts` 匹配数 >100 只格式化前 100 行）与 dsh spill 的「全量转储」语义不匹配——匹配数爆炸场景下 spill 文件存的是截断后结果，模型无法从 spill 精确读回剩余匹配，只能重新 grep。spill 的「全量读回」价值仅在「匹配少但行超长」场景成立。该语义冲突随 grep 桥下线或 fs-search 承接槽位而消解（Plan 2）。

---

## Plan 2 — 工具利用：fs-search 替换 grep/glob ⬜

> **目标**：dsh fs-search（1574 行，npm 自带 ripgrep 二进制、VCS 排除、超时治理）替换原生 grep/glob（259 行 + 运行时下载 ripgrep），消灭运行时下载问题。这是**桥轨首个实证**——做完就知道"桥接一个工具"到底多贵。
> **验收故事**：模型可见工具 grep/glob 来自 fs-search；运行时下载 ripgrep 消除；权限行为回归测试全绿。
> **挂载方式**：见 `DESIGN-dsh-poc.md` §4.1（契约缝隙 + 采用侧注册回原生 ToolRegistry 槽位，权限仍走原生 Permission）。

- [ ] 2.1 ctx.subprocess 缝隙桥（fs-search 依赖的进程树终止/环境净化语义）
- [ ] 2.2 采用侧注册：fs-search 注册回 grep/glob 槽位替换原生实现，锁版本 + 契约符合性冒烟
- [ ] 2.3 被替换工具下线检查（模型可见性、行为对照、运行时下载消除验证）
- [ ] 2.4 桥成本评估记录：记录"桥接一个工具"的实际成本，作为吸收轨载体决定的证据

---

## Plan 3 — 配置动态化观察 ⬜

> **目标**：观察 dsh 的配置动态化机制（patch 声明式 entry 树、增量重扫、HMR），评估吸收成本。**只观察、不写设计**，积累认知直到有信心决定载体。
> **验收故事**：理解 dsh 配置动态化的完整机制与成本，形成吸收轨载体决定的输入。

- [ ] 3.1 观察 patch 声明式 entry 树机制（insert/disable/override）
- [ ] 3.2 观察增量重扫机制（dirty entry → microtask 刷新，只 diff 变更条目）
- [ ] 3.3 观察 HMR 机制（client-hmr row 监听 onRebuilt）
- [ ] 3.4 评估吸收成本：ellamaka 宿主层复刻这套机制的复杂度

---

## Plan 4 — 插件规范化观察 ⬜

> **目标**：观察 dsh 的插件规范化机制（Loader 动态装载、`loader.remove(entry)` 干净卸载、dual-face 前端 bundle），评估吸收成本。**只观察、不写设计**。
> **验收故事**：理解 dsh 插件规范化与动态插拔的完整机制与成本，形成吸收轨载体决定的输入。

- [ ] 4.1 观察 Loader 动态装载机制（`ctx.registry.plugin(Loader)` 挂载、`loader.remove(entryId)` 干净卸载）
- [ ] 4.2 观察 dual-face 前端 bundle 机制（后端 Loader 决定前端插件集、按需拉取、rev 哈希热更）
- [ ] 4.3 评估吸收成本：ellamaka 宿主层复刻这套机制的复杂度

---

## Plan 5 — 界面演进：iframe → 原生（远期）⬜

> **目标**：ellamaka 是独立产品，不是 dsh 的包装器。终局界面必然自己长，dsh 的 dual-face 前端 bundle 设计是反哺进 ellamaka 的设计。**依赖设计决定（吸收轨载体）**。
> **验收故事**：ellamaka 界面原生呈现 dsh 能力，不再用 iframe 完整包装 dsh 界面。

- [ ] 5.1 设计决定后启动（吸收轨载体确定）
- [ ] 5.2 界面演进方案设计

---

## 远期 — 发布层面 ⬜

> **目标**：PoC 是实验，不关注发布层面细节。设计决定后，dsh 成为可交付物时再处理。

- [ ] onboarding npm 安装（`npm install --omit=dev` 物化到 dsh 数据目录，幂等）
- [ ] 安装位置调整：`data/dsh/` → `$WOPAL_HOME/ellamaka/cache/dsh/`（更贴合缓存语义，单点改 DSH_HOME 默认解析）
- [ ] `.js` 构建产物：`@wopal/ellamaka-cordis` 需要 dist 构建产物才能被 Node 直接 import（当前 exports 指向 src）
- [ ] 完整端到端验证：desktop 启动后点 DSH 按钮看到完整 SPA（闭包已物化时）

---

## 进度记录

| 日期 | Plan | 记录 |
|------|------|------|
| 2026-08-16 | — | 文档创建；Plan 1–7 规划定稿 |
| 2026-08-17 | Plan 1 | Plan 1 实施完成（cordis 容器宿主 + spill 挂载）；用户验证通过 |
| 2026-08-20 | — | 确立 dsh 双引擎融合实验方向：新设计 `DESIGN-dsh-poc.md`（边实践边设计、桥/吸收双轨、微内核留白）。本文档按实验步骤重写（核心到外围）。PoC 定位为长期实验，不合并 main |
| 2026-08-20 | Plan 1 | Plan 1 接线完成：dsh 引擎进程内完整运行、动态装载保留、desktop sidecar 接线（提交 7a983fc397） |

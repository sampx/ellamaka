# PLAN-TODOS — dsh 双引擎融合实验实施计划与进度管理

> **用途**：本文档是 ellamaka 与 dsh 双引擎融合实验（`DESIGN-dsh-poc.md`）的实施进度管理中枢。
> **文档分工**：`DESIGN-dsh-poc.md` 管设计（设计哲学、双引擎现实、桥/吸收双轨、技术事实基线、当前约定、实验步骤）；本文档管实施节奏（分几个批次、每个批次做什么、做到哪了）。每个 Plan 启动实施时走 dev-flow 建 Plan 文档细化（TDD 用例、任务分解），本文档只跟踪 Plan 批次级进度。
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
| Plan 1 | 双引擎容器宿主 + 日志桥接（dsh 引擎进程内完整运行、动态装载、容器日志） | 核心 | 无 | ✅ 完成 | 接线 + 日志桥接 + spill/grep 废弃 |
| Plan 2 | 工具利用：fs-search 替换 grep/glob（桥首个实证） | 核心 | 无 | ⬜ | 3–5 天 |
| Plan 3 | 配置动态化观察：patch 声明式、增量重扫 | 吸收轨 | 无 | ⬜ | 按需 |
| Plan 4 | 插件规范化观察：dual-face、Loader 动态插拔 | 吸收轨 | 无 | ⬜ | 按需 |
| Plan 5 | 界面演进：iframe → 原生（远期） | 外围 | 设计决定后 | ⬜ | 按需 |
| 远期 | onboarding 安装、安装位置调整、发布层面 | 外围 | 设计决定后 | ⬜ | 单独立项 |

---

## Plan 1 — 双引擎容器宿主 + 日志桥接 ✅

> **目标**：dsh 引擎在 ellamaka 进程内完整运行，动态装载保留，容器日志可排查。本 Plan 并入双核心 PoC 接线 + 容器日志桥接，废弃 spill/grep 桥（无实际价值，后续工具利用直接复用 fs-search）。
> **验收故事**：dev 模式 `ELLAMAKA_DSH=1` 时 dsh 引擎挂载于 4098；desktop 模式 sidecar 加载闭包、随机端口通知 renderer。dsh 引擎 50+ 插件日志进独立 `dsh-plugins.log`，排查可读。控制台无 dsh 侧错误。

### 双核心接线（已完成）

- [x] 1.1 单容器重放 boot：`mountDshWeb(ctx, opts)` 在宿主 ctx 重放 dsh boot 序列，不创建第二个容器
- [x] 1.2 单包：dsh 装配并入 `ellamaka-cordis`（原独立 `ellamaka-dsh-host` 已删除）
- [x] 1.3 版本统一 0.1.0-rc.6（root overrides 锁 58 个 `@deepseek-ai/dsh-*`）
- [x] 1.4 `ELLAMAKA_DSH=1` 开关保留：开启挂载到进程级 CordisHub；关闭零 dsh 挂载
- [x] 1.5 修复 desktop 崩溃：`index.ts` 拆出 dsh-web 顶层导出（改子路径）+ `serve.ts` 动态 import；`dist/node/node.js` Node LOAD OK
- [x] 1.6 `installAnchor` 支持（`DshHostOptions.installAnchor`）
- [x] 1.7 前端 Workbench DSH 视图：顶栏 "DSH" 按钮 + 全屏 iframe 覆盖 SpaceRail + Workspace
- [x] 1.8 iframe src 读 dshPort（dev 回落 4098）
- [x] 1.9 desktop sidecar 接线：`bootDshWeb` + `$DSH_HOME` 缺省 + 闭包缺失 kill switch + dshPort 贯穿 ready→supervisor→preload→renderer

### 容器日志桥接（夯实中）

- [x] 1.10 `DshHostOptions` 加 `logFile`/`logLevel`：`mountDshWeb`/`bootDshWeb` 装配时注册 log exporter，dsh 插件日志进独立 `dsh-plugins.log`
- [x] 1.11 serve.ts（dev）传 `logFile` 到 `$WOPAL_HOME/logs/dsh-plugins.log`
- [x] 1.12 sidecar.ts（desktop）传 `logFile` 到 `$DSH_HOME/dsh-plugins.log`
- [x] 1.13 测试：dsh-web 装配写日志到独立文件（exporter probe 验证）

### 废弃 spill/grep 桥

- [x] 1.14 移除 `mountSpillPlugins` 挂载（`cordis-mount.ts` 不再挂 spill 三件套）
- [x] 1.15 移除 grep 桥（`createGrepBridgeLayer`/`GrepBridgeService` 退役，grep 回原生管道）
- [x] 1.16 清理 spill/grep 相关测试与代码（`spill/`、`tools/grep-bridge.ts`、`tools/registry.ts` 的 GrepBridgeService）
- [x] 1.17 回归收口：opencode 全量测试基线对照零新增失败 + 三包 typecheck

> **废弃理由（2026-08-20 用户定案）**：spill/grep 桥无实际价值。native grep 上游截断与 spill「全量转储」语义不匹配（匹配数爆炸场景 spill 存的是截断后结果，模型无法精确读回），spill 价值仅在「匹配少但行超长」场景成立。后续工具利用直接复用 fs-search（Plan 2），不再维护 spill/grep 桥。

### 旧 Plan 1 残留拆除（2026-08-21）

> **背景**：研究报告 §17.4 确立"一个完整容器 + per-directory scope"实例模型后，旧 Plan 1 的 per-instance hub 机制（每实例目录一个 CordisHub + turn-driver 桥 + `cordis-plugins.log`）成为被否决路线的残留（DESIGN-dsh-poc §3.4），与新方案构成替代关系。用户定案：彻底拆除，恢复到接线前状态，容器日志唯一保留 `dsh-plugins.log`。

- [x] 1.18 删除旧机制源码：`agent-loop.ts`、`turn-driver-layer.ts`、`layer.ts`（hub registry）、`tools/`（自持 ctx.tools）、`cordis-mount.ts`、`session/turn-driver.ts`
- [x] 1.19 还原接线：`prompt.ts` loop 回直接执行（接线前形态）、`httpapi/server.ts` 移除 turn-driver layer 与 registry invalidation
- [x] 1.20 删除旧机制测试：cordis 包 `agent-loop/turn-driver-layer/tools` 测试、opencode `test/cordis/`（turn-driver/als-cancel/log-exporter）、prompt.test.ts spy-driver 用例；裁剪 `hub.test.ts` 至 hub 生命周期
- [x] 1.21 收缩包公开面：`index.ts` 只导出 `CordisHub` + `createCordisLogExporter`；`types.ts` 去 agentLoop 声明；`package.json` 去 `./layer` 导出；还原 `core/util/log.ts` `currentLevel`
- [x] 1.22 文档同步：README 重写、DESIGN-dsh-poc §3.4/§6.4 更新（dsh-plugins.log 为唯一容器日志）

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
| 2026-08-20 | Plan 1 | **Plan 1 重新规划**：并入双核心 PoC + 容器日志桥接，废弃 spill/grep 桥（无实际价值，后续用 fs-search）。日志桥接补齐（dsh-plugins.log 独立文件，提交待定） |
| 2026-08-20 | Plan 1 | **Plan 1 完成**：spill/grep 桥废弃（提交 8d79bfd45e），cordis 9 pass + ellamaka-cordis 30 pass 全绿，零残留引用。Plan 1 全部 1.1–1.17 勾选完成 |
| 2026-08-21 | Plan 1 | **旧 Plan 1 残留拆除**：per-instance hub 机制（turn-driver 桥、hub registry、自持 ctx.tools、cordis-mount 装配、`cordis-plugins.log`）彻底退役，prompt loop 还原直接执行。容器日志唯一保留 `dsh-plugins.log`。§17.4 scope 模型为 instance 隔离的唯一承接方 |

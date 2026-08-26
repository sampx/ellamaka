# PLAN-TODOS — dsh 双引擎融合实验实施计划与进度管理

> **用途**：本文档是 ellamaka 与 dsh 双引擎融合实验（`DESIGN-dsh-poc.md`）的实施进度管理中枢。
> **文档分工**：`DESIGN-dsh-poc.md` 管设计（设计哲学、双引擎现实、桥/吸收双轨、技术事实基线、当前约定、实验步骤）；本文档管实施节奏（分几个批次、每个批次做什么、做到哪了）。每个 Plan 启动实施时走 dev-flow 建 Plan 文档细化（TDD 用例、任务分解），本文档只跟踪 Plan 批次级进度。
> **更新纪律**：任务完成即勾选；Plan 状态变更时更新总览表；架构变更回写设计文档，不沉淀在本文件。
> **创建时间**：2026-08-16（重构 2026-08-20；**2026-08-26 按盘点结论全量重写**）

## 状态图例

- ⬜ 未开始
- 🔶 进行中
- ✅ 已完成
- ⏸ 暂停（注明原因）
- ⊘ 取消（注明原因）

## 实验定位

**PoC 是长期实验，不合并 main**，直到设计决定（阶段 B escalation 桥接取舍，见 `DESIGN-dsh-poc.md` §3.2.5）做出。在此之前，本分支是实验场。实验顺序**从核心到外围**：核心是插件生态融合 + 工具利用，外围是发布层面细节。

## 2026-08-26 全量重写说明

本次重写基于对 dsh 工具插件的**源码级消费面盘点**（`DESIGN-dsh-poc.md` §4.9），确立了"先 A 后 B"双阶段路径：

- **阶段 A（工具在沙箱内运行）**：让 tool-fs / str_replace / tool-bash 在**沙箱后端**（`fs-sandbox` / `bash-sandbox`）下跑起来，验证沙箱底座 + 工具本体可行性。采用 dsh 工具的核心动机就是沙箱能力——ellamaka 现有文件/命令工具零沙箱。
- **阶段 B（待定）**：不接管 dsh 权限体系，权限继续走 ellamaka 原生；已记录思路（§3.2.5），核心小决策是 escalation 审批桥接，后期细化可行性，不可行则放弃。

已实施部分保留：P1 容器宿主 + 日志桥接、P2 grep/glob 落地。前置验证：macOS Seatbelt 沙箱实测可用（§4.10）。

## Plan 总览

| Plan | 名称 | 核心度 | 依赖 | 状态 | 规模 |
|------|------|--------|------|------|------|
| P1 | 双引擎容器宿主 + 日志桥接 | 核心 | 无 | ✅ 完成 | 接线 + 日志桥接 |
| P2 | 工具利用：fs-search（grep/glob）落地 | 核心 | P1 | ✅ 落地 | adapter 机制 + grep/glob |
| P3 | **阶段 A：tool-fs / str_replace / tool-bash 沙箱内运行** | 核心 | P2 | 🔶 当前重点 | 中 |
| P4 | **阶段 B：escalation 审批桥接（待定）** | 核心 | P3 | ⏸ 待定 | 后期细化 |
| P5 | 配置动态化观察：patch 声明式、增量重扫 | 吸收轨 | 无 | ⬜ | 按需 |
| P6 | 插件规范化观察：dual-face、Loader 动态插拔 | 吸收轨 | 无 | ⬜ | 按需 |
| P7 | 界面演进：iframe → 原生（远期） | 外围 | 设计决定 | ⬜ | 按需 |
| P8 | desktop 依赖安装：首次启动自动装 dsh 包 | 外围 | 设计决定 | ⬜ | 单独立项 |

---

## P1 — 双引擎容器宿主 + 日志桥接 ✅

> **目标**：dsh 引擎在 ellamaka 进程内完整运行，动态装载保留，容器日志可排查。本 Plan 并入双核心 PoC 接线 + 容器日志桥接，废弃 spill/grep 桥。
> **验收故事**：dev 模式 `ELLAMAKA_DSH=1` 时 dsh 引擎挂载于 4098；desktop 模式 sidecar 加载闭包、随机端口通知 renderer。dsh 引擎 50+ 插件日志进独立 `dsh-plugins.log`，排查可读。

### 双核心接线（已完成）

- [x] 1.1 单容器重放 boot：`mountDshWeb(ctx, opts)` 在宿主 ctx 重放 dsh boot 序列，不创建第二个容器
- [x] 1.2 单包：dsh 装配并入 `ellamaka-cordis`（原独立 `ellamaka-dsh-host` 已删除）
- [x] 1.3 版本统一 0.1.0-rc.6（root overrides 锁 58 个 `@deepseek-ai/dsh-*`）
- [x] 1.4 `ELLAMAKA_DSH=1` 开关保留：开启挂载到进程级 CordisHub；关闭零 dsh 挂载
- [x] 1.5 修复 desktop 崩溃：`index.ts` 拆出 dsh-web 顶层导出（改子路径）+ `serve.ts` 动态 import；`dist/node/node.js` Node LOAD OK
- [x] 1.6 `installAnchor` 支持（`DshHostOptions.installAnchor`）
- [x] 1.7 前端 Workbench DSH 视图：顶栏 "DSH" 按钮 + 全屏 iframe 覆盖 SpaceRail + Workspace
- [x] 1.8 iframe src 读 dshPort（dev 回落 4020）
- [x] 1.9 desktop sidecar 接线：`bootDshWeb` + `$DSH_HOME` 缺省 + 闭包缺失 kill switch + dshPort 贯穿 ready→supervisor→preload→renderer

### 容器日志桥接

- [x] 1.10 `DshHostOptions` 加 `logFile`/`logLevel`：装配时注册 log exporter，dsh 插件日志进独立 `dsh-plugins.log`
- [x] 1.11 serve.ts（dev）传 `logFile` 到 `$WOPAL_HOME/logs/dsh-plugins.log`
- [x] 1.12 sidecar.ts（desktop）传 `logFile` 到 `$DSH_HOME/dsh-plugins.log`
- [x] 1.13 测试：dsh-web 装配写日志到独立文件（exporter probe 验证）

### 废弃 spill/grep 桥

- [x] 1.14 移除 `mountSpillPlugins` 挂载（`cordis-mount.ts` 不再挂 spill 三件套）
- [x] 1.15 移除 grep 桥（`createGrepBridgeLayer`/`GrepBridgeService` 退役，grep 回原生管道）
- [x] 1.16 清理 spill/grep 相关测试与代码
- [x] 1.17 回归收口：opencode 全量测试基线对照零新增失败 + 三包 typecheck

> **废弃理由（2026-08-20 用户定案）**：spill/grep 桥无实际价值。native grep 上游截断与 spill「全量转储」语义不匹配。后续工具利用直接复用 fs-search。

### 旧 P1 残留拆除（2026-08-21）

- [x] 1.18 删除旧机制源码（per-instance hub 机制）
- [x] 1.19 还原接线：`prompt.ts` loop 回直接执行
- [x] 1.20 删除旧机制测试
- [x] 1.21 收缩包公开面：`index.ts` 只导出 `CordisHub` + `createCordisLogExporter`
- [x] 1.22 文档同步：README 重写、DESIGN-dsh-poc §3.4/§6.4 更新

---

## P2 工具利用：fs-search（grep/glob）落地 ✅

> **目标**：dsh fs-search（自带 ripgrep 二进制、VCS 排除、超时治理）替换原生 grep/glob，消灭运行时下载问题。这是**桥轨首个实证**。
> **挂载方式**：见 `DESIGN-dsh-poc.md` §3.2.3。

- [x] 2.1 工具容器 + adapter 机制搭建（`mountDshTools` + `dsh-adapter` 投影，零 session）
- [x] 2.2 grep/glob 映射落地：`tools: [{source: grep, target: grep}, {source: glob, target: glob}]`
- [x] 2.3 schema 投影修复：adapter 把 dsh JSON Schema 解包为 ZodRawShape，registry 走 zod 路径（修复 serve 模式 `missing required property`）
- [x] 2.4 调用日志：adapter 经容器 logger 记录每次调用，落入 dsh-plugins.log
- [x] 2.5 验证：TUI grep ✅、serve grep ✅（重启后）；adapter 单测 10 项；双容器并存零 session 断言

> **成本记录（2.5）**：grep/glob 是最干净样本（纯形状 A，只喂 `header.cwd`+`header.id`）。adapter 代码 190 行 + 测试 220 行，其中大部分是通用机制（schema 投影、日志、per-call context），非 grep 专属。**基建已付清，后续每工具边际成本极低**——这是"桥接一个工具"的实证成本，记录为吸收轨载体决定的证据。

---

## P3 阶段 A：tool-fs / read / str_replace / tool-bash 沙箱内运行 🔶

> **目标**：让 tool-fs（read/write/edit）、str_replace_editor、tool-bash 在**沙箱后端**（`fs-sandbox` / `bash-sandbox`）下接入工具容器，adapter 喂 session 形状。**采用 dsh 工具的核心动机就是沙箱能力**——ellamaka 现有文件/命令工具零沙箱，A 阶段不用非沙箱后端。
> **原理**：容器装配 `fs-sandbox` / `bash-sandbox` 后 `ctx.fs.sandboxMode` / `ctx.shell.sandboxMode` 有值，`sandboxPolicy.resolve()` 折叠 `session.events` 中缺省的模式覆盖、回落进程级默认模式。adapter 喂 `session.header.cwd` + `session.header.id` + `session.events: []`。`approval`/`jobs` 非硬依赖（`ctx.get` 降级，§4.9）。
> **沙箱模式配置**：不用环境变量。空间 `.wopal/config/settings.jsonc` 配置 dsh 沙箱模式，adapter 按空间注入 `sandbox/mode` 事件（§4.10）。进程级默认仅兜底。
> **验收故事**：模型可见 read/write/edit/str_replace/bash 来自 dsh；这些工具在沙箱内读写文件、执行命令，沙箱底座生效（受限读写、read-first 门禁、模式决议可用）；不引入审批流（阶段 B 待定）。
> **前置验证**：macOS Seatbelt 沙箱实测可用（§4.10）。

### P3.1 tool-fs（read / write / edit）接入

- [ ] 3.1.1 容器装配：工具容器改用 `fs-sandbox`（沙箱 fs 后端），确认 `ctx.fs.sandboxMode` 有值
- [ ] 3.1.2 adapter 映射：`tools: [{source: read, target: read}, {source: write, target: write}, {source: edit, target: edit}]`
- [ ] 3.1.3 补 session 形状：adapter 喂 `session.header.cwd` + `session.events: []`（write/edit 的 sessionResolveOptions 消费）
- [ ] 3.1.4 read-first 门禁确认：沙箱后端默认 mode 下 read 放行、write/edit 受限（read-first 门禁生效）
- [ ] 3.1.5 测试：tool-fs 三工具在容器内读写文件行为正确；adapter 投影 schema 正确（read 无参、write 有 file_path/content）
- [ ] 3.1.6 验证：模型可见 read/write/edit；写文件成功且沙箱限制生效；与原生文件工具并存或覆盖的取舍记录

### P3.2（str_replace_editor）接入

- [ ] **预读**：`tool-str-replace-editor/src/index.ts`（用绝对路径，不读 session.cwd，走 `ctx.fs` 解析）
- [ ] **设计**：str_replace_editor 依赖 `tools`+`fs`，用绝对路径；沙箱后端下 `ctx.fs.sandboxMode` 有值 → 走 MutationPolicy.resolve（read-first 门禁）
- [ ] 3.2.1 adapter 映射：`tools: [{source: str_replace_editor, target: str_replace_editor}]`
- [ ] 3.2.2 测试：view/create/str_replace/insert 四命令在容器内行为；绝对路径解析正确；沙箱内受限操作受门禁约束
- [ ] 3.2.3 边界：str_replace_editor 需绝对路径，adapter 无需喂 cwd（工具自解析）

### P3.3（tool-bash）接入

- [ ] **预读**：`tool-bash/src/index.ts`（依赖 shell/shellEnv；shellEnv 是硬依赖）
- [ ] **预读**：`shell/bash-sandbox/src/index.ts`（沙箱 bash 后端，sandboxMode 有值）
- [ ] **设计**：tool-bash 需要 `ctx.shell`（bash-sandbox）+ `ctx.shellEnv`。前者沙箱；后者 declared inject 必须提供。需确认 shell-env 是否依赖 session-persistence（`ctx.get` 可选）
- [ ] 3.3.1 容器装配 `bash-sandbox`（沙箱）+ `shell-env`；确认 `ctx.shell.sandboxMode` 有值
- [ ] 3.3.2 adapter 映射：`tools: [{source: bash, target: bash}]`；喂 `session.header.cwd`（workdir 回落）
- [ ] 3.3.3 shellEnv 接入：提供 `shellEnv.collect(exec)` 的最小实现（读 header.id 即可），或确认容器自带
- [ ] 3.3.4 测试：bash 命令在容器内沙箱执行正确；workdir 回落 session cwd；沙箱限制生效
- [ ] 3.3.5 边界：`run_in_background` 需 jobs（阶段 A 可禁用 `enableRunInBackground: false`，或评估）

### P3.4 阶段 A 验证收口

- [ ] 3.4.1 回归：tool-fs/str_replace/bash 行为对照原生；沙箱限制生效；adapter 测试全绿；typecheck
- [ ] 3.4.2 桥成本记录：记录"沙箱内运行三类工具"的实际成本（复用 §2.5 的基建，边际成本应低）
- [ ] 3.4.3 文档：DESIGN §3.2.4 更新（工具沙箱内运行现状）、PLAN 勾选
- [ ] 3.4.4 settings.jsonc 沙箱模式配置接入（§4.10），模式切换生效验证

---

## P4 阶段 B：escalation 审批桥接（待定） ⏸

> **状态**：待定，只记录思路、不实施。dag 权限体系接管已放弃（dsh approval/permission-presets 为 dsh 自身 UI 闭环服务，接管成本极高、收益为零）。权限继续走 ellamaka 原生体系，沙箱只当执行底座（§3.2.5）。
> **思路**：唯一待定的子问题是 escalation——模型写入被沙箱拒绝后主动申请更宽模式（`sandbox_permissions` + `justification`）的审批通道。候选：① 桥接到 ellamaka ask；② 不做，用户从 UI 切模式重试。后期细化可行性，不可行则放弃。

- [ ] 4.1 细化 escalation 桥接方案（approveEscalation → Permission.ask 通道）
- [ ] 4.2 评估成本；不可行即放弃，记录结论

---

## P5 配置动态化观察：patch 声明式、增量重扫 ⬜

> **目标**：观察 dsh 的配置动态化机制（patch 声明式 entry 树、增量重扫、HMR），评估吸收成本。**只观察、不写设计**，积累认知直到有信心决定载体。
> **验收故事**：理解 dsh 配置动态化的完整机制与成本，形成吸收轨载体决定的输入。

- [ ] 5.1 观察 patch 声明式 entry 树机制（insert/disable/override）
- [ ] 5.2 观察增量重扫机制（dirty entry → microtask 刷新，只 diff 变更条目）
- [ ] 5.3 观察 HMR 机制（client-hmr row 监听 onRebuilt）
- [ ] 5.4 评估吸收成本：ellamaka 宿主层复刻这套机制的复杂度

---

## P6 插件规范化观察：dual-face、Loader 动态插拔 ⬜

> **目标**：观察 dsh 的插件规范化机制（Loader 动态装载、`loader.remove(entry)` 干净卸载、dual-face 前端 bundle），评估吸收成本。**只观察、不写设计**。
> **验收故事**：理解 dsh 插件规范化与动态插拔的完整机制与成本，形成吸收轨载体决定的输入。

- [ ] 6.1 观察 Loader 动态装载机制（`ctx.registry.plugin(Loader)` 挂载、`loader.remove(entryId)` 干净卸载）
- [ ] 6.2 观察 dual-face 前端 bundle 机制（后端 Loader 决定前端插件集、按需拉取、rev 哈希热更）
- [ ] 6.3 评估吸收成本：ellamaka 宿主层复刻这套机制的复杂度

---

## P7 界面演进：iframe → 原生（远期）⬜

> **目标**：ellamaka 是独立产品，不是 dsh 的包装器。终局界面必然自己长，dsh 的 dual-face 前端 bundle 设计是反哺进 ellamaka 的设计。**依赖设计决定（§3.2.5）**。
> **验收故事**：ellamaka 界面原生呈现 dsh 能力，不再用 iframe 完整包装 dsh 界面。

- [ ] 7.1 设计决定后启动（阶段 B 权限决定）
- [ ] 7.2 界面演进方案设计

---

## 远期 — 发布层面 ⬜

> **目标**：PoC 是实验，不关注发布层面细节。设计决定后，dsh 成为可交付物时再处理。

- [ ] onboarding npm 安装（`npm install --omit=dev` 物化到 dsh 数据目录，幂等）
- [ ] 安装位置调整：`data/dsh/` → `$WOPAL_HOME/ellamaka/cache/dsh/`（更贴合缓存语义）
- [ ] `.js` 构建产物：`@wopal/ellamaka-cordis` 需要 dist 构建产物才能被 Node 直接 import
- [ ] 完整端到端验证：desktop 启动后点 DSH 按钮看到完整 SPA（闭包已物化时）

---

## 进度记录

| 日期 | Plan | 记录 |
|------|------|------|
| 2026-08-16 | — | 文档创建；Plan 1–7 规划定稿 |
| 2026-08-17 | P1 | P1 实施完成（cordis 容器宿主 + spill 挂载）；用户验证通过 |
| 2026-08-20 | — | 确立 dsh 双引擎融合实验方向：新设计 `DESIGN-dsh-poc.md`；文档按实验步骤重写 |
| 2026-08-20 | P1 | P1 接线完成（提交 7a983fc397） |
| 2026-08-20 | P1 | **P1 重新规划**：并入双核心 PoC + 容器日志桥接，废弃 spill/grep 桥 |
| 2026-08-20 | P1 | **P1 完成**：spill/grep 桥废弃（提交 8d79bfd45e），零残留引用 |
| 2026-08-21 | P1 | 旧 P1 残留拆除：per-instance hub 机制退役 |
| 2026-08-26 | — | **全量重写**：对 dsh 工具源码级消费面盘点（§4.9），确立"先 A 后 B"双阶段；grep/glob 已落地；工具选型修正（fs-observation-policy 不再单独采用，跟随 tool-fs） |
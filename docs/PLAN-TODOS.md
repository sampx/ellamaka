# PLAN-TODOS — dsh 双引擎融合实验实施计划与进度管理

> **用途**：本文档是 ellamaka 与 dsh 双引擎融合实验（`DESIGN-dsh-poc.md`）的实施进度管理中枢。
> **文档分工**：`DESIGN-dsh-poc.md` 管设计（设计哲学、双引擎现实、桥/吸收双轨、技术事实基线、当前约定、实验步骤）；本文档管实施节奏（分几个批次、每个批次做什么、做到哪了）。每个 Plan 启动实施时走 dev-flow 建 Plan 文档细化（TDD 用例、任务分解），本文档只跟踪 Plan 批次级进度。
> **更新纪律**：任务完成即勾选；Plan 状态变更时更新总览表；架构变更回写设计文档，不沉淀在本文件。
> **创建时间**：2026-08-16（重构 2026-08-20；**2026-08-26 按盘点结论全量重写**）

## 状态图例

- ⬜ 未开始
- 📋 已规划（正式 Plan 已提交审阅，尚未实施）
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
| P3 | **阶段 A：tool-fs / str_replace / tool-bash 沙箱内运行** | 核心 | P2 | 🔶 P3.5 收尾 | 中 |
| P3.5+ | **DSH home 收口**：物化到 `$WOPAL_HOME/dsh` 唯一 home（P4 Plan Task 0） | 基础 | 无 | 📋 随 P4 Plan 审阅 | 小 |
| P4 | **DSH Web 单端口统一：同源挂载 `/dsh/*`** | 核心 | P1；执行排在 Task 0 后 | 📋 正式 Plan reviewing | 大 |
| P6 | 配置动态化实证整理：patch 覆盖与生命周期 | 吸收轨 | P4 | ⬜ | 小 |
| P7 | 插件规范化实证整理：Loader、dual-face、卸载 | 吸收轨 | P4 | ⬜ | 小 |
| P8 | 界面演进：同源 iframe → 原生（远期） | 外围 | P4 + P5 决策 | ⬜ | 按需 |
| P9 | desktop 依赖安装：首次启动自动装 dsh 包 | 交付 | P4 + 交付决定 | ⬜ | 单独立项 |

### 推荐实施顺序

`Task 0（home 收口）→ P4 → P3.6 → P5 → P6/P7 → P8 → P9`

1. **Task 0 先行**：DSH home 收口是单端口挂载链路的前置基础，随 P4 Plan 一起审阅，审批后 Wave 0 实施。
2. **P4 随后实施**：单端口统一与 P3.5 技术上独立，但共享长期 PoC 工作树。顺序执行可避免 dsh 装配文件并发修改。
3. **P3.6 延后到 P4 之后**：skill 目录模型输入属于独立缓存优化，不阻塞单端口目标。
4. **P5 保持暂停**：escalation 需要独立产品决策。P4 不引入权限体系变化。
5. **P6/P7 从 P4 提取实证**：P4 会真实使用 patch 覆盖、Loader 生命周期与官方 dual-face 插件，无需先做抽象观察。
6. **P8 建立在 P4 的同源基线上**：先稳定 iframe 的服务边界，再决定原生 UI 替换。
7. **P9 继续属于交付阶段**：单端口完成后再处理打包版闭包安装，避免固化双端口协议。

---

## P1 — 双引擎容器宿主 + 日志桥接 ✅

> **目标**：dsh 引擎在 ellamaka 进程内完整运行，动态装载保留，容器日志可排查。本 Plan 并入双核心 PoC 接线 + 容器日志桥接，废弃 spill/grep 桥。
> **验收故事**：dev 模式 `ELLAMAKA_DSH=1` 时 dsh 引擎挂载于 4098；desktop 模式 sidecar 加载闭包、随机端口通知 renderer。dsh 引擎 50+ 插件日志进独立 `dsh-plugins.log`，排查可读。

### 双核心接线（已完成）

- [x] 1.1 单容器重放 boot：`mountDshWeb(ctx, opts)` 在宿主 ctx 重放 dsh boot 序列，不创建第二个容器
- [x] 1.2 单包：dsh 装配并入 `ellamaka-cordis`（原独立 `ellamaka-dsh-host` 已删除）
- [x] 1.3 版本统一 0.1.1-rc.2（依赖锁定交给 `bun.lock`；root overrides 中的 dsh 锁已于 2026-08-27 移除，`ellamaka-cordis` 只显式声明源码真实 import 的 7 个 dsh 依赖）
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

- [x] 3.1.1 容器装配：工具容器使用 `fs-sandbox`（沙箱 fs 后端），`ctx.fs.sandboxMode` 为 `workspace-write`
- [x] 3.1.2 adapter 映射：`tools: [{source: read, target: read}, {source: write, target: write}, {source: edit, target: edit}]`
- [x] 3.1.3 补 session 形状：adapter 喂 `session.header.cwd` + `session.events: []`，并按 ellamaka session ID 复用 facade 对象
- [x] 3.1.4 read-first 门禁确认：read 放行；未读 edit 返回 `FS_NOT_OBSERVED`；工作区外 write 返回 `FS_SANDBOX_DENIED`
- [x] 3.1.5 测试：tool-fs 三工具在容器内读写文件行为正确；adapter 投影 schema 保留 read 的 `file_path`、write 的 `file_path/content` 与沙箱 escalation 字段
- [x] 3.1.6 验证：真实容器经 adapter 投影 read/write/edit；工作区写入成功且沙箱限制生效。同名 target 覆盖原生工具，adapter 在执行前复用 ellamaka 的 read/edit 与 external_directory 权限门禁。

### P3.2（str_replace_editor）接入

- [x] **预读**：`tool-str-replace-editor/src/index.ts`（用绝对路径，走 `ctx.fs` 解析）
- [x] **设计**：str_replace_editor 依赖 `tools`+`fs`，以绝对路径解析；沙箱后端下 `ctx.fs.sandboxMode` 有值，MutationPolicy.resolve 以 facade session 决议模式与工作区根，fs-observation-policy 负责 read-first 门禁
- [x] 3.2.1 adapter 映射：`tools: [{source: str_replace_editor, target: str_replace_editor}]`
- [x] 3.2.2 测试：view/create/str_replace/insert 四命令在容器内行为正确；相对路径拒绝；未观察编辑与工作区外创建均受沙箱门禁约束
- [x] 3.2.3 边界：str_replace_editor 的目标路径必须绝对；路径解析不使用 session cwd，facade cwd 继续作为 sandboxPolicy 的工作区根，facade 对象身份继续承载观察状态

### P3.3（tool-bash）接入

- [x] **预读**：`tool-bash/src/index.ts`（依赖 shell/shellEnv；shellEnv 是硬依赖）
- [x] **预读**：`shell/bash-sandbox/src/index.ts`（沙箱 bash 后端，sandboxMode 有值）
- [x] **设计**：tool-bash 使用 `ctx.shell`（bash-sandbox）与容器现有的 `shellEnv`；shellEnv 对缺失 session-persistence 以 `ctx.get` 降级
- [x] 3.3.1 容器装配 `bash-sandbox`（沙箱）+ `shell-env`；`ctx.shell.sandboxMode` 为 `workspace-write`
- [x] 3.3.2 adapter 映射：`tools: [{source: bash, target: bash}]`；facade `session.header.cwd` 作为默认 workdir 与 sandboxPolicy 工作区根
- [x] 3.3.3 shellEnv 接入：容器已提供 `shellEnv.collect(exec)`，为 facade session 注入 `DSH_SESSION_ID`
- [x] 3.3.4 测试：bash 在容器内以 session cwd 运行；工作区写入成功；工作区外写入以 sandbox denial 返回
- [x] 3.3.5 边界：容器禁用 `run_in_background`，避免依赖未装配的 jobs；schema 隐藏该字段，强制传入时由 dsh 拒绝

### P3.4 阶段 A 验证收口

- [x] 3.4.1 回归：tool-fs、str_replace_editor 与 bash 的真实容器投影均通过；workspace-write、read-first 和工作区外拒写生效；adapter 13 项、dsh-web 8 项、真实 adapter 3 项测试与 typecheck 全绿
- [x] 3.4.2 桥成本记录：P3.1 扩展 facade 与原生权限门禁；P3.2 复用既有 fs-sandbox 无新增容器装配；P3.3 只增加前台 bash 配置与权限投影。三类工具复用同一 adapter、容器和沙箱底座，边际实现量保持很低
- [x] 3.4.3 文档：DESIGN §3.2.4 更新工具沙箱内运行现状，PLAN 记录全部 P3.1–P3.3 验证结论
- [x] 3.4.4 settings.jsonc 沙箱模式配置接入（§4.10），模式切换生效验证

### P3.5 动态装配收尾：每轮读当前 dsh registry + 修正 enabled:false 语义 🔶

> **目标**：让 dsh 插件动态加载/卸载后，下一轮模型请求自动看到新 native tools 集合；修正 P3.4.4 中 `enabled:false` 的语义错误（见 §4.10/§4.11）。
> **原理**：dsh 每轮（pre-step）都重新装配 `assembly.tools`，仅是内存级重建（微秒级）；工具集合不变且按稳定顺序排列、字节一致时，重建不破坏缓存。动态装配的正确含义是"每轮读当前 registry 得到最新集合"，而非"每轮改动 schema"。
> **验收故事**：dsh 插件加载新工具 → 下一轮请求 `tools` 出现新工具；卸载同名工具 → builtin 自动恢复；`enabled:false` 真正关闭沙箱（注入 `danger-full-access`），不再回落容器默认 `workspace-write`。

- [x] 3.5.1 adapter 改为每轮模型调用前读取当前 dsh registry（`container.get("tools").schemas()`），不再启动时冻结
- [x] 3.5.2 ToolRegistry 增加每请求动态工具提供者：builtin + 静态插件工具 + 当前 dsh 工具，按工具名覆盖（dsh 赢），稳定排序
- [x] 3.5.3 修正 `enabled:false`：注入 `danger-full-access` 关闭沙箱，不切换本地后端
- [x] 3.5.4 测试：工具集合变化后下一轮请求反映新集合；未变化时字节稳定、缓存不破坏；关沙箱后工作区外写入放行

### P3.6 skill 目录模型输入改造：目录从 system + tool description 移到历史尾部 ⬜

- [ ] 3.6.1 从 `session/system.ts` 的 `sys.skills()` 移除动态目录输出
- [ ] 3.6.2 从 `tool/registry.ts` 的 `describeSkill()` 移除动态目录，`skill` 工具 description 变为固定文本
- [ ] 3.6.3 新增持久 skill catalog 投影：初始完整目录 + digest 变化时完整替换 + 空 tombstone + source metadata
- [ ] 3.6.4 测试：skill 增删只追加历史尾部消息，system/tool schema 不变；正文仅在调用 `skill(name)` 后作为 tool result 出现

---

## P4 DSH Web 单端口统一 📋

> **目标**：Ellamaka 与 DSH Web 共用进程和公开端口。Ellamaka 保持现有 `/api/*` 与 `/workbench`；DSH 统一挂载 `/dsh/*`，Workbench iframe 使用同源 `/dsh/`。
> **设计**：`VirtualWebServer` 保存官方 DSH 插件注册的 node:http 路由与 upgrade socket，实现含 `renderIndex` 结构化注入在内的官方 WebServer 接口。Ellamaka Server 提供受控 Node 路由挂载点并剥离 `/dsh`。官方 connection、client-hmr、modules、web-runtime 与 UI 插件保持原版；`web-runtime` 的根路径 URL 输出与注入被关闭。iframe index 注入浏览器传输前缀适配，并重写 DSH 静态资源根路径。详见 `DESIGN-dsh-poc.md` §2.1。
> **执行依赖**：技术依赖 P1。前置 Task 0（DSH home 收口）随本 Plan 实施，复用当前长期 PoC 工作树；P3.6 延后到本批次之后。
> **验收故事**：`http://127.0.0.1:4097/dsh/` 加载完整 DSH 界面；DSH API/WS/HMR/插件资源全部走 `/dsh/*`；Ellamaka `/api/*` 不受影响；dev 与 Desktop 不再监听或传递第二个 dshPort。
> **正式 Plan**：`.wopal-space/plans/ellamaka/feature-dsh-unify-web-services-on-one-port.md`（reviewing）

### P4.1 Ellamaka Node 路由挂载点

- [ ] 4.1.1 新增受控 prefix mount registry，统一分发 HTTP 与 upgrade 请求
- [ ] 4.1.2 `/dsh` 与 `/dsh/*` 边界匹配并保留 query；非匹配请求继续进入 Effect listener
- [ ] 4.1.3 注册返回 disposer；Server shutdown 保持 Effect/NodeHttpServer 所有权

### P4.2 VirtualWebServer 与 iframe 前缀适配

- [ ] 4.2.1 实现官方 WebServer 接口（含 `collectIndexInjections`/`renderIndex` 结构化注入）与 exact / longest-prefix / fallback / exact-upgrade 语义
- [ ] 4.2.2 index 变换添加 `/dsh` 静态资源前缀并移除 iframe 不需要的 PWA manifest
- [ ] 4.2.3 index 最前注入 fetch / WebSocket / EventSource 前缀适配；外部 URL 与已带 `/dsh` URL 保持不变
- [ ] 4.2.4 upgrade socket 由 VirtualWebServer 跟踪并在 dispose 时销毁

- [ ] 4.3.1 Loader 挂载前提供 VirtualWebServer，只禁用官方真实 `webserver` 行
- [ ] 4.3.2 保留 `web-startup`、connection、client-hmr、modules、web-runtime 与全部 UI 插件；`web-runtime` 的根路径 URL 打印与 shell/prompt 注入被关闭
- [ ] 4.3.3 Web host handle 暴露 VirtualWebServer 与 dispose；工具容器 API 保持独立

### P4.4 CLI serve 单端口接线

- [ ] 4.4.1 `serve.ts` 将 DSH VirtualWebServer 注册到 Listener `/dsh` mount
- [ ] 4.4.2 生命周期 disposer 与 web/tools CordisHub 一起清理
- [ ] 4.4.3 验证 Ellamaka API、DSH HTTP、WebSocket 与插件资源共享一个端口

### P4.5 Desktop 与 Workbench 同源收口

- [ ] 4.5.1 Desktop sidecar 在本地 Ellamaka Listener 上挂载 DSH，不再启动随机第二端口
- [ ] 4.5.2 删除 ready → supervisor → preload → renderer → Platform 的 `dshPort/getDshPort` 透传链
- [ ] 4.5.3 Workbench iframe 固定使用 `/dsh/`；无 DSH 闭包时继续自然降级

### P4.6 回归、端到端与文档收口

- [ ] 4.6.1 单元测试覆盖 route mount、VirtualWebServer、URL 适配与 profile patch
- [ ] 4.6.2 集成验证覆盖 `/dsh/`、静态资源、RPC、WS、HMR 与 Ellamaka `/api/*` 隔离
- [ ] 4.6.3 CLI、Workbench、Desktop 三包 typecheck/test/build 通过
- [ ] 4.6.4 实施完成后将 DESIGN §2 双端口现状更新为单端口现实，并记录 P6/P7 的后续实证输入

---

## P5 阶段 B：escalation 审批桥接（待定） ⏸

> **状态**：待定，只记录思路、不实施。dag 权限体系接管已放弃（dsh approval/permission-presets 为 dsh 自身 UI 闭环服务，接管成本极高、收益为零）。权限继续走 ellamaka 原生体系，沙箱只当执行底座（§3.2.5）。
> **思路**：唯一待定的子问题是 escalation——模型写入被沙箱拒绝后主动申请更宽模式（`sandbox_permissions` + `justification`）的审批通道。候选：① 桥接到 ellamaka ask；② 不做，用户从 UI 切模式重试。后期细化可行性，不可行则放弃。

- [ ] 5.1 细化 escalation 桥接方案（approveEscalation → Permission.ask 通道）
- [ ] 5.2 评估成本；不可行即放弃，记录结论

---

## P6 配置动态化实证整理：patch 声明式、增量重扫 ⬜

> **目标**：以 P4 的真实 patch 覆盖与 mount/dispose 证据为输入，整理 dsh 配置动态化机制与吸收成本。
> **验收故事**：形成可复用的 patch 声明、增量重扫与生命周期事实，不从抽象源码观察重新开始。

- [ ] 6.1 汇总 P4 的 webserver disable + host service replacement 证据
- [ ] 6.2 观察增量重扫机制（dirty entry → microtask 刷新，只 diff 变更条目）
- [ ] 6.3 记录 client-hmr graph/rebuilt 生命周期在单端口下的行为
- [ ] 6.4 评估 ellamaka 宿主吸收 patch 机制的成本

---

## P7 插件规范化实证整理：dual-face、Loader 动态插拔 ⬜

> **目标**：以 P4 保留官方 dual-face 插件并替换 WebServer host service 的实证为输入，整理 Loader 动态装载与卸载规律。
> **验收故事**：明确 Ellamaka 可直接采用的 Loader/dual-face 机制，以及继续保持 DSH 原生的部分。

- [ ] 7.1 汇总 Loader 挂载、`loader.remove(entryId)` 与 VirtualWebServer disposer 证据
- [ ] 7.2 汇总 dual-face boot graph、按需 bundle 与 rev 热更在 `/dsh` 下的行为
- [ ] 7.3 评估 ellamaka 宿主吸收 Loader/dual-face 机制的成本

---

## P8 界面演进：同源 iframe → 原生（远期）⬜

> **目标**：ellamaka 是独立产品，不是 dsh 的包装器。终局界面由 ellamaka 原生承载，P4 的同源 iframe 是稳定过渡边界。**依赖 P4 与设计决定（§3.2.5）**。
> **验收故事**：ellamaka 界面原生呈现 dsh 能力，不再用 iframe 完整包装 dsh 界面。

- [ ] 8.1 设计决定后启动（阶段 B 权限决定）
- [ ] 8.2 以 `/dsh` 同源能力边界为输入编写界面演进方案

---

## P9 Desktop 依赖安装与发布收口 ⬜

> **目标**：PoC 设计决定完成后，让打包版 Desktop 自动物化 dsh 闭包并验证单端口运行。P4 先移除 dshPort 协议，P9 再处理安装与发布。

- [ ] onboarding 安装（复用 Task 0 物化脚本语义物化到 `$DSH_HOME`，缺省 `$WOPAL_HOME/dsh`，幂等）
- [ ] `.js` 构建产物：`@wopal/ellamaka-cordis` 需要 dist 构建产物才能被 Node 直接 import（届时同步移除 sidecar loader 的 `.ts` 解析覆盖）
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
| 2026-08-26 | P3.1 | read/write/edit 经真实工具容器与 adapter 接入；workspace-write、read-first 和工作区外拒写均已实证 |
| 2026-08-26 | P3.2 | str_replace_editor 经真实工具容器与 adapter 接入；四个命令、绝对路径、read-first 与工作区外拒写均已实证 |
| 2026-08-26 | P3.3 | bash 经真实工具容器与 adapter 接入；session cwd、workspace-write 与工作区外拒写均已实证，后台任务保持禁用 |
| 2026-08-26 | P3.4.4 | settings.jsonc 沙箱模式配置接入：adapter 解析 `ellamaka.dsh.sandbox`，enabled 注入 sandbox/mode 事件、mode 限 read-only/workspace-write，enabled:false 不注入；单测 16 项全绿 |
| 2026-08-27 | P4 | 单端口目标定案：保留官方 connection/HMR/modules/UI 插件；VirtualWebServer + `/dsh` Node mount + iframe 前缀适配；后续批次重排为 P5–P9 |
| 2026-08-27 | P3.5 | **动态装配收尾完成**：Plugin SDK 新增 `tool.provider` hook，`ToolRegistry.tools()` 每轮合并动态工具（dsh 同名赢、新 id 稳定排序，未变集合字节稳定）；adapter 改动态投影、不再启动时冻结；`enabled:false` 修正为注入 `danger-full-access` 关闭沙箱（不切换本地后端）。真实容器实证 danger-full-access 放行工作区外写入、workspace-write 拒写不回归；registry 单测 19 项 + adapter 单测 18 项全绿 |
| 2026-08-28 | — | **工具结果契约映射设计定案**（`DESIGN-dsh-poc.md` §4.13）：adapter 一处补齐两处契约断裂（`file_path`→`filePath` 参数映射、`meta.diffs`→`filediff` 透传），前端零改动；实施待 dev-flow Plan |
| 2026-08-28 | P4 | **P4 Plan 修订**：按审查结论补齐 VirtualWebServer 的 `renderIndex`/结构化 index 注入契约（D-11）、upgrade socket 生命周期（D-12）、`web-runtime` 根路径 URL 输出关闭（D-05 修订）；物化脚本路径定为 `packages/opencode/script/materialize-dsh.ts` 且验证含 Node strip-types 导入冒烟；DSH home 收口并入 P4 Plan Task 0，批次表新增 P3.5+ 行 |

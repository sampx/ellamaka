# DESIGN-dsh-poc — dsh 双引擎融合实验设计

> **状态**: Active（实验性设计，随实践演进）
> **创建时间**: 2026-08-20
> **上级架构**: `DESIGN.md`
> **研究依据**: `research/deepseek-harness-architecture-and-integration-research.md`、`research/dsh-web-dual-engine-poc.md`

## 1. Role

本文档是 ellamaka 与 dsh（DeepSeek Harness）双引擎融合实验的架构真相源。它定义实验的设计哲学、双引擎现实、桥/吸收双轨策略、技术事实基线、红线边界与实验步骤。

本文档取代 `DESIGN-refactor-cordis.md` 与 `DESIGN-capabilities.md`（已删除）。历史文档中的技术事实已榨取沉淀于本文档 §6；历史文档中的设计转向结论（cordis 降级、Effect 原生主线）被抹去——本实验回到 cordis 微内核愿景 + 双引擎现实重新演进。

## 2. 设计哲学：边实践边设计

### 2.1 核心原则

**不预先决定"复刻 vs 复用"，用起来收集证据，直到有信心再决定。**

ellamaka 对 dsh 的了解仍处于皮毛阶段，无法准确评估复刻的成本代价、复用的范围与难度。因此本实验**不决定**吸收轨的载体（ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制），而是：

1. **先用起来**：让 dsh 在 ellamaka 进程内完整运行，边用边熟悉 dsh 机理。
2. **边用边收集证据**：每个"桥"或"吸收"的实践，都回答一个成本问题。
3. **直到有信心再决定**：当证据足够时，才做吸收轨载体的最终决定。

### 2.2 为什么"不决定"是正确策略

"不决定"保留所有选项。它把决定推迟到信息最充分的时刻，避免在信息不足时锁死方向。这正是"桥不了该吸收"的落地方式——先用桥，桥贵了自然转向吸收。

### 2.3 心智负担管理

前几次设计转向（cordis 主线 → Effect 原生主线 → 双引擎）造成心智负担。本实验通过**单一真相源**（本文档）+ **单一实施计划**（`PLAN-TODOS.md`）降低负担：明确思路，不再徘徊。

## 3. 双引擎现实（PoC 成果）

### 3.1 终局方案：单进程、双端口 + iframe 嵌入

dsh 引擎在 ellamaka 进程内 boot，用原生 webserver 绑第二个 loopback 端口；前端用 iframe 加载该端口，实现零改动、零冲突、双引擎同进程并存。

```
ellamaka serve / sidecar (单进程)
├── ellamaka 引擎 + HttpApi server  → 127.0.0.1:4097  (/api/provider, /workbench 等)
└── dsh 引擎 (boot 装配) + 原生 webserver → 127.0.0.1:4098 (或随机端口)  (/api, /plugins, /)
```

### 3.2 关键事实

- **dsh 源码零改动、社区插件零改动、ellamaka HTTP 路由层零改动**。
- **单容器重放 boot 序列**：`mountDshWeb` 在宿主 ctx 上重放 dsh boot，不创建第二个 Cordis 容器。
- **desktop sidecar 用 `bootDshWeb`**（自包含，Node strip-types 可直接 import）；`mountDshWeb`+CordisHub 的 `.js` 导入 Node 无法解析。
- **动态装载保留**：前端 UI bundle 保持"后端 scan → `/plugins/<id>/client.js` 从磁盘动态 serve"机制，不内联。
- **`$DSH_HOME` 缺省** `$WOPAL_HOME/ellamaka/data/dsh`，闭包缺失不挂载（kill switch）。
- **dshPort 贯穿** server.ts → sidecar-supervisor.ts → preload/types.ts → renderer → platform.getDshPort()。

### 3.3 iframe 是界面问题，不是架构结论

iframe 只是 PoC 让 dsh 界面先跑起来的手段。它阻挡的是"界面合并"，不是"容器能力复用"。真正的能力复用活在容器层，与 iframe 无关。

**终局 ellamaka 是独立产品，不是 dsh 的包装器**——界面必然自己长。dsh 的 dual-face 前端 bundle 设计（后端 Loader 决定前端插件集、按需拉取、rev 哈希热更）是值得反哺进 ellamaka 的设计，见 §5 吸收轨。

## 4. 桥/吸收双轨策略

ellamaka 借 dsh 解决四类问题，分两轨：

| ellamaka 的痛 | dsh 给的解 | 靠桥还是吸收 |
|---|---|---|
| **工具能力增强**（grep/glob→fs-search、sandbox、spill） | 现成插件 | **桥**（契约缝隙 + 采用，个案） |
| **配置动态化**（现在启动期静态、无热重载） | patch 声明式 entry 树、增量重扫 | **吸收**（运行时机制复刻） |
| **插件规范化 + 动态插拔**（现在三路由混杂、静态装配） | Loader 动态装载、`loader.remove(entry)` 干净卸载、dual-face | **吸收**（宿主机制） |

### 4.1 桥轨 — 工具能力增强（个案、可立即落地）

- 从最强候选开始：**fs-search 替换 grep/glob**（消灭运行时下载 ripgrep + 工程治理厚）。
- 每工具一次契约符合性，权限走原生 Permission。
- **不建整套桥体系**，个案评估。

### 4.2 吸收轨 — 配置动态化 + 插件规范化 + 动态插拔（宿主机制，长期主线）

- 这是微内核方向真正住的地方：让 ellamaka 宿主运行时从"静态装配"演进为"动态装载容器"。
- 具体：patch 声明式 entry 树、增量重扫、`loader.remove(entry)` 干净卸载、dual-face 前端 bundle。
- 这条轨成本最高、最接近终极目标，也最需要谨慎——**它决定 ellamaka 最终是"微内核"还是"dsh 包装器"**。

### 4.3 载体决定（推迟）

吸收轨的载体（ellamaka 自长成动态容器 vs 直接复用 dsh 容器机制）**本实验不决定**。它会在使用 dsh 的过程中被自然回答：

- 用 dsh 的 fs-search 替换 grep/glob → 看到"桥接一个工具"到底多贵 → 回答"桥"的成本。
- 用 dsh 的动态装载、patch、dual-face → 看到"这套机制"到底多复杂 → 回答"吸收"的成本。
- 用 dsh 一段时间 → 知道哪些能力值得内化、哪些不值得 → 回答"微内核"值不值得。

## 5. 微内核方向（目标留白）

ellamaka 的演进方向明确：**容器化、动态化，尽量直接利用 dsh 生态**。终极目标是成为一个与 dsh 非常类似的微内核框架。

但**这个目标不写死**——PoC 尚未验证到这个程度，ellamaka 最终能否做成微内核，关键看成本。因此本文档只锁定**方向**（容器化/动态化），不锁定**目标**（微内核），以成本门控。

## 6. 技术事实基线（从历史文档榨取）

以下技术事实经源码实证或实测固化，不随设计转向改变，本实验继续遵守。

### 6.1 深耦合包不可桥接（C2）

session-query / schedule / subagent / system prompt 注入等能力依赖 dsh 自家 loop/session 语义的引擎层（事件日志语料重放、agent.send 唤醒通道、子会话模型）。契约桥只能翻译接口层形状，翻译不了引擎层语义。这些能力的获取路径是**原生复刻**（机制设计可剥离，包与数据模型不可复用）。

### 6.2 桥接 API 规范（§5.6.1，实测固化）

全部从 async 侧（Cordis 服务）调回 Effect 世界的桥接遵守以下形态：

1. **持有 work Fiber 必须 `Effect.forkIn(scope)(work)`**：在 `Effect.scoped` 内取 scope，`Effect.forkIn(scope)(work)` 直接返回持有的 work fiber，`Fiber.await` 拿到真实 exit。禁止 `ManagedRuntime.runFork(work).pipe(Effect.forkIn(scope))`（双重 fork，返回值与中断语义错乱）。中断经 `runtime.runFork(Fiber.interrupt(fiber))` 执行。禁止 `runPromise` 驱动长任务（无中断句柄，未受管的 `forever` 任务导致进程退出时报错）。
2. **顶层 `Effect.runFork/runPromise/runCallback` 在运行时未导出**——一律经 `ManagedRuntime` 实例方法调用。
3. **`Effect.scope` 须在 `Effect.scoped` 内获取**，否则以空 defect Die。桥接 scope 由宿主层的 `Effect.scoped` 提供。
4. **ALS 上下文**：effect 体内发起的桥接调用沿传播链天然继承 Instance ALS，无需 `Instance.bind`。纯 async 侧发起的轮次须捕获-恢复 ALS。
5. **取消语义**：interrupt 后 finalizer 按子先父后顺序确定性执行，`forkIn(scope)` 的并发子任务级联清理。Cordis 入口只启动不拥有中断权。

### 6.3 工具管道设计（§5.1 ctx.tools）

工具执行管道五段：`pre`（参数观察）→ `guard`（审批/拒绝决策）→ `around`（执行替换/包装，spill/timeout 挂载点）→ `post`（结果塑形）→ `result`（终态物化）。全部以 Cordis waterfall 事件暴露，插件可短路（guard 拒绝）或替换（around）。

### 6.4 日志桥接（§5.10，已实现）

cordis 插件日志经 `ctx.logger`（自动命名）→ Exporter（装配层注册）→ 独立文件 `cordis-plugins.log`，不进 ellamaka 主日志。路径按实例目录决定（空间内写 `<space>/.wopal-space/logs/`，非空间写 `$WOPAL_HOME/logs/`）。

### 6.5 复刻方法论（研究报告 §11）

复刻的对象是机制设计，不是包。每个闪光点剥离 session 耦合后归入三种形态：

- **A 类 — 算法吸收**：机制本质是纯逻辑，session 只是输入输出载体。提为纯函数嵌入现有 Effect 服务实现。不依赖 Cordis 化，可先行。
- **B 类 — 能力插件**：新能力天然是插件形态（工具、后台服务）。自研实现 + 自持契约封装，底层接 ellamaka Storage/Bus。
- **C 类 — 现状增强**：ellamaka 已有对应能力，仅缺 dsh 的某个精妙语义。将语义 diff 移植进现有实现。

### 6.6 工具选型（研究报告 §12）

- **倾向直接采用 dsh**：`fs-search`（替换原生 glob/grep，顺带消灭运行时下载问题）、`fs-observation-policy`（先读后写门禁，纯增量）。
- **倾向保留自研（包装迁移）**：`edit`（成熟度）；`read/write` 初判保留。
- **待深评**：`bash`（保留 shell 主体吸收 run_in_background/jobs 语义，或整体换 dsh tool-bash 换取 sandbox）；`wopal_task_*` 契约化重造。
- **增量采用候选**（空白槽位）：ask-user、jobs、goal、schedule、session-query、terminal。

### 6.7 session 语义模型（研究报告 §13）

dsh 是"账本"（只记流水，余额随时可算），ellamaka 是"余额表"（只存现状，流水不保留）。核心差异导致深耦合包不可桥接（§6.1）。dsh 的"model-visible is logged"承诺带来**确定性回放**能力——loop 从玄学调试变工程测试，这是 dsh 敢高频重构 loop 内核的底气。

## 7. 红线（所有权边界）

1. **cordis import 边界**：`@deepseek-ai/cordis` 只出现在 `@wopal/ellamaka-cordis` 包内（版本锁 4.0.1）。
2. **dsh 深耦合包禁入（运行时语义）**：agent-loop/session/session-query/compaction/subagent/schedule 及任何 rt-import dsh-session 的包，禁止被主线代码 import、禁止在运行时加载、禁止作为插件挂载；这些能力的插件化走自研路径。required peer 进入 node_modules/bun.lock 仅供类型解析不构成违反，以运行时加载探针为零为验收（`packages/ellamaka-cordis/test/forbidden-load.test.ts`）。
3. **session 所有权**：持久化与事件定义归 Storage/Bus/EventV2；Cordis 层只持有 facade。
4. **对外契约冻结**：SSE 事件、HttpApi、SDK 在实验中零变更。
5. **桥的加法原则**：全部桥接为新增文件/包装层；对 loop 与存储的改写以"实现内转向"为限，保持删除桥即回滚的能力。

## 8. 实验步骤（核心到外围）

> 实验顺序从核心到外围。核心是**插件生态融合 + 工具利用**，外围是发布层面细节。PoC 是长期实验，不合并 main，直到设计决定做出。

| 批次 | 内容 | 核心度 | 状态 |
|------|------|--------|------|
| P1 | 插件生态融合验证：dsh 插件在 ellamaka 容器内完整运行、动态装载 | 核心 | ✅ 接线完成 |
| P2 | 工具利用：fs-search 替换 grep/glob（桥首个实证） | 核心 | ⬜ |
| P3 | 配置动态化观察：patch 声明式、增量重扫 | 吸收轨 | ⬜ |
| P4 | 插件规范化观察：dual-face、Loader 动态插拔 | 吸收轨 | ⬜ |
| P5 | 界面演进：iframe → 原生（远期） | 外围 | ⬜ |

详细任务分解见 `PLAN-TODOS.md`。

## 9. 相关文档

- 实施计划与进度管理：`PLAN-TODOS.md`
- 研究报告（dsh 全景调研、四层架构分析、审计证据链）：`research/deepseek-harness-architecture-and-integration-research.md`
- PoC 记录（终局方案、实施现状、关键决策）：`research/dsh-web-dual-engine-poc.md`
- 上级架构：`DESIGN.md`
- dsh 参考源码：`labs/ref-repos/deepseek-harness/`

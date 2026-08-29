# PLAN-TODOS — dsh 双引擎融合实验实施计划与进度管理

> **用途**：本文档是 ellamaka 与 dsh 双引擎融合实验（`DESIGN-dsh-poc.md`）的实施进度管理中枢。
> **文档分工**：`DESIGN-dsh-poc.md` 管设计；本文档只管"已完成事实 + 当前真实状态"。
> **创建时间**：2026-08-16（重构 2026-08-20；2026-08-26 全量重写；**2026-08-29 清理重写：已完成项写清，未开始的后续 Plan 全部清除，待与用户重新讨论**）
> **更新纪律**：任务完成即勾选；架构变更回写设计文档，不沉淀在本文件。

## 状态图例

- ⬜ 未开始
- 🔶 进行中
- ✅ 已完成
- ⏸ 暂停（注明原因）
- ⊘ 取消（注明原因）

## 实验定位

**PoC 是长期实验，不合并 main**，直到设计决定（阶段 B escalation 桥接取舍，见 `DESIGN-dsh-poc.md` §3.2.5）做出。在此之前，本分支是实验场。实验顺序**从核心到外围**：核心是插件生态融合 + 工具利用，外围是发布层面细节。

---

## 已完成工作总览

| 批次 | 名称 | 状态 | 说明 |
|------|------|------|------|
| P1 | 双引擎容器宿主 + 日志桥接 | ✅ 完成 | dsh 引擎在 ellamaka 进程内完整运行 |
| P2 | 工具利用：fs-search（grep/glob）落地 | ✅ 完成 | 桥轨首个实证，基建成本已付清 |
| P3 | 阶段 A：工具沙箱内运行 | ✅ 完成 | tool-fs / str_replace / tool-bash 全部接入 |
| P3.5 | 动态装配 + 沙箱语义修正 | ✅ 完成 | 含 tool.provider hook、契约映射、插件侧实现 |
| P3.5+ | DSH home 收口 | ✅ 完成 | 物化到 `$WOPAL_HOME/dsh` 唯一 home |
| P4 | DSH Web 单端口统一 | ✅ 完成 | `/dsh/*` 同源挂载，dshPort 协议全链路移除 |

### P1 — 双引擎容器宿主 + 日志桥接 ✅

> dsh 引擎在 ellamaka 进程内完整运行；单容器重放 boot 序列；50+ 插件日志进独立 `dsh-plugins.log`。spill/grep 桥已废弃退役（native grep 截断语义与 spill 全量转储不匹配）。旧 per-instance hub 机制已拆除。

### P2 — 工具利用：fs-search（grep/glob）落地 ✅

> dsh fs-search（自带 ripgrep 二进制、VCS 排除、超时治理）替换原生 grep/glob。桥轨首个实证：adapter 机制、schema 投影（ZodRawShape 解包）、调用日志全部落地。**基建已付清，后续每工具边际成本极低**（成本记录见 DESIGN §3.2.3）。

### P3 — 阶段 A：tool-fs / str_replace / tool-bash 沙箱内运行 ✅

> 采用 dsh 工具的核心动机——沙箱能力——已实证：tool-fs（read/write/edit）、str_replace_editor（四命令）、tool-bash 在 `fs-sandbox` / `bash-sandbox` 后端下接入工具容器。workspace-write、read-first 门禁、工作区外拒写均验证生效。settings.jsonc 沙箱模式配置接入（§4.10）。

### P3.5 — 动态装配收尾 ✅

> 三个子项全部完成，**实现分布在两处**（这是本批次特有的双仓库结构）：

- **ellamaka 侧**（`packages/plugin` + `packages/opencode`）：
  - Plugin SDK 新增 `"tool.provider"` 动态工具提供者契约
  - `ToolRegistry.tools()` 每轮合并动态工具（dsh 同名赢、稳定排序，未变集合字节稳定不破坏缓存）
  - `enabled:false` 语义修正：注入 `danger-full-access` 关闭沙箱，不切换本地后端
- **插件侧**（`.wopal/plugins/dsh-adapter/`，wopal-space 插件，随 `space/wopal-workspace` 分支分发）：
  - 动态投影：每轮实时读 `container.get("tools").schemas()`，不启动冻结
  - **工具结果契约映射**（设计 §6，2026-08-28 完成，提交 `93164701`）：`file_path`→`filePath` 参数重命名 + `meta.diffs`→`filediff` 透传（LCS hunk diff 自持、±N 统计），前端零改动，Workbench 工具条与 diff 视图正常渲染，300 行测试覆盖

### P3.5+ — DSH home 收口 ✅

> DSH home 物化到 `$WOPAL_HOME/dsh` 唯一锚点（installAnchor + 物化闭包），kill switch 语义，P4 单端口挂载链路的前置基础。

### P4 — DSH Web 单端口统一 ✅

> VirtualWebServer + Listener `/dsh` Node mount + iframe 前缀适配。官方 connection/HMR/modules/UI 插件保留原版。dev 双服务器拓扑三处修复（iframe src 派生、script accessor 包装、同源绝对 URL 覆盖）。dshPort 协议全链路移除。2026-08-29 用户验收通过（打包 CLI + desktop 构建验证成功）。

---

## 当前真实状态

### 已实施能力清单（截至 2026-08-29）

- dsh 引擎单端口同源挂载（`/dsh/*`），CLI serve / TUI / desktop sidecar 三入口可用
- dsh 工具（grep/glob/read/write/edit/str_replace_editor/bash）经 adapter 沙箱内运行，Workbench 渲染契约一致
- 沙箱底座（workspace-write / read-only / danger-full-access）经 settings.jsonc 可配
- 动态装配：dsh 插件加载/卸载 → 下一轮模型请求自动反映
- DSH home 物化闭包 + kill switch
- 打包二进制下 DSH 可用（`$WOPAL_HOME/dsh` 锚点解析 + loader polyfill）
- CLI 命令 SIGINT/SIGTERM 优雅退出

### 进行中的 Plan

| Plan | 项目 | 状态 | 说明 |
|------|------|------|------|
| `feature-dsh-onboarding-dependency-preinstall-orchestration-and-dsh-runtime-isolation` | ellamaka | 🔶 planning | onboarding 依赖预装编排 + dsh 运行时隔离 + 开关语义 + 运行时兜底（本 Plan） |
| `feature-setup-preinstall-plugin-deps-and-materialise-dsh-closure-in-setup-operations` | wopal-cli | 🔶 planning | wopal-cli 预装用户级/空间级插件依赖 + 物化 dsh 闭包（前置依赖） |

### 待定事项（未排期，待讨论）

| 事项 | 状态 | 说明 |
|------|------|------|
| 阶段 B：escalation 审批桥接 | ⏸ 待定 | 需独立产品决策；候选方案见 DESIGN §3.2.5 |
| 界面演进（iframe → 原生） | ⏸ 待定 | 依赖阶段 B 设计决定 |

---

## 进度记录

| 日期 | 记录 |
|------|------|
| 2026-08-16 | 文档创建；Plan 1–7 规划定稿 |
| 2026-08-17 | P1 实施完成；用户验证通过 |
| 2026-08-20 | 确立 dsh 双引擎融合实验方向；文档按实验步骤重写 |
| 2026-08-21 | 旧 P1 残留拆除：per-instance hub 机制退役 |
| 2026-08-26 | 全量重写：源码级消费面盘点，确立"先 A 后 B"双阶段 |
| 2026-08-26 | P3.1–P3.4 完成：三类工具沙箱内运行实证 |
| 2026-08-27 | P3.5 完成：动态装配 + enabled:false 修正；P4 单端口目标定案 |
| 2026-08-28 | P4 完成：单端口统一全链路落地；工具结果契约映射完成（`.wopal/plugins/dsh-adapter`，提交 93164701） |
| 2026-08-29 | 用户验收 P4：打包 CLI + desktop 构建验证成功；合并 main 全部修复进 poc 分支 |
| 2026-08-29 | **文档清理重写**：已完成项写清（含此前遗漏的契约映射完成记录），未开始的后续 Plan（P6/P7/P8/P9 批次定义）全部清除，待重新讨论 |
| 2026-08-30 | **设计定案**：dsh 运行时隔离（纯配置注入、零 env、`~/.dsh` 归官方 CLI 不做处理）、`ELLAMAKA_DSH` 改禁用开关（默认开启）、三层依赖 onboarding 预装 + 运行时兜底；设计文档归位（DESIGN-dsh-poc / DESKTOP-ONBOARDING / wopal-cli DESIGN / 产品级 DESIGN-onboarding）。登记两个 Plan：ellamaka（onboarding 编排 + 隔离）与 wopal-cli（预装能力，前置依赖） |

# PLAN-TODOS — dsh 双引擎融合实验进度管理

> **用途**：本分支（poc-ellamaka-cordis）实验进度索引。已完成事实与活跃 Plan 入口。
> **分工**：`DESIGN-dsh-poc.md` 管设计；dev-flow Plan（`.wopal-space/plans/ellamaka/`）管实施；本文件只管总览。

## 实验定位

PoC 不合并 main，直到供应链实施验收。顺序从核心到外围：核心是插件生态融合 + 工具利用（供应链为当前核心目标），外围是发布细节。

## 已完成

| 批次 | 名称 | 完成说明 |
|------|------|----------|
| P1 | 双引擎容器宿主 + 日志桥接 | dsh 引擎在 ellamaka 进程内完整运行 |
| P2 | 工具利用：fs-search 落地 | 桥轨首个实证，基建成本付清 |
| P3/P3.5 | 工具沙箱 + 动态装配 | tool-fs/str_replace/bash 沙箱接入；tool.provider 动态投影 |
| P3.5+ | DSH home 收口 | 物化到 `$WOPAL_HOME/dsh` 唯一锚点 |
| P4 | DSH Web 单端口统一 | `/dsh/*` 同源挂载，dshPort 协议移除 |
| P5 | 运行时隔离 + 物化生产化 | `ELLAMAKA_DSH` 开关、state 隔离、Bridge 随宿主发布、统一 Runtime Manager（§8 十项验收达成，2026-09-01） |
| P6 | 插件供应链 | 命令式 add/remove/enable/disable/list、热挂载（store watch + include 全栈重放）、`--dir` 安装（§9 七项验收达成，2026-09-02） |

## 活跃 Plan

（无——最近两个 Plan 已完成归档）

| Plan | 结果 |
|------|------|
| `feature-dsh-dsh-escalation-approval-bridge-and-sandbox-mode-ui` | 已归档（done，2026-09-02）：审批桥接 + 沙箱三态 UI（§4.5） |
| `feature-ellamaka-dsh-plugin-supply-chain-install-hot-mount-lifecycle` | 已归档（done，2026-09-02）：插件供应链全链路（§9），实施 12 commits，rook 审查 8 Blocker 全修复，用户实机验证通过 |

推进用 dev-flow：`flow.sh plan status / approve / complete / verify / archive`。

## 待定事项（未排期）

| 事项 | 说明 |
|------|------|
| 界面演进（iframe → 原生） | 审批桥接落地后解锁，待讨论 |
| 插件 entry 级配置命令（`plugin config`） | 供应链 Plan 的 Out of Scope，独立后续 |
| dsh 协处理器（借引擎跑子任务） | 不紧急；涉及托管会话语义设计，暂挂起 |

## 排队中的后续目标（§10 workbench × dsh 前端插件互通）

> 设计基线 DESIGN §10（2026-09-02 定稿方向）。前置 Plan 均已归档，本目标现已是下一个启动候选；暂不出详细 Plan 文档，目标先行列入。

| 项 | 目标/方向 | 状态 |
|----|-----------|------|
| 方向 | 走方向二：dsh 前端插件补 `ellamaka.ui` 面（WC 壳）→ 进 workbench 原生 slot；方向一（ellamaka 组件进 dsh 界面）为远期吸收轨道，机制同源 | 已定稿 |
| 前置实证 | hello-dsh-plugin（`.wopal-space/.tmp/`）已验证 `dsh.client` 第三方面：服务端热挂载 + settings 页 GUI 经 boot manifest 自动下发，零构建手写 factory 形态可行 | 已验证 |
| 验证 V1 | 同源连通：Bridge 静态路由 `/dsh/ellamaka-ui/*` + Vite `/dsh` proxy | 待做 |
| 验证 V2 | 加载器最小链路：installed.json fixture → 加载 → 挂载 → 卸载 | 待做 |
| 验证 V3 | 数据面实证：插件服务端 register 路由 → WC 同源 fetch 渲染 | 待做 |
| 验证 V4 | 真实插件实证：fork 一个 dsh client 插件补 `ellamaka.ui` 面 | 待做 |
| 验证 V5 | 失败语义：容器未起降级 / 加载错误隔离 | 待做 |
| 平台件 | Bridge 静态路由 + workbench slot 面（3-5 点 + props 契约）+ WC 加载器 + Vite proxy + enabledIn 增 "workbench" 面 | 设计见 §10.5 |

## 进度记录

| 日期 | 记录 |
|------|------|
| 2026-08-16 ~ 09-01 | P1–P5 全部完成（明细见 git 历史与本文件早期版本） |
| 2026-09-02 | 设计文档精简重写（删附录过程记录）；§9 插件供应链定稿；spike 验证热挂载与运行时依赖解析（§6.6）；供应链 Plan 创建并提交审阅 |
| 2026-09-02 | §10 workbench × dsh 前端插件互通方向定稿（走方向二，WC 一包多面 + 同源数据通道）；验证步骤 V1-V5 与平台改造清单列入设计，目标入 TODO 队列 |
| 2026-09-02 | 供应链 Plan 全周期完成：实施 6 Task + rook 审查（8 Blocker 修复：全栈重放/semver 0.x/传递树/锁内写/profile 别名/悬空 symlink/Desktop watcher/路径穿越）+ Wopal 自审 PASS + 用户实机验证（hello 插件热挂载 + settings 页 GUI）；§9 验收达成进入维护态。审批桥接 Plan 同日归档。§9 供应链 + §10 前置实证（dsh.client 自动手写 bundle）完成 |
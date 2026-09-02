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

## 活跃 Plan

| Plan | 状态 | 说明 |
|------|------|------|
| `feature-dsh-dsh-escalation-approval-bridge-and-sandbox-mode-ui` | executing | 阶段 B：审批桥接 + 沙箱三态（§4.5） |
| `feature-ellamaka-dsh-plugin-supply-chain-install-hot-mount-lifecycle` | reviewing | 插件供应链（§9），spike 已验证（§6.6），待用户审批 |

推进用 dev-flow：`flow.sh plan status / approve / complete / verify / archive`。

## 待定事项（未排期）

| 事项 | 说明 |
|------|------|
| 界面演进（iframe → 原生） | 审批桥接落地后解锁，待讨论 |
| 插件 entry 级配置命令（`plugin config`） | 供应链 Plan 的 Out of Scope，独立后续 |
| dsh 协处理器（借引擎跑子任务） | 不紧急；涉及托管会话语义设计，暂挂起 |

## 进度记录

| 日期 | 记录 |
|------|------|
| 2026-08-16 ~ 09-01 | P1–P5 全部完成（明细见 git 历史与本文件早期版本） |
| 2026-09-02 | 设计文档精简重写（删附录过程记录）；§9 插件供应链定稿；spike 验证热挂载与运行时依赖解析（§6.6）；供应链 Plan 创建并提交审阅 |
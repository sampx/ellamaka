# 会话时间线虚拟滚动遗漏工具 Part

> **状态**：已知基线 E2E 缺陷，独立于 Workbench Store 边界重构。
> **复现日期**：2026-07-14
> **基线**：`f7fdff18cb chore: update desktop package references and cleanup scripts`

## 结论

这不是四个独立问题，而是同一个长会话时间线虚拟滚动场景漏掉的四个工具 Part。当前 Workbench 重构和基线提交中都能稳定复现相同的四个 ID，不能归因于本次 Store、Action、Space scope 或 directory SDK 改造。

## 复现方式

从 `packages/ellamaka-app` 运行：

```bash
PLAYWRIGHT_WORKERS=1 bun run test:e2e e2e/smoke/session-timeline.spec.ts
```

测试构造 72 个 turn、331 个应显示 Part 和 72 个用户消息，并从最新消息连续滚动到历史起点。

## 实际表现

- 历史消息没有漏取：72 个用户消息全部被遍历到。
- 时间线应遍历到 331 个 Part，实际只见到 327 个。
- 缺失的四项全部属于第 `0048` 回合的 assistant 工具输出：
  - `prt_tool_read_0_smoke_0048`
  - `prt_tool_glob_5_smoke_0048`
  - `prt_tool_grep_1_smoke_0048`
  - `prt_tool_list_6_smoke_0048`
- 同一回合的 text、edit、write 和 apply_patch Part 可以被遍历到。因此问题不是整条消息或整页历史未加载，而是四个相邻工具 Part 在虚拟列表遍历期间没有进入 DOM。

## 已排除范围

- E2E 的 spec 与 fixture 在当前工作树和 `f7fdff18cb` 基线中的内容哈希一致。
- 在独立的 `f7fdff18cb` worktree 上运行同一场景，缺失项和失败模式一致。
- 当前复现没有浏览器错误 toast，也没有触发分页 UI 的 `Load details` 或 `Show earlier steps` 文本。
- 这不是 General/Space 切换、插件/MCP、模型选择、fork、命令路由或 PTY 生命周期问题。

## 建议排查入口

1. `e2e/smoke/session-timeline.fixture.ts`：确认第 `0048` 回合生成的 `read`、`glob`、`grep`、`list` 四个 `AssistantPart` 均进入 `targetPartIDs`，并保持唯一 key。
2. `src/pages/session/message-timeline.tsx`：检查 `TimelineRow` 生成、`reuseTimelineRows()`、`timelineCache`、`Virtualizer` 的 `cache`、`itemSize`、`keepMounted` 与历史分页追加后的 row key/高度测量关系。
3. 同文件的工具 Part 渲染：确认四个工具 Part 的折叠状态、`data-timeline-part-id` 属性和实际高度变化不会让 `virtua` 跳过这一段。

## 修复验收

- 上述单文件 Playwright 场景通过，遍历到全部 `331` 个 Part 和 `72` 个消息。
- 失败时输出的四个 `0048` 工具 ID 不得再缺失。
- 增加一个能覆盖该“同一 assistant turn 含多个普通工具 Part”的定向回归断言；不能通过降低期望数量或忽略这些 ID 让测试变绿。

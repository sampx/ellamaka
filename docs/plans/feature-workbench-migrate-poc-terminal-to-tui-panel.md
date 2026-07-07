# feature-workbench-migrate-poc-terminal-to-tui-panel

## Metadata

- **Issue**: #
- **Type**: feature
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka
- **Created**: 2026-07-07
- **Status**: executing

## Scope Assessment

- **Complexity**: Low
- **Confidence**: High

## Goal

将 PoC 终端流程正式迁移到 Workbench 的 TUI 面板中，根据面板所指向的目录自动加载/创建真实的 PTY 终端并渲染，实现真正的 Web 终端操作。

## Technical Context

### Architecture Context

目前 Workbench 的 Panel 结构（[panel.tsx](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/packages/ellamaka-app/src/pages/workbench/parts/panel.tsx)）中，TUI 模式的主体区域仍是只读 placeholder：
```tsx
<Show when={props.panel.mode === "tui"}>
  <div class="flex flex-col items-center gap-2 text-v2-text-text-muted">
    <IconV2 name="terminal" class="size-6 opacity-40" />
    <span class="text-12-regular">{t("workbench.view.tui.placeholder")}</span>
  </div>
</Show>
```
我们需要在这个区域绑定并渲染真实的 `<Terminal pty={activePty} />` 组件。

官方 `app` 通过 [terminal.tsx](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/packages/ellamaka-app/src/context/terminal.tsx) 提供的 `TerminalProvider` 实现了空间级（基于路由参数 `params.dir`）的终端会话管理：
- `createWorkspaceTerminalSession(sdk, dir, legacySessionID, scope)` 返回一个终端会话实例，管理着该目录下的所有 PTY 状态。
- `loadWorkspace(dir, legacySessionID, serverScope)` 负责按目录缓存并获取会话。

为了支持面板对特定目录的绑定，我们需要在 `useTerminal()` 暴露的接口中追加 `loadWorkspace`，使 Panel 组件可以通过 `useTerminal().loadWorkspace(panel.directory)` 按需动态获取目录专属的会话实例，并进行渲染与自动初始化。

### Key Decisions

- **D-01**: `useTerminal` 上下文暴露 `loadWorkspace`。这样，Workbench 组件可以脱离当前全局路由参数（`params.dir`），按面板自定义的 `directory` 获取独立的 `TerminalSession`，保持与官方应用终端引擎的最佳解耦与复用。
- **D-02**: TUI 面板内终端的自动初始化。在渲染面板时，如果该目录的 `TerminalSession` 没有任何活动 PTY，自动调用 `session.new()` 创建首个终端会话，提供即时可用的交互体验。

## In Scope

- 扩展 `useTerminal` 返回的上下文接口，暴露 `loadWorkspace`。
- 修改 `Panel` 组件的渲染逻辑：
  - 当为 `tui` 模式时，按 `panel.directory` 获取对应的 `TerminalSession`。
  - 获取会话中 active 状态的 `LocalPTY` 对象，并挂载 `<Terminal>` 组件。
  - 如果当前目录会话没有任何活动 PTY，且会话处于 ready 状态，则自动初始化一个新终端。

## Out of Scope

- 修改 `Terminal` 组件本身或后端 PTY 路由管理（完全复用现有成熟的基础设施）。
- 底部终端坞的真实化（这属于后续 P2 任务，不在此次 P0 TUI 面板集成范围内）。

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| `ellamaka-app/context` | `packages/ellamaka-app/src/context/terminal.tsx` | 修改 | 在上下文接口中暴露 `loadWorkspace` 工具函数 |
| `ellamaka-app/workbench` | `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx` | 修改 | 渲染真实的 `Terminal` 组件并挂载对应目录终端状态 |

## Acceptance Criteria

### Agent Verification

1. [ ] 静态类型检查：在项目根目录下运行 `bun turbo typecheck` 成功通过。
2. [ ] 接口定义验证：运行 `rg "loadWorkspace:" packages/ellamaka-app/src/context/terminal.tsx` 存在匹配，确保方法已被导出。
3. [ ] 终端引用验证：运行 `rg "<Terminal " packages/ellamaka-app/src/pages/workbench/parts/panel.tsx` 存在匹配，确保 Panel 中成功导入并挂载了终端组件。

### User Validation

#### Scenario 1: 工作台 TUI 面板终端挂载与交互
- Goal: 验证工作台的 TUI 面板中能够渲染真实的终端，且能接收用户输入执行 Shell 命令。
- Precondition: `ellamaka serve` 后端处于启动状态，浏览器已打开并进入工作台路由 `/workbench`。
- User Actions:
  1. 点击空间栏中的某个 WopalSpace（例如 `main`）以打开工作台。
  2. 观察默认的 TUI 面板：不再展示占位符，而是加载并初始化一个真实的 Web 终端（展示 Shell 提示符）。
  3. 在终端内输入命令（例如 `ls` 或 `pwd`）并回车。
- Expected Result: 终端能够正常显示命令输出。

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: Integrate Real PTY Terminal into TUI Panel

**Verification Intent**: AC#1, AC#2, AC#3

**Behavior**:
在 Workbench 的 TUI 面板中不再使用静态占位符，而是按面板指向的 `panel.directory` 动态加载其专属的 `TerminalSession`。并在该目录尚未分配活动终端时自动创建一个，将 active 的 `LocalPTY` 交给 `<Terminal>` 渲染。

**Files**:
- `packages/ellamaka-app/src/context/terminal.tsx`
- `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx`

**Pre-read**: N/A

**Design**:
1. 修改 `packages/ellamaka-app/src/context/terminal.tsx` 中的返回结构：
   In `return { ... }` block, add `loadWorkspace: (dir: string, legacySessionID?: string) => loadWorkspace(dir, legacySessionID, scope())`.
2. 在 `packages/ellamaka-app/src/pages/workbench/parts/panel.tsx` 中：
   - 导入 `useTerminal` 与 `Terminal`（来自 `@/components/terminal`）。
   - 声明一个针对当前面板的 `session = useTerminal().loadWorkspace(props.panel.directory)`。
   - 使用 `createEffect` 监控 `session.ready()`。若准备就绪且 `session.all().length === 0`，自动调用 `session.new()` 初始化终端。
   - 提取当前活跃终端：`activePty = createMemo(() => session.all().find(pty => pty.id === session.active()))`。
   - 在 `<Show when={props.panel.mode === "tui"}>` 分支下：
     如果 `activePty()` 存在，渲染 `<Terminal pty={activePty()!} />`，否则显示加载状态。

**TDD**: false

**Changes**:
1. 在 `terminal.tsx` 导出的 Context 接口中暴露 `loadWorkspace`。
2. 在 `panel.tsx` 中导入 `useTerminal` 和 `Terminal`，并在组件内实例化当前目录的终端会话。
3. 增加自动创建终端的 `createEffect` 副作用。
4. 将 TUI 模式的占位 `div` 替换为 `<Show when={activePty()} fallback={...}>` 和 `<Terminal pty={activePty()!} />`。

**Verify**:
- 运行 `bun turbo typecheck`

**Done**:
任务产出：TUI 面板真实终端集成完成，可通过 typecheck
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤.

---

## Delegation Strategy

N/A

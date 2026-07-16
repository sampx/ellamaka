# ellamaka · workbench 模块 — 代码缺陷与技术债评审

> 评审范围：`projects/ellamaka/packages/ellamaka-app/src/pages/workbench/`
> 评审方式：只读，三位专家并行精读真实源码（架构师 / 工程师 / QA），主理人汇总去重。
> **关键前提更正**：本模块是 **SolidJS**（`solid-js` / `solid-js/store`，`Show`/`For`/`createStore`/`createEffect`），**不是 React**。所有"渲染/副作用/依赖追踪"类判断按 Solid 语义执行（`createEffect` 由依赖追踪触发，而非每次渲染；但高频 store 写入仍会触发依赖它的 effect 与重渲染）。

---

## 0. 总览统计

| 维度 | 高危 | 中危 | 低危 | 合计 |
|---|---|---|---|---|
| 1 代码质量 | 0 | 5 | 2 | 7 |
| 2 架构层面 | 3 | 6 | 0 | 9 |
| 3 性能隐患 | 1 | 4 | 2 | 7 |
| 4 可维护性 | 3 | 9 | 4 | 16 |
| 5 安全风险 | 0 | 3 | 1 | 4 |
| **合计** | **7** | **27** | **9** | **43** |

跨维度重叠（已合并）：`view-store` 的 `JSON.stringify(snapshot())` 脏检查（架构 E + 性能 P2）、SessionStore 线性查找（性能 P3 + 架构 C/5）、会话树"open-session"编排重复（架构 4/5 + 性能 P5 部分）。

**正面结论**：未发现 `eval` / `new Function` / `innerHTML` / `dangerouslySetInnerHTML` 注入点；核心领域逻辑（`workbench-actions` / `workbench-store` / `session-store`）测试质量高；`testing/workbench-test-harness.ts` 提供的可控 transport 是可复用优秀底座，建议推广。

---

## 一、按优先级排列的优化方案清单

### P0 — 立即处理（致命 / 高杠杆且投入可控）

- **O1 顶层缺 ErrorBoundary，单面板异常白屏整个 IDE**
  位置：`index.tsx:104-118`（Provider 树 `WorkbenchSingletonGuard → … → WorkbenchShell` 无包裹）。
  等级：高（可维护性）。建议：在 `WorkbenchShell` 外层或每个 `Panel` 渲染处包裹 Solid `<ErrorBoundary>`，提供"该面板加载失败，点击重试"兜底 UI。投入极小、用户可见收益最大。

- **O2 纵向 split 拖拽每帧写 store，引发整树重渲染 + 全量序列化**
  位置：`parts/panel.tsx:337-357`（`onMouseMove` 内 `wb.setPanelSplitHeight(...)`）。横向 resize（`workspace.tsx:65-104`）已用"拖拽期直写 DOM、`mouseup` 提交 store"规避，纵向却相反。
  等级：高（性能）。建议：纵向拖拽复用 workspace 模式——`onMouseMove` 只改 DOM `style.height`，`onMouseUp` 一次性提交 store。性价比最高的性能项。

- **O3 目录（cwd / SDKProvider header）缺少路径穿越校验**
  位置：`parts/panel.tsx:129`（`sdk.client.pty.create({ cwd: directory })`）、`workbench-directory-provider.tsx:67,88`（`SDKProvider directory={current.directory}`）。`directory` 来自 session 的 `directory/projectPath`（服务端返回）或拖拽 `projectPath`，客户端零校验。
  等级：中→建议按高危处理（安全）。建议：在 pty 创建与会话绑定入口加 `sanitizeDirectory()`（绝对路径 + `path.normalize` 后无 `..` 越界 + 拒绝空/相对路径），`workbench-directory-provider` 选择目录时同样归一化后再下发。

- **O4 收口 actions 迁移（删掉自承的过渡适配器）**
  位置：`workbench-actions-context.ts`（注释原文 "Task 3 compatibility adapter. Tasks 4-6 migrate callers and replace this adapter"）。纯逻辑 `createWorkbenchActions` 已 port 化，但所有调用方仍经 `useWorkbenchActions()` → 适配器桥回 `wb/projection/sdk`。
  等级：高（架构）。建议：按注释推进 Tasks 4-6，让 store 直接实现 StorePort 或 actions 直接持有 store 引用，删除 `workbench-actions-context.ts` 与 `useWorkbenchActions` 间接层。**这是其余耦合（隐式 Provider 顺序 D、平行类型 C）的根，需排期。**

### P1 — 本迭代内推进（高价值，需排期）

- **O5 双存储 / 多存储 + 平行 Session 类型体系收敛**
  位置：`services/session-store-legacy.ts`（死键清理）、`services/session-store-service.ts`（仅 `limitSessions`）、`view-store.tsx:34-42`、`session-store.tsx:98`、`parts/sidebar.tsx:29-37`、`parts/session-tree.tsx:70-92`（≥5 套历史 `workbench.*` localStorage 键散落）；`Session`(`session-store.tsx:10-20`) 与 `WorkbenchActionSession`(`workbench-actions.ts:17-27`)、`WorkbenchPanel` 与 `WorkbenchActionPanel` 平行拷贝。
  等级：高（架构）。建议：① 删除 `session-store-legacy.ts`，`limitSessions` 并入工具模块并改名；② 用单一 `STORAGE_KEYS` 常量表集中管理所有键；③ 建立单一 `Session`/`WorkbenchPanel` 真相源类型，actions 的 port 复用，消除 `WorkbenchAction*` 平行拷贝；④ 注释明确"服务端为唯一真相源 + `SessionProjection` 为内存缓存"边界。

- **O6 `view-store` 用 `JSON.stringify(snapshot())` 触发持久化 → 改细粒度 dirty**
  位置：`view-store.tsx:80-83`。为建立"任意字段变更即脏"的依赖，对整个快照深读序列化；叠加 O2 会逐帧全量序列化。且对"结构变但 JSON 不变"会漏触发。
  等级：中（架构 + 性能重叠）。建议：用 store path 级订阅，或在 `workbench-store` 每次 `setStore` 后触发持久化；保存已有 150ms 防抖，脏标记可合并。

- **O7 SessionStore 线性查找 → Map 索引 + 反向索引**
  位置：`session-store.tsx:35-41`（`find` 全表 `Object.entries` 扫描），被 `getSession`/`upsert`/`patch`/`remove`、`panel.tsx:67,75`、`session-tree.tsx` 多处、以及 `isSessionBound`/`boundPanelIdForSession`(`workbench-store.ts:314-328`) 反复调用 → 列表渲染约 O(N·M)。
  等级：中（性能）。建议：维护 `id→Session` Map（upsert/patch/remove 同步更新），panel→boundSession 建反向索引。

- **O8 会话树多拉取源收敛为单一协调器 + debounce**
  位置：`session-tree.tsx:266-288`(30s 轮询 + visibility)、`:776-790`(三 effect 监听 refreshKey)、`index.tsx:30-63`(sdk 事件 `projection.invalidate()`)。
  等级：中（性能）。建议：把"轮询 + visibility + 事件失效 + 手动刷新"收敛为单一协调器，对 `refreshKey` debounce(300ms) 后再 `loadSessionGroups`；内部版本去重已存在可保留。

- **O9 补 session-tree.tsx 主组件测试**
  位置：`parts/session-tree.tsx`（~879 行，仅拆出纯函数有测）。主组件内 `loadSessionGroups`、拖拽落点、重命名/删除/创建异步处理、`pin` 逻辑均无测，是模块内分支最多、最易回归、承载不可逆用户操作的部分。
  等级：高（测试）。建议：优先补 `loadSessionGroups` 成功/空/异常三态 + "双击/拖入 → loadSessionIntoPanel" 的成功与 archived/child 不可用分支。

- **O10 补 workbench-actions-context.ts 测试**
  位置：`workbench-actions-context.ts`（0 测试）。这是把 SDK / projection / actions 三个 port 接起来的胶水层，含 directory 推导与字段映射，后端字段变更会静默炸裂。
  等级：高（测试）。建议：用 harness 可控 transport 断言 `create/get/project/rename/remove` 传给 SDK 的 directory 与写入 projection 的字段映射，重点覆盖 General（空 path）vs Space 差异。

- **O11 补 view-store.tsx hydrate / 迁移测试**
  位置：`view-store.tsx`（0 测试）；`workbench-store.ts` 4 个测试未覆盖 `hydrate`/`migrateLegacyPanels`/`validateTabs`。legacy 面板迁移或 active 回退出错会启动白屏或 tab 丢失。
  等级：高（测试）。建议：补 `hydrate` legacy 无 `slotState`、缺 General tab 自动补齐、activeSpaceName 非法回退；`view-store` 的 `hydrate`/`queueSave` 轻量测试。

- **O12 拖拽落点入参校验**
  位置：`parts/panel.tsx:218-280`（`handleDrop` 读 `sessionId`/`projectPath`/`spaceName` 直接进 SDK 调用）。
  等级：中（安全）。建议：`handleDrop` 进入 `loadSessionIntoPanel` 前对 `sessionId` 非空/格式校验、对 `projectPath` 复用 O3 的 `sanitizeDirectory()`。

- **O13 收敛"静默吞错"模式**
  位置：`space-store.tsx:19-24`(silent `catch{}` 返回 `[]`)、`panel-chat.tsx:235`(`.catch(()=>{})`)、`view-registry.tsx:85,113,124`(`.catch(console.error)` 卡死面板)、`panel.tsx` & `session-tree.tsx` 共 ~15 处 `void actions.X().catch(console.error)`。
  等级：中（可维护性）。建议：统一错误上报 helper（日志 + `showToast` + 可选 UI 状态回滚）；TUI PTY 失败置 `setPtyError` 渲染重试按钮；关键动作（删/改/替换）改 `await` 并在失败保留编辑态。

- **O14 上帝组件拆分 + 去重**
  位置：`parts/session-tree.tsx`(879 行)、`parts/panel.tsx`(624 行)；重复 `DialogOverwritePanel`(`panel.tsx:167-193` 与 `session-tree.tsx:588-614`)、"open-session"编排三处重复(`session-tree.tsx:550-585`/`sidebar.tsx:143-155`/`panel.tsx`)。
  等级：中（架构 + 代码质量）。建议：拆 `useSessionTreeData`/`SessionRow`/`SessionContextMenu`/`PanelHeader`/`PanelSplitTerminal`/`usePanelDrop`；提取共享 `DialogOverwritePanel` 与 `locateBoundPanel`/`openSessionInPanel` 服务。

### P2 — 后续整洁度 / 稳健性

- **O15** 删除孤儿 hook `hooks/use-panel-chat-state.ts`（全仓无引用，路由方案被 props 方案取代）。（中，代码质量）
- **O16** `createSessionHistoryLoader` 跨模块逐字复制（`panel-chat-helpers.ts:17-23` ← `pages/session.tsx`），抽到公共 hook 共用。（中，代码质量）
- **O17** Provider 嵌套顺序隐式硬依赖（`index.tsx:104-118`：Actions/State/Session/Space 顺序即契约，调整即运行期 context 缺失）→ 改依赖注入或显式传参，至少加顺序约束注释。（中，架构）
- **O18** `view-registry` 模块级全局 `viewRegistry` 数组（`view-registry.tsx:30`）改为显式注入；视图 id 定义为枚举常量，消除 `getView("tui"|"chat"|"context")` 字符串字面量。（中，架构）
- **O19** `panel-chat.tsx:368-431` 局部 `MemoryRouter` 仅为给 `PanelChatRoute` 传 props → 直接渲染 `<PanelChatRoute ...props/>`，移除 MemoryRouter + 死 hook。（中，架构）
- **O20** 类型安全：`view-registry` 的 `sdk: any`(`view-registry.tsx:16`)、`children: any`(`singleton-guard.tsx:8`/`panel-chat.tsx:433`)、i18n `as` 强转绕过 key 校验(`index.tsx:27`/`panel.tsx:33`)、`PtySDK` 返回 `Promise<unknown>`(`pty-manager.tsx:8-10`) → 定义最小接口 / 用 `JSX.Element` / 去掉无意义 cast / 补返回类型。（中/低，可维护性）
- **O21** 魔法字符串 `"General"` 双常量 + 硬编码 5 处（`workbench-scope.ts:1`/`workbench-store.ts:53`/`session-tree.tsx`/`workspace.tsx`/`panel-loader.tsx`）→ 合并为单一 `GENERAL_SPACE_NAME`；布局魔法数字（`workspace.tsx:71` 的 `280`×4、`panel.tsx:326` 的 `180`、`sidebar.tsx:82` 的 `5000` 等）提升为具名常量。（低，代码质量）
- **O22** `session-tree.tsx:696-702` 每行 `createEffect` 滚动定位 → 单 effect + `Map<id,HTMLElement>` 引用表，active 变更只滚目标行。（中，性能）
- **O23** `use-workbench-commands.tsx:242-256` 命令列表用 `createMemo` 产出，仅引用变化时再 `command.register`。（低，性能）
- **O24** `parts/sidebar.tsx:49-55` 宽度拖拽每帧写持久化 store → 拖拽中直写 DOM，`mouseup` 提交。（低，性能）
- **O25** `pty-manager.tsx:3,42-44` 用 `${spacePath}::${panelId}::${kind}` 字符串 key + `startsWith` 反查 → 改结构化元组/嵌套 Map。（低，架构）
- **O26** `console.error` 打印原始 error 对象可能泄露响应体/头/路径（`session-tree.tsx:362`/`panel.tsx`/`index.tsx:51`/`pty-manager.tsx:178`/`view-registry.tsx`）→ 统一日志封装，只记 `message`/状态码/脱敏请求 ID。（低，安全）
- **O27** 单例 `ptyManager` 的 Map 跨会话不主动清理（`pty-manager.tsx:34-40,184`）→ 登出/卸载确定入口显式 `clearMemoryOnly()` 或绑定登录会话生命周期。（低，安全）
- **O28** 测试文件名与所测模块不符（`workbench-command-adapter.test.ts`→`workbench-actions`、`workbench-directory-status.test.ts`→`workbench-directory-provider`）→ 重命名或加 CI 静态检查。（低，测试）
- **O29** 补 `space-store.tsx` 成功/失败两态、`createSessionHistoryLoader` 分页三态、`singleton-guard.tsx` Web Lock 三态测试。（中，测试）

---

## 二、五维度发现明细（含等级 / 位置 / 建议）

### 维度一 · 代码质量（7 项）
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| 1 | 中 | `hooks/use-panel-chat-state.ts` | 全仓无引用孤儿 hook → 删除 |
| 2 | 中 | `parts/panel-chat-helpers.ts:17-23` | `createSessionHistoryLoader` 逐字复制自 session 页 → 抽到公共 hook 共用（O16） |
| 3 | 中 | `panel.tsx:167-193` / `session-tree.tsx:588-614` | `DialogOverwritePanel` 两份重复 → 提取共享组件（O14） |
| 4 | 中 | `session-tree.tsx:550-585` / `sidebar.tsx:143-155` / `panel.tsx` | "open-session"编排三处重复 → 抽 `openSessionInPanel` 服务（O14） |
| 5 | 中 | `session-tree.tsx:165-190,561-569` | 本地 `isSessionBound`/`getPanelBadge` 重复且违背 `wb` 已提供的 store API → 统一调用 `wb.isSessionBound`/`boundPanelIdForSession`（O7） |
| 6 | 低 | `workbench-scope.ts:1`/`workbench-store.ts:53`/多处 | `"General"` 双常量+硬编码 → 单一 `GENERAL_SPACE_NAME`（O21） |
| 7 | 低 | `workspace.tsx:71`/`panel.tsx:326`/`sidebar.tsx:82` | 布局魔法数字散落 → 具名常量（O21） |

### 维度二 · 架构层面（9 项）
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| A | 高 | `workbench-actions-context.ts` | 自承的 Task3 兼容适配器，未完成的迁移是耦合根 → 推进 Tasks 4-6 删除（O4） |
| B | 高 | `session-store-legacy.ts`/`session-store-service.ts`/`view-store.tsx:34-42`/… | 双存储名不副实 + ≥5 套 `workbench.*` 键散落清理 → 删除 legacy、集中 `STORAGE_KEYS`、明确真相源边界（O5） |
| C | 高 | `session-store.tsx:10-20`/`workbench-actions.ts:17-27` | 多 store 职责重叠 + `Session`/`WorkbenchActionSession`、`WorkbenchPanel`/`WorkbenchActionPanel` 平行拷贝 → 单一真相源类型（O5） |
| D | 中 | `index.tsx:104-118` | Provider 嵌套顺序成隐式硬依赖 → DI 或显式传参 + 注释（O17） |
| E | 中 | `view-store.tsx:80-83` | `JSON.stringify(snapshot())` 制造响应式依赖触发持久化，脆弱且全量开销 → 细粒度 dirty（O6） |
| F | 中 | `view-registry.tsx:30,46-177` | 模块级可变数组作全局单例注册表，难单测、import 顺序敏感 → 注入 + id 枚举（O18） |
| G | 中 | `panel-chat.tsx:368-431` | MemoryRouter 仅为传 props → 直接渲染 `PanelChatRoute`，删死 hook（O19） |
| H | 中 | `session-tree.tsx`(879)/`panel.tsx`(624) | 上帝组件，单文件多职责 → 按职责拆子组件/子 hook（O14） |
| I | 低 | `pty-manager.tsx:3,42-44` | 字符串拼接 key + `startsWith` 反查脆弱 → 结构化键（O25） |

### 维度三 · 性能隐患（7 项）
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| P1 | 高 | `panel.tsx:337-357` | 纵向 split 拖拽每帧写 store → 整 Panel+Terminal 重渲染 + 触发全量 `JSON.stringify` 脏检查 → 复用 DOM 直写、`mouseup` 提交（O2） |
| P2 | 中 | `view-store.tsx:80-83` | `JSON.stringify(snapshot())` 全量序列化脏检查，状态越大越慢 → 细粒度 dirty（O6） |
| P3 | 中 | `session-store.tsx:35-41`/`workbench-store.ts:314-328` | SessionStore 线性查找 O(N·M) → Map 索引 + 反向索引（O7） |
| P4 | 中 | `session-tree.tsx:696-702` | 每行 `createEffect` 滚动，active 变更全重跑 → 单 effect + 引用表（O22） |
| P5 | 中 | `session-tree.tsx:266-288,776-790`/`index.tsx:30-63` | 多拉取源易冗余请求 → 单一协调器 + debounce（O8） |
| P6 | 低 | `use-workbench-commands.tsx:242-256` | 命令列表整组重建注册 → `createMemo` + 仅变化时 register（O23） |
| P7 | 低 | `sidebar.tsx:49-55` | 宽度拖拽每帧写持久化 store → DOM 直写、`mouseup` 提交（O24） |

### 维度四 · 可维护性（16 项）
**类型安全**
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| T1 | 中 | `view-registry.tsx:16` | 扩展点 `sdk: any` 失去类型检查 → 定义最小 `WorkbenchViewSdk` 接口（O20） |
| T2 | 低 | `singleton-guard.tsx:8`/`panel-chat.tsx:433` | `children: any` → `JSX.Element`（O20） |
| T3 | 低 | `index.tsx:27`/`panel.tsx:33` | i18n `as` 强转绕过 key 校验 → 去掉无意义 cast（O20） |
| T4 | 低 | `pty-manager.tsx:8-10` | `PtySDK.get/remove` 返回 `Promise<unknown>` → 补返回类型（O20） |

**错误处理**
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| E1 | 高 | `index.tsx:104-118` | 顶层无 ErrorBoundary，单面板异常白屏整个 IDE → 包裹 `<ErrorBoundary>`（O1） |
| E2 | 中 | `space-store.tsx:19-24` | 加载失败 silent `catch{}` 返回 `[]` → 至少 `console.error` + `spacesError` 信号（O13） |
| E3 | 中 | `panel-chat.tsx:235` | `abort().catch(()=>{})` 纯静默 → `console.debug` 区分良性（O13） |
| E4 | 中 | `view-registry.tsx:85,113,124` | TUI PTY 失败仅 `console.error`，面板卡死 → 置错误态 + 重试按钮（O13） |
| E5 | 中 | `panel.tsx`/`session-tree.tsx`(~15 处) | fire-and-forget `.catch(console.error)`，失败不回滚/不提示 → 统一上报 helper（O13） |
| E6 | 低 | `pty-manager.tsx:165` | pending rejection 静默忽略，行为未注释 → 补注释或显式 log（O13） |

**测试覆盖**（概览：核心领域逻辑测试质量高；胶水/副作用层缺失）
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| C1 | 高 | `session-tree.tsx` | 主组件 0 测试（仅拆出纯函数有测）→ 补 loadSessionGroups 三态 + 拖拽/增删改（O9） |
| C2 | 高 | `workbench-actions-context.ts` | 0 测试，SDK↔store 字段映射胶水层 → 补 directory 推导与字段映射（O10） |
| C3 | 高 | `view-store.tsx` | 0 测试，hydrate/legacy 迁移是白屏根源 → 补 hydrate/queueSave（O11） |
| C4 | 中 | `space-store.tsx` | 0 测试 + 自身静默吞错 → 补成功/失败两态（O29） |
| C5 | 中 | `panel-chat-helpers.ts:24` | `createSessionHistoryLoader` while 分页无测试 → 补三态（O29） |
| C6 | 中 | `singleton-guard.tsx` | Web Lock 单例锁 0 测试 → 补三态（O29） |
| C7 | 低 | `workbench-command-adapter.test.ts`/`workbench-directory-status.test.ts` | 文件名指向不存在的源 → 重命名或 CI 静态检查（O28） |

### 维度五 · 安全风险（4 项）
| # | 等级 | 位置 | 问题与建议 |
|---|---|---|---|
| S1 | 中 | `panel.tsx:129`/`workbench-directory-provider.tsx:67,88` | cwd / SDKProvider directory 缺路径穿越校验 → `sanitizeDirectory()`（O3） |
| S2 | 中 | `panel.tsx:218-280` | 拖拽落点 `sessionId`/`projectPath` 未校验即进 SDK → 非空/格式校验 + `sanitizeDirectory()`（O12） |
| S3 | 低 | `session-tree.tsx:362`/`panel.tsx`/`pty-manager.tsx:178`/`view-registry.tsx` | `console.error` 打印原始 error 可能泄露响应体/头 → 统一日志脱敏（O26） |
| S4 | 低 | `pty-manager.tsx:34-40,184` | 单例 Map 跨会话不清理，内存/身份滞留 → 登出/卸载入口显式清理（O27） |
| — | 正面 | 全模块 | 无 `eval`/`new Function`/`innerHTML`/`dangerouslySetInnerHTML` 注入点；右键菜单坐标为数值经 style 绑定，XSS 面控制好 |

---

## 三、横向主题与落地下一步

1. **先止血再还债**：P0 四项中 O1（ErrorBoundary）、O2（拖拽直写 DOM）、O3（目录校验）投入极小却分别消除"致命白屏 / 最高频性能退化 / 唯一实质安全纵深缺口"；O4 是架构根因，需排期但应最先立项。
2. **收敛"胶水/副作用层"测试**：`*context.ts`（SDK 适配）、`view-store`（持久化）、`space-store`（资源加载）、`session-tree`（重交互）是回归风险最高且当前最裸的区域，优先补测（O9/O10/O11/O29）。
3. **消除系统性"静默吞错"**：15+ 处 `catch(console.error)` 与空 catch 让失败操作看起来"成功"，是最大可维护性债务，用统一上报 helper 一次性收敛（O13）。
4. **去重即降回归面**：上帝组件拆分 + `DialogOverwritePanel` / "open-session"编排提取（O14），是投入产出比最高、风险最低的欠债偿还。
5. **复用已有测试底座**：`testing/workbench-test-harness.ts` 的 `createControlledDirectoryTransport` 已被复用且自测，新测试应统一基于它。

（本报告为只读评审，未改动任何文件。）

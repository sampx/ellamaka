# ellamaka workbench 代码复查优化总结

> 复查依据：`docs/overview.md`（共 29 项发现，O1–O29）
> 模块：`packages/ellamaka-app/src/pages/workbench/`（SolidJS / solid-js）
> 本轮验证：测试 **451 pass / 0 fail / 1092 expect**；`bun run typecheck`（tsgo -b）**exit 0 无错误**

## 约束遵守声明

- 未破坏现有功能与逻辑（全量测试通过）。
- 接口签名与所有调用点保持不变，仅针对评审指出的具体问题做最小化修改。
- 评审意见均已逐条核实属实后实施。

## 本轮范围

本轮定位为**选择性止血补丁**：落地 P0 中的 3 项（O1/O2/O3）与若干高性价比性能/整洁项，**不触碰架构迁移与测试补全**。评审报告共 29 项，本轮完成 10 项，余 19 项排期见文末。

## 已落地的优化（10 项）

| 编号 | 问题 | 文件 | 改动 |
|------|------|------|------|
| O15 | 孤儿 hook 无引用 | `hooks/use-panel-chat-state.ts` | 删除整个文件及空目录 |
| O21 | "General" 双常量发散 + 硬编码 | `workbench-scope.ts` / `workbench-store.ts` | 收敛为 `GENERAL_SPACE_NAME` 单一导出，`GENERAL_SCOPE_NAME`/`GENERAL_TAB_NAME` 为别名；替换 `panel-loader / workspace / sidebar / session-tree` 中的硬编码字符串 |
| O25 | pty key 字符串拼接易冲突、难查询 | `pty-manager.tsx` | 改为结构化嵌套 Map：`spacePath -> panelId -> kind -> value`，对外 API 不变；`disposeSpace` 主动清理空 space entry |
| O7 | SessionStore `find()` 线性查找 O(N*M) | `session-store.tsx` | `createSessionProjection` 维护 `idToSpace: Map<id, spaceName>` 索引，upsert/patch/remove 同步维护；`limitSessions` 丢条目时不写入索引；stale 索引惰性清理 + 全表 fallback |
| O6 | view-store 整树 `JSON.stringify(snapshot())` 脏检查 | `view-store.tsx` | 改为 `void workbench.snapshot()` 仅建立响应式依赖，去掉每帧序列化；依赖 `clonePersistedWorkbench` 内部遍历 store 代理捕获字段 |
| O2 | 纵向 split 拖拽每帧写 store 抖动 | `parts/panel.tsx` | 拖拽期直写 `splitTerminalEl.style.height`（经 `data-split-terminal` 锚点定位），`mouseup` 提交 `wb.setPanelSplitHeight` |
| O24 | sidebar 宽度拖拽每帧写 store | `parts/sidebar.tsx` | rAF 外直写 `aside`/handle 宽度，`mouseup` 提交 `setWidthStore`；加 `asideRef`/`handleRef` 避免 layout thrash |
| O3 | 目录 cwd 缺路径穿越校验 | 新增 `directory-utils.ts` + `parts/panel.tsx` + `workbench-directory-provider.tsx` | 新增 `sanitizeDirectory()`：空串放行（General 合法），归一化反斜杠，拒绝相对路径与任意 `..` 段；pty.create 与两处 SDKProvider 下发前校验 |
| O12 | 拖拽落点入参未校验 | `parts/panel.tsx` `handleDrop` | `sessionId` 拒绝含斜杠或为 `..`/`.`；`projectPath` 复用 `sanitizeDirectory()` |
| O1 | 顶层缺 ErrorBoundary 兜底 | `index.tsx` + `parts/workspace.tsx` | 顶层 `WorkbenchShell` 外包裹 Solid `ErrorBoundary`；每个 Panel 渲染处单独包裹，单面板崩溃不白屏整页 |

## 已知缺陷（本轮未修，待后续批次处理）

| 编号 | 位置 | 问题 | 建议批次 |
|------|------|------|---------|
| W-01 | `index.tsx:109,119` + `workspace.tsx:308,317` | ErrorBoundary fallback 文案用 `{("工作台加载失败")}` 裸字符串表达式，绕过 `useLanguage` 的 `t()`，违反 AGENTS.md §4 i18n 规范 | 批次 1 |
| W-02 | `view-store.tsx:88` → `workbench-store.ts:135-137` | O6 的响应式依赖间接依赖 `clonePersistedWorkbench` 遍历 store 代理这一实现细节；未来若改用 `structuredClone` 依赖会静默失效，且 view-store 0 测试守护 | 批次 1 |
| I-02 | `directory-utils.ts` | `sanitizeDirectory` 是 O3/O12 安全防线核心却无单测 | 批次 1 |

## 未解决项清单（19 项，按评审报告原分级）

### P0（高杠杆，1 项未做）

- **O4** 收口 actions 迁移适配器 — 架构耦合根，需排期但应最先立项

### P1（本迭代内推进，7 项未做）

- O5 双存储/多存储 + 平行 Session 类型收敛
- O8 会话树多拉取源收敛为单一协调器 + debounce
- O9 补 session-tree.tsx 主组件测试
- O10 补 workbench-actions-context.ts 测试
- O11 补 view-store.tsx hydrate / 迁移测试
- O13 收敛"静默吞错"模式（15+ 处 `catch(console.error)`）
- O14 上帝组件拆分 + 去重（DialogOverwritePanel 两份重复、open-session 编排三处重复）

### P2（后续整洁度 / 稳健性，11 项未做）

- O16 createSessionHistoryLoader 跨模块逐字复制
- O17 Provider 嵌套顺序隐式硬依赖
- O18 view-registry 模块级全局数组改注入
- O19 panel-chat 局部 MemoryRouter 死 hook
- O20 类型安全（`any` / `as` 强转 / `Promise<unknown>`）
- O22 session-tree 每行 createEffect 滚动 → 单 effect + 引用表
- O23 use-workbench-commands 命令列表 createMemo
- O26 console.error 打印原始 error 泄露响应体
- O27 单例 ptyManager Map 跨会话不清理
- O28 测试文件名与所测模块不符
- O29 补 space-store / historyLoader / singleton-guard 测试

## 后续优化规划

按"先低风险测试补全、再错误处理收敛、再去重拆分、最后架构收口"的顺序推进。每个批次独立可提交、独立可验证（测试 + typecheck 全绿）。

### 批次 1 — 测试补全 + i18n 修复（低风险，测试驱动）

目标：补齐评审报告指出的测试裸区，并修复本轮引入的 W-01。

- 修复 W-01：ErrorBoundary fallback 文案走 `t()`，新增 `workbench.error.title/retry` 等 i18n key
- 修复 W-02：在 `snapshot()` 上加注释明确响应式依赖职责，或改用 `createEffect(on(() => store, ...))` 直接订阅
- 补 I-02：`directory-utils.ts` 单测（空串放行、Windows `C:/..` 拒绝、POSIX `..` 段拒绝、反斜杠归一化、相对路径拒绝）
- O11：`view-store.tsx` hydrate / queueSave / legacy 面板迁移测试
- O29：`space-store` 成功/失败两态、`createSessionHistoryLoader` 分页三态、`singleton-guard` Web Lock 三态

退出条件：相关模块测试覆盖改动分支，451+ 测试全绿，typecheck 0 错误。

### 批次 2 — 胶水层测试（回归风险最高区）

- O9：`session-tree.tsx` 主组件测试（`loadSessionGroups` 成功/空/异常三态 + 双击/拖入成功与 archived/child 不可用分支）
- O10：`workbench-actions-context.ts` 测试（directory 推导与字段映射，General 空 path vs Space 差异）
- O28：重命名错位测试文件或加 CI 静态检查

退出条件：胶水层与重交互组件有行为测试守护，复用 `testing/workbench-test-harness.ts` 的可控 transport。

### 批次 3 — 错误处理收敛

- O13：统一错误上报 helper（日志 + 可选 toast + UI 状态回滚），收敛 15+ 处 `catch(console.error)` 与空 catch
- TUI PTY 失败置错误态 + 重试按钮（配合 `view-registry.tsx`）
- 关键动作（删/改/替换）失败保留编辑态

退出条件：无静默吞错路径，失败操作对用户可见。

### 批次 4 — 去重与上帝组件拆分

- O14：提取共享 `DialogOverwritePanel` 与 `locateBoundPanel`/`openSessionInPanel` 服务
- 拆 `session-tree.tsx`(879 行) 为 `useSessionTreeData`/`SessionRow`/`SessionContextMenu`
- 拆 `panel.tsx`(624 行) 为 `PanelHeader`/`PanelSplitTerminal`/`usePanelDrop`
- O16：`createSessionHistoryLoader` 抽公共 hook
- O19：删除 `panel-chat.tsx` 局部 MemoryRouter 死 hook

退出条件：无逐字复制，单文件职责单一，测试仍全绿。

### 批次 5 — 性能收敛

- O8：会话树"轮询 + visibility + 事件失效 + 手动刷新"收敛为单一协调器，`refreshKey` debounce(300ms)
- O22：`session-tree.tsx` 滚动定位改单 effect + `Map<id, HTMLElement>` 引用表
- O23：`use-workbench-commands` 命令列表 `createMemo`，仅引用变化时 `command.register`

退出条件：高频更新路径无全表扫描或全量序列化。

### 批次 6 — 整洁度 / 类型 / 安全

- O20：`view-registry` 的 `sdk: any` 定义最小接口；`children: any` 改 `JSX.Element`；去 i18n `as` 强转；`PtySDK` 返回类型补全
- O26：统一日志封装，脱敏响应体/头/路径
- O27：登出/卸载入口显式 `ptyManager.clearMemoryOnly()` 或绑定登录会话生命周期
- O17：Provider 嵌套顺序加顺序约束注释或改 DI
- O18：`view-registry` 模块级全局数组改注入 + id 枚举

退出条件：无 `any` 类型逃逸，日志无敏感泄露。

### 批次 7 — 架构收口（长周期，高风险）

- O4：推进 Tasks 4-6，让 store 直接实现 StorePort 或 actions 直接持有 store 引用，删除 `workbench-actions-context.ts` 与 `useWorkbenchActions` 间接层
- O5：删除 `session-store-legacy.ts`，`limitSessions` 并入工具模块；单一 `STORAGE_KEYS` 常量表；建立单一 `Session`/`WorkbenchPanel` 真相源类型，消除 `WorkbenchAction*` 平行拷贝

退出条件：无过渡适配器，单一真相源类型，Workbench §5 边界契约全部通过。

## 回归验证基线

每个批次提交前需通过：

```
cd packages/ellamaka-app
bun run typecheck
bun run test:unit --force-exit   # 当前基线 451 pass / 0 fail
```

涉及 Workbench 边界的批次（4/5/7）额外按 `packages/ellamaka-app/AGENTS.md` §5.9 的最小验证链执行。
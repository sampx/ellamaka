# ellamaka workbench 代码复查优化总结

> 复查依据：`docs/overview.md`（共 29 项发现，O1–O29）
> 模块：`packages/ellamaka-app/src/pages/workbench/`（SolidJS / solid-js）
> 当前验证：测试 **482 pass / 0 fail / 1143 expect**；`bun run typecheck`（tsgo -b）**exit 0 无错误**；agent-browser 5 路径端到端全绿

## 约束遵守声明

- 未破坏现有功能与逻辑（全量测试通过 + 端到端回归通过）。
- 接口签名与所有调用点保持不变，仅针对评审指出的具体问题做最小化修改。
- 评审意见均已逐条核实属实后实施。

## 已落地的优化（14 项）

### 第一轮止血补丁（10 项）

| 编号 | 问题 | 文件 | 改动 |
|------|------|------|------|
| O15 | 孤儿 hook 无引用 | `hooks/use-panel-chat-state.ts` | 删除整个文件及空目录 |
| O21 | "General" 双常量发散 + 硬编码 | `workbench-scope.ts` / `workbench-store.ts` | 收敛为 `GENERAL_SPACE_NAME` 单一导出，`GENERAL_SCOPE_NAME`/`GENERAL_TAB_NAME` 为别名；替换 `panel-loader / workspace / sidebar / session-tree` 中的硬编码字符串 |
| O25 | pty key 字符串拼接易冲突、难查询 | `pty-manager.tsx` | 改为结构化嵌套 Map：`spacePath -> panelId -> kind -> value`，对外 API 不变；`disposeSpace` 主动清理空 space entry |
| O7 | SessionStore `find()` 线性查找 O(N*M) | `session-store.tsx` | `createSessionProjection` 维护 `idToSpace: Map<id, spaceName>` 索引，upsert/patch/remove 同步维护；`limitSessions` 丢条目时不写入索引；stale 索引惰性清理 + 全表 fallback |
| O6 | view-store 整树 `JSON.stringify(snapshot())` 脏检查 | `view-store.tsx` | 改为 `void workbench.snapshot()` 仅建立响应式依赖，去掉每帧序列化；依赖 `clonePersistedWorkbench` 内部遍历 store 代理捕获字段 |
| O2 | 纵向 split 拖拽每帧写 store 抖动 | `parts/panel.tsx` | 拖拽期直写 `splitTerminalEl.style.height`（经 `data-split-terminal` 锚点定位），`mouseup` 提交 `wb.setPanelSplitHeight` |
| O24 | sidebar 宽度拖拽每帧写 store | `parts/sidebar.tsx` | rAF 外直写 `aside`/`handle` 宽度，`mouseup` 提交 `setWidthStore`；加 `asideRef`/`handleRef` 避免 layout thrash |
| O3 | 目录 cwd 缺路径穿越校验 | 新增 `directory-utils.ts` + `parts/panel.tsx` + `workbench-directory-provider.tsx` | 新增 `sanitizeDirectory()`：空串放行（General 合法），归一化反斜杠，拒绝相对路径与任意 `..` 段；pty.create 与两处 SDKProvider 下发前校验 |
| O12 | 拖拽落点入参未校验 | `parts/panel.tsx` `handleDrop` | `sessionId` 拒绝含斜杠或为 `..`/`.`；`projectPath` 复用 `sanitizeDirectory()` |
| O1 | 顶层缺 ErrorBoundary 兜底 | `index.tsx` + `parts/workspace.tsx` | 顶层 `WorkbenchShell` 外包裹 Solid `ErrorBoundary`；每个 Panel 渲染处单独包裹，单面板崩溃不白屏整页 |

### 第二轮架构收口（4 项，2026-07-16 落地）

| 编号 | 问题 | 文件 | 改动 |
|------|------|------|------|
| O4 | actions 迁移适配器是架构耦合根 | 删 `workbench-actions-context.ts`(158行)；新增 `workbench-actions-ports.ts`(`buildStorePort`/`buildPtyPort`/`buildSessionPort`)；`view-store.tsx` 暴露 `boundPanels`/`active` 满足 `WorkbenchActionStorePort`；`workbench-actions.ts` 内联 `useWorkbenchActions()` hook 删 Context 层；9 调用点迁移 | 删过渡适配器，store 直连 `createWorkbenchActions`，net -110 行 |
| O5 | 双存储 + 平行 Session/Panel 类型 | 删 `services/session-store-legacy.ts` + `session-store-service.ts` + 两测试；`limitSessions` 并入 `session-store.tsx`；`WorkbenchActionPanel` → `WorkbenchPanel` 别名；`WorkbenchActionSession` 保留为 server DTO（与本地 `Session` 分属不同层） | 单一真相源类型，删死代码 services 层 |
| O17 | Provider 嵌套顺序隐式硬依赖 | `index.tsx` | Provider 嵌套处加顺序约束注释：SessionStore > WorkbenchState > ViewRegistry > Space，标注"Actions 依赖 State+Session，Space 依赖 Actions" |
| O18 | view-registry 模块级全局数组 | `view-registry.tsx` | `ViewId` 枚举常量替换字符串字面量；`createViewRegistry()` 工厂替换模块级全局数组；`registerDefaultViews()` 在 Shell 初始化时调用；`getView`/`listViews` 从注入 registry 读取 |
| O10 | workbench-actions 测试裸区 | `workbench-actions.test.ts` | 随 O4 落地测收口后最终形态：34 新测试覆盖 store port delegation、General vs Space scope、§5.6 四态（success/failure/repeated/stale generation token）；无过渡测试债 |

**架构收口验证**：typecheck exit 0；482 pass / 0 fail（+34）；agent-browser 5 路径端到端全绿（首屏渲染、创建会话、会话恢复、三视图切换、Space Tab 切换切回状态保持）。

## 已知缺陷（本轮未修，待 Plan 2 处理）

| 编号 | 位置 | 问题 | 建议批次 |
|------|------|------|---------|
| W-01 | `index.tsx:109,119` + `workspace.tsx:308,317` | ErrorBoundary fallback 文案用 `{("工作台加载失败")}` 裸字符串表达式，绕过 `useLanguage` 的 `t()`，违反 AGENTS.md §4 i18n 规范 | Plan 2 |
| W-02 | `view-store.tsx:88` → `workbench-store.ts:135-137` | O6 的响应式依赖间接依赖 `clonePersistedWorkbench` 遍历 store 代理这一实现细节；未来若改用 `structuredClone` 依赖会静默失效，且 view-store 0 测试守护 | Plan 2 |
| I-02 | `directory-utils.ts` | `sanitizeDirectory` 是 O3/O12 安全防线核心却无单测 | Plan 2 |

## 未解决项清单（15 项，Plan 2 推进）

### P1（本迭代内推进，6 项未做）

- O8 会话树多拉取源收敛为单一协调器 + debounce
- O9 补 session-tree.tsx 主组件测试
- O11 补 view-store.tsx hydrate / 迁移测试
- O13 收敛"静默吞错"模式（15+ 处 `catch(console.error)`）
- O14 上帝组件拆分 + 去重（DialogOverwritePanel 两份重复、open-session 编排三处重复）

### P2（后续整洁度 / 稳健性，9 项未做）

- O16 createSessionHistoryLoader 跨模块逐字复制
- O19 panel-chat 局部 MemoryRouter 死 hook
- O20 类型安全（`any` / `as` 强转 / `Promise<unknown>`）
- O22 session-tree 每行 createEffect 滚动 → 单 effect + 引用表
- O23 use-workbench-commands 命令列表 createMemo
- O26 console.error 打印原始 error 泄露响应体
- O27 单例 ptyManager Map 跨会话不清理
- O28 测试文件名与所测模块不符
- O29 补 space-store / historyLoader / singleton-guard 测试

## 后续优化规划

架构收口（O4/O5/O17/O18）已先于其他项落地，消除了过渡适配器与平行类型，为后续在干净架构上推进测试补全、错误处理收敛、去重拆分奠定基础。剩余 15 项 + W-01/W-02/I-02 统一纳入 Plan 2 推进，按"先低风险测试补全、再错误处理收敛、再去重拆分、最后性能与类型安全"的顺序分批执行。每个批次独立可提交、独立可验证（测试 + typecheck + 端到端全绿）。
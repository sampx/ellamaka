---
name: Ellamaka AGENT RULES
description: WopalSpace engine fork of OpenCode for running space-aware agents, commands, plugins, configuration, and TUI behavior
---

# Agent Development Rules

## 1. Canonical References

权威引用：

- DESIGN: `docs/DESIGN.md`
- API 契约: `docs/API-CONTRACT.md`
- BRANDING: `docs/BRANDING.md` — 品牌化定制的唯一真相源，记录每项定制的设计意图和实现逻辑
- WORKBENCH: `docs/ELLAMAKA-WORKBENCH.zh-CN.md` — 工作台设计规范，包含多面板、三级会话浏览器、状态持久化等核心设计
- `.gitattributes` — fork 独有文件的 merge 保护规则（merge=ours），上游合并自动保留 ellamaka 版本
- DISTRIBUTION: `docs/DISTRIBUTION.md`
- Upstream Merge logs: `docs/UPSTREAM-MERGE-LOG.md`
- Config Reference: `docs/references/ellamaka-config-mechanism.md`
- opencode package rules: `packages/opencode/AGENTS.md`

## 2. Architecture and Directories

执行链：OpenCode upstream → ellamaka fork → `--wopal-space` → `.wopal/` ontology → `.wopal-space/` runtime。

| 目录 | 职责 |
|---|---|
| `packages/opencode/` | OpenCode inherited engine 主包；其内部规则见 `packages/opencode/AGENTS.md` |
| `packages/core/` | shared core、flags、global paths、installation/runtime 基础能力 |
| `packages/app/`, `packages/ui/`, `packages/storybook/` | inherited UI surfaces；只在 engine/TUI 需要时改动 |
| `packages/plugin/`, `packages/script/`, `packages/util/` | workspace support packages |
| `packages/sdk/` | SDK workspace；JS SDK regeneration 使用既有脚本 |
| `packages/ellamaka/` | 品牌常量（branding.ts/channel）、品牌字模（logo.ts）、构建包装（build.ts）、WopalSpace 自动检测（detect.ts）、安装路径判断（is-wopal-install.ts）及包级测试 |
| `docs/` | project DESIGN、BRANDING、DISTRIBUTION、references、research 和 plans |

## 3. Development Commands (build format test)

| 场景 | 命令 | 何时 |
|---|---|---|
| Lint | `bun run lint` | 修改 TypeScript / config 后 |
| Root typecheck | `bun run typecheck` | 需要全仓类型检查时 |
| opencode typecheck | `bun typecheck` from `packages/opencode` | 修改 engine 主包后；不要直接运行 `tsc` |
| opencode tests | `bun test --timeout 30000` from `packages/opencode` | 修改 engine 主包行为后 |
| opencode build | `bun run build` from `packages/opencode` | runtime / CLI / package build 相关变更后 |
| ellamaka package tests | `bun test` from `packages/ellamaka` | 修改 branding、logo、detection 逻辑后 |
| ellamaka build | `bun packages/ellamaka/build.ts --web-ui ellamaka-app` | 本地构建 ellamaka 品牌 CLI 时；用 `--web-ui app` 嵌入上游 UI，用 `--web-ui none` 不嵌入 UI |
| 上游合并后精简检查 | `./scripts/check-cleanup.sh [--clean]` | 合并 opencode 上游后检查是否有应删除的文件/目录被错误并入 |

测试不能从 repo root 运行；root `test` script 是 guard。

## 4. Implementation Rules

- 遵循 `packages/opencode/AGENTS.md` 的通用编码规范（Bun APIs、Effect Schema、类型/控制流、Drizzle schema、模块组织等）。
- WopalSpace 定制优先放在新文件；上游文件只保留最小 import 和调用注入点。
- 定制分支使用提前返回 guard，避免与 upstream 主流程改动重叠。
- 新模块需要访问 upstream 内部能力时优先用回调/闭包注入，不直接暴露 upstream Service 类型边界。
- 复用 upstream 逻辑时提取共享 helper，不复制大段 upstream 流程。
- 禁止对 upstream 文件做无关格式化重排、import 重排、dependency 重排或 object key 重排。
- `main` 是 ellamaka 定制稳定主线；`dev` 只跟踪 upstream OpenCode `dev`，不要在 `dev` 上做 ellamaka 定制开发。
- diff 基准使用 `main` 或 `origin/main`；不要用 `dev` 作为 ellamaka 定制差异基准。
- 上游合并时遵循 `docs/UPSTREAM-MERGE-LOG.md` 的精简清单、保留定制项和验证门槛。
- `.gitattributes` 已配置以下 fork 独有文件的 `merge=ours` 保护：`README.md`、`README.zh-CN.md`、`AGENTS.md`、`AGENTS.zh-CN.md`、`scripts/**`、`docs/**`、`.husky/**`、`.github/TEAM_MEMBERS`、`.github/workflows/publish-ellamaka.yml`。上游合并时这些文件自动保留 ellamaka 版本，禁止删除或修改该规则。

### HTTP API 与 SDK 契约

- 新端点遵循 `docs/API-CONTRACT.md`。先确认领域 Owner、Root/Instance 层级、既有 group 和资源语义，再定义 Effect Schema、请求、成功结果、领域错误与兼容性。
- 端点归入 `HttpApiGroup`。全局 WopalSpace 控制能力归 Root API，Session、文件、项目、PTY 和工作目录能力归 Instance API。handler 只转换 HTTP 与领域服务。
- 路径表达领域资源与自然从属关系。查询条件属于 query 参数。文件系统、Shell、CLI 执行和目录 provision 由所属领域服务拥有，不形成浏览器可直接调用的通用原语。
- SDK 由 Effect HttpApi → OpenAPI → `packages/sdk/js/script/build.ts` 自动生成。应用代码使用生成客户端；`packages/sdk/js/src/v2/gen/**` 由生成管线拥有。
- 新增或修改端点必须测试 schema、成功结果、领域错误和 middleware 边界，重新生成 SDK，并同步更新 DESIGN 与 BRANDING。

### 提交信息与 PR 标题

使用 conventional commit 格式：`type(scope): summary`。

有效 type：`feat`、`fix`、`docs`、`chore`、`refactor`、`test`。scope 可选，建议使用受影响的包或模块，如 `core`、`opencode`、`tui`、`app`、`desktop`、`sdk`、`plugin`。

示例：`fix(tui): simplify thinking toggle styling`、`docs: update contributing guide`、`chore(sdk): regenerate types`。

## 5. Testing

- 代码类变更遵循 TDD：先写能失败的测试，再实现代码使其通过。
- 尽量避免 mocks；测试真实实现，不要把实现逻辑复制进测试。
- 测试必须从 package 目录运行，例如 `packages/opencode` 或 `packages/ellamaka`；不要从 repo root 运行测试。
- 修改 engine 主包后，至少从 `packages/opencode` 运行相关 `bun test --timeout 30000` 或说明未运行原因。
- 修改 branding、logo 或 detection 逻辑后，从 `packages/ellamaka` 运行 `bun test`。
- 修改 TypeScript 后，从对应 package 运行 `bun typecheck`；不要直接运行 `tsc`。
- 修改 CLI/runtime/config/plugin/agent/TUI space mode 后，验证或说明以下面向：`WOPAL_SPACE` flag、`.wopal/config/settings.*`、TUI settings、plugin loading、theme loading。
- 上游合并后区分 upstream known failures、环境问题和 ellamaka 新引入问题。

## 6. User-Supplied Rules

- JS SDK 重新生成：`./packages/sdk/js/script/build.ts`。
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- 本仓库默认分支是 `main`。`dev` 分支仅跟踪 upstream OpenCode 的 `dev`，用于 merge 集成。
- diff 基准使用 `main` 或 `origin/main`；`dev` 仅作 upstream-tracking。
- 优先自动执行明确请求；遇到缺少关键信息、安全风险或不可逆操作时先确认。

### 通用原则

- 除非需要组合或复用，否则保持逻辑在一个函数内。
- 不要预先提取单次使用的 helper。仅在 helper 被复用、隐藏了真正复杂边界或有清晰独立命名时提取。
- 尽量避免 `try`/`catch`。
- 避免使用 `any` 类型。
- 尽可能使用 Bun API（如 `Bun.file()`）。
- 尽可能依赖类型推断；除非导出或需要明确性，避免显式类型标注或 interface。
- 优先使用函数式数组方法（`flatMap`、`filter`、`map`）而非 for 循环；filter 上使用类型守卫以保持下游类型推断。
- 在 `src/config` 中，添加新模块遵循已有自导出模式：`export * as ConfigAgent from "./agent"`。

### Style Guide — Code Examples

#### Inlining

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

#### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

#### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

#### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

#### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

### 复杂逻辑

当函数有多个验证分支或辅助细节时，让主函数保持 Happy Path，将辅助细节移入下方的小型 helper。

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- 将 helper 放在靠近所支持代码的位置，在主 export 下方以改善可读性。
- 不要将简单表达式过度抽象为多个单次使用的 helper；仅在 helper 命名了真正的概念时提取（如 `requireConfig`、`readMetadata`）。
- 不要从 helper 返回 `Effect`，除非它们确实执行有副作用的工作。同步的解析、验证和选项构建应保持同步。
- 解析不可信 JSON 字符串时，优先使用 Effect schema 辅助方法（`Schema.UnknownFromJsonString`、`Schema.decodeUnknownOption`）而非手写 `JSON.parse` 包裹在 `Effect.try` 中。
- 为非显而易见的约束和意外行为添加注释，不要为明显的赋值或控制流添加注释。

## 5. UI 状态管理与持久化规范 (State & Persistence)

为了防止多 Panel 结构下界面状态丢失和高频重绘闪烁，所有 Agent 进行前端定制开发时，必须遵守以下持久化与状态更新规则：

### 5.1 空间路径 (Space Path) 与面板 CWD 语义隔离

- **Space Path** 是全局 Store 的主键（即 Tab 绝对路径，如 `/Volumes/U500G/coding/wopal-workspace`），用于检索空间面板状态。
- **Panel.directory** 是面板内的 CWD 上下文，可被用户更改定位到子项目目录中。
- **强制规则**：**禁止**使用 `panel.directory` 或空间名称（`spaceName`）充当 Space Path Key 传递给 Store 的读写 API。面板容器必须接收外部透传的 `spacePath` prop，确保状态数据在正确的空间索引下持久化。

### 5.2 异步同步桥 (Sync Bridge) 竞态安全保护

- 引入监听服务端列表（如 `sync.data.session`）的 `createEffect` 自动解绑机制时，**必须**做初始化就绪判定。
- **强制规则**：只有在数据加载完毕（如 `sync.data.status === "complete"`）后，才允许执行本地与服务端的非一致性解绑/删除判断。在就绪前，不得因初始列表为空而对本地持久化状态进行擦除。

### 5.3 响应式副作用与性能控制

- **强制规则**：`createMemo` 必须是纯函数，**禁止**在 Memo 内部发起 API 异步请求或写入 Store 的副作用行为，必须使用 `createEffect`。
- **高频更新限频**：连接 SSE 总线时，只有结构性变动（如 `created`、`deleted`）才允许更新 `triggerRefresh()` 引发树组件重新获取。状态内容的高频变动（如 `updated` 块生成）必须通过 Sync 机制在渲染组件内部局部响应，禁止引起全局列表频繁重绘。

### 5.4 虚拟通用空间 (General Space) 的逻辑兼容

- **空串路径处理**：通用空间（General）的路径为空字符串 `""`。在组件内对 `path` 进行初始化保障（如 `ensureSpace(path)`）或显示切换时，**必须**使用 activeTab 存在与否做前置守卫，**绝对禁止**使用 `if (path)` 等隐式真值判定，避免 `""` 被识别为 Falsy 值导致初始化被跳过、面板渲染空白及加号按钮被隐藏。
- **I18n 引用**：通用空间的 Tab 顶部标题翻译引用应为 `t("workbench.sidebar.spaces")`（对应中文“会话”，英文“Sessions”），禁止错写为未定义的 `t("workbench.sidebar.sessions")`。

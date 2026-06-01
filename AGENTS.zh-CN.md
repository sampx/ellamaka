---
name: Ellamaka AGENT RULES
description: WopalSpace engine fork of OpenCode for running space-aware agents, commands, plugins, configuration, and TUI behavior
---

# Agent Development Rules

## 1. Canonical References

权威引用：

- DESIGN: `docs/DESIGN.md`
- Upstream Merge Rules: `docs/UPSTREAM-MERGE-LOG.md`
- Config Reference: `docs/references/ellamaka-config-mechanism.md`
- opencode package rules: `packages/opencode/AGENTS.md`

## 2. Architecture and Directories

执行链：OpenCode upstream → ellamaka fork → `--wopal-space` → `.wopal/` ontology → `.wopal-space/` runtime。

ellamaka 是 WopalSpace 的 engine runtime。它负责运行 space-aware agents、commands、plugins、configuration 和 TUI behavior；不要在本仓库维护 ontology 内容、space runtime state、wopal-cli 确定性编排或 WopalSpace 产品路线。

| 目录 | 职责 |
|---|---|
| `packages/opencode/` | OpenCode inherited engine 主包；其内部规则见 `packages/opencode/AGENTS.md` |
| `packages/core/` | shared core、flags、global paths、installation/runtime 基础能力 |
| `packages/app/`, `packages/ui/`, `packages/storybook/` | inherited UI surfaces；只在 engine/TUI 需要时改动 |
| `packages/plugin/`, `packages/script/`, `packages/shared/`, `packages/util/` | workspace support packages |
| `packages/sdk/` | SDK workspace；JS SDK regeneration 使用既有脚本 |
| `packages/ellamaka/` | ellamaka 品牌常量与 env 驱动构建包装 |
| `docs/` | project DESIGN、references、research 和 plans |

## 3. Development Commands (build format test)

| 场景 | 命令 | 何时 |
|---|---|---|
| Root dev | `bun run dev` | 本地启动 opencode package dev entry |
| Web dev | `bun run dev:web` | 调试 app/web surface |
| Storybook | `bun run dev:storybook` | 调试 storybook surface |
| Lint | `bun run lint` | 修改 TypeScript / config 后 |
| Root typecheck | `bun run typecheck` | 需要全仓类型检查时 |
| opencode typecheck | `bun typecheck` from `packages/opencode` | 修改 engine 主包后；不要直接运行 `tsc` |
| opencode tests | `bun test --timeout 30000` from `packages/opencode` | 修改 engine 主包行为后 |
| opencode build | `bun run build` from `packages/opencode` | runtime / CLI / package build 相关变更后 |
| JS SDK regeneration | `./packages/sdk/js/script/build.ts` | SDK 输出需要重新生成时 |
| ellamaka build | `bun packages/ellamaka/build.ts` | 本地构建 ellamaka 品牌 CLI 时 |
| 本地构建（darwin） | `./scripts/build.sh` | macOS 本地编译 CLI 二进制 |
| 本地开发环境 | `./scripts/dev.sh` | 启动开发环境（支持 in-process TUI、attach/server 分流） |
| API 文档 | `bun ./scripts/scalar-doc.ts` | 启动 Scalar API 参考文档 UI |
| 上游合并后精简检查 | `./scripts/check-cleanup.sh [--clean]` | 合并 opencode 上游后检查是否有应删除的文件/目录被错误并入 |

测试不能从 repo root 运行；root `test` script 是 guard。

## 4. Implementation Rules

- 优先使用 Bun APIs，例如 `Bun.file()`。
- 保持代码在一个函数中，除非逻辑需要复用或组合。
- 避免 `try` / `catch`；遵循现有 Effect error handling 模式。
- 避免 `any`；需要缺陷类错误时遵循 `packages/opencode/AGENTS.md` 的 Effect Schema 规则。
- 依赖类型推断；除导出边界或清晰度需要外，避免显式类型和 interface。
- 优先使用 `flatMap`、`filter`、`map` 等函数式数组方法；`filter` 使用 type guard 保持下游类型推断。
- 避免不必要的 destructuring；使用 dot notation 保留上下文。
- 优先 `const`；用 ternary 或 early return 替代变量重赋值。
- 避免 `else`；优先 early return。
- 只使用 `let` 表达真实可变状态。
- 只在值被复用或能提升可读性时创建中间变量；一次性值优先内联。
- `src/config` 新增模块时遵循现有 self-export pattern，例如 `export * as ConfigAgent from "./agent"`。
- Drizzle schema 字段使用 snake_case，避免通过字符串重定义 column name。
- 修改 `packages/opencode/` 内部模块、Effect、database、migration 或 Instance lifecycle 时，遵循 `packages/opencode/AGENTS.md`。
- 涉及 WopalSpace、`.wopal/*`、plugin、自定义工具或 agent 配置时，验证对象必须是 ellamaka runtime，不要用 upstream opencode 替代。
- ellamaka 全局配置根是 `~/.wopal/ellamaka/config/`，不要按 upstream OpenCode 的默认 config root 设计 WopalSpace 行为。
- wopal-space mode 使用 `.wopal/config/settings.jsonc` 的 `ellamaka` 和 `tui` 分区；不要让 project-level `opencode.jsonc` 污染 space mode。
- wopal-space permission 合并顺序是 defaults → global config → `.wopal/config/settings.*` → `.wopal/agents/{name}.md` frontmatter；最后匹配项生效。
- WopalSpace 定制优先放在新文件；上游文件只保留最小 import 和调用注入点。
- 定制分支使用提前返回 guard，避免与 upstream 主流程改动重叠。
- 新模块需要访问 upstream 内部能力时优先用回调/闭包注入，不直接暴露 upstream Service 类型边界。
- 复用 upstream 逻辑时提取共享 helper，不复制大段 upstream 流程。
- 禁止对 upstream 文件做无关格式化重排、import 重排、dependency 重排或 object key 重排。
- `main` 是 ellamaka 定制稳定主线；`dev` 只跟踪 upstream OpenCode `dev`，不要在 `dev` 上做 ellamaka 定制开发。
- diff 基准使用 `main` 或 `origin/main`；不要用 `dev` 作为 ellamaka 定制差异基准。
- 上游合并时遵循 `docs/UPSTREAM-MERGE-LOG.md` 的精简清单、保留定制项和验证门槛。
- 涉及 load path、plugin、agent、config 或 runtime 启动链路的修改完成后，提醒用户重启 ellamaka 验证；Wopal 不自行重启 ellamaka。
- 优先自动执行明确请求；遇到缺少关键信息、安全风险或不可逆操作时先确认。
- 可并行读取或检查时使用并行工具。

## 5. Testing

- 代码类变更遵循 TDD：先写能失败的测试，再实现代码使其通过。
- 尽量避免 mocks；测试真实实现，不要把实现逻辑复制进测试。
- 测试必须从 package 目录运行，例如 `packages/opencode`；不要从 repo root 运行测试。
- 修改 engine 主包后，至少从 `packages/opencode` 运行相关 `bun test --timeout 30000` 或说明未运行原因。
- 修改 TypeScript 后，从对应 package 运行 `bun typecheck`；不要直接运行 `tsc`。
- 修改 CLI/runtime/config/plugin/agent/TUI space mode 后，验证或说明以下面向：`WOPAL_SPACE` flag、`.wopal/config/settings.*`、TUI settings、plugin loading、theme loading。
- 上游合并后区分 upstream known failures、环境问题和 ellamaka 新引入问题。

## 6. User-Supplied Rules

- JS SDK 重新生成：`./packages/sdk/js/script/build.ts`。
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- 本仓库默认分支是 `main`。`dev` 分支仅跟踪 upstream OpenCode 的 `dev`，用于 merge 集成。
- diff 基准使用 `main` 或 `origin/main`；`dev` 仅作 upstream-tracking。
- 优先自动执行明确请求；遇到缺少关键信息、安全风险或不可逆操作时先确认。

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

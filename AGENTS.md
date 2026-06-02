---
name: Ellamaka AGENT RULES
description: WopalSpace engine fork of OpenCode for running space-aware agents, commands, plugins, configuration, and TUI behavior
---

# Agent Development Rules

## 1. Canonical References

Canonical references:

- DESIGN: `docs/DESIGN.md`
- DISTRIBUTION: `docs/DISTRIBUTION.md`
- Upstream Merge Rules: `docs/UPSTREAM-MERGE-LOG.md`
- Config Reference: `docs/references/ellamaka-config-mechanism.md`
- opencode package rules: `packages/opencode/AGENTS.md`

## 2. Architecture and Directories

Execution chain: OpenCode upstream → ellamaka fork → `--wopal-space` → `.wopal/` ontology → `.wopal-space/` runtime.

ellamaka is the WopalSpace engine runtime. It runs space-aware agents, commands, plugins, configuration, and TUI behavior; do not maintain ontology content, space runtime state, wopal-cli deterministic orchestration, or the WopalSpace product roadmap in this repository.

| Directory | Responsibility |
|---|---|
| `packages/opencode/` | Main inherited OpenCode engine package; follow `packages/opencode/AGENTS.md` for internal rules |
| `packages/core/` | Shared core, flags, global paths, and installation/runtime foundations |
| `packages/app/`, `packages/ui/`, `packages/storybook/` | Inherited UI surfaces; change only when engine/TUI work requires it |
| `packages/plugin/`, `packages/script/`, `packages/util/` | Workspace support packages |
| `packages/sdk/` | SDK workspace; use the existing script for JS SDK regeneration |
| `packages/ellamaka/` | ellamaka branding constants and env-driven build wrapper |
| `docs/` | Project DESIGN, references, research, and plans |

## 3. Development Commands (build format test)

| Scenario | Command | When |
|---|---|---|
| Root dev | `bun run dev` | Start the opencode package dev entry locally |
| Web dev | `bun run dev:web` | Debug the app/web surface |
| Storybook | `bun run dev:storybook` | Debug the storybook surface |
| Lint | `bun run lint` | After TypeScript / config changes |
| Root typecheck | `bun run typecheck` | When a full-repo typecheck is needed |
| opencode typecheck | `bun typecheck` from `packages/opencode` | After changing the main engine package; do not run `tsc` directly |
| opencode tests | `bun test --timeout 30000` from `packages/opencode` | After changing main engine behavior |
| opencode build | `bun run build` from `packages/opencode` | After runtime / CLI / package build changes |
| JS SDK regeneration | `./packages/sdk/js/script/build.ts` | When SDK output needs regeneration |
| ellamaka build | `bun packages/ellamaka/build.ts` | When building ellamaka-branded CLI locally |
| Local build (darwin) | `./scripts/build.sh` | Compile CLI binary on macOS |
| Local dev environment | `./scripts/dev.sh` | Start dev environment (in-process TUI, attach/server modes) |
| API docs | `bun ./scripts/scalar-doc.ts` | Start Scalar API reference documentation UI |
| Post-merge cleanup check | `./scripts/check-cleanup.sh [--clean]` | After merging upstream opencode, check for files/dirs that should have been deleted |

Tests must not run from the repo root; the root `test` script is a guard.

## 4. Implementation Rules

- Prefer Bun APIs, such as `Bun.file()`.
- Keep code in one function unless logic must be reused or composed.
- Avoid `try` / `catch`; follow the existing Effect error-handling patterns.
- Avoid `any`; when defect-like errors are needed, follow the Effect Schema rules in `packages/opencode/AGENTS.md`.
- Rely on type inference; avoid explicit types and interfaces unless needed for exported boundaries or clarity.
- Prefer functional array methods such as `flatMap`, `filter`, and `map`; use type guards in `filter` to preserve downstream inference.
- Avoid unnecessary destructuring; use dot notation to preserve context.
- Prefer `const`; use ternaries or early returns instead of variable reassignment.
- Avoid `else`; prefer early returns.
- Use `let` only for true mutable state.
- Create intermediate variables only when a value is reused or improves readability; inline one-off values.
- When adding modules under `src/config`, follow the existing self-export pattern, such as `export * as ConfigAgent from "./agent"`.
- Drizzle schema fields use snake_case; avoid redefining column names with strings.
- When changing internal modules, Effect, database, migrations, or Instance lifecycle under `packages/opencode/`, follow `packages/opencode/AGENTS.md`.
- For WopalSpace, `.wopal/*`, plugins, custom tools, or agent configuration, verify against the ellamaka runtime; do not use upstream opencode as a substitute.
- ellamaka's global config root is `~/.wopal/ellamaka/config/`; do not design WopalSpace behavior around upstream OpenCode's default config root.
- wopal-space mode uses the `ellamaka` and `tui` sections in `.wopal/config/settings.jsonc`; do not let project-level `opencode.jsonc` pollute space mode.
- wopal-space permission merge order is defaults → global config → `.wopal/config/settings.*` → `.wopal/agents/{name}.md` frontmatter; the last matching rule wins.
- Put WopalSpace customization in new files first; upstream files should keep only minimal imports and invocation points.
- Use early-return guards for customized branches to avoid overlapping upstream main-flow changes.
- When new modules need upstream internals, prefer callback/closure injection instead of exposing upstream Service type boundaries directly.
- When reusing upstream logic, extract shared helpers instead of copying large upstream flows.
- Do not apply unrelated formatting churn, import reordering, dependency reordering, or object key reordering to upstream files.
- `main` is the stable line for ellamaka customization; `dev` only tracks upstream OpenCode `dev`, so do not develop ellamaka customizations on `dev`.
- Use `main` or `origin/main` as the diff base; do not use `dev` as the ellamaka customization diff base.
- During upstream merges, follow the cleanup list, preserved customization list, and verification gates in `docs/UPSTREAM-MERGE-LOG.md`.
- After changes involving load paths, plugins, agents, config, or runtime startup flow, remind the user to restart ellamaka for verification; Wopal must not restart ellamaka itself.
- Prefer automation for explicit requests; ask first when critical information is missing, safety is at risk, or the operation is irreversible.
- Use parallel tools whenever reads or checks can run independently.

## 5. Testing

- Code changes follow TDD: write a failing test first, then implement code to make it pass.
- Avoid mocks as much as possible; test the real implementation and do not duplicate implementation logic into tests.
- Tests must run from package directories, such as `packages/opencode`; do not run tests from the repo root.
- After changing the main engine package, run the relevant `bun test --timeout 30000` from `packages/opencode` or explain why it was not run.
- After changing TypeScript, run `bun typecheck` from the relevant package; do not run `tsc` directly.
- After changing CLI/runtime/config/plugin/agent/TUI space mode, verify or report these surfaces: `WOPAL_SPACE` flag, `.wopal/config/settings.*`, TUI settings, plugin loading, and theme loading.
- After upstream merges, separate upstream known failures, environment issues, and newly introduced ellamaka issues.

## 6. User-Supplied Rules

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`. The `dev` branch tracks upstream opencode `dev` for merge integration.
- Use `main` or `origin/main` for diffs; `dev` is upstream-tracking only.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

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

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`. The `dev` branch tracks upstream opencode `dev` for merge integration.
- Use `main` or `origin/main` for diffs; `dev` is upstream-tracking only.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

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

### Schema Definitions (Drizzle)

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

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Upstream Merge Conflict Minimization

This repo tracks upstream opencode via the `dev` branch. All local customizations (ellamaka/wopal-space features) must follow these rules to minimize merge conflict surface:

1. **New files over in-line edits**: Custom logic goes in dedicated new files (e.g. `wopal-space.ts`), not embedded in upstream source files. The upstream file only gets a minimal call-site insertion (import + one `yield*` call).

2. **Closure injection over raw Service passing**: When the new module needs access to upstream internals (closures, Effect services), inject them as callback interfaces — not by passing the Service objects directly. This avoids leaking upstream type changes into the new module.

3. **Early-return gates**: Custom branches use `if (flag) { ... return result }` before the upstream flow starts, so upstream changes to the main flow never overlap with custom code in the same region.

4. **Post-merge helpers extracted once**: When upstream logic must be shared (e.g. `applyPostMerge()`), extract it into a named helper in the upstream file and call it from both paths — do not duplicate the logic.

5. **No cosmetic reorderings**: Never reorder imports, dependencies, or object keys in upstream files. These create noise diffs that explode conflict windows on merge.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

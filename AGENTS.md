---
name: Ellamaka AGENT RULES
description: WopalSpace engine fork of OpenCode for running space-aware agents, commands, plugins, configuration, and TUI behavior
---

# Agent Development Rules

## 1. Canonical References

- DESIGN: `docs/DESIGN.md` — architecture overview, config contract, ontology loading
- API CONTRACT: `docs/API-CONTRACT.md` — Runtime API, OpenAPI, generated SDK, and Wopal CLI adapter contract
- BRANDING: `docs/BRANDING.md` — single source of truth for all upstream injection changes (per-file, per-line, per-pattern)
- WORKBENCH: [docs/ELLAMAKA-WORKBENCH.zh-CN.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/ELLAMAKA-WORKBENCH.zh-CN.md) — Workbench design specification, covering multi-panel layout, session browser, and state persistence
- DESKTOP: `docs/DESKTOP.md` — ellamaka-desktop architecture, state ownership, PTY lifecycle, and sidecar integration
- `.gitattributes` — fork-specific file merge protection (`merge=ours`); upstream merges automatically preserve ellamaka versions
- DISTRIBUTION: `docs/DISTRIBUTION.md`
- Upstream Merge logs: `docs/UPSTREAM-MERGE-LOG.md`
- Config Reference: `docs/references/ellamaka-config-mechanism.md`
- opencode package rules: `packages/opencode/AGENTS.md`
- desktop package rules: `packages/ellamaka-desktop/AGENTS.md`

## 2. Architecture and Directories

Execution chain: OpenCode upstream → ellamaka fork → `--wopal-space` → `.wopal/` ontology → `.wopal-space/` runtime.

| Directory | Responsibility |
|---|---|
| `packages/opencode/` | Inherited OpenCode engine main package; see `packages/opencode/AGENTS.md` for internal rules |
| `packages/core/` | Shared core, flags, global paths, installation/runtime primitives |
| `packages/app/`, `packages/ui/`, `packages/storybook/` | Inherited UI surfaces; only modify when engine/TUI requires |
| `packages/plugin/`, `packages/script/`, `packages/util/` | Workspace support packages |
| `packages/sdk/` | SDK workspace; JS SDK regeneration uses existing script |
| `packages/ellamaka/` | Brand constants (branding.ts/channel), logo (logo.ts), build wrapper (build.ts), WopalSpace auto-detection (detect.ts), install path detection (is-wopal-install.ts), and package-level tests |
| `packages/ellamaka-desktop/` | Electron desktop app (v1.15.13 baseline), hosts ellamaka-app Workbench and local Ellamaka sidecar; see `packages/ellamaka-desktop/AGENTS.md` |
| `docs/` | Project DESIGN, BRANDING, DISTRIBUTION, references, research, and plans |

## 3. Development Commands (build format test)

| Scenario | Command | When |
|---|---|---|
| Lint | `bun run lint` | After TypeScript / config changes |
| Root typecheck | `bun run typecheck` | When full-repo type check is needed |
| opencode typecheck | `bun typecheck` from `packages/opencode` | After engine main package changes; never run `tsc` directly |
| opencode tests | `bun test --timeout 30000 --force-exit` from `packages/opencode` | After engine main package behavior changes |
| opencode build | `bun run build` from `packages/opencode` | After runtime / CLI / package build changes |
| ellamaka package tests | `bun test` from `packages/ellamaka` | After branding, logo, or detection changes |
| ellamaka build | `bun packages/ellamaka/build.ts --web-ui ellamaka-app` | When building ellamaka-branded CLI locally; use `--web-ui app` for upstream UI or `--web-ui none` for no embedded UI |
| Build CLI binary | `./scripts/build.sh cli` | One-click CLI build for current platform; supports `--platform`, `--arch`, `--install` |
| Build Desktop app | `./scripts/build.sh desktop` | Build Electron desktop app (default main channel); `--channel prod --install` for release |
| Workbench dev server | `./scripts/dev.sh serve` | From any directory; starts backend `:4096` + `ellamaka-app` `:3000/workbench` |
| Stop Workbench dev server | `./scripts/dev.sh stop` | Stops backend and Workbench for the current port combination |
| Desktop dev app | `./scripts/dev.sh desktop` | Build sidecar + desktop, start Electron dev mode; `--channel local|main` |
| Post-upstream clean check | `./scripts/check-cleanup.sh [--clean]` | After merging upstream opencode to check for erroneously merged files/dirs |
| Desktop typecheck | `bun run typecheck` from `packages/ellamaka-desktop` | After desktop package TypeScript changes |
| Desktop tests | `bun test --preload ./electron-mock.ts --force-exit src` from `packages/ellamaka-desktop` | After desktop behavior changes (requires electron mock) |
| Desktop build | `bun run build` from `packages/ellamaka-desktop` | After main/preload/renderer changes |
| Desktop package:mac | `bun run package:mac` from `packages/ellamaka-desktop` | Produces unsigned macOS DMG/ZIP main build |
| Sidecar build | `cd ../opencode && bun script/build-node.ts` | Build sidecar node runtime (prerequisite for desktop build) |

Tests cannot run from repo root; the root `test` script is a guard.

## 4. Implementation Rules

- Follow `packages/opencode/AGENTS.md` for general coding conventions (Bun APIs, Effect Schema, types/control flow, Drizzle schema, module organization, etc.).
- WopalSpace customizations should go in new files first; upstream files should only contain minimal import and call injection points.
- Use early-return guards in customization branches to avoid overlapping with upstream mainline changes.
- When new modules need access to upstream internal capabilities, prefer callback/closure injection over directly exposing upstream Service type boundaries.
- Extract shared helpers when reusing upstream logic; do not copy large upstream flows.
- Do not perform unrelated formatting, import reordering, dependency reordering, or object key reordering on upstream files.
- `main` is the ellamaka customization stable line; `dev` tracks upstream OpenCode `dev` only and must not be used for ellamaka customization development.
- Use `main` or `origin/main` as the diff baseline; do not use `dev` as the diff baseline for ellamaka customizations.
- Follow `docs/UPSTREAM-MERGE-LOG.md` for cleanup checklists, preserved customizations, and validation gates during upstream merges.
- `.gitattributes` configures `merge=ours` protection for: `README.md`, `README.zh-CN.md`, `AGENTS.md`, `AGENTS.zh-CN.md`, `scripts/**`, `docs/**`, `.husky/**`, `.github/TEAM_MEMBERS`, `.github/workflows/publish-ellamaka.yml`. Upstream merges automatically preserve ellamaka versions; do not delete or modify these rules.

### HTTP API and SDK Contract

- Follow `docs/API-CONTRACT.md` for every new endpoint. Establish the domain owner, Root/Instance scope, existing group, and resource semantics before defining Effect Schemas, requests, success results, domain errors, and compatibility.
- Endpoints belong to `HttpApiGroup`. Global WopalSpace control capabilities belong to the Root API. Session, file, project, PTY, and working-directory capabilities belong to the Instance API. Handlers only translate between HTTP and domain services.
- Paths express domain resources and their natural relationships. Query parameters express query conditions. Filesystem access, shell execution, CLI invocation, and directory provisioning are owned by their domain services rather than exposed as browser-callable primitives.
- The SDK is generated through Effect HttpApi → OpenAPI → `packages/sdk/js/script/build.ts`. Application code uses the generated client, and `packages/sdk/js/src/v2/gen/**` remains owned by the generation pipeline.
- Every endpoint addition or modification tests its schemas, success result, domain errors, and middleware boundary, regenerates the SDK, and updates DESIGN and BRANDING.

### Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## 5. Testing

- Code changes follow TDD: write a failing test first, then implement code to make it pass.
- Avoid mocks as much as possible; test real implementations, do not duplicate logic into tests.
- Tests must run from package directories, e.g. `packages/opencode` or `packages/ellamaka`; never from repo root.
- After modifying the engine main package, run `bun test --timeout 30000 --force-exit` from `packages/opencode` or document why not.
- After modifying branding, logo, or detection logic, run `bun test` from `packages/ellamaka`.
- **How to safely and correctly run tests (prevention of hangs and zombie/orphan processes)**:
  - **Force exit on completion**: When running tests that may spin up long-lived or unmanaged handles (such as PTY terminals, file watchers, database connections), always include the `--force-exit` flag to ensure the process exits cleanly.
  - **External timeout & lifecycle guard**: When executing tests asynchronously in background shell tasks, agents must not run bare commands. Always wrap the execution with an external timeout guard (e.g. `timeout 120 bun test`), and ensure that the process group is terminated upon cancellation or session close, preventing orphaned processes from consuming CPU in the background.
- After TypeScript changes, run `bun typecheck` from the corresponding package; never run `tsc` directly.
- After modifying CLI/runtime/config/plugin/agent/TUI space mode, verify or document: `WOPAL_SPACE` flag, `.wopal/config/settings.*`, TUI settings, plugin loading, theme loading.
- After upstream merges, distinguish upstream known failures, environment issues, and newly-introduced ellamaka issues.

## 6. User-Supplied Rules

- JS SDK regeneration: `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`. The `dev` branch only tracks upstream OpenCode `dev` for merge integration.
- Use `main` or `origin/main` as the diff baseline; `dev` is for upstream-tracking only.
- Prefer auto-executing clear requests; confirm when missing critical info, security risks, or irreversible operations.

### General Principles

- Keep things in one function unless composable or reusable.
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible.
- Avoid using the `any` type.
- Use Bun APIs when possible, like `Bun.file()`.
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity.
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream.
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

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

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

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

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

## 5. UI State Management and Persistence (State & Persistence)

To prevent state loss and UI flickering in multi-panel structures, all agents doing frontend development must follow these rules:

### 5.1 Space Path and Panel CWD Segregation

- **Space Path** is the store's primary key (immutable identifier for workspaces).
- **Panel.directory** is the panel's active CWD context, which can change when a user switches directories.
- **Rule**: **Never** use `panel.directory` or space names (`spaceName`) as a replacement for Space Path in store read/write calls. Pass a dedicated `spacePath` prop to panels to ensure correct store slot state persistence.

### 5.2 Async Sync Bridge Initialization Guard

- When implementing `createEffect` sync bridges that unbind/delete local state on remote mismatch, you **must** check that remote loading has completed.
- **Rule**: Only run non-identity unbinding checks after data synchronizer reaches completed status (e.g., `sync.data.status === "complete"`). Never unbind slots due to temporary empty states during initialization.

### 5.3 Reactivity Control and Side-Effect Hygiene

- **Rule**: `createMemo` must be a pure function. **Do not** write to stores or trigger API requests inside a memo; use `createEffect` for side effects.
- **Flicker Prevention**: SSE event subscriptions should only trigger global refetches/re-renders (`triggerRefresh()`) on structural events (e.g., `created`, `deleted`). High-frequency property changes (such as chat `updated` stream chunks) must be handled locally inside rendering components.

### 5.4 Virtual General Space logical compatibility

- **Empty Path Handling**: The path for the General Space is defined as an empty string `""`. When initializing or refreshing space states (e.g., `ensureSpace(path)`), you **must** use the existence of `activeTab` as the guard. **Never** use implicit truthiness checks like `if (path)` because `""` evaluates to falsy, causing the space state to fail to initialize, panels to render empty, and panel action buttons (like Add Panel) to hide.
- **I18n References**: The translation key for the General Space tab title must be `t("workbench.sidebar.spaces")` (which maps to "Sessions" in English and "会话" in Chinese). Do not use the undefined key `t("workbench.sidebar.sessions")`.

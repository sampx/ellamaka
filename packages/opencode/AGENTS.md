---
name: opencode package AGENT RULES
description: Main inherited OpenCode engine package for CLI, runtime, config, server, session, tools, storage, and TUI integration
---

# Agent Development Rules

## 1. Canonical References

Canonical references:

- Project DESIGN: `../../docs/DESIGN.md`
- Parent Rules: `../../AGENTS.md`
- Test Rules: `test/AGENTS.md`
- Server Test Rules: `test/server/AGENTS.md`
- Instance Route Rules: `src/server/routes/instance/AGENTS.md`
- HttpApi Route Rules: `src/server/routes/instance/httpapi/AGENTS.md`
- Effect Migration Reference: `specs/effect/migration.md`

## 2. Architecture and Directories

Execution chain: CLI entry → config/runtime services → server/session/tool/storage/TUI → WopalSpace hooks.

This directory is ellamaka's main engine package. It carries the inherited OpenCode runtime and integrates WopalSpace config, plugin, agent, command, permission, and TUI hooks; follow the WopalSpace customization boundaries in the parent `../../AGENTS.md`.

| Directory | Responsibility |
|---|---|
| `src/cli/` | CLI commands, TUI command entry, and command-specific runtime glue |
| `src/config/` | Config schema, loading, merge, command/agent/plugin config, and wopal-space config hooks |
| `src/server/` | Hono / Effect HttpApi server, routes, middleware, and adapters |
| `src/session/` | Session lifecycle, messages, events, retry/status, and session domain logic |
| `src/tool/` | Tool definitions, permission-facing tool behavior, and runtime execution surfaces |
| `src/storage/` | Database access, storage adapters, and persisted runtime data |
| `src/effect/` | Shared Effect runtime helpers, InstanceState, and service runtime utilities |
| `src/permission/` | Permission matching, merge, and tool authorization behavior |
| `src/plugin/` | Plugin loading, plugin origin handling, and plugin runtime integration |
| `test/` | Package-local tests and fixtures; see `test/AGENTS.md` for detailed rules |
| `migration/` | Drizzle migration output |

## 3. Development Commands (build format test)

| Scenario | Command | When |
|---|---|---|
| Dev | `bun run dev` | Run the package dev entry locally |
| Typecheck | `bun typecheck` | After TypeScript changes; do not run `tsc` directly |
| Test | `bun test --timeout 30000` | After package behavior changes |
| CI test | `bun run test:ci` | When junit output is needed |
| Build | `bun run build` | After runtime, CLI, package build, or release-related changes |
| Database migration | `bun run db generate --name <slug>` | When schema changes need a migration |
| Fix node-pty | `bun run fix-node-pty` | When the node-pty patch / install flow needs repair |

Run all commands from `packages/opencode`.

## 4. Implementation Rules

- Follow the parent `../../AGENTS.md` for Bun, TypeScript, WopalSpace mode, upstream customization boundaries, and verification rules.
- Do not organize modules with `export namespace Foo { ... }`; use flat top-level exports and a self-reexport at the bottom of the file, such as `export * as Foo from "./foo"`.
- When a single-file module is named `index.ts`, use `"."` as the self-reexport source; do not use `"./index"`.
- Do not add barrel `index.ts` files in multi-sibling directories; consumers import concrete siblings directly, such as `@/session/retry`.
- Keep namespace-private helpers as non-exported top-level declarations in the same file.
- When adding modules under `src/config`, follow the existing self-export pattern, such as `export * as ConfigAgent from "./agent"`.
- Drizzle schema lives in `src/**/*.sql.ts`.
- Drizzle tables and columns use snake_case; join columns use `<entity>_id`; indexes use `<table>_<column>_idx`.
- Drizzle Kit generates migrations into `migration/<timestamp>_<slug>/migration.sql` and `snapshot.json`.
- Migration tests read the per-folder layout; do not depend on `_journal.json`.
- Use `Effect.gen(function* () { ... })` for Effect composition.
- Use `Effect.fn("Domain.method")` for named/traced public effects; use `Effect.fnUntraced` for internal helpers.
- `Effect.fn` / `Effect.fnUntraced` can accept pipeable operators directly; avoid unnecessary outer `.pipe()` calls.
- Use `Effect.callback` for callback-based APIs.
- Use `Effect.void`; do not use `Effect.succeed(undefined)` or `Effect.succeed(void 0)`.
- Prefer `DateTime.nowAsDate` when a `Date` is needed; do not use `new Date(yield* Clock.currentTimeMillis)`.
- Use `Schema.Class` for multi-field data; use branded schemas for single-value types.
- Use `Schema.TaggedErrorClass` for typed errors; use `Schema.Defect` for defect-like causes.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)`; do not wrap it with `Effect.fail(new MyError(...))`.
- Use `makeRuntime` (from `src/effect/run-service.ts`) for all services. It returns `{ runPromise, runFork, runCallback }` backed by a shared memoMap that deduplicates layers.
- Use `InstanceState` (from `src/effect/instance-state.ts`) for per-directory or per-project state that needs per-instance cleanup. It uses `ScopedCache` keyed by directory — each open project gets its own state, automatically cleaned up on disposal.
- Services that need directory isolation must use `InstanceState`; do not share a single service copy.
- Do the work directly inside the `InstanceState.make` closure; do not add extra fibers, `ensure()` callbacks, or `started` flags.
- Use `Effect.addFinalizer` or `Effect.acquireRelease` for cleanup, subscriptions, and process teardown.
- Use `Effect.forkScoped` inside the closure for background stream consumers.
- When service `init()` needs to be non-blocking, fork `InstanceState.get(state)` at the call site; do not fork initialization work inside the `InstanceState.make` closure.
- `src/project/bootstrap.ts` already wraps service `init()` as fire-and-forget; keep service-internal `init()` synchronous and let the caller control concurrency.
- Effect v4 beta does not have `Effect.fork` or `Effect.forkDaemon`; use `Effect.forkIn(scope)`.
- In Effect services, prefer yielding existing Effect services; avoid direct ad hoc platform APIs.
- Prefer `FileSystem.FileSystem` for effectful file I/O, `ChildProcessSpawner.ChildProcessSpawner` + `ChildProcess.make(...)` for processes, and `HttpClient.HttpClient` for HTTP.
- When already inside Effect code, prefer `Path.Path`, `Config`, `Clock`, and `DateTime`.
- Use `Effect.repeat` or `Effect.schedule` for background loops or scheduled tasks, and attach them to the layer scope with `Effect.forkScoped`.
- Use `Effect.cached` when concurrent callers should share one in-flight computation; do not hand-roll `Fiber | undefined` or `Promise | undefined` caches. See `specs/effect/migration.md` for the full pattern.
- Use `Instance.bind(fn)` for native addon callbacks that need to read `Instance.directory` or call `Bus.publish`, so Instance AsyncLocalStorage context is captured and restored.
- `setTimeout`, `Promise.then`, `EventEmitter.on`, and Effect fibers do not need `Instance.bind`.
- When changing `src/server/routes/instance/`, keep legacy Hono routes and Effect HttpApi behavior aligned; see the directory `AGENTS.md` for detailed rules.
- When changing `src/server/routes/instance/httpapi/`, follow the HttpApi route patterns; do not rebuild stable layers inside request handlers.

## 5. Testing

- Code changes follow TDD: write a failing test first, then implement code to make it pass.
- Run tests from `packages/opencode`; do not run tests from the repo root.
- Test the real implementation and avoid mocks; do not duplicate implementation logic into tests.
- Use `testEffect(...)` from `test/lib/effect.ts` for Effect services or Effect workflows.
- Use `it.instance(...)` by default for tests that need one temporary instance.
- Use `it.live(...)` when a test depends on real time, filesystem mtimes, child processes, git, locks, or OS behavior.
- Use `it.effect(...)` when a test can run with `TestClock` and `TestConsole`.
- Prefer `tmpdir`, `tmpdirScoped`, `provideTmpdirInstance`, or `provideTmpdirServer` from `test/fixture/fixture.ts` when a temporary directory is needed.
- Server and HttpApi middleware tests follow `test/server/AGENTS.md`; prefer focused middleware tests and the Effect HTTP stack.
- When changing legacy Hono / Effect HttpApi routes, add or update parity coverage, such as `test/server/httpapi-bridge.test.ts` or focused HttpApi tests.
- When changing database schema, generate a migration and add or update migration tests.
- After changing CLI/runtime/config/plugin/agent/TUI space mode, verify or report the `WOPAL_SPACE` flag, `.wopal/config/settings.*`, TUI settings, plugin loading, and theme loading.

## 6. User-Supplied Rules

### Module Shape

Do not use `export namespace Foo { ... }` for module organization. It is not standard ESM, it prevents tree-shaking, and it breaks Node's native TypeScript runner. Use flat top-level exports combined with a self-reexport at the bottom of the file:

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)

export * as Foo from "./foo"
```

Consumers import the namespace projection:

```ts
import { Foo } from "@/foo/foo"

yield * Foo.Service
Foo.layer
Foo.defaultLayer
```

Namespace-private helpers stay as non-exported top-level declarations in the same file — they remain inaccessible to consumers (they are not projected by `export * as`) but are usable by the file's own code.

#### When the file is an `index.ts`

If the module is `foo/index.ts` (single-namespace directory), use `"."` for the self-reexport source rather than `"./index"`:

```ts
// src/foo/index.ts
export const thing = ...

export * as Foo from "."
```

#### Multi-sibling directories

For directories with several independent modules (e.g. `src/session/`, `src/config/`), keep each sibling as its own file with its own self-reexport, and do not add a barrel `index.ts`. Consumers import the specific sibling:

```ts
import { SessionRetry } from "@/session/retry"
import { SessionStatus } from "@/session/status"
```

Barrels in multi-sibling directories force every import through the barrel to evaluate every sibling, which defeats tree-shaking and slows module load.

### Instance.bind — ALS for native callbacks

`Instance.bind(fn)` captures the current Instance AsyncLocalStorage context and restores it synchronously when called.

Use it for native addon callbacks (`@parcel/watcher`, `node-pty`, native `fs.watch`, etc.) that need to call `Bus.publish` or anything that reads `Instance.directory`.

You do not need it for `setTimeout`, `Promise.then`, `EventEmitter.on`, or Effect fibers.

```typescript
const cb = Instance.bind((err, evts) => {
  Bus.publish(MyEvent, { ... })
})
nativeAddon.subscribe(dir, cb)
```

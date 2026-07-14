---
name: ellamaka-app agent rules
description: Ellamaka Web UI built with SolidJS, Vite, and Tailwind CSS
---

# Agent Development Rules

## 1. Canonical References

- Project design: `../../docs/DESIGN.md`
- Workbench design: `../../docs/ELLAMAKA-WORKBENCH.zh-CN.md`
- Parent rules: `../../AGENTS.md`
- Backend rules: `../opencode/AGENTS.md`
- UI library: `../ui/`, the `@opencode-ai/ui` workspace package

## 2. Architecture and Directories

Execution chain: Vite dev server -> SolidJS SPA -> `@opencode-ai/sdk` -> backend (`packages/opencode`) HTTP/WS API.

This directory contains the ellamaka/OpenCode Web frontend. It does not own the engine runtime, CLI, server, or storage logic. Backend capabilities are consumed through `@opencode-ai/sdk`.

| Directory | Responsibility |
|---|---|
| `src/app.tsx` | Application root, routing, and global provider composition |
| `src/entry.tsx` | Vite entry that mounts the SolidJS application |
| `src/pages/` | Route-level page components |
| `src/pages/workbench/` | Workbench-specific implementation governed by the mandatory boundaries in section 5 |
| `src/components/` | Reusable UI components |
| `src/hooks/` | Custom SolidJS hooks and primitives |
| `src/context/` | SolidJS context definitions |
| `src/i18n/` | Translations and locale configuration |
| `src/utils/` | Pure utilities |
| `src/addons/` | Browser plugin and extension UI |
| `src/constants/` | Application-level constants |
| `e2e/` | Playwright end-to-end tests |
| `public/` | Static assets |
| `script/` | Build, validation, and development scripts |

## 3. Development Commands

| Scenario | Command | When |
|---|---|---|
| Development server | `bun run dev` | Local frontend development; requires the backend |
| Backend | `bun run --conditions=browser ./src/index.ts serve --port 4096` from `packages/opencode` | Local API backend |
| Build | `bun run build` | Production build |
| Preview | `bun run serve` | Preview the production build |
| Typecheck | `bun run typecheck` | After TypeScript changes |
| Unit tests | `bun run test:unit` | After component, hook, or utility changes |
| Unit test watch | `bun run test:unit:watch` | Continuous local testing |
| End-to-end tests | `bun run test:e2e` | After page, route, or user-flow changes |
| End-to-end UI mode | `bun run test:e2e:ui` | Debugging end-to-end tests |
| End-to-end report | `bun run test:e2e:report` | Viewing the end-to-end report |
| CI tests | `bun run test:ci` | CI environment |

Run all frontend commands from `packages/ellamaka-app`. `opencode dev web` proxies to `https://app.opencode.ai`, so local CSS and UI changes do not appear there. Local UI development must run the backend and app dev server separately.

## 4. General Implementation Rules

- Follow the Bun, TypeScript, and parallel-tool rules in `../../AGENTS.md`.
- The stack is SolidJS 1.x, Vite 7, Tailwind CSS 4, `@kobalte/core`, `@solidjs/router`, and `@tanstack/solid-query`.
- Prefer `createStore` for related SolidJS state instead of multiple independent `createSignal` calls.
- Use the SolidJS `jsxImportSource`. Do not introduce React JSX.
- Put route-level components in `src/pages/`, reusable components in `src/components/`, and cross-package UI primitives in `packages/ui/`.
- Use `@solidjs/router` for application routes and update route configuration when adding a page.
- Communicate with the backend through `@opencode-ai/sdk`. Components must not call backend fetch endpoints directly.
- Put translated copy in `src/i18n/` and use the `@solid-primitives/i18n` APIs.
- Prefer Tailwind CSS utility classes. Put necessary custom styles in `src/index.css`.
- Typecheck with `tsgo -b`. Do not run `tsc` directly.
- Build with Vite using `vite.config.ts` and the `esnext` production target.
- Extend upstream shared code through adapters, callbacks, or small injection points. Do not copy complete Session, command, Dialog, or navigation flows.

## 5. Mandatory Workbench Boundaries

This section applies to all code under `src/pages/workbench/` and to Workbench adaptations made in `src/components/`, `src/context/`, or `src/pages/session/`.

The primary goal is to stop further erosion of state boundaries. Before changing behavior, identify the state owner, scope, and transaction entry point. Visual correctness is not a valid reason to add cross-store writes, implicit directory context, or duplicate lifecycle logic.

The priority order is fixed:

1. Preserve backend resource and data truth.
2. Prevent General, Space, Panel, and Session identity from crossing scopes.
3. Preserve a single state owner and a single transaction entry point.
4. Address presentation, interaction, and styling last.

### 5.1 State Ownership

Every state category has exactly one canonical owner. Caches, projections, and persisted copies must not override canonical data.

| State | Canonical Owner | Allowed Workbench Representation | Forbidden |
|---|---|---|---|
| Session title, directory, timestamps, and status | Server Session Projection | In-memory read-only projection and `boundSessionId` references | Persisting complete Sessions, fabricating Sessions in UI, or overriding server fields with stale local data |
| Space, Tab, and Panel layout | `WorkbenchStore` | Tabs, Panels, activePanel, viewMode, slotState, and required reconnect hints | SDK calls, PTY disposal, navigation, or Toasts inside the Store |
| Whether a PTY process exists | Backend PTY registry | `PtyManager` runtime handle; persisted PTY ID as a reconnect hint only | Treating a UI boolean as process truth or hiding a clearly closed PTY without releasing it |
| Plugin, MCP, LSP, and configuration load results | Directory-bound SDK/sync layer | In-memory projection for the current directory | Persisting capability lists, reusing results across directories, or validating counts without source paths |
| Transient messages and dialogs | Workbench UI state | Short-lived, non-persisted state | Writing them into domain Stores or using them as domain truth |

A read-only `sessionStore` means read-only to UI consumers. Only the Session Projection adapter and SSE reconciliation may write it. Components, Dialogs, command handlers, and Workbench Actions must not fabricate or directly edit server-owned fields.

### 5.2 Identity and Directory Scope

General is not an alias for an empty path. Domain boundaries must use an explicit discriminated type:

```ts
type SpaceScope =
  | { kind: "general" }
  | { kind: "space"; name: string; path: string }
```

- Do not use `if (spacePath)`, `if (!spacePath)`, or `path || fallback` to distinguish General from a Space.
- Do not use `spaceName`, `panel.directory`, or a falsy string as the Space key.
- `SpaceScope` determines Session ownership and plugin composition. `panel.directory` determines the working directory for Panel SDK, file, terminal, and Session requests. They are not interchangeable.
- General loads only global plugins, global MCP servers, and global configuration. It must not inherit the most recently visited Space context.
- A Space loads the union of global capabilities and capabilities defined by that Space. Validation must compare complete source paths.
- Convert strings from routes, localStorage, or the server into `SpaceScope` at the boundary. Do not propagate the implicit contract that an empty string means General.

### 5.3 Dependency Direction and Shared Boundaries

The only allowed primary dependency direction is:

```text
UI components -> WorkbenchActions -> Store / PtyManager / directory-bound SDK / Projection adapter
```

- UI components render, collect user intent, and call Actions. They do not compose multi-step domain transactions.
- A component must not write two Stores in one operation or write a Store and then call the SDK or `PtyManager` directly.
- `WorkbenchStore` performs synchronous, pure state mutations only. It must not import the SDK, `PtyManager`, router, Toast, or Dialog.
- All operations that cross state owners go through `WorkbenchActions`, including load, replace, fork, bind, unbind, closePanel, closeSpace, and createSession.
- Shared code under `src/components/` and `src/pages/session/` must not import `src/pages/workbench/` or expose Workbench-only parameters such as `panelID`, `spacePath`, or `spaceName`.
- Shared components return generic results through callbacks such as `onCompleted` or `onForked`. A Workbench adapter then calls the Action.
- A migration adapter must live under Workbench and state its owner, deletion condition, and Plan Task. New callers must not adopt the legacy entry point.

### 5.4 Directory SDK and Context

- Each Panel subtree consumes one canonical `SDKProvider` bound to that Panel's `directory`.
- Global Workbench surfaces such as StatusPopover and TopBar obtain directory context from the active `SpaceScope` and active Panel selector. They must not read the Context of the last mounted Panel.
- Components must not call `serverSDK.createDirSdkContext()`. A directory client is injected by an explicit Provider or Action.
- Provider creation, ownership, and disposal must be fixed. Do not use nested Providers to hide scope bugs.
- When the directory changes, asynchronous results for the old directory must not update the new projection.
- Key plugin, MCP, and configuration state by normalized directory. Mount order and visibility are not scope.

### 5.5 Command Scope

- Register global Workbench commands exactly once in the Workbench Shell.
- At execution time, read the active `SpaceScope`, Panel, and Session from the canonical selector. Do not capture a Panel's mount-time props in the command closure.
- Hidden, keep-alive, or inactive Panels must not register or replace same-name global commands.
- Do not register unsupported commands with no-op handlers.
- Shared Session commands accept only generic action adapters. Do not add Workbench-only parameters to shared interfaces.

### 5.6 Transactions, Failures, and Async Races

Operations spanning Stores, the SDK, and PTYs are not database transactions. `WorkbenchActions` must implement an explicit consistency boundary:

1. Validate the `SpaceScope`, Panel, Session, and directory preconditions.
2. Assign a generation or cancellation token to the Panel operation.
3. Perform resource disposal and SDK side effects.
4. Confirm that the operation is still the latest generation, then commit Store state once.
5. On failure, clean up resources created by this operation and preserve or restore an explainable previous state.

- close, unbind, and dispose operations must be idempotent. Repeated calls must not destroy newer resources.
- Discard late PTY, Session, plugin, or MCP results after a Panel closes or its directory changes. A late PTY must still be released.
- Acquire Context, Store, and router hooks during synchronous component initialization. Do not call hooks again from Promises, timers, or event callbacks.
- Action behavior must not depend on component visibility. Hidden and visible Panels follow the same lifecycle contract.
- Each Action test covers success, failure, repeated calls, and stale async results.

### 5.7 Persistence

Allowed persisted state:

- Space, Tab, and Panel layout.
- activePanel, viewMode, slotState, and other state required to restore the UI.
- PTY ID reconnect hints, which are not proof that a process exists.

Forbidden persisted state:

- Complete Sessions, server titles, or message copies.
- Plugin, MCP, LSP, or directory configuration results.
- Transient messages, pending request state, or error Toasts.
- Data that can be projected again from the server or directory SDK.

The persistence schema must have a version and explicit migrations. Legacy reads may migrate layout fields only. Historical projections must never be injected back into server-owned domain state.

Workbench Chat model selection is isolated by Session. An explicit user selection is the authoritative model for that Session and must not be overwritten by an Agent default, a hidden Panel mount, or a same-value callback from a controlled selector. Without an explicit selection, resolve the model in this fixed order: the last visible user message, the Agent default, then an available-model fallback. Same-value Agent updates must be idempotent and must not write model persistence.

### 5.8 Established Presentation and Lifecycle Contracts

- Derive the TUI liveness marker in the Panel title bar directly from `panel.tuiPtyId`. Do not store a second UI marker. Set the ID at startup and clear it on close or disconnect.
- Route transient Workbench messages through `wb.statusMessage` using i18n copy only. Show them at the bottom of the left Session tree for five seconds and hide the area completely when the sidebar collapses. The bottom status bar displays only the current Space, Panel, Session, and server context; it does not carry operational help.
- The Workbench Chat history and composer dock share `bg-v2-background-bg-deep`. Keep this adaptation in `PanelChatComposer` and do not change the default global Session Composer background.
- Embedded terminals and TUIs suppress the `ghostty-web` canvas scrollbar and calculate columns from the full container content width instead of the fixed scrollbar allowance in `FitAddon`.
- A TUI uses a ceiling-rounded full character grid clipped by its container to avoid right or bottom gutters. A dedicated TUI uses `isTui`. Ellamaka started inside a normal terminal must require both its OSC title and an alternate buffer before receiving the same behavior, so other fullscreen terminal programs are unaffected.
- Do not hide terminal sizing defects with global scrollbar CSS.

### 5.9 Tests and Acceptance Evidence

Workbench behavior changes follow RED, GREEN, REFACTOR:

- Before fixing a bug, add a failing test that reproduces it and names the user-visible behavior.
- Prefer real Store, Provider, Action, and component composition. Use a controlled fake only at the SDK transport boundary. Do not mock the ownership boundary under test.
- Typecheck, static `rg` output, and plugin counts are supporting evidence only. They do not replace behavior tests or source-path validation.
- Directory-state validation asserts normalized complete plugin and MCP paths and their sources, not only counts.
- Cover the `General -> Space A -> Space B -> General` round trip. General contains global capabilities only; each Space contains global plus its own capabilities.
- Cover multiple Panels, hidden Spaces, fork behavior, command targets, Session Projection reconnects, PTY close behavior, and late asynchronous results.
- Confirm the real failure reason before implementing a regression fix, and rerun the test after the fix. Do not treat a harness error as a business RED.

Minimum verification chain:

```bash
bun run check:workbench-boundaries
bun run test:unit --force-exit
bun run typecheck
```

`check:workbench-boundaries` may not exist until the corresponding refactor Plan lands. Once added to package scripts, it is mandatory for every Workbench change.

### 5.10 Change Discipline and Blocking Patterns

- Before editing, state the behavior's owner, input scope, and single transaction entry point. Do not begin if these are unknown.
- One patch solves one verifiable behavior. Router reconstruction, command registration, fork binding, and Store refactoring require separate verification.
- Existing violations may migrate through compatibility adapters and an explicit technical-debt manifest. Do not add or expand debt.
- Do not rewrite, revert, or format unrelated uncommitted changes.
- A Plan must pass structural and mandatory review before user approval. Do not expand source changes under the label of refactoring before approval.

The following patterns are blocking issues:

- Using string truthiness to distinguish General from a Space.
- A shared Workbench operation writing multiple Stores.
- A component composing `Store + SDK + PtyManager` directly.
- Network, PTY, router, Dialog, or Toast side effects inside a Store.
- A shared component importing a Workbench Store or Context.
- Calling Context or Store hooks from an asynchronous callback.
- Registering the same global command from every Panel.
- Letting hidden Panel mount order determine command or directory ownership.
- Persisting complete Sessions or directory capability lists.
- Claiming correctness from static matching, typecheck, or equal counts alone.

### 5.11 Workbench Definition of Done

A Workbench change is complete only when all of the following are true:

1. State ownership and dependency direction comply with these rules.
2. New regression tests fail before the fix and pass afterward.
3. Boundary checks, targeted tests, full unit tests, and typecheck have real output evidence.
4. User-visible validation confirms the plugin and MCP source paths for General, Space A, and Space B.
5. Multiple Panels, hidden Spaces, fork behavior, commands, and PTY lifecycle do not cross scopes.
6. The Chinese rules and design document receive user review before the formal English rules are synchronized.
7. Commits, Plan state transitions, and user validation follow the workspace dev-flow and user confirmation gates. This Workbench Plan must not request or require Rook review; use the executable boundary checks, targeted tests, full verification, and user confirmation instead.

## 6. General Testing Rules

- Code changes follow TDD: write a test that fails first, then implement the behavior that makes it pass.
- Unit tests use bun test with the happydom preload at `./happydom.ts`.
- Run unit tests from `packages/ellamaka-app` with `bun run test:unit`.
- End-to-end tests use Playwright configured in `playwright.config.ts`. Run them from `packages/ellamaka-app` with `bun run test:e2e`.
- End-to-end tests cover user-visible navigation, interaction, and backend communication.
- Avoid mocks and prefer real component behavior.
- CI uses `bun run test:ci` to generate JUnit output.

## 7. User-Supplied Rules

- Never restart the app or server processes.
- Always use parallel tools when applicable.

# ellamaka-app

ellamaka official Web UI package, forked from upstream `packages/app`.

## Responsibilities

Three-column IDE-style workbench (TUI + Chat + Split view), plus all inherited web UI capabilities from upstream.

## Tech Stack

SolidJS + Vite + Tailwind CSS, identical to upstream `packages/app`.

## Development Commands

| Scenario | Command | When |
|----------|---------|------|
| Dev server | `bun run dev` | Local frontend dev |
| Build | `bun run build` | Production build |
| Typecheck | `bun run typecheck` | After TypeScript changes |
| Unit test | `bun run test:unit` | After behavior changes |

## Implementation Rules

- All code from upstream `packages/app` is inherited
- Workbench-specific code lives in `src/pages/workbench/`
- Do not modify upstream page components; extend them instead
- Backend API consumption stays in upstream style (no new abstractions)
- Workbench `session-store` owns UI projection only. Server-owned fields such as session titles must reconcile to backend truth and must not permanently override backend responses from persisted local state.
- Embedded terminals and TUIs must suppress the `ghostty-web` canvas scrollbar and calculate columns from the full container content width rather than FitAddon's reserved scrollbar gutter. TUI uses a full-bleed character grid (`ceil`) clipped by its container so no right or bottom gutter remains. A dedicated TUI uses `isTui`; an Ellamaka TUI started inside a normal terminal must require both its OSC title and an alternate buffer before it receives the same full-bleed sizing and message-history wheel mapping, so other full-screen applications remain unaffected. Do not mask sizing errors with global scrollbar CSS.
- Workbench transient notifications must unify under `wb.statusMessage` (i18n keys only), shown at the bottom of the left session tree for 5 seconds and hidden completely when the sidebar collapses. The bottom status bar is refactored into a left-side hierarchy chain separated by slashes (`Space / P{index}/{count} / Session / Path`, styled uniformly in `text-v2-text-text-muted` without any rounded background blocks), and a right-side server name/status separated by a left border line.
- Workbench Chat history and composer dock must share `bg-v2-background-bg-deep` styling; this adaptation is isolated to `PanelChatComposer` without modifying the global composer color.

## Upstream Sync

See main `AGENTS.md` and `docs/DESIGN.md §8` for merge strategy details.

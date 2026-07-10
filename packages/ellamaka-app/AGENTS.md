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

## Upstream Sync

See main `AGENTS.md` and `docs/DESIGN.md §8` for merge strategy details.

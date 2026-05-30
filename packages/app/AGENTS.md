---
name: app package AGENT RULES
description: OpenCode web app frontend built with SolidJS, Vite, and Tailwind CSS
---

# Agent Development Rules

## 1. Canonical References

Canonical references:

- Project DESIGN: `../../docs/DESIGN.md`
- Parent Rules: `../../AGENTS.md`
- Backend Rules: `../opencode/AGENTS.md`
- UI Library: `../ui/` (`@opencode-ai/ui` workspace package)

## 2. Architecture and Directories

Execution chain: Vite dev server → SolidJS SPA → `@opencode-ai/sdk` → backend (`packages/opencode`) HTTP/WS API.

This directory is the ellamaka/OpenCode web frontend. It does not contain engine runtime, CLI, server, or storage logic; backend capabilities are accessed through `@opencode-ai/sdk`.

| Directory | Responsibility |
|---|---|
| `src/app.tsx` | App root component, routing, and global provider assembly |
| `src/entry.tsx` | Vite entry, mounts the SolidJS app |
| `src/pages/` | Route page components |
| `src/components/` | Reusable UI components |
| `src/hooks/` | Custom SolidJS hooks and primitives |
| `src/context/` | SolidJS context definitions |
| `src/i18n/` | Internationalization messages and locale config |
| `src/utils/` | Pure utility functions |
| `src/addons/` | Browser extension/addon-related UI |
| `src/constants/` | App-level constants |
| `e2e/` | Playwright e2e tests |
| `public/` | Static assets |
| `script/` | Build and dev helper scripts |

## 3. Development Commands (build format test)

| Scenario | Command | When |
|---|---|---|
| Dev server | `bun dev -- --port 4444` | Local frontend dev; start the backend first |
| Backend | `bun run --conditions=browser ./src/index.ts serve --port 4096` (from `packages/opencode`) | API backend for local frontend dev |
| Build | `bun run build` | Production build |
| Preview | `bun run serve` | Preview production build locally |
| Typecheck | `bun typecheck` | After TypeScript changes |
| Unit test | `bun run test:unit` | After changing components, hooks, or utils |
| Unit test watch | `bun run test:unit:watch` | Continuous run during development |
| E2E test | `bun run test:e2e` | After changing pages/routes or user flows |
| E2E UI mode | `bun run test:e2e:ui` | Debug e2e tests |
| E2E report | `bun run test:e2e:report` | View e2e test reports |
| CI test | `bun run test:ci` | CI environment |

All frontend commands run from `packages/app`. `opencode dev web` proxies to the live `https://app.opencode.ai`, so local CSS/UI changes will not take effect; for local UI development, run the backend and app dev servers separately.

## 4. Implementation Rules

- Follow the parent `../../AGENTS.md` for Bun, TypeScript style rules, and parallel tool preferences.
- Stack: SolidJS 1.x + Vite 7 + Tailwind CSS 4 + @kobalte/core + @solidjs/router + @tanstack/solid-query.
- SolidJS state: prefer `createStore` over multiple independent `createSignal` calls.
- JSX uses solid-js `jsxImportSource`; do not introduce React JSX.
- Component splitting: page-level components go in `src/pages/`, reusable components in `src/components/`, shared UI components in `packages/ui/`.
- Page routing uses `@solidjs/router`; new pages must update the route config accordingly.
- Backend communication goes through `@opencode-ai/sdk`; do not call fetch directly to the backend in components.
- Internationalization messages go in `src/i18n/`; use `@solid-primitives/i18n` APIs.
- Styles use Tailwind CSS utility classes; custom styles go in `src/index.css`.
- Type checking uses `tsgo -b` (TypeScript native preview), not `tsc` directly.
- Build uses Vite, configured in `vite.config.ts`; production build target is `esnext`.
- `packages/ui/` (`@opencode-ai/ui`) is the shared UI library for this project; cross-package reusable UI primitives go there.

## 5. Testing

- Code changes follow TDD: write a failing test first, then implement code to make it pass.
- Unit tests use bun test + happydom preload (`./happydom.ts`), providing a DOM environment.
- Unit tests run from `packages/app` using `bun run test:unit`.
- E2E tests use Playwright, configured in `playwright.config.ts`; run `bun run test:e2e` from `packages/app`.
- E2E tests cover user-visible flows: page navigation, interaction, backend communication.
- Avoid mocks; test real component behavior.
- CI environment uses `bun run test:ci` to generate junit output.

## 6. User-Supplied Rules

- NEVER try to restart the app, or the server process, EVER.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

### Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

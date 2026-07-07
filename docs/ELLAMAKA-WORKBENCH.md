# Ellamaka Workbench Design

> **Status**: core design specification. All subsequent development must follow this document.

## Core constraints

Workbench is built by **forking official `packages/app`** and customizing on top.
This is the fundamental design rule:

- **Do not modify `packages/app`.**
- All workbench code lives in `packages/ellamaka-app`.
- Customizations are additive: new components, new routes, new state — never edits to upstream files.
- The goal is **minimum intrusion** so that upstream `packages/app` can be merged forward without conflict.

## Reference

- PoC pilot: `projects/ellamaka/poc/web` — validated multi-PTY TUI, SSE-based Chat, three-column IDE layout
- Official app tech stack: SolidJS + Vite + Tailwind, `@opencode-ai/ui` component library, server SDK contexts
- Workbench inherits the full official app tech stack and extends it

## 1. Direction

Workbench is ellamaka's main workspace.
It stands beside the official app.
It is not a child page inside the official app shell.

The core object is **Space**.
Each space owns its own tabs, panels, terminal state, chat state, and layout preferences.

The conversation surface has only two content modes:

- TUI
- Chat

There is no standalone Split mode.
Split becomes a **multi-panel layout state**.

## 2. Target model

```
Ellamaka App
├─ Official App
│  ├─ Home
│  └─ Session
└─ Workbench
   ├─ Workbench Shell
   ├─ Space Rail
   ├─ Space Tabs
   ├─ Panel Workspace
   ├─ Bottom Terminal Dock
   └─ Workbench Statusbar
```

The panel workspace is the center of the product.
Each open space can contain one to three horizontal panels.
Each panel can display either TUI or Chat.
Each panel can target any directory inside the current WopalSpace.

## 3. Shell and routing

### 3.1 Workbench route

`/workbench` uses a dedicated workbench shell.
Official app pages continue to use the inherited `Layout`.

The implementation uses a conditional `Show` in `RouterRoot` that skips `Layout` wrapping when the path starts with `/workbench`.

### 3.2 Entry flow

Users can move between the two app surfaces explicitly.

Entry points:

1. Home page: `Workbench` entry in the project navigation column
2. Official titlebar: explicit `Workbench` text button
3. Workbench titlebar: `Official App` text button that restores the last official route

Official app layout stays unchanged.
Workbench integration adds one explicit `Workbench` button into the official titlebar and leaves the rest of the official app shell untouched.

### 3.3 Architecture and Directory Structure

```
packages/ellamaka-app/           ← ellamaka customized web UI
  ├── src/pages/workbench/         ← 🆕 Three-column IDE workbench
  │   ├── index.tsx                  Main layout (top-bar/activity-bar/sidebar/workspace/status-bar)
  │   ├── view.tsx                   View toggle Provider (panel state management, persisted to localStorage)
  │   ├── space-store.tsx            Space list + tab state Provider
  │   ├── surface-route.ts           Route and surface toggle helpers
  │   └── parts/
  │       ├── top-bar.tsx            Top bar (brand / active space summary / return to Official App)
  │       ├── sidebar.tsx            Activity bar & space rail (registered spaces, collapse, settings entry)
  │       ├── workspace.tsx          Workspace (tab management and 1~3 Panel containers)
  │       ├── panel.tsx              Common panel component (mode toggle, directory selection)
  │       ├── bottom-dock.tsx        Bottom terminal dock component
  │       ├── status-bar.tsx         Status bar (status / server / active path)
  │       └── workbench-settings.tsx Workbench-specific settings menu
  ├── (Other directories completely inherited from app/)
  └── AGENTS.md                    ← Package-level development rules
```

### 3.4 Upstream Sync Strategy

| Strategy | Description |
|------|------|
| **Directory-level merge=ours** | `.gitattributes` marks `packages/app/` as `merge=ours`, preserving the ellamaka baseline as a reference during upstream merges; `packages/ellamaka-app/` is unprotected and can merge upstream changes normally. |
| **Incremental Sync Workflow** | When upstream `packages/app` is updated, manually or script-review differences → pick changes to cherry-pick or redo → implement in `packages/ellamaka-app/`. |
| **Clear Customization Boundaries** | Customization is concentrated in the new `workbench/`, `view.tsx`, and entry injections; does not modify the original structure of `app/`. |
| **Dependency Sync** | `workspace:*` dependencies in `package.json` point to shared packages, remaining consistent with upstream. |

### 3.5 Regularized Capabilities from PoC

Architectural decisions are carried over, code is not directly copied:

| PoC Validated Capability | Adoption in ellamaka-app |
|---------------|----------------------|
| pty-bridge independent child process mode | Existing: `packages/opencode/src/pty/` (Complete PTY system, Effect Schema, WebSocket ticket authentication) |
| Multi-space TUI tabs | Existing: `TerminalProvider` supports up to 20 tabs; workbench adds `useSpaceStore` hook |
| TUI/Chat unified view | New: `panel.tsx` and multi-panel composition in panel mode |
| Command palette three-view toggle (⌘1/2/3) | New: Registered in `CommandProvider`, reusing existing command palette UI |
| Space sidebar + Space picker | New: `sidebar.tsx` space list and switching |

### 3.6 Coordination with wopal-cli

After embedding ellamaka-app into the ellamaka binary, `ellamaka serve` provides both API + Web UI capabilities (on the same port 4096). The responsibility of `wopal start` is simplified to:

```
wopal start
  ├─ startEngine()  → Start ellamaka serve (detached, port 4096)
  ├─ open browser   → http://localhost:4096/workbench
  └─ process.exit(0)← Exit immediately, unlocking wopal.exe
```

This perfectly aligns with the existing `startEngine()` architecture—simply changing from `spawnSync(ellamaka attach)` to `open browser + exit`. This completely resolves the Windows file lock issue for `wopal update`.

### 3.7 Relationship with poc/web

| Phase | PoC (poc/web) | ellamaka-app |
|------|--------------|--------------|
| Status | In prototype validation | Skeleton implemented, space sidebar wired and running |
| After Validation | Kept as exploration reference | Carries production code and architectural decisions |
| Future | Capabilities gradually migrated to ellamaka-app, eventually archived | The sole web UI production form |

**PoC Archiving Timeline**: Once the workbench view of ellamaka-app runs stably and covers all PoC scenarios (desktop TUI, mobile Chat, split-screen, command palette), poc/web will enter the archived state. No new features will be added, keeping it solely as a reference implementation.

## 4. Workbench layout

### 4.1 Desktop layout

```
┌──────────────────────────────────────────────────────────────┐
│ Workbench Titlebar                                            │
│ Ellamaka · active space · Official App                        │
├──────────────────────┬───────────────────────────────────────┤
│ Space Rail           │ Stage Header                          │
│ collapse · settings  │ space tabs · add panel                │
│                      ├───────────────────────────────────────┤
│ Registered spaces    │ Panel Workspace                       │
│                      │ 1~3 horizontal panels                 │
│                      │ panel = TUI or Chat                   │
│                      ├───────────────────────────────────────┤
│                      │ Bottom Terminal Dock                  │
├──────────────────────┴───────────────────────────────────────┤
│ Workbench Statusbar                                           │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Region ownership

| Region | Responsibility |
|------|------|
| Titlebar | Brand, active space summary, surface toggle |
| Space Rail | Registered spaces, open state, active state, refresh, collapse control, settings entry |
| Stage Header | Space tabs, add panel action |
| Panel Workspace | One to three horizontal panels for TUI and Chat |
| Bottom Terminal Dock | Global web terminal dock for the active space |
| Statusbar | Server, channel, active space, panel count, layout hints |

## 5. Space tabs

Space tabs represent open WopalSpace workspaces.
They do not represent chat sessions or terminal instances.

Each space tab shows:

- space name
- close action

Selecting a space tab restores that space's layout state.
That includes panel composition, active panel, bottom dock visibility, and recent directory targets.

Closing a space tab preserves the space's persisted layout state so that reopening the same space restores it.

## 6. Panel workspace

### 6.1 Panel rules

The panel workspace supports up to three horizontal panels.

Each panel has:

- panel type: `tui` or `chat`
- target directory inside the current space
- width ratio
- local state owned by that panel type

```ts
type WorkbenchPanel = {
  id: string
  mode: "tui" | "chat"
  directory: string
  width: number
}

type SpaceWorkbenchState = {
  panels: WorkbenchPanel[]
  activePanelID: string
  terminalDockOpen: boolean
}
```

### 6.2 Panel actions

The workspace supports these actions:

- Add panel
- Remove panel
- Change panel mode between TUI and Chat
- Change panel directory
- Resize panel widths
- Focus a panel

The default layout is one panel.
The first panel opens in TUI mode for the space root directory.

### 6.3 Why this replaces Split

This model makes split a natural result of opening more than one panel.
The UI stays consistent:

- one panel = single surface
- two panels = split
- three panels = expanded multi-surface workspace

Users never switch into a separate conceptual mode.
They only compose panels.

## 7. TUI panel

The TUI panel owns a real terminal surface.
It fills the panel body.
Its header presents directory, status, reconnect, and fit actions.

### 7.1 Terminal close semantics

The primary exit path is inside the terminal itself.
Users end a terminal session with `/exit` or the terminal's own process exit.

The main UI does not present a prominent close `X` on each TUI panel.
That avoids accidental teardown during normal flow.

The header provides a secondary `Force close` action inside a menu.

### 7.2 PTY lifecycle

Current official PTY close behavior already removes the PTY and kills the backing process.
The removal path is explicit and does not indicate a confirmed leak.

Relevant code paths:

- `packages/ellamaka-app/src/context/terminal.tsx`
- `packages/opencode/src/pty/index.ts`

The design decision here is UX-first, not a bug workaround.

## 8. Chat panel

The Chat panel owns a conversation surface for the selected directory.
It fills the panel body.
Its header owns model, agent, session, and directory controls.

The message area uses a readable content width inside a full-width panel body.
The composer stays docked at the bottom of the panel.

Each space can keep independent chat state for each panel or reuse a shared active session per directory.
The implementation can begin with one chat session per directory per space and evolve later.

## 9. Bottom terminal dock

Workbench includes a bottom dock above the statusbar.
It reuses the existing official web terminal capability.

This dock is separate from panel TUI.

Its job is:

- provide a familiar quick terminal
- support quick commands without disturbing panel composition
- remain available when the panel workspace is chat-heavy

## 10. Settings

Workbench has its own settings entry at the bottom of the space rail.

The settings experience has two layers:

### 10.1 Global appearance settings

Reuse the existing settings dialog for:

- theme
- color scheme
- fonts

### 10.2 Workbench display settings

Workbench-specific toggles:

- show titlebar
- show statusbar

The space rail uses its own collapse control instead of a hide toggle in settings.
These controls belong to workbench state, not to the official app titlebar settings.

## 11. Directory targeting

Each panel can target any directory inside the current space.

That means a user can:

- keep one TUI panel on the space root
- open a second TUI panel on a project directory
- open a chat panel against another project directory

The directory selector should start with:

1. space root
2. registered project roots discovered inside the space
3. recently used directories in that space

The first implementation can begin with the space root plus a manually chosen directory list.
The interaction contract should still be panel-directory based from day one.

## 12. Implementation order

### Step 1 — Independent shell

- Route `/workbench` outside official `Layout`
- Add official app entry points into workbench
- Add workbench return entry into official app

### Step 2 — Panel workspace skeleton

- Replace global TUI/Chat/Split switch with panel workspace state
- Support one to three horizontal panels
- Add panel headers and add/remove actions
- Add bottom terminal dock slot above statusbar

### Step 3 — Settings and display controls

- Add workbench settings menu
- Open global settings dialog for theme
- Add toggles for titlebar and statusbar
- Add collapse and expand control on the space rail

### Step 4 — TUI panel integration

- Bind TUI panels to real directory-scoped terminal state
- Add directory targeting per panel
- Add secondary `Force close` action

### Step 5 — Chat panel integration

- Bind Chat panels to directory-scoped chat state
- Add agent/model/session controls in panel headers
- Persist active conversation state per space

## 13. First implementation slice

The first code slice delivers:

- independent shell
- workbench entry points
- panel workspace skeleton
- workbench settings entry
- bottom terminal dock placeholder slot

This slice fixes the shell and layout problems first.
It creates the right container for the real TUI and Chat integrations that follow.

## 14. Current implementation checkpoint

### 14.1 Implemented now

- `/workbench` renders outside the official `Layout`
- The official titlebar keeps its original layout and adds one explicit `Workbench` entry button
- The workbench titlebar exposes one text button: `Official App`
- Returning to the official app restores the last official route that was active before entering workbench
- Workbench state is space-first and persisted per space
- The panel workspace supports one to three panels
- Each panel persists `mode`, `directory`, and `width` groundwork
- TUI panel removal uses a secondary menu action instead of a direct close affordance
- The bottom terminal dock placeholder lives in the right stage column above the statusbar
- The space rail is always present and can collapse to a narrow strip
- The workbench settings entry lives at the bottom of the space rail
- Titlebar and statusbar visibility are already user-toggleable and persist across refreshes

### 14.2 Not implemented yet

- The TUI panel is still a placeholder surface
- The Chat panel is still a placeholder surface
- The PoC terminal flow has not been migrated into the panel model yet
- The PoC chat flow has not been migrated into the panel model yet
- Panel directory selection UI is not wired yet
- Panel resize handles are not wired yet
- The bottom dock does not use the real terminal yet

### 14.3 Resume point for the next session

Resume from real content integration rather than more shell work.

1. Migrate the PoC terminal flow into the TUI panel
2. Migrate the PoC chat flow into the Chat panel
3. Wire per-panel directory targeting
4. Wire the bottom dock to the real terminal implementation
5. Add resize handles after real TUI and Chat are in place

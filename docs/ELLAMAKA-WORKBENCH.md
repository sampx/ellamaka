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

**PoC Archiving Timeline**: Once the workbench view of ellamaka-app runs stably, the mobile `/m` route migration is complete (see Step 6), and all PoC scenarios are covered (desktop TUI, mobile Chat, split-screen, command palette), poc/web will enter the archived state. No new features will be added, keeping it solely as a reference implementation.

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
  width: number            // flex ratio (positive number), panels share width proportionally
  terminalOpen: boolean    // whether the panel-internal terminal is open
  terminalHeight: number   // terminal area height ratio (0~1), default 0.35
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

### 6.4 Panel width constraints

| Constraint | Value | Explanation |
|------|-----|------|
| Minimum panel width | `280px` | Below this TUI characters wrap severely, Chat messages become unreadable |
| Maximum panel count | 3 | Existing constraint, unchanged |
| Viewport width check | `280 × panel_count + sidebar_width` | Validate viewport can accommodate before adding a panel; block if insufficient |
| Resize handle | `4px` vertical divider between panels | Highlights on hover, cursor changes to `col-resize` |
| Double-click handle | Equalize all panel widths | Quick reset to even layout |

The `width` field semantics are **flex ratio** (positive number). For example, three panels with widths `[1, 2, 1]` yield a 25%:50%:25% split. Resize translates pixel deltas into proportional adjustments.

### 6.5 Panel-internal terminal

Each panel (TUI or Chat) can open a **panel-level embedded terminal** via the panel menu.

When open, the panel splits vertically into two regions:

```
┌─────────────────────────┐
│ Panel Header (mode/dir) │  fixed height
├─────────────────────────┤
│                         │
│   TUI or Chat content   │  flex: 1 - terminalHeight
│                         │
├── resize handle ────────┤  4px horizontal drag bar
│   Panel Terminal        │  terminalHeight (default 35%)
│   (independent PTY)     │
└─────────────────────────┘
```

#### Rules

| Action | Trigger | Behavior |
|------|---------|------|
| Open terminal | Panel menu → "Open Terminal" | Creates independent PTY instance, sets `terminalOpen: true`, height defaults to 35% |
| Close terminal | Terminal area titlebar × button | Destroys PTY, sets `terminalOpen: false` |
| Adjust height | Drag horizontal resize handle | Updates `terminalHeight`, persisted |
| Minimum height constraint | — | Terminal area minimum `120px`, main content area minimum `200px` |

#### Technical implementation

Panel terminal reuses the existing `Terminal` component (`src/components/terminal.tsx`). The component is self-contained:

- Automatically connects to an independent PTY instance via WebSocket
- Uses ghostty-web WASM terminal, multiple instances on the same page without conflict
- `FitAddon` automatically adapts to container size changes
- Session isolation per panel via `TerminalProvider`'s `scope` parameter

No modifications needed to the `Terminal` component itself or the backend PTY system.

#### Relationship with the bottom terminal dock

Panel-internal terminals are **panel-level**, following the panel's `directory` context.
The bottom terminal dock is **space-level**, independent of panel composition.

They cover different scenarios:
- Panel terminal: execute related commands while chatting (e.g. `git status`, `npm test`)
- Bottom dock: quick global operations (e.g. `wopal` commands)

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

This dock is separate from both panel TUI and panel-internal terminals. It is a **space-level** quick terminal.

Its job is:

- provide a familiar quick terminal
- support quick commands without disturbing panel composition
- remain available when the panel workspace is chat-heavy

**Priority**: Panel-internal terminal (§6.5) ships first, bottom dock iterates later. The two coexist without conflict.

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
- Use isolated ellamaka-specific wrapper components to avoid upstream merge conflicts (see §12.1)

### Step 6 — Mobile route `/m`

- Add `/m` route providing a phone-dedicated Chat interface (detailed design in §12.1.5)
- Migrate core Chat interaction logic from poc/web and optimize mobile UX
- Detect mobile browsers and auto-redirect to `/m`
- Users can manually switch back to desktop version; preference is persisted

## 12.1 Chat Panel Architecture (Detailed Design)

### 12.1.1 Component Isolation Strategy

To prevent merge conflicts with upstream `packages/app`, all Workbench-specific Chat adaptations live in dedicated ellamaka directories:

```
packages/ellamaka-app/src/pages/workbench/
├── parts/
│   ├── panel-chat.tsx              # ← NEW: Chat panel wrapper (ellamaka-specific)
│   ├── panel-chat-header.tsx       # ← NEW: Panel-level model/agent/session controls
│   └── panel-chat-composer.tsx     # ← NEW: Adapted composer for panel context
├── services/
│   └── panel-session-service.ts    # ← NEW: Per-panel session state management
── hooks/
    └── use-panel-chat-state.ts     # ← NEW: Panel-scoped chat state hook
```

**Isolation Principles:**
1. **No modifications to `packages/app`**: All adaptations are additive wrappers
2. **Reuse official components**: Import from `@app/pages/session/*` without modification
3. **Adapter pattern**: Thin wrapper layers handle Panel-specific concerns (directory scoping, layout adaptation)
4. **Clear boundaries**: Ellamaka-specific code clearly separated from inherited app code

### 12.1.2 Official App Chat UI Design Version Analysis

The official app's Chat interface is driven by a single `PromptInput` component (2155 lines) that switches between two visual styles via the global setting `settings.general.newLayoutDesigns()`:

**Design Comparison:**

| Dimension | v1 Old Design (`newLayoutDesigns = false`) | v2 New Design (`newLayoutDesigns = true`) |
|-----------|-------------------------------------------|------------------------------------------|
| **UI Library** | `@opencode-ai/ui/*` (v1) | `@opencode-ai/ui/v2/*` (v2) |
| **Visual Style** | Traditional borders, higher information density | Rounded corners + shadows, visually minimal |
| **Model Selector** | In bottom dock toolbar | Embedded in composer toolbar |
| **Agent Display** | Agent name visible in session header and interactions | Agent name display removed, overly sparse UI |
| **New Session Page** | Logo + title + worktree selector + info text | WordmarkV2 + inline composer, missing information |
| **Session Header** | Full header (file tree/search/terminal toggles, open-in-app menu) | Simplified controls, reduced functionality |
| **File Tree** | Visible by default | Hidden by default |

**UX Assessment:**
- v1 old design provides complete information density and functionality: agent name visible, full-featured header, rich new session page
- v2 new design is over-simplified: removed agent name display, simplified header, insufficient new session page information — noticeably worse UX
- `showCustomAgents` setting only applies to v2 and is disabled by default, further limiting v2's agent visibility

**Conclusion: Workbench Chat integration should target the v1 old design.**

**Integration Strategy:**
- `PromptInput` switches rendering style based on the global `newLayoutDesigns` setting. The Workbench panel wrapper must ensure v1 rendering in the embedded context
- If the user has globally enabled v2, the Workbench wrapper layer needs to force-override to v1 style, or explicitly set `newLayoutDesigns = false` context in the wrapper
- Core reuse components `MessageTimeline` and `SessionComposerRegion` are identical across both designs; the difference lies only in `PromptInput`'s visual wrapper

**Context Adaptation Challenges:**

| Dependency | Description | Workbench Challenge |
|------------|-------------|--------------------|
| `useParams()` | Session ID from route | Workbench panels are not in session routes |
| `useSessionLayout()` | Session tabs and view state | Workbench has its own panel state management |
| `useLayout()` | Global layout context | Workbench has independent layout |
| `useSDK()` / `useServer()` | SDK and server connection | Reusable but needs correct initialization |
| `usePrompt()` / `useLocal()` | Prompt and local state | Requires panel-level isolation |

### 12.1.3 Desktop and Mobile Chat Strategy

ellamaka-app hosts both desktop and mobile Chat interfaces within the same application:

| Dimension | Workbench Chat (Desktop/Tablet) | Mobile Chat (Phone/Small Tablet) |
|-----------|-------------------------------|----------------------------------|
| **Route** | `/workbench` (embedded in panel) | `/m` (dedicated mobile route) |
| **Target Device** | Desktop browsers, tablets | Mobile phones, small tablets |
| **Layout Model** | Multi-Panel workspace (1-3 panels) | Single-column fullscreen, touch-optimized |
| **Chat Source** | Official app components (wrapped) | Migrated from poc/web Chat + optimized |
| **Feature Completeness** | 100% (tool calls, permissions, file refs, diffs) | Core chat + mobile UX optimizations |
| **State Management** | Per-panel session isolation | Single active session |
| **Route Switching** | User enters manually | Auto-redirect on mobile browser detection |

**Rationale:**
- Workbench Chat reuses official components, inheriting production-grade features and architecture consistency
- Mobile Chat is independently implemented within ellamaka-app, not dependent on poc/web at runtime
- Both share the same backend and session infrastructure, but UI layers are fully independent
- The `/m` mobile route allows deep UX optimization for touch and small screens, unconstrained by desktop layout

### 12.1.4 Implementation Plan

#### Phase 5.1: Core Wrapper Components

**PanelChat (Chat Panel Container)** — `parts/panel-chat.tsx`

Responsibility: Top-level container for the Chat panel. Orchestrates internal layout (header → message area → composer). Reuses the official `MessageTimeline` for message rendering and `SessionComposerRegion` for input. Disables centered layout and hides the session title for the panel context (replaced by the panel header). Passes the panel's `directory` as the worktree context to the composer.

**PanelChatHeader (Panel Control Header)** — `parts/panel-chat-header.tsx`

Responsibility: Panel-level control bar. Left side displays the current directory path indicator. Right side provides a model selector (dropdown), an agent selector (dropdown), and a new session button. Visual style consistent with existing workbench panel headers.

**PanelChatComposer (Panel Composer Adapter)** — `parts/panel-chat-composer.tsx`

Responsibility: Thin panel-level adaptation of the official `SessionComposerRegion`. Disables centered mode, sets placement to `inline`, passes the panel's directory context and submission callbacks.

**usePanelChatState (Panel Chat State Hook)** — `hooks/use-panel-chat-state.ts`

Responsibility: Creates isolated Chat state per panel. Core behavior:
- Generates a unique session key from `spaceId + panelId + directory` combination, ensuring session reuse for the same panel-directory pair
- Creates composer state using the official `createSessionComposerState` factory
- Exposes reactive accessors: `sessionKey`, `ready`, `composerState`, `inputRef`
- Provides `handleSubmit` and `handleResponse` callbacks
- On mount, ensures the session exists (creates a new one if absent)

#### Phase 5.2: State Persistence Layer

**PanelSessionService (Panel Session Persistence Service)** — `services/panel-session-service.ts`

Responsibility: Manages persistent storage for panel-level sessions. Each panel+directory combination persists: current session ID, selected model, selected agent, and last active timestamp. Uses the existing `Persist` utility with per-space granularity. Retains the most recent 50 session records per space; older records are automatically pruned.

#### Phase 5.3: Integration with Panel Workspace

In `view.tsx` panel rendering logic, when panel mode is `chat`, conditionally render the `PanelChat` component, passing the panel ID, directory accessor, and current space ID. This change replaces the current Chat panel placeholder UI.

### 12.1.5 Mobile Route `/m` Design Overview (Step 6 Scope)

Mobile Chat is not part of the Workbench. Instead, ellamaka-app introduces a dedicated `/m` route providing an optimized Chat experience for phones and small tablets.

**Routing and Redirection:**
- New `/m` route with its own mobile shell, not wrapped in workbench or official Layout
- On app startup, detect User-Agent and viewport width; mobile browsers auto-redirect to `/m`
- Users can manually switch to the desktop version (`/workbench`); preference is persisted

**Chat Feature Origin:**
- Migrate core interaction logic from poc/web Chat (SSE streaming, message list, input box)
- Further optimize mobile UX: touch gestures, virtual keyboard adaptation, safe area awareness
- Reuse ellamaka-app session infrastructure (shared backend with Workbench Chat)

**Mobile UX Optimization Directions:**
1. **Touch Gestures**: Swipe to switch sessions, long-press for message actions
2. **Input Optimization**: Larger tap targets, auto-layout adjustment when virtual keyboard appears
3. **Safe Areas**: Adapt to notch, bottom safe area, and other mobile-specific screen regions
4. **Performance**: Optimize first-screen loading and message stream rendering for mobile networks

**Code Isolation:**
- Mobile components live in `packages/ellamaka-app/src/pages/mobile/`
- Fully separated from workbench and official app code at the directory level

This belongs to a future step (Step 6) and is not within the current Step 5 implementation scope.

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
- PoC terminal flow migrated to TUI panels with on-demand activation and cross-space session persistence
- Panel width resize handles and constraints (minimum 280px width) fully implemented with double-click reset
- Panel-internal vertical split terminal with drag height resizing and top/bottom height constraints fully implemented

### 14.2 Not yet implemented

- Chat panels are still placeholder UI (detailed design in §12.1)
- PoC chat flow not yet migrated into panel model
- Panel directory selection UI not yet wired
- Bottom dock not yet using real terminal
- Mobile route `/m` not yet implemented (Step 6, design overview in §12.1.5)

### 14.3 Continuation point for next session

1. **Implement Panel Chat wrapper components** (§12.1.4, Phase 5.1)
   - Create `panel-chat.tsx`, `panel-chat-header.tsx`, `use-panel-chat-state.ts`
   - Integrate with existing panel workspace in `view.tsx`

2. **Wire per-panel directory targeting**
   - Add directory selector UI to panel headers
   - Connect to space's project discovery API

3. **Wire bottom dock to real terminal implementation**
   - Reuse official app's web terminal capability
   - Add space-level terminal state management

4. **Mobile route `/m` implementation** (Step 6)
   - Migrate Chat core logic from poc/web to `pages/mobile/`
   - Implement mobile browser auto-detection and redirection
   - Mobile UX optimization (touch, keyboard, safe areas)

# Ellamaka Desktop

Ellamaka desktop application powered by Electron 41.2.1. Hosts the `ellamaka-app` Workbench and manages a local Ellamaka sidecar process.

## Architecture

```
Electron Main Process
├── Window Manager (BrowserWindow lifecycle)
├── Sidecar Manager (packages/opencode node runtime)
└── IPC Handler Registry
          │ IPC
Electron Preload (minimal allowlisted desktop API)
          │
ellamaka-app Renderer (SolidJS SPA)
          │ HTTP / WebSocket
Ellamaka Sidecar (packages/opencode/build-node.ts)
├── PTY Session Registry
├── Disconnect Grace Reaper (10s)
└── PTY / TUI processes
```

Electron is a thin shell — it only manages window lifecycle and the sidecar process. All PTY, TUI, and session management lives in the sidecar. The Renderer shares the exact same PTY logic as the browser Workbench via `@opencode-ai/ellamaka-app`.

## Relationship with ellamaka-app Workbench

The Workbench doesn't know whether it's running in a browser or Electron. It gets platform capabilities through `PlatformProvider`:

| Capability | Browser | Electron |
|-----------|---------|----------|
| File picker | Browser native | Via Preload IPC |
| Menus | None | Native Electron menus |
| Updates | None | Electron updater |
| PTY lifecycle | Identical | Identical |

## Prerequisites

```bash
# Build the sidecar first (required before desktop build)
cd ../opencode && bun script/build-node.ts
```

## Development

```bash
# Install deps
bun install

# Start dev server (hot reload for renderer)
bun run dev
```

## Build

```bash
bun run build          # electron-vite build → out/
bun run package:mac    # unsigned macOS dev DMG/ZIP → dist/
```

## Test

```bash
# Unit tests (requires electron mock preload)
bun test --preload ./electron-mock.ts --force-exit src

# Typecheck
bun run typecheck

# Full-repo typecheck
bun turbo typecheck
```

## Baseline Drift Checks

```bash
bash scripts/check-desktop-baseline.sh  # packages/desktop/ vs v1.15.13
bash scripts/check-app-baseline.sh      # packages/app/ vs v1.15.13
```

## Verification

See `docs/DESKTOP.md` §11 for the full 16-point verification contract. Automated checks (build, typecheck, unit tests, baseline drift) run in CI. Manual runtime verification covers:

- Workbench loads at `/workbench` on startup
- TUI/Terminal creation, I/O, and resize
- PTY survive Renderer refresh (same PID)
- No duplicate PTYs after refresh
- PTY cleanup on Panel/Space close
- Grace-period reconnection after Renderer crash
- Clean app exit (no orphan sidecar or PTY processes)

## Key Files

| File | Role |
|------|------|
| `src/main/index.ts` | Main process entry — app lifecycle, window creation, sidecar orchestration |
| `src/main/server.ts` | Sidecar spawn, health check, env setup |
| `src/main/sidecar.ts` | Sidecar worker thread — server listen/stop |
| `src/preload/index.ts` | Context bridge — ElectronAPI → `window.api` |
| `src/renderer/index.tsx` | Renderer entry — platform setup, routing, sidecar connection |
| `electron-builder.config.ts` | Packaging config (unsigned macOS dev build) |
| `electron.vite.config.ts` | Vite config (main/preload/renderer builds) |

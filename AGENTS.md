---
name: Ellamaka AGENT RULES
description: WopalSpace engine fork of OpenCode for running space-aware agents, commands, plugins, configuration, and TUI behavior
---

# Agent Development Rules

## 1. Canonical References

- DESIGN: `docs/DESIGN.md`
- API CONTRACT: `docs/API-CONTRACT.md`
- BRANDING: `docs/BRANDING.md`
- WORKBENCH: `docs/WORKBENCH.md`
- DESKTOP: `docs/DESKTOP.md`
- DISTRIBUTION: `docs/DISTRIBUTION.md`
- Upstream Merge logs: `docs/UPSTREAM-MERGE-LOG.md`
- Config Reference: `docs/references/ellamaka-config-mechanism.md`
- `.gitattributes` — fork-specific file merge protection (`merge=ours`)
- opencode package rules: `packages/opencode/AGENTS.md`
- ellamaka-app package rules: `packages/ellamaka-app/AGENTS.md`
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
| `packages/ellamaka/` | Brand constants, logo, build wrapper, WopalSpace auto-detection, install path detection, and package-level tests |
| `packages/ellamaka-app/` | Workbench Web UI frontend; see `packages/ellamaka-app/AGENTS.md` for internal rules |
| `packages/ellamaka-desktop/` | Electron desktop app hosting ellamaka-app Workbench and local Ellamaka sidecar; see `packages/ellamaka-desktop/AGENTS.md` |
| `docs/` | Project DESIGN, BRANDING, DISTRIBUTION, references, research, and plans |

### 2.1 Wopal Integration Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| CLI Adapter | `packages/opencode/src/wopal/cli-adapter.ts` | Effect service that executes the wopal CLI via ChildProcessSpawner with absolute path + argument array, parses the v1 capability envelope (`wopal.capability/v1`), and maps CLI error codes to Runtime domain errors (`SpaceControlUnavailable`, `CapabilityContractError`) |
| CLI Contract | `packages/opencode/src/wopal/cli-contract.ts` | Global CLI health and repair service. Checks version compatibility of `$WOPAL_HOME/bin/wopal`, performs user-confirmed update or install recovery, and re-probes after repair |
| CLI Schema | `packages/opencode/src/wopal/cli-schema.ts` | CLI envelope, data schema (SpaceEntry, ProjectEntry, DirectoryEntry), Runtime domain errors, and stable error codes (`StableErrorCode`) |
| SpaceRegistry | `packages/opencode/src/wopal/space-registry.ts` | Non-authoritative read-through Runtime cache. Obtains Space list, project list, and directory search results via the CLI adapter; provides `refreshSpaces`, `getSpaces`, `refreshProjects`, `searchDirectories` |
| Session Provisioner | `packages/opencode/src/workbench/session-provisioner.ts` | Controlled session creation. `provisionGeneral` creates a unique directory under `$WOPAL_HOME/general_tasks/`; `provisionSpace` accepts only registered Spaces and safe relative directories, rejecting traversal attacks and unknown Spaces |
| Session Projection | `packages/opencode/src/workbench/session-projection.ts` | Session tree projection. Reads all Session data from the Runtime database, grouped by registered Space; sessions created by external TUIs appear naturally in the projection |
| Directory Health | `packages/opencode/src/workbench/session-directory-health.ts` | Directory health check. Returns `healthy`, `missing`, or `unavailable`; directory failure does not delete the Session |
| Workbench API | `packages/opencode/src/server/routes/instance/httpapi/groups/workbench.ts` | Workbench HttpApi route group. `POST /workbench/sessions` creates a controlled session; `GET /workbench/session-groups` returns the full session projection with directory health |
| Workbench Handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/workbench.ts` | Workbench endpoint handler that translates HTTP requests into domain service calls, returning Session responses with `directoryHealth` |

### 2.2 Test Locations

| Test File | Coverage |
|----------|----------|
| `packages/opencode/test/server/wopal-cli-adapter.test.ts` | CLI adapter protocol parsing, error mapping, schema validation, SpaceRegistry integration |
| `packages/opencode/test/server/wopal-space-overview.test.ts` | WopalSpace grouping logic (project root session, subdirectory, worktree attribution) |
| `packages/opencode/test/server/workbench-session-api.test.ts` | Session provisioner, projection, directory health service-level tests |

### 2.3 HTTP API Ownership

| API Domain | HTTP Method | Path | Owner |
|--------|-----------|------|-------|
| Workbench | POST | `/workbench/sessions` | `SessionProvisioner` + `SessionDirectoryHealth` |
| Workbench | GET | `/workbench/session-groups` | `SessionProjection` + `SessionDirectoryHealth` |
| WopalSpace | GET | `/wopal-space/spaces` | `SpaceRegistry` (via CLI adapter) |
| Global | GET | `/global/health` | `CliContract` + Runtime health |
| Global | POST | `/global/cli/repair` | `CliContract`, invoked by user-confirmed Workbench repair action |

## 3. Development Commands

| Scenario | Command |
|---|---|
| Lint | `bun run lint` |
| Full-repo typecheck | `bun run typecheck` |
| opencode package tests | `bun test --timeout 30000 --force-exit` (from `packages/opencode`) |
| opencode build | `bun run build` (from `packages/opencode`) |
| ellamaka package tests | `bun test` (from `packages/ellamaka`) |
| Build ellamaka-branded CLI | `bun packages/ellamaka/build.ts --web-ui ellamaka-app` |
| Build CLI binary | `./scripts/build.sh cli` |
| Build desktop app | `./scripts/build.sh desktop` |
| Dev server (TUI/Workbench/Desktop) | `./scripts/dev.sh` |
| Post-upstream clean check | `./scripts/check-cleanup.sh` |
| Desktop package tests | `bun test --preload ./electron-mock.ts --force-exit src` (from `packages/ellamaka-desktop`) |

Tests cannot run from repo root. Run `./scripts/dev.sh help` and `./scripts/build.sh help` for full parameter documentation.

## 4. Implementation Rules

### WopalSpace Customization Constraints

- WopalSpace customizations should go in new files first; upstream files should only contain minimal import and call injection points.
- Use early-return guards in customization branches to avoid overlapping with upstream mainline changes.
- When new modules need access to upstream internal capabilities, prefer callback/closure injection over directly exposing upstream Service type boundaries.
- Extract shared helpers when reusing upstream logic; do not copy large upstream flows.
- Do not perform unrelated formatting, import reordering, dependency reordering, or object key reordering on upstream files.
- `.gitattributes` configures `merge=ours` protection for fork-specific files. Upstream merges automatically preserve ellamaka versions; do not delete or modify these rules.

### HTTP API and SDK Contract

- Follow `docs/API-CONTRACT.md` for every new endpoint. Establish the domain owner, Root/Instance scope, existing group, and resource semantics before defining Effect Schemas, requests, success results, domain errors, and compatibility.
- Endpoints belong to `HttpApiGroup`. Global WopalSpace control capabilities belong to the Root API. Session, file, project, PTY, and working-directory capabilities belong to the Instance API. Handlers only translate between HTTP and domain services.
- Paths express domain resources and their natural relationships. Query parameters express query conditions. Filesystem access, shell execution, CLI invocation, and directory provisioning are owned by their domain services rather than exposed as browser-callable primitives.
- The SDK is generated through Effect HttpApi → OpenAPI → `packages/sdk/js/script/build.ts`. Application code uses the generated client; `packages/sdk/js/src/v2/gen/**` is owned by the generation pipeline.
- Every endpoint addition or modification tests its schemas, success result, domain errors, and middleware boundary, regenerates the SDK, and updates DESIGN and BRANDING.

### Workbench Frontend Development

Workbench frontend development rules (state ownership, identity scope, dependency direction, PTY lifecycle, effect race protection, persistence, testing, and other mandatory boundaries) are in `packages/ellamaka-app/AGENTS.md`. This file does not duplicate those rules; changes to Workbench frontend code must follow that specification.

## 5. Testing

- Code changes follow TDD: write a failing test first, then implement code to make it pass.
- Avoid mocks as much as possible; test real implementations, do not duplicate logic into tests.
- Tests must run from the corresponding package directory, never from repo root.
- After modifying CLI/runtime/config/plugin/agent/TUI space mode, verify or document: `WOPAL_SPACE` flag, `.wopal/config/settings.*`, TUI settings, plugin loading, theme loading.
- After upstream merges, distinguish upstream known failures, environment issues, and newly-introduced ellamaka issues.
- Test safety rules (preventing hangs and orphan processes) are in the space `REGULATIONS.md`.

## 6. User-Supplied Rules

- JS SDK regeneration: `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `main`. The `dev` branch only tracks upstream OpenCode `dev` for merge integration.
- Use `main` or `origin/main` as the diff baseline; `dev` is for upstream-tracking only.
- Prefer auto-executing clear requests; confirm when missing critical info, security risks, or irreversible operations.

# fix-config-align-wopal-space-detection-and-skill-loading

## Metadata

- **Type**: fix
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka/
- **Project Type**: standard
- **Created**: 2026-06-10
- **Status**: reviewing

## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## Goal

Make ellamaka detect WopalSpace by the actual space root and run a coherent WopalSpace config and capability chain from anywhere inside the space.

## Technical Context

### Architecture Context

ellamaka currently has two separate WopalSpace decisions.

The CLI detects space mode by walking upward from cwd and checking whether `.wopal/config/settings.json[c]` contains an `ellamaka` key.

The config loader then searches for `.wopal/` only between cwd and the current git worktree root.

This splits detection from loading.

When ellamaka starts inside a nested project repo such as `projects/ellamaka/`, the detector can find the workspace root while the loader is capped at the project git root.

The result is inconsistent mode selection: space mode can be detected while space-local config, agents, commands, plugins, and skills are not loaded.

WopalSpace identity belongs to the space root.

The root is the nearest ancestor directory whose `.wopal/.git` is a file.

The presence of `.wopal/config/settings.jsonc` is a config overlay, not the identity marker.

WopalSpace mode should be a short-circuit chain.

Inside a space, ellamaka uses the WopalSpace chain.

Outside a space, ellamaka keeps the opencode-compatible chain unchanged.

### Research Findings

The target WopalSpace loading model is:

1. Space detection finds the nearest valid space root from cwd upward, stopping at the user home directory.
2. `--no-wopal-space` is the only manual override and restores native opencode behavior inside a space.
3. `--wopal-space` is removed because space mode cannot be forced outside an actual space.
4. `WOPAL_SPACE_ROOT` is process-internal state set by detection and cleared otherwise.
5. Config and capability loaders consume `WOPAL_SPACE_ROOT/.wopal/` directly.
6. Space mode loads skills in this priority order: `~/.agents/skills/` → `~/.wopal/skills/` → `<space-root>/.wopal/skills/`.
7. Space mode excludes Claude Code prompts and Claude Code skills.
8. Non-space mode keeps the current opencode-compatible behavior.

**参考资料**：
- N/A — source-level behavior was inspected directly during planning.

### Key Decisions

- D-01: Detect WopalSpace by `.wopal/.git` being a file, because the ontology worktree is the space identity marker.
- D-02: Stop upward detection at the user home directory, because `~/.wopal/` is the global user layer and must not be treated as a nested space search boundary beyond home.
- D-03: Remove `--wopal-space`, because forcing space mode outside a detected space creates invalid state.
- D-04: Keep `--no-wopal-space`, because it is the escape hatch for restoring native opencode behavior while working inside a space.
- D-05: Use `WOPAL_SPACE_ROOT` as internal process state and ignore user-supplied `WOPAL_SPACE` or `WOPAL_SPACE_ROOT` values before detection runs.
- D-06: Load WopalSpace config and TUI config from `WOPAL_SPACE_ROOT/.wopal/` directly, not by searching from cwd to the current git worktree.
- D-07: Keep existing command and agent field-level merge behavior. Space definitions override only the fields they define.
- D-08: Keep skill and plugin replacement behavior. Same-name skills and same-identity plugins from higher layers replace lower layers.

### Key Interfaces

```ts
type WopalSpaceDetection = {
  root: string
  wopalDir: string
}

function detectWopalSpace(cwd: string, options?: { home?: string }): WopalSpaceDetection | undefined
```

Runtime contract:

- `WOPAL_SPACE_ROOT` is the absolute path to the detected space root.
- `WOPAL_SPACE` remains only as internal compatibility state for existing `Flag.WOPAL_SPACE` consumers.
- `--no-wopal-space` clears both internal values for the current process.

## In Scope

- Replace settings-file-based WopalSpace detection with ontology worktree detection.
- Remove the force-enable `--wopal-space` CLI option.
- Preserve `--no-wopal-space` as the explicit native-mode escape hatch.
- Make config and TUI loading use the detected space root instead of the current git worktree boundary.
- Make WopalSpace skill discovery load `~/.agents/skills/` at the lowest priority.
- Keep Claude Code prompts and Claude Code skills excluded in WopalSpace mode.
- Add regression tests for nested project execution inside a space.
- Update ellamaka project documentation if existing docs describe the old WopalSpace behavior.

## Out of Scope

- Changing generic opencode-compatible behavior outside WopalSpace mode.
- Changing command and agent merge semantics.
- Changing skill and plugin replacement semantics.
- Supporting manual force-enable space mode outside a detected WopalSpace.
- Changing upstream opencode config names or paths.

## Business Rules Impact

### 新增

N/A — no business rules change.

### 修改

N/A — no business rules change.

### 废弃

N/A — no business rules change.

### 同步确认
- [ ] N/A — no `BUSINESS_RULES.md` update required.

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| Space detection | `packages/ellamaka/detect.ts`, `packages/ellamaka/test/detect.test.ts` | Modify/Create | Detect the nearest WopalSpace root by ontology worktree marker |
| CLI mode selection | `packages/opencode/src/index.ts` | Modify | Remove force-enable flag and normalize internal space-mode state |
| Main config loading | `packages/opencode/src/config/wopal-space-settings.ts`, `packages/opencode/src/config/wopal-space.ts`, `packages/opencode/src/config/config.ts`, `packages/opencode/test/config/config.test.ts` | Modify | Load WopalSpace config and capabilities from `WOPAL_SPACE_ROOT/.wopal/` |
| TUI config loading | `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/test/config/tui.test.ts` | Modify | Keep TUI config on the same WopalSpace root chain |
| Skill loading | `packages/opencode/src/skill/index.ts`, `packages/opencode/src/effect/runtime-flags.ts`, `packages/opencode/test/skill/skill.test.ts` | Modify | Load `~/.agents/skills/` first and exclude Claude skills in space mode |
| Instruction loading | `packages/opencode/src/session/instruction.ts`, `packages/opencode/test/session/instruction.test.ts` | Modify | Exclude Claude prompts in space mode without affecting non-space mode |
| Documentation | `docs/BRANDING.md`, `AGENTS.md` | Modify if needed | Record the target WopalSpace behavior for future maintenance |

## Acceptance Criteria

### Agent Verification

1. [ ] From `packages/ellamaka`: `bun test test/detect.test.ts` exits 0.
2. [ ] From `packages/opencode`: `bun test test/config/config.test.ts test/config/tui.test.ts test/skill/skill.test.ts test/session/instruction.test.ts` exits 0.
3. [ ] From `packages/opencode`: `bun typecheck` exits 0.
4. [ ] From `packages/opencode`: test evidence confirms nested project cwd under a WopalSpace loads `<space-root>/.wopal/` config and capabilities even when cwd git worktree is the nested project root.
5. [ ] User Validation Scenario 2 confirms `--no-wopal-space` restores native opencode-compatible behavior. No automated test required — this is a user-initiated mode switch verified through manual observation.

### User Validation

#### Scenario 1: Start ellamaka from a project repo inside WopalSpace
- Goal: Confirm ellamaka uses the space root `.wopal/` chain when launched from `projects/<name>/`.
- Precondition: The implemented branch is active and ellamaka has been restarted from inside a project directory under the workspace.
- User Actions:
  1. Launch ellamaka from a nested project directory inside the WopalSpace.
  2. Inspect available skills or agent behavior that is defined by the space root `.wopal/` layer.
- Expected Result: Space-local abilities are available even though the current git repo is the nested project repo.

#### Scenario 2: Disable WopalSpace mode explicitly
- Goal: Confirm `--no-wopal-space` restores native opencode-compatible behavior.
- Precondition: The same project directory is inside a detected WopalSpace.
- User Actions:
  1. Launch ellamaka with `--no-wopal-space`.
  2. Inspect whether WopalSpace-only abilities are absent.
- Expected Result: ellamaka follows the native opencode-compatible chain for that process.

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: Detect the WopalSpace root and normalize CLI mode

**Verification Intent**: AC#1, AC#5

**Behavior**: ellamaka detects the nearest space root by `.wopal/.git` file, stops at the user home directory, removes `--wopal-space`, and keeps `--no-wopal-space` as the only manual override.

**Files**: `packages/ellamaka/detect.ts`, `packages/ellamaka/test/detect.test.ts`, `packages/opencode/src/index.ts`

**Pre-read**: `packages/ellamaka/detect.ts`, `packages/opencode/src/index.ts`

**Design**:

Change detection from boolean settings-file scanning to root detection.

The detector walks upward from cwd to the home directory.

The first ancestor containing `.wopal/.git` as a file is the detected space root.

Plain `.wopal/` directories without a git worktree marker are ignored and do not stop the search.

`index.ts` removes the `--wopal-space` option and keeps `--no-wopal-space` through yargs boolean negation support.

Before applying detection results, clear any inherited `WOPAL_SPACE` and `WOPAL_SPACE_ROOT` values so user-provided environment variables cannot force mode.

If `--no-wopal-space` is present, leave both values cleared.

Otherwise, set both values from the detected root.

**TDD**: true

**Changes**:
1. Add RED tests for detected root, nearest-root priority, home stop boundary, ignored non-worktree `.wopal/`, and settings-file-independent detection.
2. Update `detectWopalSpace` to return root metadata instead of a boolean.
3. Update `index.ts` middleware to remove the force-enable flag and normalize internal env state from detection.
4. Update call sites and tests affected by the detector return type.

**Verify**:
From `packages/ellamaka`: `bun test test/detect.test.ts`

**Done**:
任务产出：WopalSpace root detection and CLI mode selection are deterministic and settings-file independent.
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 2: Load main and TUI config from the detected space root

**Verification Intent**: AC#2, AC#3, AC#4, AC#5

**Behavior**: WopalSpace config loading uses `WOPAL_SPACE_ROOT/.wopal/` directly and works from nested project repos, non-git directories under a space, and spaces without local settings overlays.

**Files**: `packages/opencode/src/config/wopal-space-settings.ts`, `packages/opencode/src/config/wopal-space.ts`, `packages/opencode/src/config/config.ts`, `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/test/config/config.test.ts`, `packages/opencode/test/config/tui.test.ts`

**Pre-read**: `packages/opencode/src/config/wopal-space.ts`, `packages/opencode/src/config/wopal-space-settings.ts`, `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`

**Design**:

Replace `findWopalDirs` with root-based resolution.

The local Wopal directory is always `[path.join(WOPAL_SPACE_ROOT, ".wopal")]` in space mode.

The loader should not require `ctx.worktree`.

The loader should not require a space-local settings file to exist.

When a local settings file exists, merge its `ellamaka` or `tui` section as today.

When no local settings file exists, continue with global config and capability loading.

Keep normal mode untouched.

`--no-wopal-space` must make the WopalSpace loader return undefined and allow the existing native path to run.

**TDD**: true

**Changes**:
1. Add RED config tests where cwd is inside a nested project repo and `WOPAL_SPACE_ROOT` points to the outer workspace.
2. Add RED config tests for a detected space without `.wopal/config/settings.jsonc`.
3. Add RED TUI config tests with the same nested-root shape.
4. Remove `findWopalDirs` from WopalSpace config and TUI dependencies.
5. Make both loaders use the internal root directly.

**Verify**:
From `packages/opencode`: `bun test test/config/config.test.ts test/config/tui.test.ts && bun typecheck`

**Done**:
任务产出：Main config and TUI config use the detected WopalSpace root consistently.
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 3: Apply the WopalSpace skill and instruction chain

**Verification Intent**: AC#2, AC#3, AC#5

**Behavior**: In WopalSpace mode, skills load from `~/.agents/skills/` first, then `~/.wopal/skills/`, then `<space-root>/.wopal/skills/`; Claude skills and Claude prompts are excluded. Outside WopalSpace mode, existing opencode-compatible skill and prompt behavior remains unchanged.

**Files**: `packages/opencode/src/skill/index.ts`, `packages/opencode/src/effect/runtime-flags.ts`, `packages/opencode/src/session/instruction.ts`, `packages/opencode/test/skill/skill.test.ts`, `packages/opencode/test/session/instruction.test.ts`

**Pre-read**: `packages/opencode/src/skill/index.ts`, `packages/opencode/src/effect/runtime-flags.ts`, `packages/opencode/src/session/instruction.ts`

**Design**:

Stop using `WOPAL_SPACE` as a blanket runtime flag for disabling all external skills.

Space mode has its own explicit skill discovery chain.

The chain starts with `~/.agents/skills/` so external agent skills become the lowest priority layer.

Config directories then load user-level and space-level Wopal skills in existing order.

Skill replacement remains last-write-wins.

Claude Code prompt and skill exclusion is handled directly by space-mode branching, not by requiring users to set environment variables.

Normal mode keeps the existing external skill and instruction logic.

**TDD**: true

**Changes**:
1. Add RED skill tests proving `~/.agents/skills/` loads in space mode and is overridden by `~/.wopal/skills/` and `<space-root>/.wopal/skills/`.
2. Add RED skill tests proving `~/.claude/skills/` is not loaded in space mode.
3. Add RED instruction tests proving Claude prompt files are excluded in space mode and still work in normal mode.
4. Refactor skill discovery to branch explicitly for WopalSpace mode.
5. Refactor instruction loading to exclude Claude prompts via space-mode state instead of broad external-skill disabling.

**Verify**:
From `packages/opencode`: `bun test test/skill/skill.test.ts test/session/instruction.test.ts && bun typecheck`

**Done**:
任务产出：WopalSpace skill and prompt loading follows the designed short-circuit chain.
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 4: Document the final WopalSpace mode contract

**Verification Intent**: AC#3

**Behavior**: Project documentation states the target WopalSpace runtime contract in configuration-oriented language without preserving old detection assumptions.

**Files**: `docs/BRANDING.md`, `AGENTS.md`

**Pre-read**: `docs/BRANDING.md`, `AGENTS.md`

**Design**:

Update existing ellamaka documentation only where it already describes WopalSpace behavior.

Keep the text operational.

Document the root marker, short-circuit config chain, skill priority, and `--no-wopal-space` escape hatch.

Avoid source-analysis notes or implementation history.

**TDD**: false — documentation-only task.

**Changes**:
1. Update the relevant documentation section if it exists.
2. Add or adjust AGENTS guidance only if maintainers need it to preserve this behavior in future config work.

**Verify**:
From `packages/opencode`: `bun typecheck`; then from `projects/ellamaka`: `rg -l 'WOPAL_SPACE_ROOT' docs/BRANDING.md AGENTS.md` exits 0.

**Done**:
任务产出：Documentation reflects the final WopalSpace mode contract.
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | Detection and CLI mode are the foundation for all later loaders |
| 2 | Task 2 | fae | Task 1 | Config and TUI loaders depend on the internal root contract |
| 3 | Task 3 | fae | Task 1, Task 2 | Skill and instruction loading should use the finalized space-mode contract |
| 4 | Task 4 | fae | Task 1, Task 2, Task 3 | Documentation should reflect the implemented contract |

Each wave is sequential because the internal WopalSpace root contract affects every downstream loader.

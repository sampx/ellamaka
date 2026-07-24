export * as ConfigWopalSpaceSettings from "./wopal-space-settings"

import path from "path"
import { existsSync } from "fs"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { detectWopalSpace } from "../../../ellamaka/detect"

export interface WopalSpaceSettingsDeps {
  readConfigFile: (filepath: string) => Effect.Effect<string | undefined, never, never>
}

export interface WopalSpaceSettingsFile {
  dir: string
  path: string
  text: string
}

export interface WopalSpaceSettingsResult {
  directories: string[]
  localWopalDirs: string[]
  files: WopalSpaceSettingsFile[]
}

export function wopalSpaceDirectories(localWopalDirs: string[]) {
  const homeWopal = Global.Path.wopalHome
  const seen = new Set<string>()
  const directories: string[] = []
  for (const dir of [Global.Path.config, ...(existsSync(homeWopal) ? [homeWopal] : []), ...localWopalDirs]) {
    if (seen.has(dir)) continue
    seen.add(dir)
    directories.push(dir)
  }
  return directories
}

export function loadWopalSpaceSettingsFiles(deps: WopalSpaceSettingsDeps, ctx: { directory: string }) {
  return Effect.gen(function* () {
    if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      return undefined
    }

    // Resolve the space root. Two sources, in priority order:
    //   1. detectWopalSpace(cwd) — walks up looking for `.wopal/.git` worktree marker.
    //      Authoritative for CLI entry and any cwd inside a real space checkout.
    //   2. WOPAL_SPACE + WOPAL_SPACE_ROOT env — explicit override set by callers
    //      that already know the space root (sidecar, tests). detectWopalSpace can
    //      miss in those contexts because cwd may not sit under a space checkout
    //      or the marker may be absent in synthetic test fixtures.
    let detection = detectWopalSpace(ctx.directory)
    if (!detection && process.env.WOPAL_SPACE === "1" && process.env.WOPAL_SPACE_ROOT) {
      const root = process.env.WOPAL_SPACE_ROOT
      detection = { root, wopalDir: path.join(root, ".wopal") }
    }
    if (!detection) {
      return undefined
    }

    // CLI entry sets WOPAL_SPACE env in its yargs middleware (index.ts), but the
    // Desktop sidecar imports the server directly and bypasses that middleware.
    // Set the env here so RuntimeFlags (disableClaudeCodeSkills, wopalSpace, ...)
    // — which read WOPAL_SPACE via Config.boolean — pick up wopal-space mode
    // regardless of entry point. Mirrors index.ts:117-119.
    process.env.WOPAL_SPACE = "1"
    process.env.WOPAL_SPACE_ROOT = detection.root

    const spaceRoot = detection.root
    const localWopalDirs = [path.join(spaceRoot, ".wopal")]

    const files: WopalSpaceSettingsFile[] = []
    for (const dir of localWopalDirs) {
      // Public settings (committed to ontology)
      for (const file of ["settings.jsonc", "settings.json"]) {
        const settingsPath = path.join(dir, "config", file)
        const text = yield* deps.readConfigFile(settingsPath)
        if (!text) continue
        files.push({ dir, path: settingsPath, text })
      }
      // Local settings (private, gitignored — deep-merge overrides public)
      for (const file of ["settings.local.jsonc"]) {
        const settingsPath = path.join(dir, "config", file)
        const text = yield* deps.readConfigFile(settingsPath)
        if (!text) continue
        files.push({ dir, path: settingsPath, text })
      }
    }

    return {
      directories: wopalSpaceDirectories(localWopalDirs),
      localWopalDirs,
      files,
    } satisfies WopalSpaceSettingsResult
  })
}

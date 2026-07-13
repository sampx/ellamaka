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

    const detection = detectWopalSpace(ctx.directory)
    if (!detection) {
      return undefined
    }

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

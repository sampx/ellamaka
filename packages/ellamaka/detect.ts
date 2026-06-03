import { readFileSync, existsSync } from "fs"
import path from "path"

export function detectWopalSpace(cwd: string): boolean {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const wopalDir = path.join(dir, ".wopal")
    if (!existsSync(wopalDir)) {
      if (dir === path.dirname(dir)) return false
      continue
    }
    for (const file of ["settings.jsonc", "settings.json"]) {
      const settingsPath = path.join(wopalDir, "config", file)
      if (!existsSync(settingsPath)) continue
      try {
        const text = readFileSync(settingsPath, "utf-8")
        if (/"ellamaka"\s*:/.test(text)) return true
      } catch (e) {
        console.error(
          "[ellamaka] failed to read wopal-space config:",
          settingsPath,
          e instanceof Error ? e.message : String(e),
        )
      }
    }
    return false
  }
}

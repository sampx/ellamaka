import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { existsSync, readFileSync } from "fs"
import path from "path"

export function readJsoncConfig(filepath: string): Record<string, unknown> | null {
  try {
    let text = readFileSync(filepath, "utf-8")
    text = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function getWorkspaceAutoupdate(spaceRoot?: string): boolean | "notify" | undefined {
  const root = spaceRoot ?? process.env.WOPAL_SPACE_ROOT
  if (!root) return undefined
  const configDir = path.join(root, ".wopal", "config")
  for (const file of ["settings.local.jsonc", "settings.jsonc", "settings.json"]) {
    const filepath = path.join(configDir, file)
    if (!existsSync(filepath)) continue
    const raw = readJsoncConfig(filepath)
    if (raw?.ellamaka && typeof raw.ellamaka === "object") {
      const auto = (raw.ellamaka as Record<string, unknown>).autoupdate
      if (auto === false || auto === "notify") return auto as boolean | "notify"
    }
  }
  return undefined
}

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))

  // Respect workspace autoupdate setting in WopalSpace mode
  const workspaceAutoupdate = getWorkspaceAutoupdate()
  const effectiveAutoupdate = workspaceAutoupdate !== undefined ? workspaceAutoupdate : config.autoupdate

  if (effectiveAutoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE) {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (InstallationVersion === latest) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (effectiveAutoupdate === "notify" || kind !== "patch") {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    .catch(() => {})
}

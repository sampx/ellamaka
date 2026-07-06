import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { ConfigParse } from "@/config/parse"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import type { WopalSpaceEntry } from "../groups/wopal-space"

const SPACES_FILE = path.join(Global.Path.config, "settings.jsonc")

const readSpaces = Effect.fn("WopalSpaceHttpApi.readSpaces")(function* () {
  const fs = yield* AppFileSystem.Service
  const text = yield* fs.readFileStringSafe(SPACES_FILE).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!text) return [] as WopalSpaceEntry[]
  const raw = ConfigParse.jsonc(text, SPACES_FILE)
  const spaces = (raw as { spaces?: Record<string, { path: string; type?: string }> })?.spaces
  if (!spaces || typeof spaces !== "object") return [] as WopalSpaceEntry[]
  return Object.entries(spaces).map(([name, info]) => ({
    name,
    path: info?.path ?? "",
    type: info?.type,
  }))
})

export const wopalSpaceHandlers = HttpApiBuilder.group(RootHttpApi, "wopal-space", (handlers) =>
  Effect.gen(function* () {
    const spaces = Effect.fn("WopalSpaceHttpApi.spaces")(function* () {
      const list = yield* readSpaces()
      return { spaces: list }
    })

    return handlers.handle("spaces", spaces)
  }),
)
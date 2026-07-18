import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi, RootHttpApi } from "../api"
import { SpaceRegistry } from "@/wopal/space-registry"
import { CliContract } from "@/wopal/cli-contract"
import { Config } from "@/config/config"
import type { SpaceEntry } from "@/wopal/cli-schema"

// ---------------------------------------------------------------------------
// CLI executable path
// ---------------------------------------------------------------------------

const WOPAL_CLI = CliContract.executablePath()

// ---------------------------------------------------------------------------
// Space list helper
// ---------------------------------------------------------------------------

const resolveSpaces = (registry: SpaceRegistry) =>
  Effect.gen(function* () {
    const snapshot = yield* registry.getSpaces()
    if (snapshot.spaces.length > 0) return snapshot.spaces
    const refreshed = yield* registry.refreshSpaces(WOPAL_CLI)
    return refreshed.spaces
  }).pipe(Effect.catch(() => Effect.succeed([] as SpaceEntry[])))

export { resolveSpaces }

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const wopalSpaceHandlers = HttpApiBuilder.group(RootHttpApi, "wopal-space", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* SpaceRegistry.Service

    const spaces = Effect.fn("WopalSpaceHttpApi.spaces")(function* () {
      const list = yield* resolveSpaces(registry)
      return { spaces: list }
    })

    return handlers.handle("spaces", spaces)
  }),
)

// ---------------------------------------------------------------------------
// Handler - Instance
// ---------------------------------------------------------------------------

export const wopalSpaceInstanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "wopal-space-instance", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service

    const mode = Effect.fn("WopalSpaceHttpApi.mode")(function* () {
      const isWopal = yield* config.isWopalSpace()
      return { isWopalSpace: isWopal }
    })

    return handlers.handle("mode", mode)
  }),
)

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { SpaceRegistry } from "@/wopal/space-registry"
import type { SpaceEntry } from "@/wopal/cli-schema"

// ---------------------------------------------------------------------------
// Space list helper
// ---------------------------------------------------------------------------

const resolveSpaces = (registry: SpaceRegistry) =>
  Effect.gen(function* () {
    const snapshot = yield* registry.getSpaces()
    if (snapshot.spaces.length > 0) return snapshot.spaces
    const refreshed = yield* registry.refreshSpaces("")
    return refreshed.spaces
  }).pipe(Effect.catch(() => Effect.succeed([] as SpaceEntry[])))

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
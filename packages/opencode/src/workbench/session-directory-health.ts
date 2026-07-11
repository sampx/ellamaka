import { Context, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DirectoryHealth = "healthy" | "missing" | "unavailable"

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SessionDirectoryHealth {
  readonly check: (directory: string) => Effect.Effect<DirectoryHealth>
}

export class Service extends Context.Service<Service, SessionDirectoryHealth>()("@opencode/SessionDirectoryHealth") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const make = Effect.sync(() =>
  Service.of({
    check: (directory: string): Effect.Effect<DirectoryHealth> =>
      Effect.sync(() => {
        try {
          const fs = require("fs")
          const stat = fs.statSync(directory)
          if (stat.isDirectory()) return "healthy" as const
          return "unavailable" as const
        } catch (e: any) {
          if (e.code === "ENOENT") return "missing" as const
          if (e.code === "EACCES" || e.code === "EPERM") return "unavailable" as const
          return "missing" as const
        }
      }),
  }),
)

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer

export * as SessionDirectoryHealth from "./session-directory-health"
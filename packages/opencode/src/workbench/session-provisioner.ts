import { Context, Effect, Layer, Schema } from "effect"
import { SpaceRegistry } from "@/wopal/space-registry"
import { SessionDirectoryHealth } from "./session-directory-health"
import { SpaceControlUnavailable, CapabilityContractError } from "@/wopal/cli-schema"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvisionGeneralInput {
  title?: string
  agent?: string
}

export interface ProvisionSpaceInput {
  spaceName: string
  relativeDirectory?: string
  title?: string
  agent?: string
}

export interface ProvisionResult {
  id: string
  directory: string
  title: string
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class SessionDirectoryUnavailable extends Schema.TaggedErrorClass<SessionDirectoryUnavailable>()(
  "SessionDirectoryUnavailable",
  {
    message: Schema.String,
    directory: Schema.String,
  },
) {}

export class InvalidSpaceTarget extends Schema.TaggedErrorClass<InvalidSpaceTarget>()(
  "InvalidSpaceTarget",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SessionProvisioner {
  readonly provisionGeneral: (
    input: ProvisionGeneralInput,
  ) => Effect.Effect<ProvisionResult, SessionDirectoryUnavailable>
  readonly provisionSpace: (
    input: ProvisionSpaceInput,
  ) => Effect.Effect<ProvisionResult, SessionDirectoryUnavailable | InvalidSpaceTarget | SpaceControlUnavailable | CapabilityContractError>
}

export class Service extends Context.Service<Service, SessionProvisioner>()("@opencode/SessionProvisioner") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const WOPAL_CLI = "/Users/sam/.wopal/bin/wopal"
const WOPAL_HOME = process.env.WOPAL_HOME || require("os").homedir() + "/.wopal"

const make = Effect.gen(function* () {
  const health = yield* SessionDirectoryHealth.Service
  const registry = yield* SpaceRegistry.Service

  const provisionGeneral = (input: ProvisionGeneralInput): Effect.Effect<ProvisionResult, SessionDirectoryUnavailable> =>
    Effect.gen(function* () {
      const now = new Date()
      const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
      const dir = `${WOPAL_HOME}/general_tasks/${ts}`
      const title = input.title ?? `General session ${ts}`

      // Ensure the directory exists
      try {
        require("fs").mkdirSync(dir, { recursive: true })
      } catch {
        return yield* Effect.fail(
          new SessionDirectoryUnavailable({
            message: "Failed to create general task directory",
            directory: dir,
          }),
        )
      }

      return {
        id: `general-${ts}`,
        directory: dir,
        title,
      }
    })

  const provisionSpace = (
    input: ProvisionSpaceInput,
  ): Effect.Effect<ProvisionResult, SessionDirectoryUnavailable | InvalidSpaceTarget | SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      // Validate the space exists
      const snapshot = yield* registry.getSpaces()
      const spaces = snapshot.spaces.length > 0
        ? snapshot.spaces
        : (yield* registry.refreshSpaces(WOPAL_CLI)).spaces

      const space = spaces.find((s) => s.name === input.spaceName)
      if (!space) {
        return yield* Effect.fail(
          new InvalidSpaceTarget({
            message: `Space not found: ${input.spaceName}`,
            detail: "Use a registered space name",
          }),
        )
      }

      // Resolve the target directory
      let directory = space.path
      if (input.relativeDirectory) {
        const rel = input.relativeDirectory
        if (rel.includes("..") || rel.startsWith("/")) {
          return yield* Effect.fail(
            new InvalidSpaceTarget({
              message: "Invalid relative directory: path traversal detected",
              detail: rel,
            }),
          )
        }
        directory = `${space.path}/${rel}`
      }

      // Check directory health
      const dirHealth = yield* health.check(directory)
      if (dirHealth !== "healthy") {
        return yield* Effect.fail(
          new SessionDirectoryUnavailable({
            message: `Directory is ${dirHealth}: ${directory}`,
            directory,
          }),
        )
      }

      const title = input.title ?? `Space session - ${input.spaceName}`

      return {
        id: `space-${input.spaceName}-${Date.now()}`,
        directory,
        title,
      }
    })

  return Service.of({ provisionGeneral, provisionSpace })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(
  Layer.provide(SpaceRegistry.defaultLayer),
  Layer.provide(SessionDirectoryHealth.defaultLayer),
)

export * as SessionProvisioner from "./session-provisioner"
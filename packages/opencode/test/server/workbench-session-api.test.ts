import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { SessionProvisioner } from "../../src/workbench/session-provisioner"
import { SessionProjection } from "../../src/workbench/session-projection"
import { SessionDirectoryHealth } from "../../src/workbench/session-directory-health"
import { SpaceRegistry } from "../../src/wopal/space-registry"
import { CliAdapter } from "../../src/wopal/cli-adapter"

const it = testEffect(
  Layer.mergeAll(
    SessionProvisioner.defaultLayer,
    SessionProjection.defaultLayer,
    SessionDirectoryHealth.defaultLayer,
    CliAdapter.defaultLayer,
    SpaceRegistry.defaultLayer,
  ),
)

describe("workbench-session-api", () => {
  it.live("SessionProvisioner service is available", () =>
    Effect.gen(function* () {
      const provisioner = yield* SessionProvisioner.Service
      expect(provisioner).toBeDefined()
      expect(provisioner.provisionGeneral).toBeDefined()
      expect(provisioner.provisionSpace).toBeDefined()
    }),
  )

  it.live("SessionProjection service is available", () =>
    Effect.gen(function* () {
      const projection = yield* SessionProjection.Service
      expect(projection).toBeDefined()
      expect(projection.getSessionGroups).toBeDefined()
    }),
  )

  it.live("SessionDirectoryHealth service is available", () =>
    Effect.gen(function* () {
      const health = yield* SessionDirectoryHealth.Service
      expect(health).toBeDefined()
      expect(health.check).toBeDefined()
    }),
  )

  it.live("directory health check returns healthy for existing directory", () =>
    Effect.gen(function* () {
      const health = yield* SessionDirectoryHealth.Service
      const result = yield* health.check("/tmp")
      expect(result).toBe("healthy")
    }),
  )

  it.live("directory health check returns missing for nonexistent directory", () =>
    Effect.gen(function* () {
      const health = yield* SessionDirectoryHealth.Service
      const result = yield* health.check("/nonexistent/path/12345")
      expect(result).toBe("missing")
    }),
  )

  it.live("provisioner creates general session directory", () =>
    Effect.gen(function* () {
      const provisioner = yield* SessionProvisioner.Service
      const result = yield* provisioner.provisionGeneral({ title: "test" })
      expect(result.directory).toContain("general_tasks")
      expect(result.title).toBe("test")
    }),
  )
})
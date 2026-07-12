import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { SessionProvisioner } from "../../src/workbench/session-provisioner"
import { SessionProjection } from "../../src/workbench/session-projection"
import { SessionDirectoryHealth } from "../../src/workbench/session-directory-health"
import { SpaceRegistry } from "../../src/wopal/space-registry"
import { CliAdapter } from "../../src/wopal/cli-adapter"
import { SessionShare } from "../../src/share/session"
import { InstanceStore } from "../../src/project/instance-store"

const sessionShareLayer = Layer.mock(SessionShare.Service, {
  create: () => Effect.die("SessionShare.create should not run in service wiring tests"),
})

const instanceStoreLayer = Layer.mock(InstanceStore.Service, {
  provide: (_input, effect) => effect,
})

let createInput: { title?: string; agent?: string } | undefined
let createCalled = false

function resetCreateCapture() {
  createInput = undefined
  createCalled = false
}

const provisionerIt = testEffect(
  SessionProvisioner.layer.pipe(
    Layer.provide([
      Layer.mock(SessionDirectoryHealth.Service, {
        check: () => Effect.succeed("healthy" as const),
      }),
      Layer.mock(SpaceRegistry.Service, {
        getSpaces: () => Effect.succeed({ spaces: [{ name: "main", path: "/tmp" }], refreshedAt: 0 } as never),
      }),
      Layer.mock(SessionShare.Service, {
        create: (input) =>
          Effect.sync(() => {
            createCalled = true
            createInput = input
            return { id: "ses_1", directory: "/tmp", title: "New session - 2026-07-12T00:00:00.000Z" } as never
          }),
      }),
      instanceStoreLayer,
    ]),
  ),
)

const it = testEffect(
  Layer.mergeAll(
    SessionProvisioner.defaultLayer,
    SessionProjection.defaultLayer,
    SessionDirectoryHealth.defaultLayer,
    CliAdapter.defaultLayer,
    SpaceRegistry.defaultLayer,
  ).pipe(Layer.provide([sessionShareLayer, instanceStoreLayer])),
)

describe("workbench-session-api", () => {
  provisionerIt.live("provisioner delegates session creation without assigning a fixed title", () =>
    Effect.gen(function* () {
      resetCreateCapture()
      const provisioner = yield* SessionProvisioner.Service
      const result = yield* provisioner.provisionSpace({ spaceName: "main" })

      expect(createCalled).toBe(true)
      expect(createInput).toEqual({ title: undefined, agent: undefined })
      expect(result).toEqual({
        id: "ses_1",
        directory: "/tmp",
        title: "New session - 2026-07-12T00:00:00.000Z",
      })
    }),
  )

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
})

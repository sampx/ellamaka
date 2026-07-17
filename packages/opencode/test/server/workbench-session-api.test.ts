import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { SessionProvisioner } from "../../src/workbench/session-provisioner"
import { SessionProjection } from "../../src/workbench/session-projection"
import { SessionDirectoryHealth } from "../../src/workbench/session-directory-health"
import { SpaceRegistry } from "../../src/wopal/space-registry"
import { CliAdapter } from "../../src/wopal/cli-adapter"
import { SessionShare } from "../../src/share/session"
import { Session } from "../../src/session/session"
import { InstanceStore } from "../../src/project/instance-store"

const sessionShareLayer = Layer.mock(SessionShare.Service, {
  create: () => Effect.die("SessionShare.create should not run in service wiring tests"),
})

const instanceStoreLayer = Layer.mock(InstanceStore.Service, {
  provide: (_input, effect) => effect,
})

let createInput: { title?: string; agent?: string; metadata?: Record<string, unknown> } | undefined
let createCount = 0

function resetCreateCapture() {
  createInput = undefined
  createCount = 0
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
          Effect.gen(function* () {
            createCount += 1
            createInput = input
            yield* Effect.sleep("10 millis")
            return { id: "ses_1", directory: "/tmp", title: "New session - 2026-07-12T00:00:00.000Z" } as never
          }),
      }),
      Layer.mock(Session.Service, {
        list: () => Effect.succeed([]),
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
  ).pipe(Layer.provide([
    sessionShareLayer,
    instanceStoreLayer,
    Layer.mock(Session.Service, { list: () => Effect.succeed([]) }),
  ])),
)

describe("workbench-session-api", () => {
  provisionerIt.live("provisioner delegates session creation without assigning a fixed title", () =>
    Effect.gen(function* () {
      resetCreateCapture()
      const provisioner = yield* SessionProvisioner.Service
      const result = yield* provisioner.provisionSpace({ spaceName: "main" })

      expect(createCount).toBe(1)
      expect(createInput).toMatchObject({ title: undefined, agent: undefined })
      expect(createInput?.metadata?.workbench).toMatchObject({
        payload: expect.any(String),
        requestID: expect.any(String),
      })
      expect(result).toMatchObject({
        id: "ses_1",
        directory: "/tmp",
        title: "New session - 2026-07-12T00:00:00.000Z",
      })
    }),
  )

  provisionerIt.live("provisioner records a request ID and canonical payload metadata for idempotent creation", () =>
    Effect.gen(function* () {
      resetCreateCapture()
      const provisioner = yield* SessionProvisioner.Service
      yield* provisioner.provisionSpace({ spacePath: "/tmp", requestID: "request-1" })

      expect(createInput).toEqual({
        title: undefined,
        agent: undefined,
        metadata: {
          workbench: {
            requestID: "request-1",
            payload: JSON.stringify({
              target: { type: "space", spacePath: "/private/tmp", directory: undefined },
              title: undefined,
              agent: undefined,
            }),
          },
        },
      })
    }),
  )

  provisionerIt.live("coalesces concurrent retries with the same request ID", () =>
    Effect.gen(function* () {
      resetCreateCapture()
      const provisioner = yield* SessionProvisioner.Service
      const [first, second] = yield* Effect.all([
        provisioner.provisionSpace({ spacePath: "/tmp", requestID: "request-coalesced" }),
        provisioner.provisionSpace({ spacePath: "/tmp", requestID: "request-coalesced" }),
      ], { concurrency: 2 })

      expect(first.id).toBe("ses_1")
      expect(second.id).toBe("ses_1")
      expect(createCount).toBe(1)
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

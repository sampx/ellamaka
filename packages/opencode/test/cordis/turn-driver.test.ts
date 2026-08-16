import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { TurnDriver } from "@/session/turn-driver"
import { createTurnDriverLayer, cordisHubLayer, CordisHubService } from "@wopal/ellamaka-cordis"

describe("TurnDriver default direct-run", () => {
  test("runs the work directly without routing through cordis", async () => {
    const rt = ManagedRuntime.make(TurnDriver.defaultLayer)
    const out = await rt.runPromise(
      Effect.gen(function* () {
        const driver = yield* TurnDriver.Service
        return yield* driver.run({ sessionID: "s1", work: Effect.succeed("direct") })
      }),
    )
    expect(out).toBe("direct")
    await rt.dispose()
  })
})

describe("TurnDriver cordis layer", () => {
  test("routes work through ctx.agentLoop when the cordis layer is provided", async () => {
    const built = Layer.mergeAll(
      createTurnDriverLayer(TurnDriver.Service).pipe(Layer.provide(cordisHubLayer)),
      cordisHubLayer,
    )
    const rt = ManagedRuntime.make(built)
    const out = await rt.runPromise(
      Effect.gen(function* () {
        const driver = yield* TurnDriver.Service
        return yield* driver.run({ sessionID: "s2", work: Effect.succeed("via-agentLoop") })
      }),
    )
    expect(out).toBe("via-agentLoop")
    await rt.dispose()
  })

  test("emits agent/turn-completed with the sessionID on successful completion", async () => {
    const built = Layer.mergeAll(
      createTurnDriverLayer(TurnDriver.Service).pipe(Layer.provide(cordisHubLayer)),
      cordisHubLayer,
    )
    const rt = ManagedRuntime.make(built)
    const events: string[] = []
    const out = await rt.runPromise(
      Effect.gen(function* () {
        const hub = yield* CordisHubService
        hub.ctx.on("agent/turn-completed", (p: { sessionID: string }) => events.push(p.sessionID))
        const driver = yield* TurnDriver.Service
        return yield* driver.run({ sessionID: "s3", work: Effect.succeed("done") })
      }),
    )
    expect(out).toBe("done")
    expect(events).toEqual(["s3"])
    await rt.dispose()
  })
})

import { describe, expect, test } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime } from "effect"
import { cordisHubLayer, createTurnDriverLayer } from "../src/index.js"

// Stand-in for opencode's TurnDriver tag (structurally compatible contract).
const TurnDriverTag = Context.Reference<{ run: (input: unknown) => Effect.Effect<unknown> }>("Test/TurnDriver", {
  defaultValue: () => ({ run: (i) => Effect.succeed(i) }),
})

const built = Layer.mergeAll(
  createTurnDriverLayer(TurnDriverTag).pipe(Layer.provide(cordisHubLayer)),
  cordisHubLayer,
)

describe("TurnDriver cordis bridge (R3: cancel determinism)", () => {
  test("interrupting the outer fiber aborts and runs the work's finalizers child-before-parent", async () => {
    const rt = ManagedRuntime.make(built)
    const order: string[] = []
    const started = Deferred.make<void>()

    const work = Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => order.push("parent-release")))
      order.push("parent-acquire")
      yield* Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(() => order.push("child-release")))
        order.push("child-acquire")
        yield* Effect.gen(function* () {
          order.push("leaf-acquire")
          Effect.runSync(Deferred.succeed(started, void 0))
          yield* Effect.sleep("10 seconds")
        })
      })
    })

    // Run the driver, then interrupt the outer fiber mid-run.
    const fiber = rt.runFork(
      Effect.gen(function* () {
        const driver = yield* TurnDriverTag
        return yield* driver.run({ sessionID: "s", work })
      }),
    )
    await Deferred.await(started).pipe(Effect.timeout("5 seconds"), Effect.runPromise)
    await Effect.runPromise(Fiber.interrupt(fiber))

    // The bridge aborts the work fiber and waits for finalizers to settle.
    await poll(() => order.includes("parent-release"))

    expect(order).toContain("parent-acquire")
    expect(order).toContain("parent-release")
    expect(order).toContain("child-acquire")
    expect(order).toContain("child-release")
    expect(order).toContain("leaf-acquire")
    // Child-before-parent on the same scope.
    expect(order.indexOf("child-release")).toBeLessThan(order.indexOf("parent-release"))

    await rt.dispose()
  })
})

async function poll(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error("timed out waiting for predicate")
}

import { describe, expect } from "bun:test"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { BackgroundJob } from "@/background/job"
import { InstanceState } from "@/effect/instance-state"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { TurnDriver } from "@/session/turn-driver"
import { MessageV2 } from "@/session/message-v2"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, SessionID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { Deferred, Effect, Fiber, Latch, Layer, Schema, Stream } from "effect"
import { createTurnDriverLayer, cordisHubLayer } from "@wopal/ellamaka-cordis"

// --- Event used to observe ALS inheritance across the bridge ---

const AlsProbe = {
  Ping: BusEvent.define(
    "cordis.als.probe",
    Schema.Struct({ directory: Schema.String }),
  ),
}

// --- R3 shared-state completion signal (fresh per test) ---
type CancelDone = { opened: boolean }
const makeCancelDone = (): CancelDone => ({ opened: false })

// --- Minimal valid assistant message for `ensureRunning`'s onInterrupt ---

function assistantMessage(sid: SessionID): MessageV2.WithParts {
  return {
    info: {
      id: MessageID.make("msg_als_cancel_probe"),
      sessionID: sid,
      role: "assistant",
      time: { created: 0 },
      parentID: MessageID.make("msg_als_cancel_parent"),
      modelID: ModelID.make("test-model"),
      providerID: ProviderID.make("test"),
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [],
  }
}

// --- Layer: SessionRunState + deps + cordis turn-driver bridge ---

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status), Layer.provide(BackgroundJob.layer))

const it = testEffect(
  Layer.mergeAll(
    run,
    status,
    BackgroundJob.layer,
    createTurnDriverLayer(TurnDriver.Service).pipe(Layer.provide(cordisHubLayer)),
  ),
)

// Wait until a Deferred signal is opened (deterministic readiness for the
// work to have started, avoiding fixed sleeps).
const awaitStarted = (started: Deferred.Deferred<void>) =>
  Deferred.await(started).pipe(Effect.timeout("5 seconds"))

// Poll a real wall-clock predicate with a real timer. The cordis-side work
// fiber is interrupted asynchronously in the hub's separate runtime, so we
// must yield the JS event loop between checks (TestClock `Effect.sleep` would
// not advance the hub runtime's scheduled interrupt).
const pollRealtime = <A>(predicate: () => A | undefined, message: string, timeoutMs = 5000): Effect.Effect<A, Error> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const result = predicate()
      if (result !== undefined) return result
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 20)))
    }
    return yield* Effect.fail(new Error(message))
  })

describe("R2: ALS inheritance across the bridge", () => {
  it.instance(
    "a bridge-driven work fiber reads the instance context and publishes to the instance-A subscriber",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const bus = yield* Bus.Service
        const state = yield* SessionRunState.Service
        const driver = yield* TurnDriver.Service
        const sid = SessionID.make("ses_als_inherit")

        const received: string[] = []
        const got = yield* Deferred.make<void>()
        const ready = yield* Latch.make()

        // Eager subscribe: the PubSub subscription is acquired synchronously at
        // `yield* bus.subscribe(...)`, then only consumption is forked.
        const stream = yield* bus.subscribe(AlsProbe.Ping)
        yield* Effect.forkScoped(
          Stream.runForEach(stream, (evt) =>
            Effect.gen(function* () {
              if (evt.properties.directory === "") {
                yield* ready.open
                return
              }
              received.push(evt.properties.directory)
              if (received.length >= 1) yield* Deferred.succeed(got, void 0)
            }),
          ),
        )
        yield* bus.publish(AlsProbe.Ping, { directory: "" })
        yield* ready.await.pipe(Effect.timeout("5 seconds"))

        const work = Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          expect(ctx.directory).toBe(directory)
          yield* bus.publish(AlsProbe.Ping, { directory: ctx.directory })
          return assistantMessage(sid)
        })

        yield* state.ensureRunning(sid, Effect.succeed(assistantMessage(sid)), driver.run({ sessionID: sid, work }))
        yield* Deferred.await(got).pipe(Effect.timeout("5 seconds"))

        expect(received).toEqual([directory])
      }),
  )
})

describe("R3: cancel determinism through the bridge", () => {
  it.instance(
    "interrupting the run cascades finalizers child-before-parent and cleans background work",
    () =>
      Effect.gen(function* () {
        const state = yield* SessionRunState.Service
        const status = yield* SessionStatus.Service
        const driver = yield* TurnDriver.Service
        const sid = SessionID.make("ses_cancel_determinism")

        const order: string[] = []
        const started = yield* Deferred.make<void>()
        const cancelDone = makeCancelDone()

        // Use `addFinalizer` + a cancellable long task (`Effect.sleep`), NOT
        // `acquireRelease(never, …)` which hangs under external interrupt in
        // effect 4.0.0-beta.66 — see DESIGN §5.6.1. Finalizers are ordered
        // child-before-parent on the same scope.
        const work = Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              order.push("parent-release")
              cancelDone.opened = true
            }),
          )
          order.push("parent-acquire")
          yield* Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => order.push("child-release")))
            order.push("child-acquire")
            yield* Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.sync(() => order.push("bg-release")))
              yield* Effect.forkScoped(
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() => Effect.sync(() => order.push("bg-fork-release")))
                  yield* Effect.sleep("10 seconds")
                }),
              )
              order.push("bg-acquire")
              Effect.runSync(Deferred.succeed(started, void 0))
              yield* Effect.sleep("10 seconds")
              return assistantMessage(sid)
            })
          })
        })

        const fiber = yield* state
          .ensureRunning(
            sid,
            Effect.succeed(assistantMessage(sid)),
            // `forkScoped` inside the work adds a Scope requirement that the
            // runner satisfies at runtime via `Effect.forkIn(scope)`; cast away
            // the scope from the declared effect type.
            driver.run({ sessionID: sid, work: work as Effect.Effect<MessageV2.WithParts> }),
          )
          .pipe(Effect.forkChild)

        yield* awaitStarted(started)
        yield* state.cancel(sid)
        yield* Fiber.await(fiber)
        // The cordis-side work fiber is interrupted via the abort signal and its
        // finalizers run asynchronously in the hub runtime; poll real time until
        // the parent finalizer flips the shared completion flag.
        yield* pollRealtime(
          () => (cancelDone.opened ? order.slice() : undefined),
          "work finalizers never completed",
          3000,
        )

        // Every acquire is matched by a release; the bg consumer cascades.
        for (const step of ["parent-acquire", "child-acquire", "bg-acquire"]) {
          expect(order).toContain(step)
          expect(order).toContain(step.replace("acquire", "release"))
        }
        // Child-before-parent deterministic ordering on the same scope.
        expect(order.indexOf("bg-fork-release")).toBeLessThan(order.indexOf("child-release"))
        expect(order.indexOf("child-release")).toBeLessThan(order.indexOf("parent-release"))
        expect((yield* status.get(sid)).type).toBe("idle")
      }),
  )
})

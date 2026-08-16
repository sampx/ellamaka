import { Context, Deferred, Effect, Layer } from "effect"
import * as Scope from "effect/Scope"
import { CordisHub } from "./hub.js"
import { CordisHubService } from "./layer.js"
import { AgentLoop } from "./agent-loop.js"
import type { AgentLoopRunInput } from "./agent-loop.js"

/**
 * Shape of the Effect-side turn driver contract, structurally compatible with
 * opencode's `TurnDriver`. The tag is injected at assembly time to avoid a
 * circular workspace dependency (opencode → cordis → opencode).
 */
export interface TurnDriverContract {
  readonly run: <A, E, R>(input: {
    readonly sessionID: string
    readonly work: Effect.Effect<A, E, R>
  }) => Effect.Effect<A, E, R>
}

/**
 * Ensure the hub has the `AgentLoop` service mounted, returning the hub.
 *
 * The `cordisHubLayer` provisions the bare container; bridge services that
 * drive turns mount `AgentLoop` on first use. Idempotent: if the service is
 * already available on the context, it is not mounted twice.
 */
const hubWithAgentLoop = Effect.gen(function* () {
  const hub = yield* CordisHubService
  const runtime = hub.runtime
  if (runtime && !hub.ctx.get("agentLoop")) {
    yield* Effect.promise(() => hub.mount(AgentLoop, runtime))
  }
  return hub
})

/**
 * Build the cordis-driven `TurnDriver` layer for a given opencode tag.
 *
 * The returned layer overrides the default direct-run driver so each agent
 * turn is routed through the hub's `ctx.agentLoop`, which forks the work into
 * its own scope and interrupts it on abort (DESIGN §5.6.1).
 *
 * Interrupt mapping: the driver runs the work by handing it to
 * `ctx.agentLoop.run` with an `AbortController` signal and awaiting a
 * `Deferred` that the agentLoop promise settles. When the outer turn fiber is
 * interrupted (`Effect.onInterrupt`), the controller is aborted — which the
 * agent-loop uses to interrupt the held work fiber and run its finalizers
 * (DESIGN §5.6.1 rule 5) — and the driver waits uninterruptibly for the
 * agentLoop promise to settle, so the work fiber's finalizers (and any
 * `forkScoped` background cascade) complete before the interrupt resolves.
 *
 * Two R3 fixes over the original bridge:
 * 1. The caller's Scope tag is stripped (`Context.omit(Scope.Scope)`) before
 *    providing the caller context to the work. Re-providing the caller scope
 *    re-binds `addFinalizer`/`forkScoped` inside the work to the caller's
 *    scope, so interrupting the work fiber would not run its finalizers until
 *    the caller scope closed at teardown (a leak).
 * 2. On interrupt the driver aborts the controller and waits uninterruptibly
 *    for the agentLoop promise to settle, instead of `Effect.promise`/callback
 *    rejecting immediately and abandoning the cordis-side work fiber
 *    mid-finalization.
 */
export const createTurnDriverLayer = <I, S extends TurnDriverContract>(
  tag: Context.Key<I, S>,
): Layer.Layer<I, never, CordisHubService> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const hub = yield* hubWithAgentLoop
      const run = (input: { readonly sessionID: string; readonly work: Effect.Effect<unknown, unknown> }) =>
        Effect.gen(function* () {
          // Capture the caller's full Effect context and provide it to the work
          // before crossing into the cordis ManagedRuntime. The hub runtime is
          // built from a restricted context (DESIGN §5.6.1), so without this the
          // work loses the Effect services it depends on (Bus, InstanceState,
          // SessionStatus, …) and fails with "Service not found" (R2 ALS).
          //
          // The caller's Scope tag must be stripped: the work is forked into the
          // agentLoop's own scope (`Effect.forkIn(scope)`), and re-providing the
          // caller scope would re-bind `addFinalizer`/`forkScoped` inside the work
          // to the caller's scope. Interrupting the work fiber then would not run
          // its finalizers until the caller scope closes at teardown (R3 leak).
          const caller = yield* Effect.context()
          const callerWithoutScope = Context.omit(Scope.Scope)(caller)
          const settled = yield* Deferred.make<unknown, unknown>()
          const controller = new AbortController()

          const promise = hub.ctx.agentLoop.run({
            sessionID: input.sessionID,
            work: input.work.pipe(Effect.provide(callerWithoutScope)),
            signal: controller.signal,
          } as AgentLoopRunInput)
          promise.then(
            (value) => Effect.runSync(Deferred.succeed(settled, value)),
            (error) => Effect.runSync(Deferred.fail(settled, error)),
          )

          return yield* Effect.onInterrupt(
            Deferred.await(settled).pipe(
              Effect.mapError(() => undefined as never),
            ),
            () =>
              Effect.sync(() => controller.abort()).pipe(
                Effect.flatMap(() => Effect.uninterruptible(Deferred.await(settled).pipe(Effect.ignore))),
              ),
          )
        })
      return { run } as unknown as S
    }),
  )

export * as TurnDriverLayer from "./turn-driver-layer.js"

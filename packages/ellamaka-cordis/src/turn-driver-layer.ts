import { Context, Effect, Layer } from "effect"
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
 * turn is routed through the hub's `ctx.agentLoop`. The work Effect is handed
 * to `ctx.agentLoop.run` as a promise (bridged back via `Effect.promise`),
 * which forks it into a scope and interrupts it on abort (DESIGN §5.6.1).
 *
 * Interrupt mapping: `Effect.interruptible` keeps the promise-await path
 * interruptible so an external `Fiber.interrupt` on the outer turn fiber
 * cancels the bridge; `Effect.promise` rejects with an `Interrupt` cause which
 * is propagated as a failure.
 */
export const createTurnDriverLayer = <I, S extends TurnDriverContract>(
  tag: Context.Key<I, S>,
): Layer.Layer<I, never, CordisHubService> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const hub = yield* hubWithAgentLoop
      const run = (input: { readonly sessionID: string; readonly work: Effect.Effect<unknown, unknown> }) =>
        Effect.interruptible(
          Effect.promise(() =>
            hub.ctx.agentLoop.run({
              sessionID: input.sessionID,
              work: input.work,
            } as AgentLoopRunInput),
          ),
        )
      return { run } as unknown as S
    }),
  )

export * as TurnDriverLayer from "./turn-driver-layer.js"

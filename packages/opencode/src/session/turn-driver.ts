import { Context, Effect, Layer } from "effect"

/**
 * Turn-driver injection point for the agent loop.
 *
 * `SessionPrompt.loop` routes each turn's work through this optional service.
 * The default implementation runs the work directly (unchanged behavior).
 * A cordis driver layer (`@wopal/ellamaka-cordis`) overrides this service so
 * turns are driven through `ctx.agentLoop` on the cordis side.
 *
 * Cancel stays Effect-native: `SessionRunState`/`Runner` interrupt the outer
 * fiber, and the bridge's `forkIn(scope)` cascades the interrupt (R3).
 */
export interface Interface {
  readonly run: <A, E, R>(input: {
    readonly sessionID: string
    readonly work: Effect.Effect<A, E, R>
  }) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TurnDriver") {}

export const defaultLayer = Layer.succeed(Service, Service.of({ run: (input) => input.work }))

export * as TurnDriver from "./turn-driver"

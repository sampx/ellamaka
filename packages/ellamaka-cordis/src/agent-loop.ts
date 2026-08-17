import { Effect, Exit, Fiber, Cause } from "effect"
import { Context as CordisContext, Service } from "@deepseek-ai/cordis"
import type { HubRuntime } from "./types.js"

/**
 * Input contract for a single agent turn driven through cordis.
 *
 * `work` is the Effect to run; `signal` optionally cancels the run. On abort,
 * the held fiber is interrupted and its finalizers run deterministically
 * (child-before-parent) per DESIGN §5.6.1.
 */
export interface AgentLoopRunInput {
  readonly sessionID: string
  readonly work: Effect.Effect<unknown, unknown>
  readonly signal?: AbortSignal
}

/**
 * The self-owned agent-loop service exposed as `ctx.agentLoop`.
 *
 * `run` bridges from the async cordis side back into the Effect world using
 * the DESIGN §5.6.1 form: capture a scope inside `Effect.scoped`, fork the
 * work into it via `Effect.forkIn(scope)` to hold a fiber, interrupt it on
 * abort, wait for it to settle, then return its result. On successful
 * completion it emits `agent/turn-completed`. The bridge is driven by the
 * hub's `ManagedRuntime` mount point (never `runPromise` for long-lived
 * work).
 */
export class AgentLoop extends Service {
  static provide = "agentLoop"
  static inject = []

  constructor(
    ctx: CordisContext,
    private runtime: HubRuntime,
  ) {
    super(ctx, "agentLoop")
  }

  run(input: AgentLoopRunInput): Promise<unknown> {
    const runtime = this.runtime
    const ctx = this.ctx
    if (!runtime) {
      ctx.logger("agent-loop").error("no ManagedRuntime mounted on the hub")
      return Promise.reject(new Error("agentLoop: no ManagedRuntime mounted on the hub"))
    }
    const sessionID = input.sessionID
    const signal = input.signal

    // Run in a scoped effect so a fresh scope is available (§5.6.1 rule 3).
    // Fork the work into that scope and hold the resulting fiber for interrupt.
    return runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const fiber = yield* Effect.forkIn(scope)(input.work)

          const abort = () => {
            runtime.runFork(Fiber.interrupt(fiber))
          }
          if (signal?.aborted) {
            abort()
          } else if (signal) {
            signal.addEventListener("abort", abort, { once: true })
          }

          try {
            const exit = yield* Fiber.await(fiber)
            if (Exit.isSuccess(exit)) {
              ctx.emit("agent/turn-completed", { sessionID })
              return exit.value
            }
            ctx.logger("agent-loop").warn("turn failed sessionID=%s cause=%s", sessionID, Cause.pretty(exit.cause))
            return yield* Effect.failCause(exit.cause)
          } finally {
            signal?.removeEventListener("abort", abort)
          }
        }),
      ),
    )
  }
}

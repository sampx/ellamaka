import { Effect, Fiber, Cause, Exit, Option, type ManagedRuntime } from "effect"
import type { ToolDefinition, ToolExecution } from "./types.js"

/**
 * Wrap a native Effect-backed execution body as a `ToolDefinition` so it can be
 * registered on `ctx.tools` and driven through the execute / post-execute
 * pipeline (DESIGN §5.1, D-03).
 *
 * The bridge follows DESIGN §5.6.1: the native effect is forked into a scope
 * via `Effect.forkIn(scope)` and the held fiber is awaited for its real exit;
 * caller cancellation (`exec.signal`) interrupts that fiber through
 * `runtime.runFork(Fiber.interrupt(fiber))`. Failures and interruption throw so
 * the registry materializes an error result that still reaches the
 * `tools/post-execute` waterfall.
 */
export function createGrepBridge(
  nativeExecute: (args: unknown) => Effect.Effect<unknown>,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
): ToolDefinition {
  return {
    name: "grep",
    description: "Search for patterns in files and return matching lines",
    parameters: {},
    execute(args: unknown, exec: ToolExecution): Promise<unknown> {
      const work = nativeExecute(args)
      return new Promise((resolve, reject) => {
        // Holder for the forked work fiber so the abort listener can interrupt it.
        let fiber: Fiber.Fiber<unknown, never> | undefined

        const onAbort = () => {
          if (fiber) runtime.runFork(Fiber.interrupt(fiber))
        }

        // Abort requested before the fiber is registered: nothing to interrupt.
        if (exec.signal.aborted) {
          reject(abortedError())
          return
        }
        exec.signal.addEventListener("abort", onAbort, { once: true })

        const cleanup = () => exec.signal.removeEventListener("abort", onAbort)

        const exitEffect = Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope
            fiber = yield* Effect.forkIn(work, scope)
            return yield* Fiber.await(fiber)
          }),
        )

        runtime.runPromise(exitEffect).then(
          (exit) => {
            cleanup()
            if (Exit.isSuccess(exit)) {
              resolve(exit.value)
            } else {
              reject(exitToError(exit))
            }          },
          (error: unknown) => {
            cleanup()
            reject(error instanceof Error ? error : new Error(String(error)))
          },
        )
      })
    },
  }
}

/** Build the error thrown when the native execution is interrupted. */
function abortedError(): Error {
  return Object.assign(new Error("tool execution aborted"), { code: "ABORTED" })
}

/** Convert a failed effect exit into a thrown Error for the registry. */
function exitToError(exit: Exit.Exit<unknown, unknown>): Error {
  // `exitToError` is only called for a failure exit; narrow before reading `cause`.
  if (!Exit.isFailure(exit)) return new Error("tool execution failed")
  const cause = exit.cause
  if (Cause.hasInterruptsOnly(cause)) return abortedError()
  const found = Option.getOrNull(Cause.findErrorOption(cause))
  if (found instanceof Error) return found
  if (found !== null) return new Error(String(found))
  return new Error("tool execution failed")
}

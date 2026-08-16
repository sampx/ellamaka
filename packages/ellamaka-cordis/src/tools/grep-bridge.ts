import { Context, Effect, Fiber, Cause, Exit, Layer, Option, type ManagedRuntime } from "effect"
import type { ToolDefinition, ToolExecution, ToolExecutionResult } from "./types.js"
import { Tools } from "./registry.js"
import { CordisHubService } from "../layer.js"

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

/**
 * Shape of the Effect-side grep-bridge contract, structurally compatible with
 * opencode's `GrepBridgeService`. The tag is injected at assembly time to avoid
 * a circular workspace dependency (opencode → cordis → opencode).
 */
export interface GrepBridgeContract {
  /**
   * Route a native grep dispatch through the cordis `ctx.tools` pipeline:
   * register, execute, and apply the `tools/post-execute` waterfall. The
   * caller supplies a native grep execution body already closed over its real
   * tool context (so permission/identity flow through unchanged); the bridge
   * maps caller cancellation to a fiber interrupt and materializes the result.
   */
  readonly run: (input: {
    readonly args: unknown
    readonly sessionID: string
    readonly cwd: string
    readonly signal: AbortSignal
    /**
     * The caller's Effect runtime — carries the native grep dependencies
     * (Ripgrep, AppFileSystem, InstanceRef, …). The bridge runs the native work
     * through this runtime (not the hub runtime) so permission, identity, and
     * instance context flow through unchanged (DESIGN §5.6.1).
     */
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
    readonly execute: (args: unknown) => Effect.Effect<unknown>
  }) => Promise<ToolExecutionResult>
}

/** Identity of the default grep-bridge tag opencode injects for. */
export const GrepBridgeTag = "@wopal/ellamaka-cordis/grep-bridge" as const

/** Build a per-call execution context for a grep dispatch. */
function buildExec(input: {
  readonly args: unknown
  readonly sessionID: string
  readonly cwd: string
  readonly signal: AbortSignal
}): ToolExecution {
  return {
    callId: "",
    rootCallId: "",
    name: "grep",
    arguments: input.args,
    agent: {
      session: { header: { id: input.sessionID, cwd: input.cwd } },
    },
    signal: input.signal,
  }
}

/**
 * Build a cordis-driven grep-bridge layer for a given opencode tag.
 *
 * The layer mounts the `Tools` service on the hub and exposes a `run` that
 * routes a native grep dispatch through `ctx.tools`. Each call re-registers a
 * grep definition wrapping the caller's native body with {@link createGrepBridge},
 * so caller cancellation (`exec.signal`) interrupts the forked fiber per
 * DESIGN §5.6.1, and results flow through the `tools/post-execute` waterfall.
 */
export const createGrepBridgeLayer = <I, S extends GrepBridgeContract>(
  tag: Context.Key<I, S>,
): Layer.Layer<I, never, CordisHubService> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const hub = yield* CordisHubService
      const runtime = hub.runtime
      if (!runtime) {
        return {
          run: () => Promise.reject(new Error("hub runtime unavailable")),
        } as unknown as S
      }
      // Idempotent: mount the Tools service once per hub context.
      if (!hub.ctx.get("tools")) {
        yield* Effect.promise(() => hub.mount(Tools, runtime))
      }
      const run: GrepBridgeContract["run"] = (input) => {
        // Re-register a def whose execute wraps the caller's native body,
        // running it through the caller's runtime (which carries the native
        // grep dependencies). The bridge only adds fiber/abort handling and
        // the session facade slice.
        hub.ctx.tools.register({
          name: "grep",
          description: "Search for patterns in files and return matching lines",
          parameters: {},
          execute: (args, exec) => createGrepBridge(input.execute, input.runtime).execute(args, exec),
        })
        return hub.ctx.tools.execute("grep", input.args, buildExec(input))
      }
      return { run } as unknown as S
    }),
  )

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

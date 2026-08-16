import type { Effect, ManagedRuntime } from "effect"
import type { Context } from "@deepseek-ai/cordis"
import type { AgentLoop } from "./agent-loop.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    agentLoop: AgentLoop
  }
  interface Events {
    /** Emitted once an agent turn completes successfully. */
    "agent/turn-completed"(payload: { sessionID: string }): void
  }
}

/**
 * Cordis plugin configuration passed to {@link CordisHub.mount}.
 *
 * The generic `T` is the plugin's config type; cordis validates it against the
 * plugin's `Config` schema when present.
 */
export type CordisPlugin<T = any> =
  | (new (ctx: Context, config: T) => unknown)
  | ((ctx: Context, config: T) => unknown)
  | { apply(ctx: Context, config: T): unknown }

/**
 * Options accepted by the {@link CordisHub} constructor.
 *
 * The hub always creates its own `Context`; these options configure how that
 * context is used, not which context backs it.
 */
export interface CordisHubOptions {
  /**
   * Optional name applied to the underlying cordis context. Currently
   * informational; reserved for future multi-instance diagnostics.
   */
  readonly name?: string
}

/**
 * The Effect `ManagedRuntime` mount point held by a {@link CordisHub}.
 *
 * Bridge services (agent-loop, grep-bridge, …) use this runtime to execute
 * Effect work from the async cordis side per DESIGN §5.6.1
 * (`ManagedRuntime.runFork` + `Effect.forkIn(scope)`, never `runPromise` for
 * long-lived work). When the hub is created outside an Effect scope (e.g. a
 * bare `new CordisHub()`), `runtime` is `null`.
 */
export type HubRuntime = ManagedRuntime.ManagedRuntime<never, never> | null

/**
 * Structural type of the underlying cordis context held by a {@link CordisHub}.
 *
 * Kept as a named export so downstream packages can annotate the context
 * without importing cordis directly.
 */
export type HubContext = Context

/**
 * Marker for the effect layer that provisions a per-scope {@link CordisHub}.
 *
 * The hub is built lazily on first access and disposed when the enclosing
 * effect scope closes (ScopedCache semantics).
 */
export const CordisHubTag = "@wopal/ellamaka-cordis/hub" as const

import type { ManagedRuntime } from "effect"

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
 * Bridge services use this runtime to execute Effect work from the async
 * cordis side per DESIGN-dsh-poc §6.2 (`ManagedRuntime.runFork` +
 * `Effect.forkIn(scope)`, never `runPromise` for long-lived work). When the
 * hub is created outside an Effect scope (e.g. a bare `new CordisHub()`),
 * `runtime` is `null`.
 */
export type HubRuntime = ManagedRuntime.ManagedRuntime<never, never> | null

import { Context } from "@deepseek-ai/cordis"
import type { HubRuntime, CordisHubOptions } from "./types.js"

/**
 * Per-instance Cordis container.
 *
 * Each hub owns a fresh cordis `Context` and provides a mount point for the
 * Effect `ManagedRuntime` that bridge services (agent-loop, grep-bridge, …)
 * use to execute Effect work from the async cordis side (DESIGN §5.6.1).
 *
 * Lifecycle:
 * - `mount(plugin, options)` loads a cordis plugin into the hub's context.
 * - `dispose()` tears the container down via `ctx.fiber.dispose()`.
 *
 * The hub is the single cordis boundary in the repository: every cordis
 * import converges here.
 */
export class CordisHub {
  /** The cordis context backing this hub. */
  readonly ctx: Context
  /** Effect runtime mount point for bridge services; `null` when unprovided. */
  readonly runtime: HubRuntime
  private disposed = false

  constructor(runtime: HubRuntime, options: CordisHubOptions = {}) {
    this.ctx = new Context()
    this.runtime = runtime
    // `name` is reserved for future multi-instance diagnostics; the cordis
    // context currently has no stable naming hook beyond the fiber tree.
    void options.name
    // Lifecycle "created" log is emitted by the assembly layer after the
    // log Exporter is registered (DESIGN §5.10), so the line reaches
    // cordis-plugins.log. The constructor runs before the Exporter exists,
    // so it must not log here.
  }

  /**
   * Load a cordis plugin into this hub's context.
   *
   * Returns a promise that settles once the plugin's services are active and
   * rejected on config or startup errors (e.g. duplicate-service registration).
   */
  mount<T extends object = object>(
    plugin: Parameters<Context["plugin"]>[0],
    config?: unknown,
  ): Promise<void> {
    const fiber = this.ctx.plugin(plugin as never, config as never)
    return fiber as unknown as Promise<void>
  }

  /**
   * Tear the container down, calling `ctx.fiber.dispose()`.
   *
   * Idempotent: subsequent calls are no-ops.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // Log before fiber.dispose() — the Exporter is still registered on this
    // fiber, so the line reaches cordis-plugins.log. After dispose, the
    // Exporter is auto-removed by the fiber lifecycle.
    this.ctx.logger("cordis-hub").info("disposing")
    await this.ctx.fiber.dispose()
  }
}

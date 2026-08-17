import type { Context, Fiber } from "@deepseek-ai/cordis"
import { LocalSpillStore } from "@deepseek-ai/dsh-spill-local"
import * as SpillPolicy from "@deepseek-ai/dsh-spill-policy"

/**
 * Options for {@link mountSpillPlugins}.
 */
export interface MountSpillOptions {
  /** Root directory for spill dump files (the observable instance path). */
  root?: string
  /** Model-facing context cap in UTF-8 bytes for a plain-text tool result. */
  maxInlineBytes?: number
}

/**
 * Result of {@link mountSpillPlugins}: the plugin fibers, disposed on hub
 * dispose or explicitly to unmount the spill trio and restore inline behavior.
 */
export interface MountedSpillPlugins {
  /** The `LocalSpillStore` plugin fiber. */
  readonly store: Fiber
  /** The `SpillPolicy` plugin fiber. */
  readonly policy: Fiber
}

/**
 * Code-direct spill plugin mount (D-04): load the dsh spill trio
 * (`LocalSpillStore` then `SpillPolicy`) straight onto a cordis context via
 * `ctx.plugin`, bypassing the settings/config declaration path.
 *
 * - `LocalSpillStore` registers the `ctx.spillStore` backend that persists the
 *   FULL oversized result to a private session-scoped file.
 * - `SpillPolicy` (registered as a `tools/post-execute` transformer) decides
 *   WHEN to spill — a plain-text result over `maxInlineBytes` is replaced by a
 *   bounded head/tail preview plus a `spill://`-style locator, keeping the full
 *   text on disk for retrieval.
 *
 * `read` is skipped by the policy's model-facing arm (avoids a
 * `read → spill → read again` loop). No session owner, a missing `ctx.spillStore`
 * backend, or a storage failure keeps the inline result (best-effort — a spill
 * failure never turns a successful call into an error). Mounting is idempotent
 * per context and unmounts with the hub dispose.
 *
 * @param ctx - the cordis context to mount onto.
 * @param options - spill root and policy cap.
 * @returns the plugin fibers, disposable to unmount the spill trio.
 */
export async function mountSpillPlugins(
  ctx: Context,
  options: MountSpillOptions,
): Promise<MountedSpillPlugins> {
  const logger = ctx.logger("spill-mount")
  logger.info("mounting spill plugins root=%s maxInlineBytes=%d", options.root, options.maxInlineBytes)
  const store = await ctx.plugin(LocalSpillStore, { root: options.root })
  const policy = await ctx.plugin(SpillPolicy, { maxInlineBytes: options.maxInlineBytes })
  logger.info("spill plugins mounted")
  return { store, policy }
}

import { Context, Effect, Layer, ManagedRuntime, ScopedCache } from "effect"
import * as Scope from "effect/Scope"
import { CordisHub } from "./hub.js"
import { CordisHubTag, type CordisHubOptions } from "./types.js"

/**
 * Per-instance hub registry (DESIGN D-06).
 *
 * Each instance directory maps to its own {@link CordisHub}: the hub (and the
 * cordis context behind it — plugins, config assembly) is created lazily on
 * first dispatch into that directory, shared by every dispatch in it, and
 * disposed when the registry entry is invalidated (instance dispose) or the
 * registry's own scope closes (server shutdown).
 */
export interface CordisHubRegistry {
  /**
   * Resolve the hub for an instance directory, building it on first use.
   *
   * The acquire is scoped: callers hold the entry for their scope's duration,
   * and the cached hub persists across scopes until invalidated.
   */
  readonly forDirectory: (directory: string) => Effect.Effect<CordisHub, never, Scope.Scope>
  /**
   * Invalidate the cached hub for a directory. Its disposal finalizer runs
   * once outstanding scopes release it; the next `forDirectory` builds a
   * fresh hub (wiring point for host-side instance disposal).
   */
  readonly invalidate: (directory: string) => Effect.Effect<void>
}

/**
 * Effect service identity for the per-instance {@link CordisHubRegistry}.
 */
export class CordisHubService extends Context.Service<CordisHubService, CordisHubRegistry>()(
  CordisHubTag,
) {}

/**
 * Options for {@link cordisHubLayerWith}.
 */
export interface CordisHubRegistryOptions {
  /**
   * Hub initialization hook: runs once when a per-instance hub is created,
   * before any dispatch can use it. The host assembly's code-mount point for
   * per-instance plugins (DESIGN D-04 code-direct mounting; the configured
   * ConfigBridge path is a later Plan). A rejected hook fails the hub
   * resolution loudly - an assembly bug never yields a silent half-mounted
   * container (the half-built hub is disposed by the lookup finalizer).
   */
  readonly onHubCreate?: (hub: CordisHub, directory: string) => Promise<void>
}

/**
 * Effect layer provisioning a {@link CordisHubService}.
 *
 * The registry itself is server-level (one cache); the hubs inside it are
 * per-instance directories, mirroring `InstanceState.make` semantics:
 * lazy lookup keyed by directory, disposal via the entry's finalizer on
 * invalidate, and full teardown when the layer scope closes.
 */
export const cordisHubLayerWith = (
  options: CordisHubRegistryOptions = {},
): Layer.Layer<CordisHubService> =>
  Layer.effect(
    CordisHubService,
    Effect.gen(function* () {
      const cache = yield* ScopedCache.make({
        capacity: Number.POSITIVE_INFINITY,
        lookup: (directory: string) =>
          Effect.gen(function* () {
            const hub = yield* buildCordisHub({ name: directory })
            const onHubCreate = options.onHubCreate
            if (onHubCreate !== undefined) {
              yield* Effect.promise(() => onHubCreate(hub, directory))
            }
            return hub
          }),
      })
      return {
        forDirectory: (directory) => ScopedCache.get(cache, directory),
        invalidate: (directory) =>
          ScopedCache.invalidate(cache, directory).pipe(Effect.asVoid),
      }
    }),
  )

/**
 * Bare hub registry without per-instance plugin mounting.
 */
export const cordisHubLayer: Layer.Layer<CordisHubService> = cordisHubLayerWith()

/**
 * Build a {@link CordisHub} capturing the current Effect runtime.
 *
 * `Effect.runtime()` is unavailable in effect 4.0.0-beta.66 (the catalog
 * version), so the current effect context is captured and wrapped in a fresh
 * `ManagedRuntime`. That runtime is the mount point bridge services use to
 * execute Effect work from the async cordis side (DESIGN §5.6.1). The hub's
 * `dispose()` runs via the entry finalizer when the owning scope closes.
 */
function buildCordisHub(
  options: CordisHubOptions = {},
): Effect.Effect<CordisHub, never, Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* Effect.context()
    const runtime = ManagedRuntime.make(Layer.succeedContext(context))
    const hub = new CordisHub(runtime as ManagedRuntime.ManagedRuntime<never, never>, options)
    // Entry disposal (invalidate or registry teardown) releases the container.
    yield* Effect.addFinalizer(() => Effect.promise(() => hub.dispose()))
    return hub
  })
}

/**
 * Build a bare per-scope hub outside the registry (tests, direct mounts).
 */
export function cordisHub(
  options: CordisHubOptions = {},
): Effect.Effect<CordisHub, never, Scope.Scope> {
  return buildCordisHub(options)
}

export * as CordisLayer from "./layer.js"

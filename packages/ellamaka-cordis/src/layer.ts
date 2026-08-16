import { Context, Effect, Layer, ManagedRuntime } from "effect"
import * as Scope from "effect/Scope"
import { CordisHub } from "./hub.js"
import { CordisHubTag, type CordisHubOptions } from "./types.js"

/**
 * Effect service identity for the per-scope {@link CordisHub}.
 *
 * Consumed via `yield* CordisHubService`; the hub is created lazily on first
 * access and disposed when the enclosing effect scope closes.
 */
export class CordisHubService extends Context.Service<CordisHubService, CordisHub>()(
  CordisHubTag,
) {}

/**
 * Effect layer provisioning a {@link CordisHubService}.
 *
 * The hub is built lazily on first service access and its `dispose()` runs via
 * the layer's scope finalizer — instance dispose invalidates the ScopedCache
 * and releases the cordis container, mirroring `InstanceState.make` semantics.
 */
export const cordisHubLayer: Layer.Layer<CordisHubService> = Layer.effect(
  CordisHubService,
  buildCordisHub(),
)

/**
 * Lazy per-scope hub instance.
 *
 * `yield*` resolves to the hub provisioned by {@link cordisHubLayer}; the same
 * hub is returned on subsequent accesses and is disposed when the scope closes.
 */
export const cordisHubInstance: Effect.Effect<CordisHub, never, CordisHubService> =
  Effect.gen(function* () {
    return yield* CordisHubService
  })

/**
 * Build a {@link CordisHub} capturing the current Effect runtime.
 *
 * `Effect.runtime()` is unavailable in effect 4.0.0-beta.66 (the catalog
 * version), so the current effect context is captured and wrapped in a fresh
 * `ManagedRuntime`. That runtime is the mount point bridge services use to
 * execute Effect work from the async cordis side (DESIGN §5.6.1).
 */
function buildCordisHub(
  options: CordisHubOptions = {},
): Effect.Effect<CordisHub, never, Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* Effect.context()
    const runtime = ManagedRuntime.make(Layer.succeedContext(context))
    const hub = new CordisHub(runtime as ManagedRuntime.ManagedRuntime<never, never>, options)
    // Instance dispose (scope close) releases the cordis container cleanly.
    yield* Effect.addFinalizer(() => Effect.promise(() => hub.dispose()))
    return hub
  })
}

export function cordisHub(
  options: CordisHubOptions = {},
): Effect.Effect<CordisHub, never, Scope.Scope> {
  return buildCordisHub(options)
}

export * as CordisLayer from "./layer.js"

import { readStore } from "./store.js"
import { composeFullPatchStack, composePluginLayers, healPluginsModuleFallback, type PluginLayerPatch } from "./compose.js"

/**
 * Plugin Runtime Service: watches the store and replays include patches into
 * the running containers (DESIGN-dsh-poc §9.4, D-02/D-03).
 *
 * Trigger contract (D-02): CLI commands are pure disk operations; the server
 * process polls the store on an interval, hashes the document, and only
 * replays when the hash changed — so an unchanged store costs one file read
 * per tick and never touches the containers.
 *
 * Replay contract (D-03, spike 2 path B): the include `entry.update` is a
 * SHALLOW merge, so each replay spreads the previous config back and REPLACES
 * `patches` with the FULL composition rebuilt by
 * {@link composeFullPatchStack}: bundle layers -> plugin layers -> user patch
 * layer -> extra patches -> state home patches. Replacing the stack with only
 * the plugin rows would drop the official bundle/user/state rows on the first
 * tick (the include re-applies `config.patches` over the raw config). The
 * loader diffs entries by explicit id, so mount/unmount of individual plugins
 * is transactional — add/remove/enable/disable all share this one path.
 *
 * Failure semantics (DESIGN §9.6 #5): a failed replay is logged with
 * structure and the LAST GOOD STATE stays mounted; the service never crashes
 * and replays again on the next store change.
 */

/** The structured logger seam the service logs through (W-02). */
export interface DshPluginServiceLogger {
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
}

/** One watched container: its profile and the boot include entry handle. */
export interface DshPluginContainer {
  /** The profile name the container mounted ("web" | "ellamaka-tools"). */
  profile: string
  /** The container context (service probes / logging). */
  ctx?: unknown
  /** The root include entry from the mount handle (DshHost.includeEntry). */
  includeEntry: {
    id: string
    update(options: unknown): Promise<void>
  }
  /**
   * The container's boot patch-stack context (DshHost.stackContext): passed
   * to `composeFullPatchStack` so a replay rebuilds the ENTIRE stack
   * (bundle -> plugin -> user -> extra -> state), never dropping the
   * official layers (rook B-01).
   */
  stackContext?: unknown
}

/** Options for {@link startDshPluginService}. */
export interface DshPluginServiceOptions {
  /** The dsh home (`$WOPAL_HOME/dsh`) whose plugins/ store is watched. */
  home: string
  /** The containers to replay plugin layers into. */
  containers: DshPluginContainer[]
  /** Poll interval in ms; defaults to 2000 (Plan D-02). */
  intervalMs?: number
  /**
   * The install anchor the container's profile was loaded from (binds the
   * full-stack recomposition to the same bundle layers boot used). Required
   * for correct replays; when omitted the service replays plugin-only stacks
   * (legacy behaviour, only valid for standalone test containers).
   */
  installAnchor?: string
  /** Structured logger; defaults to a console-backed fallback. */
  logger?: DshPluginServiceLogger
  /** Diagnostic hook invoked after each successful replay (tests). */
  onReplay?: (profile: string) => void
  /** Diagnostic hook invoked on a failed replay (tests). */
  onReplayError?: (profile: string, error: unknown) => void
}

/** A running service handle. */
export interface DshPluginServiceHandle {
  /** Stop polling. Idempotent; in-flight replays are awaited. */
  stop(): Promise<void>
}

/** Stable hash of the store document: plain JSON serialization digest. */
function storeHash(store: unknown): string {
  return JSON.stringify(store)
}

/** Console-backed fallback logger (never silent in production, W-02). */
function defaultLogger(): DshPluginServiceLogger {
  return {
    info: (message, extra) => console.log(`[dsh-plugins] ${message}`, extra ?? ""),
    warn: (message, extra) => console.warn(`[dsh-plugins] ${message}`, extra ?? ""),
    error: (message, extra) => console.error(`[dsh-plugins] ${message}`, extra ?? ""),
  }
}

/**
 * The patch stack a hot replay must restore: the FULL boot composition
 * (bundle -> plugin -> user -> extra -> state) with freshly composed plugin
 * rows. `profilePatches` carries the per-profile boot context (bundle layer
 * patches, user patch list, extras, state patches) captured at mount time —
 * these layers are store-independent and stay byte-identical across replays.
 */
export interface DshPluginStackContext {
  /** The profile's bundle layers (from `loadProfile(...).layers`). */
  profileLayers: { patches: unknown[] }[]
  /** The profile's user patch layer (`loadProfile(...).patches`). */
  userPatches: unknown[]
  /** The Bridge's extraPatches for this mount. */
  extraPatches: unknown[]
  /** The state-home patches for this mount. */
  stateHomePatches: unknown[]
}

/**
 * Start watching the plugin store and hot-replaying include patches.
 * Returns immediately; the first tick runs after `intervalMs`.
 */
export function startDshPluginService(options: DshPluginServiceOptions): DshPluginServiceHandle {
  const intervalMs = options.intervalMs ?? 2000
  const containers = options.containers
  const logger = options.logger ?? defaultLogger()
  let lastHash: string | undefined
  let stopped = false
  /** Serialization: a change spotted mid-replay is coalesced into one retry. */
  let replaying = false
  let pendingReplay = false

  const replayContainer = async (container: DshPluginContainer): Promise<void> => {
    const pluginLayers = composePluginLayers(options.home, container.profile)
    // Rebuild the FULL patch stack (B-01): the include re-applies
    // config.patches over the raw config on every update, so replacing the
    // list with plugin rows only would drop the bundle/user/state layers.
    // Boot captured this container's stack context on its handle.
    const stack = (container as { stackContext?: DshPluginStackContext }).stackContext
    const patches = stack
      ? composeFullPatchStack({
          profileLayers: stack.profileLayers,
          pluginLayers,
          userPatches: stack.userPatches,
          extraPatches: stack.extraPatches,
          stateHomePatches: stack.stateHomePatches,
        })
      : [{ insert: pluginLayers }]
    // Shallow-merge contract (spike 2): spread the previous config, replace
    // only `patches`.
    const previousConfig = (container.includeEntry as unknown as {
      options?: { config?: Record<string, unknown> }
    }).options?.config
    const { patches: _prev, ...rest } = previousConfig ?? {}
    await container.includeEntry.update({
      config: { ...rest, patches },
    })
    options.onReplay?.(container.profile)
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    let hash: string | undefined
    try {
      const store = readStore(options.home)
      hash = storeHash(store)
    } catch (error) {
      // A corrupt store mid-write must never crash the watcher: log and skip
      // this tick; the atomic store write means the next tick sees good state.
      logger.warn("plugin store read failed", { error: (error as Error).message })
      return
    }
    if (hash === lastHash) return // short-circuit: nothing changed
    if (replaying) {
      pendingReplay = true
      return
    }
    replaying = true
    try {
      // Heal BEFORE composing: a newly installed plugin needs its
      // profiles/node_modules symlink to exist for the loader's import.
      healPluginsModuleFallback(options.home, readStore(options.home))
      lastHash = hash
      let failed = false
      for (const container of containers) {
        try {
          await replayContainer(container)
        } catch (error) {
          // Keep the last good state for this container; the service and
          // the other containers are unaffected (DESIGN §9.6 #5).
          failed = true
          logger.error("plugin include replay failed; keeping last good state", {
            profile: container.profile,
            hash,
            error: (error as Error).message,
          })
          options.onReplayError?.(container.profile, error)
        }
      }
      if (failed) {
        // A failed replay means the observed store could not be applied;
        // forget the hash so the NEXT tick retries after another change
        // (or the same state, coalesced by pendingReplay below).
        lastHash = undefined
      }
    } finally {
      replaying = false
    }
  }

  const timer = setInterval(() => {
    void tick().then(() => {
      if (pendingReplay && !stopped) {
        pendingReplay = false
        void tick()
      }
    })
  }, intervalMs)
  // Never hold the event loop open just for the watcher.
  if (typeof timer.unref === "function") timer.unref()

  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      // Await at most one in-flight replay so callers observe settled state.
      while (replaying) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
  }
}

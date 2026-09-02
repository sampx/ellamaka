import { readStore } from "./store.js"
import { composePluginLayers, healPluginsModuleFallback } from "./compose.js"

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
 * SHALLOW merge, so each replay spreads the previous config back and
 * replaces `patches` with the fresh composition
 * `[{ insert: [...bundleInsert?] }]`-shaped plugin rows:
 * `entry.update({ config: { ...old, patches: [{ insert: pluginLayers }] } })`.
 * The loader diffs entries by explicit id, so mount/unmount of individual
 * plugins is transactional — add/remove/enable/disable all share this one
 * path.
 *
 * Failure semantics (DESIGN §9.6 #5): a failed replay is logged with
 * structure and the LAST GOOD STATE stays mounted; the service never crashes
 * and replays again on the next store change.
 */

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
}

/** Options for {@link startDshPluginService}. */
export interface DshPluginServiceOptions {
  /** The dsh home (`$WOPAL_HOME/dsh`) whose plugins/ store is watched. */
  home: string
  /** The containers to replay plugin layers into. */
  containers: DshPluginContainer[]
  /** Poll interval in ms; defaults to 2000 (Plan D-02). */
  intervalMs?: number
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

/**
 * Start watching the plugin store and hot-replaying include patches.
 * Returns immediately; the first tick runs after `intervalMs`.
 */
export function startDshPluginService(options: DshPluginServiceOptions): DshPluginServiceHandle {
  const intervalMs = options.intervalMs ?? 2000
  const containers = options.containers
  let lastHash: string | undefined
  let stopped = false
  /** Serialization: a change spotted mid-replay is coalesced into one retry. */
  let replaying = false
  let pendingReplay = false

  const replayContainer = async (container: DshPluginContainer): Promise<void> => {
    const pluginLayers = composePluginLayers(options.home, container.profile)
    // Shallow-merge contract (spike 2): spread the previous config, replace
    // only `patches`. A bare insert patch is id-diffed by the loader.
    const previousConfig = (container.includeEntry as unknown as {
      options?: { config?: Record<string, unknown> }
    }).options?.config
    const { patches: _prev, ...rest } = previousConfig ?? {}
    await container.includeEntry.update({
      config: { ...rest, patches: [{ insert: pluginLayers }] },
    })
    options.onReplay?.(container.profile)
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const store = readStore(options.home)
      const hash = storeHash(store)
      if (hash === lastHash) return // short-circuit: nothing changed
      if (replaying) {
        pendingReplay = true
        return
      }
      replaying = true
      try {
        // Heal BEFORE composing: a newly installed plugin needs its
        // profiles/node_modules symlink to exist for the loader's import.
        healPluginsModuleFallback(options.home, store)
        lastHash = hash
        const failures: Array<{ profile: string; error: unknown }> = []
        for (const container of containers) {
          try {
            await replayContainer(container)
          } catch (error) {
            // Keep the last good state for this container; the service and
            // the other containers are unaffected (DESIGN §9.6 #5).
            failures.push({ profile: container.profile, error })
            options.onReplayError?.(container.profile, error)
          }
        }
        if (failures.length > 0) {
          // A failed replay means the observed store could not be applied;
          // forget the hash so the NEXT tick retries after another change
          // (or the same state, coalesced by pendingReplay below).
          lastHash = undefined
        }
      } finally {
        replaying = false
      }
    } catch {
      // A corrupt store mid-write must never crash the watcher: skip this
      // tick; the atomic store write means the next tick sees a good state.
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

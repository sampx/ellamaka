import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { pluginsDir, readStore, type DshPluginEntry } from "./store.js"

/**
 * Plugin layer composition (DESIGN-dsh-poc §9, D-03/D-04).
 *
 * The store is the ONLY composition source: the boot composition and the hot
 * reload composition are the same function. Boot order is bundle layers ->
 * plugin layers (store order) -> user patch layer -> Bridge extraPatches;
 * the loader diffs entries by id, so add/remove/enable/disable of a plugin
 * all replay through one include `entry.update` with the layers this module
 * composes.
 *
 * Each plugin layer is a patch row `{ id: "dsh-plugin:<name>", name: "<pkg>" }`
 * — the explicit stable id makes the loader's id diff deterministic (the
 * include contract, spike 2 path B), and the bare package name resolves
 * through `profiles/node_modules` (healed by {@link healPluginsModuleFallback}).
 */

/** The install-area directory name this module composes packages from. */
export const PLUGIN_LAYER_DIRNAME = "plugins"

/** The explicit entry-id prefix for plugin layers (loader id diff stability). */
export const PLUGIN_ENTRY_ID_PREFIX = "dsh-plugin:"

/** One plugin patch row as consumed by the root include patches. */
export interface PluginLayerPatch {
  id: string
  name: string
}

/**
 * Compose the plugin patch rows for one profile from the store.
 *
 * Missing/empty store -> no layers (a fresh home boots nothing). Plugins not
 * enabled in the requested profile are skipped. Store order is composition
 * order (install order), which keeps layer diffs append-only across installs.
 */
export function composePluginLayers(dshHome: string, profile: string): PluginLayerPatch[] {
  if (!existsSync(join(dshHome, PLUGIN_LAYER_DIRNAME))) return []
  const store = readStore(dshHome)
  return store.plugins
    .filter((entry) => entry.enabledIn.includes(profile))
    .map((entry) => pluginLayerPatch(entry))
}

/** The patch row for one installed plugin entry. */
export function pluginLayerPatch(entry: DshPluginEntry): PluginLayerPatch {
  return { id: `${PLUGIN_ENTRY_ID_PREFIX}${entry.name}`, name: entry.name }
}

/**
 * The install directory of one plugin entry (`plugins/<name>/<version>/`).
 */
export function pluginPackageDir(dshHome: string, entry: DshPluginEntry): string {
  return join(pluginsDir(dshHome), entry.name, entry.version)
}

/**
 * Maintain the plugin half of the flat module fallback
 * `$DSH_HOME/profiles/node_modules`: one symlink per installed plugin, so a
 * bare package name in a plugin layer resolves through the ordinary
 * Node parent-walk from the profile directory (spike 2: the profiles-anchor
 * require finds `node_modules/<pkg>` beside it).
 *
 * This is self-owned (it does not touch the official
 * `healProfilesModuleFallback`): the official function links the closure's
 * dependency BFS; this one links the user install area. Idempotent — correct
 * links are kept, stale links (reinstalled version) are re-pointed, entries
 * not owned by the store are left alone.
 */
export function healPluginsModuleFallback(dshHome: string, store?: ReturnType<typeof readStore>): void {
  const modulesDir = join(dshHome, "profiles", "node_modules")
  mkdirSync(modulesDir, { recursive: true })
  const entries = (store ?? readStore(dshHome)).plugins
  for (const entry of entries) {
    const target = pluginPackageDir(dshHome, entry)
    const link = join(modulesDir, entry.name)
    if (!existsSync(join(target, "package.json"))) continue // damaged install: skip, mount will fail loud
    mkdirSync(join(modulesDir, ...entry.name.split("/").slice(0, -1)), { recursive: true })
    rePointSymlink(link, target)
  }
}

/** Ensure `link` is a symlink resolving to `target`; re-point when stale. */
function rePointSymlink(link: string, target: string): void {
  let current: string | undefined
  let isLink = false
  try {
    current = realpathSync(link)
    isLink = lstatSync(link).isSymbolicLink()
  } catch {
    current = undefined
  }
  if (current !== undefined) {
    if (isLink && current === target) return // already correct
    if (isLink) {
      // A stale link owned by us (same basename semantics): re-point it.
      rmSync(link, { force: true })
    } else {
      // A real directory/file occupies the name — never delete user data.
      return
    }
  }
  try {
    symlinkSync(target, link, "dir")
  } catch {
    // Lost a race with another healer that just created the same link.
    if (!existsSync(link)) throw new Error(`dsh plugin compose: failed to link ${link} -> ${target}`)
  }
}

/** Read helper re-exported for tests (the store file's raw JSON). */
export function readStoreRaw(dshHome: string): string {
  return readFileSync(join(pluginsDir(dshHome), "installed.json"), "utf-8")
}

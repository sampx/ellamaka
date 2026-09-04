import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { pluginsDir, readStore, type DshPluginEntry } from "./store.js"
import { resolveRowSpecifier } from "./resolve-specifiers.js"

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
 * include contract, spike 2 path B). The bare package name is resolved at the
 * composition point to an absolute `file://` URL (B1 拆雷:
 * {@link composeResolvedPluginLayers}, closure -> profiles order) so the row
 * reaches the Loader final — the fake `loader.internal` injection is gone and
 * profiles-only packages cannot resolve natively.
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
 * The per-container patch-stack context captured at boot: every
 * store-independent layer of the container's composition. The Plugin Runtime
 * Service passes this back to {@link composeFullPatchStack} so a hot replay
 * rebuilds the ENTIRE stack (rook B-01) instead of replacing it with plugin
 * rows only.
 */
export interface DshPluginStackContext {
  /** The profile's bundle layers (`loadProfile(...).layers`). */
  profileLayers: { patches: unknown[] }[]
  /** The composed plugin rows (recomposed fresh on every replay). */
  pluginLayers: PluginLayerPatch[]
  /** The profile's own user patch layer (`cordis.patch.yml` rows). */
  userPatches: unknown[]
  /** The Bridge's extraPatches for this mount. */
  extraPatches: unknown[]
  /** The state-home config injection rows. */
  stateHomePatches: unknown[]
}

/**
 * Composition options carrying the resolution anchors (B1 拆雷).
 */
export interface ComposeLayersOptions {
  /**
   * The install anchor the container's profile loads from (the closure's
   * `@deepseek-ai/dsh/package.json`). Passed through to the specifier
   * resolver; when omitted it falls back to this package's own closure.
   */
  installAnchor?: string
}

/**
 * Compose the plugin patch rows for one profile from the store.
 *
 * Missing/empty store -> no layers (a fresh home boots nothing). Plugins not
 * enabled in the requested profile are skipped. Store order is composition
 * order (install order), which keeps layer diffs append-only across installs.
 *
 * Bare names are resolved HERE, at the composition point, so boot and hot
 * replay share one rewrite and the Loader never sees a bare Bridge-owned
 * name (B1 拆雷). An unresolvable name throws the original resolution error.
 */
export function composePluginLayers(dshHome: string, profile: string, options?: ComposeLayersOptions): PluginLayerPatch[] {
  if (!existsSync(join(dshHome, PLUGIN_LAYER_DIRNAME))) return []
  const store = readStore(dshHome)
  return store.plugins
    .filter((entry) => entry.enabledIn.includes(profile))
    .map((entry) => resolvePluginLayerPatch(entry, dshHome, options?.installAnchor))
}

/** The patch row for one installed plugin entry (bare name, unresolved). */
export function pluginLayerPatch(entry: DshPluginEntry): PluginLayerPatch {
  return { id: `${PLUGIN_ENTRY_ID_PREFIX}${entry.name}`, name: entry.name }
}

/** One resolved patch row: the bare name replaced by its absolute file URL. */
function resolvePluginLayerPatch(entry: DshPluginEntry, dshHome: string, installAnchor?: string): PluginLayerPatch {
  const row = pluginLayerPatch(entry)
  return { ...row, name: resolveRowSpecifier(row.name, { dshHome, installAnchor }) }
}

/**
 * The full patch stack of one container (D-01/D-03): bundle layers ->
 * plugin layers (store order) -> user patch layer -> extra patches -> state
 * home patches. Boot AND hot reload call this ONE function — a hot replay
 * must rebuild the entire stack (not only the plugin rows), because the
 * include re-applies `config.patches` over the raw config on every update and
 * replacing the list would drop the official bundle/user/state rows.
 */
export function composeFullPatchStack(layers: {
  profileLayers: { patches: unknown[] }[]
  pluginLayers: PluginLayerPatch[]
  userPatches: unknown[]
  extraPatches: unknown[]
  stateHomePatches: unknown[]
}): unknown[] {
  return [
    ...layers.profileLayers.flatMap((layer) => layer.patches),
    ...(layers.pluginLayers.length > 0 ? [{ insert: layers.pluginLayers }] : []),
    ...layers.userPatches,
    ...layers.extraPatches,
    ...layers.stateHomePatches,
  ]
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
  } else {
    // realpath failed: either the link does not exist, or it DANGLES (rook
    // B-06: a remove left a link whose target is gone). A dangling entry we
    // own (a symlink whose lstat succeeds but realpath fails) must be
    // replaced, or symlinkSync below would fail EEXIST forever.
    try {
      const stale = lstatSync(link)
      if (stale.isSymbolicLink()) {
        rmSync(link, { force: true })
      } else {
        return // a real file/directory — never delete user data
      }
    } catch {
      // Nothing at the path: fall through to create the link fresh.
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

/**
 * Remove this module's `profiles/node_modules/<name>` link for one plugin.
 * Called by the installer on remove so a later reinstall (any version) never
 * trips over a dangling link (rook B-06). A foreign entry at the path is
 * left alone.
 */
export function removePluginSymlink(dshHome: string, name: string): void {
  const link = join(dshHome, "profiles", "node_modules", ...name.split("/"))
  try {
    if (lstatSync(link).isSymbolicLink()) {
      rmSync(link, { force: true })
    }
  } catch {
    // Nothing there (or unreadable): nothing to clean.
  }
}

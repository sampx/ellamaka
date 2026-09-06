import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readProfileManifest } from "./profile-manifest.js"
import { homeProfilesDirOf } from "../runtime/status.js"
import { resolveRowSpecifier } from "./resolve-specifiers.js"

/**
 * Plugin layer composition (DESIGN-dsh-poc 「真相源与目录布局」, A2 retarget).
 *
 * The profile manifest is the ONLY composition source: the boot composition
 * and the hot reload composition are the same function. Boot order is bundle
 * layers (official, `@deepseek-ai/*`, carried by loadProfile) -> plugin layers
 * (user bundles, composed HERE from the profile `package.json`) -> user patch
 * layer -> Bridge extraPatches -> home patches; the loader diffs entries by
 * id, so add/remove/enable/disable of a plugin all replay through one include
 * `entry.update` with the layers this module composes.
 *
 * Each user plugin layer is the package's own `cordis.patch.yml` patch list —
 * the official bundle-layer semantics (`loadProfile` applies exactly the same
 * file shape for `@deepseek-ai/*` bundles). The package's own insert rows
 * carry the explicit `dsh-plugin:<name>` ids, so the Loader's id diff stays
 * deterministic. The bare package name is resolved at the composition point
 * to an absolute `file://` URL (B1 拆雷: {@link resolveRowSpecifier},
 * closure -> profiles order) so the row reaches the Loader final — the fake
 * `loader.internal` injection is gone and profiles-only packages cannot
 * resolve natively.
 */

/** The explicit entry-id prefix for user plugin rows (loader id diff stability). */
export const PLUGIN_ENTRY_ID_PREFIX = "dsh-plugin:"

/** One user plugin patch row as consumed by the root include patches. */
export interface PluginLayerPatch {
  id: string
  name: string
}

/**
 * The per-container patch-stack context captured at boot: every
 * manifest-independent layer of the container's composition. The Plugin
 * Runtime Service passes this back to {@link composeFullPatchStack} so a hot
 * replay rebuilds the ENTIRE stack (rook B-01) instead of replacing it with
 * plugin rows only.
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
  /** The home config injection rows (official home semantics). */
  homePatches: unknown[]
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

/** The profile directory of one profile name under a territory root. */
export function profileDirOf(dshRoot: string, profile: string): string {
  return join(homeProfilesDirOf(dshRoot), profile)
}

/**
 * Whether a bundle row is official (an in-box `@deepseek-ai/*` package).
 * Official rows are the loadProfile bundle layer — never Bridge-owned.
 */
export function isOfficialBundleRow(name: string): boolean {
  return name.startsWith("@deepseek-ai/")
}

/** One inserted plugin row: the explicit entry id and the package specifier. */
export interface InsertRow {
  id: string
  name: string
}

/**
 * Read ONE patch file's insert rows (the official `cordis.patch.yml`
 * subset). Supports the shapes real dsh bundles ship:
 *   - insert:                      # a patch row keyed `insert:`
 *       - id: dsh-market           #   its item rows carry id + name
 *         name: dshmarket
 *   - id: dsh-plugin:x             # a bare top-level entry row whose
 *     name: x                      #   fields ARE the inserted entry
 * A row the Loader cannot consume is a misconfiguration and throws a named
 * diagnostic (official parsePatchList same stance).
 */
export function readBundleInsertRows(content: string, file: string): InsertRow[] {
  const rows: InsertRow[] = []
  const lines = content.split("\n")
  let index = 0
  while (index < lines.length) {
    const line = lines[index].replace(/\t/g, "  ")
    index++
    if (!line.trim() || line.trim().startsWith("#")) continue
    // An empty patch list (`[]`, the template shape) contributes no rows —
    // the official `parsePatchList` treats it the same way (a top-level empty
    // array mounts nothing). A bundle that ships an empty patch file is valid.
    if (/^\[\s*\]/.test(line.trim())) continue
    if (/^-\s+insert:\s*$/.test(line.trim())) {
      rows.push(...readInsertBlockItems())
      continue
    }
    // A bare top-level entry row: `- id: x` with continuation fields.
    const entryMatch = /^-\s*(?:(id|name):\s*(.*))?\s*$/.exec(line)
    if (entryMatch) {
      const fields: Record<string, string> = {}
      if (entryMatch[1]) fields[entryMatch[1]] = unquote(entryMatch[2] ?? "")
      while (index < lines.length) {
        const raw = lines[index]
        if (!raw.trim() || raw.trim().startsWith("#")) {
          index++
          continue
        }
        const continuation = raw.replace(/\t/g, "  ")
        if (!/^\s/.test(continuation)) break // dedented: next top-level row
        const fieldMatch = /^\s+(id|name):\s*(.*?)\s*$/.exec(continuation)
        if (!fieldMatch) break
        fields[fieldMatch[1]] = unquote(fieldMatch[2])
        index++
      }
      if (fields.id === undefined || fields.name === undefined) {
        throw new Error(`dsh plugin compose: insert row in ${file} needs both "id" and "name"`)
      }
      rows.push({ id: fields.id, name: fields.name })
      continue
    }
    throw new Error(`dsh plugin compose: unsupported patch row in ${file}: ${JSON.stringify(line.trim())}`)
  }
  return rows

  /** Consume the item rows of one `- insert:` block (deeper indented). */
  function readInsertBlockItems(): InsertRow[] {
    const items: { id?: string; name?: string }[] = []
    let current: { id?: string; name?: string } | undefined
    while (index < lines.length) {
      const raw = lines[index]
      if (!raw.trim() || raw.trim().startsWith("#")) {
        index++
        continue
      }
      const line = raw.replace(/\t/g, "  ")
      if (!/^\s/.test(line)) break // dedented: next top-level row
      const itemMatch = /^\s+-\s*(?:(id|name):\s*(.*))?\s*$/.exec(line)
      if (itemMatch) {
        if (itemMatch[1]) {
          // `- id: x` starts a NEW item when a current one is complete.
          if (current && current.id !== undefined && current.name !== undefined) {
            items.push(current)
            current = {}
          }
          if (!current) current = {}
          current[itemMatch[1] as "id" | "name"] = unquote(itemMatch[2] ?? "")
        } else {
          if (!current) current = {}
        }
        index++
        continue
      }
      const fieldMatch = /^\s+(id|name):\s*(.*?)\s*$/.exec(line)
      if (fieldMatch && current) {
        current[fieldMatch[1] as "id" | "name"] = unquote(fieldMatch[2])
        index++
        continue
      }
      // Anything else ends the insert block.
      break
    }
    if (current) items.push(current)
    for (const item of items) {
      if (item.id === undefined || item.name === undefined) {
        throw new Error(`dsh plugin compose: insert row in ${file} needs both "id" and "name"`)
      }
    }
    return items as InsertRow[]
  }
}

/** Strip one pair of matching YAML quotes from a scalar value. */
function unquote(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Load the patch rows of ONE user bundle package: locate the package under
 * the profile node_modules (or via the specifier resolver for closure
 * packages), read its `dsh.bundle.patch` file, and return its insert rows
 * with bare names resolved to absolute file:// URLs.
 *
 * A missing package entity, missing patch declaration, or missing patch file
 * throws a named diagnostic — a bundle row that cannot be applied is a
 * misconfiguration, not "no patches" (official loadProfile same semantics).
 */
function loadUserBundleRows(
  packageName: string,
  dshRoot: string,
  profile: string,
  options?: ComposeLayersOptions,
): InsertRow[] {
  const packageDir = join(profileDirOf(dshRoot, profile), "node_modules", ...packageName.split("/"))
  const manifestPath = join(packageDir, "package.json")
  if (!existsSync(manifestPath)) {
    throw new Error(
      `dsh plugin compose: bundle ${JSON.stringify(packageName)} has no package.json at ${packageDir} (not installed in the profile?)`,
    )
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>
  } catch (error) {
    throw new Error(`dsh plugin compose: failed to parse ${manifestPath}: ${(error as Error).message}`, { cause: error })
  }
  const declared = (manifest.dsh as { bundle?: { patch?: unknown } } | undefined)?.bundle?.patch
  if (typeof declared !== "string" || declared.length === 0) {
    throw new Error(
      `dsh plugin compose: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json at ${packageDir}`,
    )
  }
  const patchPath = join(packageDir, declared)
  if (!existsSync(patchPath)) {
    throw new Error(
      `dsh plugin compose: profile bundle ${JSON.stringify(packageName)} patch file ${patchPath} is missing`,
    )
  }
  const rows = readBundleInsertRows(readFileSync(patchPath, "utf-8"), patchPath)
  return rows.map((row) => {
    // Resolve the row's package specifier. A bare name MUST resolve to the
    // profile's own entity first (the official profile-local install
    // semantics): anchor the parent-walk at the package's own directory
    // inside the profile node_modules — `<profile>/node_modules/<pkg>` finds
    // its siblings and its own subtree natively.
    let name = row.name
    if (!name.startsWith("file://") && !name.startsWith(".") && !name.startsWith("cordis:")) {
      try {
        name = pathToFileURL(createRequire(join(packageDir, "package.json")).resolve(name)).href
      } catch {
        // Fall through to the shared closure -> profiles anchor order.
        name = resolveRowSpecifier(row.name, { dshRoot, installAnchor: options?.installAnchor })
      }
    }
    return { ...row, name }
  })
}

/**
 * Compose the user plugin patch rows for one profile from the profile
 * manifest (the official truth source).
 *
 * Missing/empty manifest -> no layers (a fresh profile boots nothing).
 * Official bundle rows (`@deepseek-ai/*`) are SKIPPED — they are the
 * loadProfile bundle layer and never Bridge-owned. Manifest bundle order is
 * composition order, which keeps layer diffs append-only across installs.
 *
 * Bare names are resolved HERE, at the composition point, so boot and hot
 * replay share one rewrite and the Loader never sees a bare Bridge-owned
 * name (B1 拆雷). An unresolvable name throws the original resolution error.
 */
export function composePluginLayers(dshRoot: string, profile: string, options?: ComposeLayersOptions): PluginLayerPatch[] {
  const manifest = readProfileManifest(profileDirOf(dshRoot, profile))
  const rows: PluginLayerPatch[] = []
  for (const bundleName of manifest.bundles) {
    if (isOfficialBundleRow(bundleName)) continue
    const insertRows = loadUserBundleRows(bundleName, dshRoot, profile, options)
    for (const row of insertRows) {
      rows.push({ id: row.id, name: row.name })
    }
  }
  return rows
}

/**
 * The full patch stack of one container (D-01/D-03): bundle layers ->
 * plugin layers (manifest order) -> user patch layer -> extra patches ->
 * home patches. Boot AND hot reload call this ONE function — a hot replay
 * must rebuild the entire stack (not only the plugin rows), because the
 * include re-applies `config.patches` over the raw config on every update and
 * replacing the list would drop the official bundle/user/home rows.
 */
export function composeFullPatchStack(layers: {
  profileLayers: { patches: unknown[] }[]
  pluginLayers: PluginLayerPatch[]
  userPatches: unknown[]
  extraPatches: unknown[]
  homePatches: unknown[]
}): unknown[] {
  return [
    ...layers.profileLayers.flatMap((layer) => layer.patches),
    ...(layers.pluginLayers.length > 0 ? [{ insert: layers.pluginLayers }] : []),
    ...layers.userPatches,
    ...layers.extraPatches,
    ...layers.homePatches,
  ]
}

/**
 * Maintain the user half of the flat module fallback
 * `$DSH_HOME/profiles/node_modules` (the territory's `home/profiles/node_modules`):
 * one symlink per user-declared plugin package, so a bare package name in a
 * plugin layer resolves through the ordinary Node parent-walk from the
 * profile directory (spike 2: the profiles-anchor require finds
 * `node_modules/<pkg>` beside it).
 *
 * This is self-owned (it does not touch the official
 * `healProfilesModuleFallback`): the official function links the closure's
 * dependency BFS; this one links the profile's declared user packages.
 * Idempotent — correct links are kept, stale links are re-pointed, entries
 * not declared by the manifest are left alone.
 */
export function healPluginsModuleFallback(dshRoot: string): void {
  const modulesDir = join(homeProfilesDirOf(dshRoot), "node_modules")
  mkdirSync(modulesDir, { recursive: true })
  const profilesDir = homeProfilesDirOf(dshRoot)
  const profileNames = existsSync(profilesDir)
    ? readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
        .map((entry) => entry.name)
    : []
  for (const profile of profileNames) {
    const profileDir = join(profilesDir, profile)
    const manifest = readProfileManifest(profileDir)
    for (const packageName of manifest.bundles) {
      if (isOfficialBundleRow(packageName)) continue
      const target = join(profileDir, "node_modules", ...packageName.split("/"))
      const link = join(modulesDir, packageName)
      if (!existsSync(join(target, "package.json"))) continue // damaged install: skip, compose will fail loud
      mkdirSync(join(modulesDir, ...packageName.split("/").slice(0, -1)), { recursive: true })
      rePointSymlink(link, target)
    }
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

/**
 * Remove this module's `profiles/node_modules/<name>` link for one plugin.
 * Called by the installer on remove so a later reinstall (any version) never
 * trips over a dangling link (rook B-06). A foreign entry at the path is
 * left alone.
 */
export function removePluginSymlink(dshRoot: string, name: string): void {
  const link = join(homeProfilesDirOf(dshRoot), "node_modules", ...name.split("/"))
  try {
    if (lstatSync(link).isSymbolicLink()) {
      rmSync(link, { force: true })
    }
  } catch {
    // Nothing there (or unreadable): nothing to clean.
  }
}

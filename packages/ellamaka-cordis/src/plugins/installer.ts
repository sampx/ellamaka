import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import {
  emptyStore,
  PLUGINS_DIR,
  pluginsDir,
  readStore,
  STORE_FILENAME,
  withPluginsLock,
  writeStoreLocked,
  type DshPluginEntry,
} from "./store.js"
import { removePluginSymlink, healPluginsModuleFallback } from "./compose.js"
import { resolveTree, type ResolveSpec, type ResolvedTree } from "./resolver.js"

/**
 * Plugin installer: the install/remove pipeline of the dsh plugin supply
 * chain (DESIGN-dsh-poc §9.4).
 *
 * Registry pipeline: resolveTree → per-package extract into a staging dir
 * (pacote in production via the injectable {@link InstallDeps.extract}) →
 * entry-manifest `dsh.bundle.patch` validation → atomic rename into
 * `plugins/<name>/<version>/` (transitive deps flat under its
 * `node_modules/`) → store entry written (directory first, store second —
 * the watcher only reads the store, so it never sees a half-install).
 *
 * `--dir` pipeline: copy the directory tree into place + store entry. Local
 * directories carry no registry manifest, so no resolution happens.
 *
 * Failure semantics (DESIGN §9.6 #5): any failure before the store write
 * cleans staging and leaves the store untouched; the error propagates with
 * diagnostics.
 */

/** `pacote.extract`-shaped download boundary (production: dynamic import). */
export type ExtractLike = (spec: string, dest: string, opts?: { registry?: string }) => Promise<unknown>

/** Where a package install comes from. */
export type InstallSpec = ResolveSpec

/** Options accepted by {@link installPackage} / {@link removePackage}. */
export interface InstallOptions {
  /**
   * The Ellamaka territory root (`$WOPAL_HOME/dsh`), NOT the DSH home; the
   * plugin install area (`plugins/`) lives under it.
   */
  home: string
  /** Injected extract (production: pacote). Tests inject fakes. */
  extract?: ExtractLike
  /** Injected tree resolver (production: plugins/resolver.ts). */
  resolve?: (spec: InstallSpec) => Promise<ResolvedTree>
  /** Registry for the extract boundary; defaults to npm. */
  registry?: string
  /** The profiles to record in the entry's enabledIn (default: none). */
  enabledIn?: string[]
}

/** Result of a successful {@link installPackage}. */
export interface InstallResult {
  name: string
  version: string
  source: "registry" | "dir"
  /**
   * Whether the package manifest declares `dsh.bundle.patch` — i.e. whether
   * the package is a mountable dsh bundle. A plain library dependency
   * installs fine but cannot mount.
   */
  isBundle: boolean
  /** Present when the package installed but cannot mount (isBundle false). */
  warning?: string
}

/** Same name and version are already installed (DESIGN §9.2: replace manually). */
export class AlreadyInstalledError extends Error {
  constructor(name: string, version: string) {
    super(`dsh plugin installer: ${name}@${version} is already installed (remove it first to replace)`)
    this.name = "AlreadyInstalledError"
  }
}

/** Removal requested for a plugin that is not installed. */
export class NotInstalledError extends Error {
  constructor(name: string) {
    super(`dsh plugin installer: ${name} is not installed`)
    this.name = "NotInstalledError"
  }
}

/**
 * npm package-name rule (simplified but strict): scope/name segments of
 * lowercase URL-safe characters, no leading `.|_|-`, no path separators — a
 * name doubles as a directory name under `plugins/`, so anything else
 * (including `../`) is rejected (rook B-08).
 */
const PACKAGE_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Exact semver (the installer pins one version per install area entry). */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** Validate an untrusted name+version pair from a package manifest. */
export function assertSafePackageIdentity(name: string, version: string): void {
  if (name.length > 214 || !PACKAGE_NAME_RE.test(name)) {
    throw new Error(`dsh plugin installer: unsafe package name ${JSON.stringify(name)} (npm name rules)`)
  }
  if (!SEMVER_RE.test(version)) {
    throw new Error(`dsh plugin installer: unsafe package version ${JSON.stringify(version)} (exact semver required)`)
  }
}

/**
 * Ensure a computed install target stays INSIDE the plugins area — the last
 * line of defence against a crafted manifest escaping the install area with
 * `../` segments (rook B-08).
 */
function assertTargetInsidePluginsArea(pluginsArea: string, target: string): void {
  const area = resolve(pluginsArea)
  const resolvedTarget = resolve(target)
  if (resolvedTarget !== area && !resolvedTarget.startsWith(area + sep)) {
    throw new Error(
      `dsh plugin installer: install target ${resolvedTarget} escapes the plugins area ${area} — refusing`,
    )
  }
}

/** Production extractor: `pacote.extract` (dynamically imported, Bun/Node). */
async function createRealExtract(): Promise<ExtractLike> {
  const { default: pacote } = await import("pacote")
  return (spec, dest, opts) => pacote.extract(spec, dest, { registry: opts?.registry, ignoreScripts: true })
}

/** Read the entry package's manifest from an installed tree. */
function readManifest(pkgDir: string): Record<string, unknown> {
  const manifestPath = join(pkgDir, "package.json")
  if (!existsSync(manifestPath)) {
    throw new Error(`dsh plugin installer: extracted package has no package.json at ${pkgDir}`)
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>
}

/** Whether the manifest declares a mountable dsh bundle patch. */
export function manifestIsBundle(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh as { bundle?: { patch?: string } } | undefined
  return typeof dsh?.bundle?.patch === "string" && dsh.bundle.patch.length > 0
}

/** Official packages never extract into the user install area (DESIGN §9.2). */
function isOfficialPackage(name: string): boolean {
  return name.startsWith("@deepseek-ai/")
}

/** Extract one resolved package into `parent/node_modules/<name>`. */
async function extractPackage(
  pkg: { name: string; version: string; tarball: string },
  parentDir: string,
  extract: ExtractLike,
  registry: string | undefined,
): Promise<void> {
  if (isOfficialPackage(pkg.name)) return // resolved via profiles symlink heal
  const spec = `${pkg.name}@${pkg.version}`
  await extract(spec, parentDir, registry ? { registry } : undefined)
}

/**
 * Install a plugin (registry or local dir) into `home/plugins/` and register
 * it in the store. Holds the cross-process plugins mutex for the whole
 * pipeline; on any failure the staging area is cleaned and the store is
 * untouched.
 */
export async function installPackage(spec: InstallSpec, options: InstallOptions): Promise<InstallResult> {
  return withPluginsLock(options.home, () =>
    spec.kind === "dir" ? installFromDir(spec.path, options) : installFromRegistry(spec, options),
  )
}

/** Read name+version from a package directory's manifest. */
function manifestIdentity(dir: string): { name: string; version: string; manifest: Record<string, unknown> } {
  const manifest = readManifest(dir)
  const name = manifest.name as string | undefined
  const version = manifest.version as string | undefined
  if (typeof name !== "string" || name.length === 0 || typeof version !== "string" || version.length === 0) {
    throw new Error(`dsh plugin installer: package.json at ${dir} lacks name/version`)
  }
  // Untrusted manifest fields become directory path segments — validate
  // BEFORE any path math (rook B-08).
  assertSafePackageIdentity(name, version)
  return { name, version, manifest }
}

/** The `--dir` pipeline: copy + validate + register. */
function installFromDir(path: string, options: InstallOptions): InstallResult {
  if (!existsSync(join(path, "package.json"))) {
    throw new Error(`dsh plugin installer: ${path} has no package.json`)
  }
  const { name, version, manifest } = manifestIdentity(path)
  assertNotInstalled(options.home, name, version)

  const pluginsArea = pluginsDir(options.home)
  const target = join(pluginsArea, name, version)
  assertTargetInsidePluginsArea(pluginsArea, target)
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
  mkdirSync(target, { recursive: true })
  cpSync(path, target, { recursive: true })

  const isBundle = manifestIsBundle(manifest)
  registerStoreEntry(options.home, {
    name,
    version,
    source: "dir",
    enabledIn: [...(options.enabledIn ?? [])],
    installedAt: new Date().toISOString(),
  })
  // Spike-report contract: add must re-run the symlink heal so the freshly
  // installed package resolves immediately (also replaces any dangling link
  // a remove left behind, rook B-06).
  healPluginsModuleFallback(options.home)
  return {
    name,
    version,
    source: "dir",
    isBundle,
    warning: isBundle ? undefined : noBundleWarning(name),
  }
}

/** The registry pipeline: resolve → stage → validate → activate → register. */
async function installFromRegistry(
  spec: { name: string; version?: string },
  options: InstallOptions,
): Promise<InstallResult> {
  const resolve = options.resolve ?? ((s: InstallSpec) => resolveTree(s, { registry: options.registry }))
  const tree = await resolve({ kind: "registry", name: spec.name, version: spec.version })

  const rootId = `${tree.root.name}@${tree.root.version}`
  const rootPkg = tree.packages.get(rootId)
  if (!rootPkg) {
    throw new Error(`dsh plugin installer: resolved tree for ${rootId} is missing its root package`)
  }
  assertNotInstalled(options.home, tree.root.name, tree.root.version)

  const extract = options.extract ?? (await createRealExtract())
  const pluginsArea = pluginsDir(options.home)
  // Untrusted registry manifest fields become path segments — validate before
  // any path math (rook B-08).
  assertSafePackageIdentity(rootPkg.name, rootPkg.version)
  // Staging scene: a sibling of the target area, never inside it (a failed
  // staging must not be resolvable as an install, DESIGN §9.6 #6).
  const staging = mkdtempSync(join(tmpdir(), "dsh-plugins-stage-"))
  try {
    // Extract every package of the tree into the staging parent; pacote
    // materialises each under `<staging>/node_modules/<name>/`.
    for (const pkg of tree.packages.values()) {
      await extractPackage(pkg, staging, extract, options.registry)
    }
    const stagedRoot = join(staging, "node_modules", ...rootPkg.name.split("/"))
    if (!existsSync(join(stagedRoot, "package.json"))) {
      throw new Error(`dsh plugin installer: staged tree missing the entry package at ${stagedRoot}`)
    }
    // Move the entry package into place first (directory first, store last),
    // THEN flatten EVERY non-official package of the tree under
    // `target/node_modules/` (rook B-03): the runtime resolves nested deps by
    // directory parent-walk, so second-level and deeper transitive packages
    // must land inside the entry package's node_modules too — leaving them in
    // staging would drop them at cleanup.
    const target = join(pluginsArea, rootPkg.name, rootPkg.version)
    assertTargetInsidePluginsArea(pluginsArea, target)
    // rename(2) requires the destination PARENT to exist: create
    // `plugins/<name>/` before moving the staged entry package in.
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    renameSync(stagedRoot, target)
    for (const dep of tree.packages.values()) {
      if (dep === rootPkg || isOfficialPackage(dep.name)) continue
      const stagedDep = join(staging, "node_modules", ...dep.name.split("/"))
      if (!existsSync(stagedDep)) continue
      const depTarget = join(target, "node_modules", ...dep.name.split("/"))
      rmSync(depTarget, { recursive: true, force: true })
      mkdirSync(dirname(depTarget), { recursive: true })
      renameSync(stagedDep, depTarget)
    }

    const manifest = readManifest(target)
    const isBundle = manifestIsBundle(manifest)
    registerStoreEntry(options.home, {
      name: rootPkg.name,
      version: rootPkg.version,
      source: "registry",
      enabledIn: [...(options.enabledIn ?? [])],
      installedAt: new Date().toISOString(),
    })
    healPluginsModuleFallback(options.home)
    return {
      name: rootPkg.name,
      version: rootPkg.version,
      source: "registry",
      isBundle,
      warning: isBundle ? undefined : noBundleWarning(rootPkg.name),
    }
  } finally {
    // Staging is always drained: on success the packages were renamed out of
    // it; on failure this removes the partial scene (DESIGN §9.4 失败语义).
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Throw {@link AlreadyInstalledError} when the entry already exists. */
function assertNotInstalled(home: string, name: string, version: string): void {
  const store = readStore(home)
  const hit = store.plugins.find((p) => p.name === name)
  if (hit && hit.version === version) {
    throw new AlreadyInstalledError(name, version)
  }
  // A different version of the same package: the plan's upgrade story is
  // remove + add, so installing over another version is refused with a
  // clear diagnostic rather than silently skewing.
  if (hit) {
    throw new AlreadyInstalledError(name, hit.version)
  }
}

/** Append the entry to the store (caller holds the plugins mutex). */
function registerStoreEntry(home: string, entry: DshPluginEntry): void {
  const store = readStore(home)
  store.plugins = [...store.plugins.filter((p) => p.name !== entry.name), entry]
  writeStoreLocked(home, store)
}

function noBundleWarning(name: string): string {
  return `${name} declares no "dsh.bundle.patch" in its package.json: installed as a plain dependency, but it provides no dsh bundle to mount`
}

/**
 * Remove an installed plugin: delete `plugins/<name>/<version>/` and drop
 * the store entry. Holding the plugins mutex for the whole operation keeps
 * CLI-side writers serialised (DESIGN §9.4 并发).
 */
export async function removePackage(name: string, options: { home: string }): Promise<void> {
  return withPluginsLock(options.home, () => {
    const store = readStore(options.home)
    const entry = store.plugins.find((p) => p.name === name)
    if (!entry) {
      throw new NotInstalledError(name)
    }
    const target = join(pluginsDir(options.home), name)
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
    }
    // Drop the profiles/node_modules link we own: a stale link would dangle
    // and block any later reinstall under the same name (rook B-06).
    removePluginSymlink(options.home, name)
    const next = emptyStore()
    next.plugins = store.plugins.filter((p) => p.name !== name)
    writeStoreLocked(options.home, next)
  })
}

/** List installed plugins from the store (thin re-export for CLI use). */
export function listInstalled(home: string): DshPluginEntry[] {
  return readStore(home).plugins
}

export { PLUGINS_DIR, STORE_FILENAME }

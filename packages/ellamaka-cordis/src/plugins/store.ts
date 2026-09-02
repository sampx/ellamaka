import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireMaterializeLock, releaseMaterializeLock, type LockToken } from "../runtime/lock.js"

/**
 * Plugin store: the single source of truth for installed dsh plugins
 * (DESIGN-dsh-poc §9.2). Every upper layer (installer / runtime service /
 * compose) reads and writes the store only through this module.
 *
 * Layout under the dsh home (`$WOPAL_HOME/dsh`):
 *   plugins/installed.json   — the store document
 *   plugins.lock             — cross-process mutex in `locks/` (CLI writers)
 *
 * Writes are atomic (tmp file + rename) and serialised through the
 * `plugins.lock` guard, so the server-side watcher (which polls the store
 * hash) only ever observes consistent states.
 */

/** The install-area directory name under the dsh home (DESIGN §9.2). */
export const PLUGINS_DIR = "plugins"

/** The store document filename. */
export const STORE_FILENAME = "installed.json"

/** The store schema marker; a foreign schema is a hard validation error. */
export const STORE_SCHEMA = "ellamaka.dsh-plugins/v1"

/** Where the plugin was installed from. */
export type DshPluginSource = "registry" | "dir"

/** One installed-plugin entry in the store. */
export interface DshPluginEntry {
  name: string
  version: string
  source: DshPluginSource
  /** Profile names the plugin is enabled in ("web" | "ellamaka-tools"). */
  enabledIn: string[]
  /** ISO timestamp of the installation moment. */
  installedAt: string
}

/** The installed.json document (version 1). */
export interface DshPluginStoreV1 {
  schema: "ellamaka.dsh-plugins/v1"
  plugins: DshPluginEntry[]
}

/** The plugins directory for a dsh home. */
export function pluginsDir(dshHome: string): string {
  return join(dshHome, PLUGINS_DIR)
}

/** Absolute path of the store file for a dsh home. */
export function storeFile(dshHome: string): string {
  return join(pluginsDir(dshHome), STORE_FILENAME)
}

/** Absolute path of the cross-process plugins mutex (in `locks/`, DESIGN §9.4). */
export function pluginsLockFile(dshHome: string): string {
  return join(dshHome, "locks", "plugins.lock")
}

/**
 * Validate a parsed store document. Throws naming the offending field on any
 * shape violation — a corrupt store must fail loud, never be silently emptied.
 */
export function validateStore(value: unknown): DshPluginStoreV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("dsh plugin store: store document must be an object")
  }
  const doc = value as Record<string, unknown>
  if (doc.schema !== STORE_SCHEMA) {
    throw new Error(`dsh plugin store: unexpected schema ${JSON.stringify(doc.schema)}, expected "${STORE_SCHEMA}"`)
  }
  if (!Array.isArray(doc.plugins)) {
    throw new Error("dsh plugin store: plugins must be an array")
  }
  for (const entry of doc.plugins) {
    validateEntry(entry)
  }
  return doc as unknown as DshPluginStoreV1
}

function validateEntry(entry: unknown): void {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("dsh plugin store: plugin entry must be an object")
  }
  const e = entry as Record<string, unknown>
  const fail = (field: string) => {
    throw new Error(`dsh plugin store: plugin entry field "${field}" is invalid`)
  }
  if (typeof e.name !== "string" || e.name.length === 0) fail("name")
  if (typeof e.version !== "string" || e.version.length === 0) fail("version")
  if (e.source !== "registry" && e.source !== "dir") fail("source")
  if (!Array.isArray(e.enabledIn) || e.enabledIn.some((p) => typeof p !== "string")) fail("enabledIn")
  if (typeof e.installedAt !== "string" || e.installedAt.length === 0) fail("installedAt")
}

/** An empty store document. */
export function emptyStore(): DshPluginStoreV1 {
  return { schema: STORE_SCHEMA, plugins: [] }
}

/**
 * Read the store for a dsh home. A missing file is an empty store; a present
 * but invalid store throws (fail loud, DESIGN §9.6 failure semantics).
 */
export function readStore(dshHome: string): DshPluginStoreV1 {
  const file = storeFile(dshHome)
  if (!existsSync(file)) return emptyStore()
  return validateStore(JSON.parse(readFileSync(file, "utf-8")))
}

/**
 * Atomically write the store (tmp file + rename) while holding the plugins
 * mutex, so concurrent CLI writers serialise and the file-watching runtime
 * only sees consistent documents.
 */
export async function writeStore(dshHome: string, store: DshPluginStoreV1): Promise<void> {
  validateStore(store)
  await withPluginsLock(dshHome, () => {
    writeStoreLocked(dshHome, store)
  })
}

/** Locked atomic write (caller must already hold the plugins mutex). */
export function writeStoreLocked(dshHome: string, store: DshPluginStoreV1): void {
  const dir = pluginsDir(dshHome)
  mkdirSync(dir, { recursive: true })
  // Write to a tmp sibling in the SAME directory, then rename: rename within
  // one filesystem is atomic, so a reader never observes a torn document.
  const tmp = join(dir, `.${STORE_FILENAME}.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf-8")
  try {
    renameSync(tmp, storeFile(dshHome))
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Run `fn` while holding the cross-process plugins mutex. */
export async function withPluginsLock<T>(dshHome: string, fn: () => Promise<T> | T): Promise<T> {
  const lockPath = pluginsLockFile(dshHome)
  const timeoutMs = 30_000
  const token: LockToken | null = await acquireMaterializeLock(lockPath, timeoutMs)
  if (!token) {
    throw new Error(`dsh plugin store: timed out acquiring ${lockPath} after ${timeoutMs}ms`)
  }
  try {
    return await fn()
  } finally {
    await releaseMaterializeLock(lockPath, token)
  }
}

/**
 * Locked read-modify-write. The mutator receives the freshly read store and
 * its return value is passed through; when the mutator throws, the store on
 * disk stays untouched.
 */
export async function updateStore<T>(
  dshHome: string,
  mutate: (store: DshPluginStoreV1) => { result: T; store: DshPluginStoreV1 } | void,
): Promise<T | undefined> {
  return withPluginsLock(dshHome, async () => {
    const store = readStore(dshHome)
    const outcome = mutate(store)
    if (outcome && "store" in outcome) {
      writeStoreLocked(dshHome, outcome.store)
      return outcome.result
    }
    // In-place mutation of the passed store (common case).
    writeStoreLocked(dshHome, store)
    return undefined
  })
}

/**
 * Pure enable/disable: add or remove `profile` from the entry's `enabledIn`.
 * Repeated enable (or disable of an absent profile) is idempotent. Throws for
 * an unknown plugin name.
 */
export function setEnabled(
  store: DshPluginStoreV1,
  name: string,
  profile: string,
  enabled: boolean,
): DshPluginStoreV1 {
  const entry = store.plugins.find((p) => p.name === name)
  if (!entry) {
    throw new Error(`dsh plugin store: plugin "${name}" is not installed`)
  }
  const has = entry.enabledIn.includes(profile)
  if (enabled && !has) entry.enabledIn = [...entry.enabledIn, profile]
  if (!enabled && has) entry.enabledIn = entry.enabledIn.filter((p) => p !== profile)
  return { ...store, plugins: [...store.plugins] }
}

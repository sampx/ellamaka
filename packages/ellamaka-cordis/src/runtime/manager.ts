import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DshRuntimeManifestV1 } from "./manifest.js"
import {
  MATERIALIZE_TIMEOUT_MS,
  closureNameForFingerprint,
  isDshEnabled,
  resolveDshLayout,
  type DshRuntimeStatus,
} from "./status.js"
import { acquireMaterializeLock, releaseMaterializeLock, type LockToken } from "./lock.js"
import {
  checkClosureIntegrity,
  materializeClosure,
  validateClosureOnDisk,
  type ArboristFactory,
} from "./materializer.js"
import { createDshLogger, type LogBridge } from "./log.js"

/**
 * Unified DSH Runtime Manager (DESIGN §3.4.5, 9-step state machine).
 *
 * Every entry (serve/web/TUI/Desktop sidecar) calls {@link initializeDshRuntime}
 * at startup. The manager:
 *   1. Gate    — `ELLAMAKA_DSH=0` → `disabled` with zero filesystem access.
 *   2. Resolve — compute the expected fingerprint and target closure directory.
 *   3. Inspect — verify an existing closure; complete → Load (no network).
 *   4. Lock    — otherwise acquire the cross-process `materialize.lock`;
 *                waiters re-inspect after the holder finishes.
 *   5. Stage   — write manifest+lock to `staging/` and reify with Arborist.
 *   6. Verify  — validate the staged tree (anchor + every direct dependency).
 *   7. Activate— atomically rename staging → `closures/<fingerprint>/`.
 *   8. Profile — create missing profile templates (never overwrite user edits).
 *   9. Load    — resolve the install anchor and report `ready`.
 *
 * Single-flight: concurrent calls in one process share one in-flight promise,
 * so only one reify runs. Multi-process coordination is the file lock.
 * Failures degrade (never overwrite a working closure, no retry this launch).
 */

/** The fetch signature the manager may use for a network probe (tests stub it). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<unknown>

export interface ManagerDeps {
  fetch?: FetchLike
  arborist?: ArboristFactory
}

export interface InitializeDshOptions {
  readonly wopalHome: string
  readonly logFile: string
  readonly entry: "serve" | "web" | "tui"
  readonly manifest: DshRuntimeManifestV1
  readonly deps?: ManagerDeps
  /** For tests: explicit env instead of `process.env`. */
  readonly env?: Record<string, string | undefined>
  /**
   * Hard timeout for the whole materialisation (download + install combined),
   * DESIGN §3.4.4. Defaults to 5 minutes; tests inject a short value.
   */
  readonly timeoutMs?: number
}

/** How long to wait for a concurrently-materialising process to finish. */
const LOCK_WAIT_MS = 10 * 60 * 1000

interface ManagerContext {
  readonly options: InitializeDshOptions
  readonly log: LogBridge
  readonly fingerprint: string
  readonly closureName: string
  readonly closureDir: string
  anchor: string
}

const inFlight = new Map<string, Promise<DshRuntimeStatus>>()

/**
 * Initialize the DSH runtime for this launch. Returns the terminal runtime
 * status: `disabled` | `ready` | `degraded`.
 */
export function initializeDshRuntime(options: InitializeDshOptions): Promise<DshRuntimeStatus> {
  const env = options.env ?? process.env
  const log = createDshLogger({ logFile: options.logFile })
  const fingerprint = options.manifest.fingerprint ?? ""

  // 1. Gate — disabled short-circuits before any filesystem access.
  if (!isDshEnabled(env)) {
    log.info("dsh.init.disabled", { reason: "ELLAMAKA_DSH=0" })
    return Promise.resolve("disabled")
  }
  if (!fingerprint) {
    log.error("dsh.init.degraded", { reason: "manifest has no fingerprint" })
    return Promise.resolve("degraded")
  }

  const key = `${options.wopalHome}::${fingerprint}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const ctx: ManagerContext = {
    options,
    log,
    fingerprint,
    closureName: closureNameForFingerprint(fingerprint),
    closureDir: join(resolveDshLayout(options.wopalHome).closuresDir, closureNameForFingerprint(fingerprint)),
    anchor: join(
      resolveDshLayout(options.wopalHome).closuresDir,
      closureNameForFingerprint(fingerprint),
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "package.json",
    ),
  }

  const promise = run(ctx).catch((error) => {
    // Never crash the host: any unhandled failure degrades.
    ctx.log.error("dsh.init.degraded", { error })
    return "degraded" as DshRuntimeStatus
  })
  inFlight.set(key, promise)
  void promise.finally(() => inFlight.delete(key))
  return promise
}

/** The 9-step state machine body. */
async function run(ctx: ManagerContext): Promise<DshRuntimeStatus> {
  const { log, options } = ctx

  // 2. Resolve — the closure dir is derived from the fingerprint.
  log.info("dsh.stage.resolve", { fingerprint: ctx.fingerprint, closureDir: ctx.closureDir })
  const layout = resolveDshLayout(options.wopalHome)

  // 3. Inspect — fast path: an intact closure loads with zero network.
  let anchor = validateClosureOnDisk({ home: options.wopalHome, manifest: options.manifest, deps: options.deps })
  if (anchor) {
    try {
      await checkClosureIntegrity({ home: options.wopalHome, manifest: options.manifest, deps: options.deps })
    } catch (error) {
      // Damaged closure → treat as missing and re-materialise.
      log.warn("dsh.inspect.integrity", { error })
      anchor = null
    }
  }
  if (anchor) {
    log.info("dsh.stage.inspect", { status: "hit", closureDir: ctx.closureDir })
    return finishReady(ctx)
  }

  // 4. Lock — cross-process mutex; waiters re-inspect after the holder finishes.
  log.info("dsh.stage.lock", { lockFile: layout.lockFile })
  const token = await acquireMaterializeLock(layout.lockFile, LOCK_WAIT_MS)
  if (!token) {
    log.error("dsh.stage.lock.timeout", { lockFile: layout.lockFile })
    return "degraded"
  }
  try {
    // Another process may have materialised while we waited for the lock.
    anchor = validateClosureOnDisk({ home: options.wopalHome, manifest: options.manifest, deps: options.deps })
    if (anchor) {
      await checkClosureIntegrity({ home: options.wopalHome, manifest: options.manifest, deps: options.deps })
      log.info("dsh.stage.inspect", { status: "waiter-hit", closureDir: ctx.closureDir })
      return finishReady(ctx)
    }

    // 5+6+7 — Stage, Verify, Activate under one hard timeout.
    log.info("dsh.stage.stage", { stagingDir: layout.stagingDir })
    const timeoutMs = options.timeoutMs ?? MATERIALIZE_TIMEOUT_MS
    const result = await withTimeout(
      materializeClosure({
        home: options.wopalHome,
        manifest: options.manifest,
        deps: options.deps,
        log,
      }),
      timeoutMs,
      `dsh materialisation timed out after ${Math.round(timeoutMs / 1000)}s`,
    )
    log.info("dsh.stage.verify", { status: "ok", packages: Object.keys(options.manifest.dependencies).length })
    log.info("dsh.stage.activate", { closureDir: result.closureDir })
    ctx.anchor = result.anchor

    // 8. Profile — create missing templates; never overwrite user edits.
    seedProfiles(layout.profileDir, log)

    // 9. Load — the anchor is the installAnchor consumers mount from.
    return finishReady(ctx)
  } catch (error) {
    log.error("dsh.stage.materialise.failed", { error })
    return "degraded"
  } finally {
    await releaseMaterializeLock(layout.lockFile, token)
  }
}

/** Terminal transition to `ready`. */
function finishReady(ctx: ManagerContext): DshRuntimeStatus {
  ctx.log.info("dsh.stage.load", { anchor: ctx.anchor })
  ctx.log.info("dsh.init.ready", { entry: ctx.options.entry })
  return "ready"
}

/**
 * Create missing profile templates (`web` and `ellamaka-tools`) and the
 * profiles/node_modules shortcuts dir. Existing profiles and user patches are
 * never touched (DESIGN §3.4.8 / §3.5).
 */
function seedProfiles(profileDir: string, log: LogBridge): void {
  const bundlesByProfile: Record<string, string[]> = {
    web: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    "ellamaka-tools": ["@deepseek-ai/dsh-base"],
  }
  for (const [name, bundles] of Object.entries(bundlesByProfile)) {
    const dir = join(profileDir, name)
    mkdirSync(dir, { recursive: true })
    const manifestPath = join(dir, "package.json")
    if (!existsSync(manifestPath)) {
      writeFileSync(
        manifestPath,
        JSON.stringify(
          { name: `dsh-profile-${name}`, private: true, dependencies: {}, dsh: { profile: { bundles } } },
          null,
          2,
        ) + "\n",
      )
    }
    const patchPath = join(dir, "cordis.patch.yml")
    if (!existsSync(patchPath)) {
      writeFileSync(
        patchPath,
        `# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; \`!!js\` expressions allowed).\n[]\n`,
      )
    }
  }
  mkdirSync(join(profileDir, "node_modules"), { recursive: true })
  log.info("dsh.stage.profile", { profiles: Object.keys(bundlesByProfile).join(",") })
}

/** Reject a promise after `ms` with the given message (hard timeout). */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Pure path & gating helpers for the DSH Runtime Manager (DESIGN-dsh-poc
 * §3.4.2 / §3.4.4). No I/O: these derive the layout and gate only from their
 * inputs, so they are trivially testable and safe to call before any
 * filesystem work.
 */

/** The one runtime status a manager run can end in. */
export type DshRuntimeStatus = "disabled" | "preparing" | "ready" | "degraded"

/** The resolved install anchor: absolute path to the closure's dsh package.json. */
export interface InstallAnchor {
  path: string
  genId: string
}

/** The immutable directory layout of the single DSH home (DESIGN §3.4.2). */
export interface DshLayout {
  /** `$WOPAL_HOME/dsh` — the single home (never `$DSH_HOME`). */
  readonly dshHome: string
  /** `dsh/closures` — immutable closures named by content fingerprint. */
  readonly closuresDir: string
  /** `dsh/staging` — transient materialisation area (self-managed). */
  readonly stagingDir: string
  /** `dsh/locks` — materialisation mutex directory. */
  readonly locksDir: string
  /** `dsh/locks/materialize.lock` — cross-process materialisation mutex. */
  readonly lockFile: string
  /** `dsh/profiles` — user profiles, preserved across versions. */
  readonly profileDir: string
  /** `dsh/state` — DSH runtime data, preserved across versions. */
  readonly stateDir: string
}

/**
 * Derive the single DSH home layout from `$WOPAL_HOME`. `$DSH_HOME` is never
 * consulted — Ellamaka always uses `$WOPAL_HOME/dsh` (DESIGN §3.4.2).
 */
export function resolveDshLayout(wopalHome: string): DshLayout {
  const dshHome = join(wopalHome, "dsh")
  return {
    dshHome,
    closuresDir: join(dshHome, "closures"),
    stagingDir: join(dshHome, "staging"),
    locksDir: join(dshHome, "locks"),
    lockFile: join(dshHome, "locks", "materialize.lock"),
    profileDir: join(dshHome, "profiles"),
    stateDir: join(dshHome, "state"),
  }
}

/**
 * Gate on `ELLAMAKA_DSH`. Only the exact value `0` disables DSH; unset or any
 * other value enables it (DESIGN §3.4.4).
 */
export function isDshEnabled(env: Record<string, string | undefined>): boolean {
  return env["ELLAMAKA_DSH"] !== "0"
}

/**
 * Closure directory name: the manifest sha256 digest's first 12 hex chars.
 * Same content ⇒ same name ⇒ idempotent hit (DESIGN §3.4.2).
 */
export function closureNameForFingerprint(fingerprint: string): string {
  // fingerprint is "sha256:<64 hex>"
  return fingerprint.slice("sha256:".length, "sha256:".length + 12)
}

/**
 * Resolve the install anchor for a manifest's target closure: the absolute
 * path to `@deepseek-ai/dsh/package.json` under `closures/<genId>/`, matching
 * the exact layout the runtime manager materialises (DESIGN §3.4.6). Entries
 * that mount the bridge pass this anchor into `createDshRuntimeApi` /
 * `mountDshWeb` / `mountDshTools` after the manager reports `ready`.
 *
 * @throws when the manifest has no fingerprint (nothing to anchor against).
 */
export function resolveInstallAnchor(
  wopalHome: string,
  manifest: { fingerprint?: string },
): InstallAnchor {
  const fingerprint = manifest.fingerprint
  if (!fingerprint) {
    throw new Error("dsh runtime: cannot resolve install anchor without a manifest fingerprint")
  }
  const closureName = closureNameForFingerprint(fingerprint)
  return {
    path: join(
      resolveDshLayout(wopalHome).closuresDir,
      closureName,
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "package.json",
    ),
    genId: closureName,
  }
}

/**
 * The npm content-addressed cache used by Arborist for cross-closure reuse
 * (`~/.npm/_cacache`, DESIGN §3.4.7). Interrupted retries fill only gaps.
 */
export function expandCacheDir(): string {
  return join(homedir(), ".npm", "_cacache")
}

/** Hard timeout for a whole materialisation (download + install combined). */
export const MATERIALIZE_TIMEOUT_MS = 5 * 60 * 1000

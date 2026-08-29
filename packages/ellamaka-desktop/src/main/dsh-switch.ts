import { join } from "node:path"

/**
 * dsh kill-switch, unified with `Flag.ELLAMAKA_DSH` in `@opencode-ai/core`
 * (DESIGN-dsh-poc §3.4, constraint #11). Default ON: `ELLAMAKA_DSH=0`
 * disables dsh; unset or any non-"0" value enables. The desktop package does
 * not depend on `@opencode-ai/core`, so this mirrors the core getter exactly
 * rather than importing it.
 *
 * Extracted to its own module so tests can exercise the pure helpers without
 * triggering the sidecar's top-level `getParentPort()` side effect.
 */
export function isDshEnabled(): boolean {
  return process.env.ELLAMAKA_DSH?.toLowerCase() !== "0"
}

/**
 * The dsh closure home and its install anchor. Ellamaka integration always
 * uses `$WOPAL_HOME/dsh` — never `$DSH_HOME`.
 */
export function dshPaths(wopalHome: string): { dshHome: string; anchor: string } {
  const dshHome = join(wopalHome, "dsh")
  return { dshHome, anchor: join(dshHome, "node_modules", "@deepseek-ai", "dsh", "package.json") }
}

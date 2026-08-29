import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

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

/**
 * The materialise-dsh script shipped with the opencode package, in the source
 * tree (dev) and source-tree builds. The sidecar reuses the exact arborist
 * materialisation logic from Task 3 (`packages/opencode/script/materialize-dsh.ts`)
 * by running it as a subprocess.
 */
export function defaultMaterializeScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "script", "materialize-dsh.ts")
}

/**
 * Runtime fallback (DESIGN-dsh-poc §3.4): when onboarding is skipped, the
 * dsh closure may be absent. Self-materialise it by running the arborist
 * materialise script as a `bun` subprocess, then confirm the install anchor
 * now exists. Returns whether the closure is present afterwards.
 *
 * Degrades to `false` (caller skips dsh and warns) when the script is not
 * available or bun is missing — the packaged desktop normally relies on the
 * wopal-cli having pre-installed, so this path is a rare safety net.
 */
export async function materializeDshClosure(
  wopalHome: string,
  options: { scriptPath?: string } = {},
): Promise<boolean> {
  const { anchor } = dshPaths(wopalHome)
  if (existsSync(anchor)) return true

  const scriptPath = options.scriptPath ?? defaultMaterializeScriptPath()
  if (!existsSync(scriptPath)) return false

  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn("bun", [scriptPath], {
      cwd: join(wopalHome, ".."),
      env: { ...process.env, WOPAL_HOME: wopalHome },
      stdio: "ignore",
    })
    proc.on("error", () => resolve(1))
    proc.on("close", (code) => resolve(code ?? 1))
  })
  return exitCode === 0 && existsSync(anchor)
}

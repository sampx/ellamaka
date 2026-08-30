/**
 * DSH test fixture: seed a complete closure under a temp `$WOPAL_HOME` so the
 * unified Runtime Manager's fast path hits and `createDshRuntimeApi` resolves
 * the six official `@deepseek-ai/*` modules from it.
 *
 * The closure mirrors what the real materialiser produces (DESIGN-dsh-poc
 * §3.4.5): `closures/<fingerprint>/` with `package.json`, `package-lock.json`,
 * `runtime-manifest.json` and a `node_modules/@deepseek-ai` tree. Instead of
 * running arborist against the network, the `@deepseek-ai` tree is a symlink to
 * the real installed packages under `@wopal/ellamaka-cordis`'s own
 * `node_modules` — the bridge's loader and profile resolution realpath the
 * anchor, so the full installed closure (including the store-hoisted plugin
 * tree the profile bundles need) stays reachable.
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  DEFAULT_DSH_RUNTIME_MANIFEST,
  closureLockJson,
  resolveInstallAnchor,
} from "@wopal/ellamaka-cordis/runtime"

/** The real `@deepseek-ai/*` tree shipped with the cordis package. */
const CORDIS_DEEPSEEK_AI_DIR = join(
  dirname(require.resolve("@wopal/ellamaka-cordis/package.json")),
  "node_modules",
  "@deepseek-ai",
)

/**
 * Seed a complete real closure for the default manifest's fingerprint under a
 * temp `wopalHome`. Returns the install anchor path.
 */
export function seedDshClosure(wopalHome: string): string {
  const manifest = DEFAULT_DSH_RUNTIME_MANIFEST
  const anchor = resolveInstallAnchor(wopalHome, manifest)
  const closureDir = join(wopalHome, "dsh", "closures", anchor.genId)
  const nodeModules = join(closureDir, "node_modules")
  mkdirSync(nodeModules, { recursive: true })
  symlinkSync(CORDIS_DEEPSEEK_AI_DIR, join(nodeModules, "@deepseek-ai"), "dir")
  writeFileSync(
    join(closureDir, "package.json"),
    JSON.stringify({ name: "ellamaka-dsh-closure", dependencies: manifest.dependencies }),
  )
  // The stored lock must be the canonical npm v3 lock derived from the manifest
  // (B-03 binding), matching what the real materialiser writes, so the fast
  // path hits and no network reify is triggered.
  writeFileSync(join(closureDir, "package-lock.json"), closureLockJson(manifest))
  writeFileSync(join(closureDir, "runtime-manifest.json"), JSON.stringify(manifest))
  return anchor.path
}

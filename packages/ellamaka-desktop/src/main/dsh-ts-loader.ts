/**
 * Node module-loader hook that maps `.js` relative imports to `.ts` sources for
 * the dsh closure's `@wopal/ellamaka-cordis` package.
 *
 * The dsh closure ships `@wopal/ellamaka-cordis` as a `file:` dependency whose
 * `exports` point at `.ts` sources (e.g. `./dsh-web` → `./src/dsh-web.ts`).
 * When the sidecar imports `dsh-web` from the materialised closure, Node's
 * `--experimental-strip-types` resolves the package's internal relative imports
 * (e.g. `./log-bridge.js`, `./dsh-virtual-webserver.js`) as `.js` — but only
 * `.ts` files exist. This hook rewrites those `.js` specifiers to `.ts` so the
 * closure loads.
 *
 * The parent URL may be:
 *   - the workspace source (`packages/ellamaka-cordis`),
 *   - the materialised `node_modules/@wopal/ellamaka-cordis` copy, or
 *   - the bundled resource `dsh-materialize/cordis` (arborist symlinks the
 *     external `file:` dependency to the real resource path, so the parent URL
 *     is the resource dir, not a node_modules path).
 *
 * Extracted to its own module so tests can exercise the hook directly without
 * triggering the sidecar's top-level `getParentPort()` side effect.
 */
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const CORDIS_PATH_MARKERS = [
  "/plugins/",
  "/skills/",
  "packages/ellamaka-cordis",
  "node_modules/@wopal/ellamaka-cordis",
  "dsh-materialize/cordis",
]

export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (specifier: string, context: unknown) => Promise<{ url: string }>,
): Promise<{ url: string }> {
  if (
    specifier.endsWith(".js") &&
    (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file://"))
  ) {
    const parentURL = context.parentURL
    if (parentURL && CORDIS_PATH_MARKERS.some((marker) => parentURL.includes(marker))) {
      const candidateURL = specifier.startsWith("file://") ? specifier : new URL(specifier, parentURL).href
      const candidatePath = fileURLToPath(candidateURL)
      if (!existsSync(candidatePath)) {
        const tsPath = candidatePath.slice(0, -3) + ".ts"
        if (existsSync(tsPath)) {
          // Pass the .ts URL to nextResolve so Node.js native
          // --experimental-strip-types applies correctly.
          return nextResolve(pathToFileURL(tsPath).href, context)
        }
      }
    }
  }
  return nextResolve(specifier, context)
}

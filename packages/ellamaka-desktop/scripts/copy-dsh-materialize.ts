#!/usr/bin/env bun
/**
 * Copy the `@wopal/ellamaka-cordis` package into `resources/dsh-materialize/cordis/`
 * so the packaged Desktop sidecar's dsh runtime fallback (B-01) can reference it
 * as a `file:` dependency in the closure manifest without a workspace source path.
 *
 * The cordis package is a workspace source package (not published to npm yet, P9),
 * so the bundled resource is the only portable source a packaged app can reach.
 *
 * The resource is made SELF-CONTAINED: after copying package.json + src/, its
 * @deepseek-ai/* deps are installed into the resource's own node_modules via
 * `bun install`. Arborist symlinks the external `file:` dependency to this
 * resource (installLinks:false), and Node dereferences the symlink to the
 * resource path — which is OUTSIDE node_modules, so --experimental-strip-types
 * applies. The resource must therefore resolve its own bare deps from its own
 * node_modules, not the closure's.
 */
import { $ } from "bun"
import { cpSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolve } from "node:path"

const resourcesDir = resolve(import.meta.dir, "..", "resources")
const target = join(resourcesDir, "dsh-materialize", "cordis")
const cordisSource = resolve(import.meta.dir, "..", "..", "ellamaka-cordis")

if (!existsSync(cordisSource)) {
  console.warn(`[copy-dsh-materialize] @wopal/ellamaka-cordis source not found at ${cordisSource}; skipping`)
  process.exit(0)
}

// Copy the package.json + src/ + the packages it ships (dsh-web, log-bridge,
// VirtualWebServer etc. all live under src/).
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const entry of ["package.json", "src"]) {
  const from = join(cordisSource, entry)
  if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true })
}

// Strip the `catalog:` peer/dev dependencies (only resolvable inside the
// workspace) so `bun install` can install the resource's runtime deps standalone.
const pkgPath = join(target, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
delete pkg.peerDependencies
delete pkg.devDependencies
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

// Install the resource's @deepseek-ai/* deps into its own node_modules so the
// symlinked resource is self-contained.
await $`bun install --cwd ${target} --production`
console.log(`[copy-dsh-materialize] copied cordis → ${target}`)

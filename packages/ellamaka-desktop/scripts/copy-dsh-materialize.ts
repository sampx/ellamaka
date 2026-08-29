#!/usr/bin/env bun
/**
 * Copy the `@wopal/ellamaka-cordis` package into `resources/dsh-materialize/cordis/`
 * so the packaged Desktop sidecar's dsh runtime fallback (B-01) can reference it
 * as a `file:` dependency in the closure manifest without a workspace source path.
 *
 * The cordis package is a workspace source package (not published to npm yet, P9),
 * so the bundled resource is the only portable source a packaged app can reach.
 */
import { $ } from "bun"
import { cpSync, rmSync, existsSync, mkdirSync } from "node:fs"
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
// VirtualWebServer etc. all live under src/). The closure's arborist install
// resolves the cordis deps (the @deepseek-ai/* packages) from npm, so only the
// cordis package body itself needs to be present here.
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const entry of ["package.json", "src"]) {
  const from = join(cordisSource, entry)
  if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true })
}
console.log(`[copy-dsh-materialize] copied cordis → ${target}`)

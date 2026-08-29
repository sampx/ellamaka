/**
 * Portable dsh closure materialiser for the Desktop sidecar (B-01 fix).
 *
 * Runs the dsh-closure materialisation **in-process** in the sidecar using
 * `@npmcli/arborist` (a Desktop dependency, shipped in the packaged app's
 * node_modules) — no source-tree path, no system `bun`. This is the runtime
 * fallback (DESIGN-dsh-poc §3.4): when onboarding was skipped and the closure
 * is absent, the sidecar materialises it itself.
 *
 * The 7 `@deepseek-ai/*` packages come from npm. `@wopal/ellamaka-cordis` is a
 * workspace package that is not published yet (P9), so it is referenced as a
 * `file:` dependency resolved portably:
 *   - dev: the workspace `packages/ellamaka-cordis` directory
 *   - packaged: the bundled copy under `resources/dsh-materialize/cordis`
 *     (copied by the prebuild script and shipped via electron-builder files).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

/** The 7 dsh packages the `@wopal/ellamaka-cordis` source imports. */
const DSH_PACKAGES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/cordis",
  "@deepseek-ai/cordis-plugin-loader",
  "@deepseek-ai/dsh-app-boot",
  "@deepseek-ai/dsh-cmdline",
  "@deepseek-ai/dsh-home-paths",
  "@deepseek-ai/dsh-launch-environment",
] as const

const CORDIS_PACKAGE = "@wopal/ellamaka-cordis"
const DSH_VERSION = "0.1.1-rc.2"
const CORDIS_VERSION = "4.0.1"
const LOADER_VERSION = "1.0.2"
const PROFILES = ["web", "ellamaka-tools"] as const

/**
 * Locate the `@wopal/ellamaka-cordis` package directory for the manifest's
 * `file:` dependency. Prefers the bundled resource (packaged) over the
 * workspace source (dev). Exported for tests.
 */
export function resolveCordisDir(): string {
  // Packaged: the prebuild copies cordis into resources/dsh-materialize/cordis,
  // shipped via electron-builder's `resources/**/*` files glob. Resolve via
  // Electron's resourcesPath when running inside the app; fall back to the
  // source-tree resources dir when running from a source checkout.
  const here = dirname(fileURLToPath(import.meta.url)) // <pkg>/src/main or <pkg>/out/main
  const resourcesRoot =
    (process as { resourcesPath?: string }).resourcesPath ??
    join(here, "..", "..", "resources")
  const bundled = join(resourcesRoot, "dsh-materialize", "cordis")
  if (existsSync(bundled)) return bundled
  // Dev workspace: <pkg>/../ellamaka-cordis (packages/ellamaka-cordis).
  return join(here, "..", "..", "..", "ellamaka-cordis")
}

/** Resolve the closure home: always `$WOPAL_HOME/dsh` (never `$DSH_HOME`). */
function resolveDshHome(wopalHome: string): string {
  return join(wopalHome, "dsh")
}

/** Build the closure package.json manifest. */
function buildManifest(home: string): Record<string, unknown> {
  return {
    name: "ellamaka-dsh-closure",
    private: true,
    type: "module",
    dependencies: {
      [DSH_PACKAGES[0]]: DSH_VERSION,
      [DSH_PACKAGES[1]]: CORDIS_VERSION,
      [DSH_PACKAGES[2]]: LOADER_VERSION,
      [DSH_PACKAGES[3]]: DSH_VERSION,
      [DSH_PACKAGES[4]]: DSH_VERSION,
      [DSH_PACKAGES[5]]: DSH_VERSION,
      [DSH_PACKAGES[6]]: DSH_VERSION,
      [CORDIS_PACKAGE]: `file:${resolveCordisDir()}`,
    },
  }
}

/** Write the closure package.json (idempotent: same content is a no-op). */
function writeManifest(home: string): void {
  const manifestPath = join(home, "package.json")
  const manifest = buildManifest(home)
  const next = JSON.stringify(manifest, null, 2) + "\n"
  if (existsSync(manifestPath) && readFileSync(manifestPath, "utf-8") === next) return
  mkdirSync(home, { recursive: true })
  writeFileSync(manifestPath, next)
}

type ArboristInstance = { reify(opts?: Record<string, unknown>): Promise<unknown> }
type ArboristCtor = new (opts: Record<string, unknown>) => ArboristInstance

/**
 * Reify the closure dependency tree with `@npmcli/arborist` (the same engine
 * `Npm.install` and the opencode materialise script use). Arborist is a Desktop
 * dependency, so it resolves from the shipped node_modules in the packaged app.
 */
async function install(home: string): Promise<void> {
  const Arborist = require("@npmcli/arborist").Arborist as ArboristCtor
  const arborist = new Arborist({
    path: home,
    binLinks: false,
    progress: false,
    ignoreScripts: true,
    savePrefix: "",
    // Keep the default installLinks:false so the external `file:` dependency
    // (@wopal/ellamaka-cordis) is SYMLINKED to the bundled resource. The
    // resource is self-contained (copy-dsh-materialize.ts ships its own
    // node_modules with the @deepseek-ai/* deps), and Node resolves the symlink
    // to the resource path — which is OUTSIDE node_modules, so
    // --experimental-strip-types applies. A real copy under node_modules would
    // hit ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
  })
  await arborist.reify({ save: false, saveType: "prod" })
}

/** Pre-seed a profile template (manifest + empty patch layer). */
function seedProfile(home: string, name: string): void {
  const dir = join(home, "profiles", name)
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, "package.json")
  if (!existsSync(manifestPath)) {
    const bundles = name === "web" ? ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] : ["@deepseek-ai/dsh-base"]
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
      `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`,
    )
  }
}

/**
 * Materialise the dsh closure at `$WOPAL_HOME/dsh`. Idempotent: skips the
 * arborist install when the `@deepseek-ai/dsh` anchor already exists.
 * Returns true when the closure is present afterwards. `deps.install` is an
 * injectable install seam for tests; production uses the real arborist install.
 */
export async function materializeDshClosure(
  wopalHome: string,
  deps: { install?: (home: string) => Promise<void> } = {},
): Promise<boolean> {
  const home = resolveDshHome(wopalHome)
  const anchor = join(home, "node_modules", "@deepseek-ai", "dsh", "package.json")
  if (existsSync(anchor)) return true

  writeManifest(home)
  try {
    await (deps.install ?? install)(home)
    for (const name of PROFILES) seedProfile(home, name)
  } catch (error) {
    console.warn("ellamaka sidecar: dsh self-materialise failed", error)
    return false
  }
  return existsSync(anchor)
}

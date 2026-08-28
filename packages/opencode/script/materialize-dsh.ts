/**
 * Materialise the DSH home closure at `$WOPAL_HOME/dsh`.
 *
 * The DSH home is the single location where the dsh dependency closure and
 * the two profiles live (DESIGN-dsh-poc §2.2). Ellamaka integration always
 * uses `$WOPAL_HOME/dsh` — never `$DSH_HOME`. This script:
 *
 *   1. writes the closure `package.json` — the 7 `@deepseek-ai/*` packages the
 *      `@wopal/ellamaka-cordis` source actually imports, plus
 *      `@wopal/ellamaka-cordis` as a `file:` dependency pointing at the
 *      workspace (dev period; P9 removes the link once the package is
 *      published to npm).
 *   2. runs `bun install` to materialise the top-level flat dependency tree.
 *   3. pre-seeds the `profiles/web` and `profiles/ellamaka-tools` profile
 *      templates (manifest + empty patch layer). The patch layer stays empty
 *      here — the mount code seeds the tool-container disable list on first
 *      mount (DESIGN-dsh-poc §2.3), so user edits are never overwritten.
 *   4. verifies the `@deepseek-ai/dsh` anchor exists at the top level and that
 *      Node `--experimental-strip-types` can import `@wopal/ellamaka-cordis/dsh-web`
 *      through the same resolver the desktop sidecar uses.
 *
 * The script is idempotent: re-running never overwrites an existing profile
 * manifest or patch layer, and `bun install` is a no-op when the tree is
 * already materialised.
 *
 * Usage:
 *   bun script/materialize-dsh.ts            # materialise
 *   bun script/materialize-dsh.ts --verify   # verify only (no install)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

/** The 7 dsh packages `@wopal/ellamaka-cordis` source imports (DESIGN §2.2). */
const DSH_PACKAGES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/cordis",
  "@deepseek-ai/cordis-plugin-loader",
  "@deepseek-ai/dsh-app-boot",
  "@deepseek-ai/dsh-cmdline",
  "@deepseek-ai/dsh-home-paths",
  "@deepseek-ai/dsh-launch-environment",
] as const

/** The `@wopal/ellamaka-cordis` package name. */
const CORDIS_PACKAGE = "@wopal/ellamaka-cordis"

/** The dsh package versions, pinned to the same rc the workspace uses. */
const DSH_VERSION = "0.1.1-rc.2"
const CORDIS_VERSION = "4.0.1"
const LOADER_VERSION = "1.0.2"

/** The two profile names the closure pre-seeds. */
const PROFILES = ["web", "ellamaka-tools"] as const

/** Resolve the DSH home: always `$WOPAL_HOME/dsh` (never `$DSH_HOME`). */
function resolveDshHome(): string {
  return join(process.env.WOPAL_HOME ?? join(homedir(), ".wopal"), "dsh")
}

/** Resolve the workspace root (the repo root, parent of `packages/`). */
function resolveWorkspaceRoot(): string {
  return join(import.meta.dir, "..", "..", "..")
}

/** The absolute path of the `@wopal/ellamaka-cordis` package in the workspace. */
function resolveCordisDir(): string {
  return join(resolveWorkspaceRoot(), "packages", "ellamaka-cordis")
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

/**
 * Run `bun install` in the closure home to materialise the flat tree.
 *
 * `--production` skips the `@wopal/ellamaka-cordis` devDependencies, whose
 * `catalog:` version references only resolve inside the workspace root — a
 * standalone closure cannot resolve them. The closure only needs the runtime
 * dependency tree, so production mode is the correct install.
 */
async function install(home: string): Promise<void> {
  const proc = Bun.spawn(["bun", "install", "--production"], {
    cwd: home,
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`bun install failed in ${home} (exit ${code})`)
}

/** Pre-seed a profile template (manifest + empty patch layer). */
function seedProfile(home: string, name: string): void {
  const dir = join(home, "profiles", name)
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, "package.json")
  if (!existsSync(manifestPath)) {
    const bundles = name === "web" ? ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] : ["@deepseek-ai/dsh-base"]
    const manifest = {
      name: `dsh-profile-${name}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles } },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  }
  // The patch layer stays empty here; the mount code seeds the tool-container
  // disable list on first mount (DESIGN-dsh-poc §2.3). Never overwrite.
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

/** Verify the anchor exists and Node strip-types can import dsh-web. */
async function verify(home: string): Promise<void> {
  const anchor = join(home, "node_modules", "@deepseek-ai", "dsh", "package.json")
  if (!existsSync(anchor)) {
    throw new Error(`anchor missing: ${anchor}`)
  }
  // Resolve @wopal/ellamaka-cordis/dsh-web from the closure's node_modules,
  // exactly as the desktop sidecar does (createRequire anchored at the closure
  // package.json). Then import it under Node --experimental-strip-types with
  // the SAME module loader override the sidecar registers (packages/ellamaka-cordis
  // `.js` relative imports resolve to `.ts`), proving the sidecar's resolver
  // can load the dsh-web entry from the materialised closure.
  const requireFromClosure = createRequire(join(home, "package.json"))
  const dshWebEntry = requireFromClosure.resolve(`${CORDIS_PACKAGE}/dsh-web`)
  // The sidecar registers its `.js`→`.ts` loader override by calling
  // `register()` from `node:module` at module top (packages/ellamaka-desktop/
  // src/main/sidecar.ts). Mirror that exactly: a bootstrap module that calls
  // `register()` with the same loader code, loaded via `--import` before the
  // dsh-web entry is imported.
  const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file://"))) {
    const parentURL = context.parentURL;
    if (parentURL && (parentURL.includes("/plugins/") || parentURL.includes("/skills/") || parentURL.includes("packages/ellamaka-cordis"))) {
      let candidateURL = specifier.startsWith("file://") ? specifier : new URL(specifier, parentURL).href;
      const candidatePath = fileURLToPath(candidateURL);
      if (!existsSync(candidatePath)) {
        const tsPath = candidatePath.slice(0, -3) + ".ts";
        if (existsSync(tsPath)) {
          return nextResolve(pathToFileURL(tsPath).href, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
`
  const bootstrap = `
import { register } from "node:module";
const loaderCode = ${JSON.stringify(loaderCode)};
register("data:text/javascript;base64," + Buffer.from(loaderCode).toString("base64"), import.meta.url);
`
  const bootstrapB64 = Buffer.from(bootstrap).toString("base64")
  const proc = Bun.spawn(
    [
      "node",
      "--experimental-strip-types",
      "--import",
      `data:text/javascript;base64,${bootstrapB64}`,
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(pathToFileURL(dshWebEntry).href)}).then((m) => { if (typeof m.bootDshWeb !== "function") throw new Error("bootDshWeb missing"); console.log("dsh-web import ok") }).catch((e) => { console.error(e); process.exit(1) })`,
    ],
    { stdout: "inherit", stderr: "inherit", env: Bun.env },
  )
  const code = await proc.exited
  if (code !== 0) throw new Error(`Node strip-types import of dsh-web failed (exit ${code})`)
}

async function main(): Promise<void> {
  const home = resolveDshHome()
  const verifyOnly = process.argv.includes("--verify")

  if (!verifyOnly) {
    writeManifest(home)
    await install(home)
    for (const name of PROFILES) seedProfile(home, name)
  }

  await verify(home)
  console.log("materialization ok")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { materializeClosure } from "./materializer"
import { resolveDshLayout } from "./status"
import { computeManifestFingerprint, type DshRuntimeManifestV1 } from "./manifest"

const dirs: string[] = []

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-reify-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Build a real package tarball with `npm pack` into `outDir` and return the
 * tarball's absolute path. Used to seed an OFFLINE fixture: the closure reifies
 * from local `file:` tarballs, never the network (W-03).
 */
function makeTarball(root: string, name: string, version: string): string {
  const pkgDir = join(root, `pkg-${name.replace(/[^a-z0-9]/gi, "-")}`)
  mkdirSync(join(pkgDir, "lib"), { recursive: true })
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version, main: "lib/index.js" }, null, 2),
  )
  writeFileSync(join(pkgDir, "lib", "index.js"), `module.exports = { name: ${JSON.stringify(name)} }`)
  const outDir = join(root, "tarballs")
  mkdirSync(outDir, { recursive: true })
  // npm pack --json prints the packed filename; use it to locate the tarball.
  const out = execFileSync("npm", ["pack", "--json", "--pack-destination", outDir], {
    cwd: pkgDir,
    encoding: "utf8",
  })
  const json = JSON.parse(out) as { filename: string }[]
  return join(outDir, json[0].filename)
}

describe("W-03: real Arborist reify against a local offline fixture", () => {
  test(
    "materializeClosure reifies with the REAL arborist from local file: tarballs (no network)",
    async () => {
      const home = tmpHome()
      const fixture = join(home, "fixture")
      mkdirSync(fixture, { recursive: true })

      // Build two real tarballs: the dsh anchor and a dependency.
      const dshTarball = makeTarball(fixture, "@deepseek-ai/dsh", "1.0.0-reify")
      const cordisTarball = makeTarball(fixture, "@deepseek-ai/cordis", "4.0.1")

      // A manifest whose direct deps resolve to the LOCAL tarballs via
      // dependencySpecs — the real arborist reifies from disk, proving the
      // whole pipeline works without any network registry.
      const manifest: DshRuntimeManifestV1 = {
        schema: "ellamaka.dsh-runtime/v1",
        bridgeAbi: 1,
        dependencies: {
          "@deepseek-ai/dsh": "1.0.0-reify",
          "@deepseek-ai/cordis": "4.0.1",
        },
      }
      manifest.fingerprint = computeManifestFingerprint(manifest)

      // Omit deps.arborist so materializeClosure uses the REAL production
      // arborist factory (no fake injected). Point the direct deps at the
      // local tarballs so nothing touches the network.
      const result = await materializeClosure({
        home,
        manifest,
        deps: {
          registry: "file:",
          dependencySpecs: {
            "@deepseek-ai/dsh": `file:${dshTarball}`,
            "@deepseek-ai/cordis": `file:${cordisTarball}`,
          },
        },
      })

      const closureDir = result.closureDir
      expect(existsSync(closureDir)).toBe(true)
      const dshPkg = JSON.parse(
        readFileSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
      )
      expect(dshPkg.version).toBe("1.0.0-reify")
      const cordisPkg = JSON.parse(
        readFileSync(join(closureDir, "node_modules", "@deepseek-ai", "cordis", "package.json"), "utf8"),
      )
      expect(cordisPkg.version).toBe("4.0.1")
      // staging is drained after activation.
      expect(existsSync(resolveDshLayout(home).stagingDir)).toBe(false)
    },
    60_000,
  )
})

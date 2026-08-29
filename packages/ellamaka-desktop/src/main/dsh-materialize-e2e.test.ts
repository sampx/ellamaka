import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, symlinkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawn } from "node:child_process"

// End-to-end B-01 regression: the materialiser uses arborist `installLinks:
// true`, which COPIES the external `file:` dependency (@wopal/ellamaka-cordis)
// as a real directory (not a symlink). A symlink would make Node resolve the
// package's bare @deepseek-ai/* deps from the resource dir (no node_modules)
// unless --preserve-symlinks is set — but that flag conflicts with
// --experimental-strip-types. A real copy keeps the closure self-contained.
// This test reproduces the real-copy layout and imports dsh-web under Node,
// asserting both the .ts relative import (./log-bridge.js) and the bare
// @deepseek-ai/* dep resolve.

const WORKSPACE_CORDIS = join(import.meta.dir, "..", "..", "..", "ellamaka-cordis")
// The self-contained resource produced by copy-dsh-materialize.ts (the exact
// packaged layout). If it is absent (prebuild not run), fall back to the
// workspace package so the test still exercises the symlink + loader path.
const RESOURCE_SOURCE = existsSync(join(import.meta.dir, "..", "..", "resources", "dsh-materialize", "cordis", "node_modules"))
  ? join(import.meta.dir, "..", "..", "resources", "dsh-materialize", "cordis")
  : WORKSPACE_CORDIS

function buildClosureLayout(): { home: string } {
  const home = mkdtempSync(join(tmpdir(), "dsh-e2e-closure-"))

  // The bundled resource is the SELF-CONTAINED copy produced by
  // copy-dsh-materialize.ts (package.json + src/ + its own node_modules with
  // the @deepseek-ai/* deps). It lives at dsh-materialize/cordis (the path the
  // sidecar TS loader matches), OUTSIDE node_modules so --experimental-strip-types
  // applies.
  const resourceDir = join(home, "dsh-materialize", "cordis")
  mkdirSync(join(home, "dsh-materialize"), { recursive: true })
  cpSync(RESOURCE_SOURCE, resourceDir, { recursive: true })

  // installLinks:false symlinks the file: dep to the resource (arborist default
  // for external dir deps). Node dereferences the symlink to the resource path —
  // outside node_modules, so strip-types applies.
  const nm = join(home, "node_modules")
  const cordisNm = join(nm, "@wopal", "ellamaka-cordis")
  mkdirSync(join(nm, "@wopal"), { recursive: true })
  symlinkSync(resourceDir, cordisNm, "dir")
  return { home }
}

const LOADER = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file://"))) {
    const parentURL = context.parentURL;
    if (parentURL && (parentURL.includes("/plugins/") || parentURL.includes("/skills/") || parentURL.includes("packages/ellamaka-cordis") || parentURL.includes("node_modules/@wopal/ellamaka-cordis") || parentURL.includes("dsh-materialize/cordis"))) {
      let candidateURL = specifier.startsWith("file://") ? specifier : new URL(specifier, parentURL).href;
      const candidatePath = fileURLToPath(candidateURL);
      if (!existsSync(candidatePath)) {
        const tsPath = candidatePath.slice(0, -3) + ".ts";
        if (existsSync(tsPath)) return nextResolve(pathToFileURL(tsPath).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`

function runNodeImport(entryUrl: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const bootstrap = `import { register } from "node:module"; const loaderCode = ${JSON.stringify(LOADER)}; register("data:text/javascript;base64," + Buffer.from(loaderCode).toString("base64"), import.meta.url);`
  const bootstrapB64 = Buffer.from(bootstrap).toString("base64")
  const entryFile = join(mkdtempSync(join(tmpdir(), "dsh-e2e-entry-")), "entry.mjs")
  writeFileSync(entryFile, `import { bootDshWeb } from ${JSON.stringify(entryUrl)}; console.log("E2E_OK " + (typeof bootDshWeb === "function" ? "function" : typeof bootDshWeb))\n`)
  return new Promise((resolve) => {
    const proc = spawn(
      "node",
      ["--experimental-strip-types", "--import", `data:text/javascript;base64,${bootstrapB64}`, entryFile],
      { stdio: "pipe" },
    )
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (c) => (stdout += c.toString()))
    proc.stderr?.on("data", (c) => (stderr += c.toString()))
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

describe("dsh closure real-copy import (B-01 e2e)", () => {
  test("dsh-web import resolves .ts relative imports and bare @deepseek-ai deps", async () => {
    const { home } = buildClosureLayout()
    const entryUrl = pathToFileURL(join(home, "node_modules", "@wopal", "ellamaka-cordis", "src", "dsh-web.ts")).href
    const { code, stdout, stderr } = await runNodeImport(entryUrl)
    expect(stderr).toBe("")
    expect(code).toBe(0)
    expect(stdout).toContain("E2E_OK function")
  }, 60_000)
})

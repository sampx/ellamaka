import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { resolve } from "./dsh-ts-loader"

// The dsh closure ships @wopal/ellamaka-cordis as a `file:` dependency whose
// exports point at .ts sources. Arborist symlinks the external file: dep to the
// real resource path (dsh-materialize/cordis), so the module parent URL is the
// resource dir, not a node_modules path. The loader must map the package's
// relative .js imports (e.g. ./log-bridge.js) to .ts in that layout.
describe("dsh-ts-loader", () => {
  test("maps ./log-bridge.js to .ts for a dsh-materialize/cordis parent (symlink layout)", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-loader-"))
    const cordisSrc = join(root, "dsh-materialize", "cordis", "src")
    mkdirSync(cordisSrc, { recursive: true })
    writeFileSync(join(cordisSrc, "dsh-web.ts"), "export {}")
    writeFileSync(join(cordisSrc, "log-bridge.ts"), "export {}")

    const parentURL = pathToFileURL(join(cordisSrc, "dsh-web.ts")).href
    let resolvedUrl: string | undefined
    const nextResolve = async (spec: string) => {
      resolvedUrl = spec
      return { url: spec }
    }

    const out = await resolve("./log-bridge.js", { parentURL }, nextResolve as never)
    expect(out.url).toBe(pathToFileURL(join(cordisSrc, "log-bridge.ts")).href)
    expect(resolvedUrl).toBe(pathToFileURL(join(cordisSrc, "log-bridge.ts")).href)
  })

  test("maps ./dsh-virtual-webserver.js to .ts for a node_modules/@wopal/ellamaka-cordis parent", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-loader-nm-"))
    const cordisSrc = join(root, "node_modules", "@wopal", "ellamaka-cordis", "src")
    mkdirSync(cordisSrc, { recursive: true })
    writeFileSync(join(cordisSrc, "dsh-web.ts"), "export {}")
    writeFileSync(join(cordisSrc, "dsh-virtual-webserver.ts"), "export {}")

    const parentURL = pathToFileURL(join(cordisSrc, "dsh-web.ts")).href
    const out = await resolve(
      "./dsh-virtual-webserver.js",
      { parentURL },
      (async (spec: string) => ({ url: spec })) as never,
    )
    expect(out.url).toBe(pathToFileURL(join(cordisSrc, "dsh-virtual-webserver.ts")).href)
  })

  test("passes through when the .ts sibling does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-loader-miss-"))
    const cordisSrc = join(root, "dsh-materialize", "cordis", "src")
    mkdirSync(cordisSrc, { recursive: true })
    writeFileSync(join(cordisSrc, "dsh-web.ts"), "export {}")

    const parentURL = pathToFileURL(join(cordisSrc, "dsh-web.ts")).href
    const out = await resolve(
      "./missing.js",
      { parentURL },
      (async (spec: string) => ({ url: spec })) as never,
    )
    expect(out.url).toBe("./missing.js")
  })

  test("passes through for a non-cordis parent", async () => {
    const parentURL = pathToFileURL(join(tmpdir(), "other", "index.js")).href
    const out = await resolve(
      "./x.js",
      { parentURL },
      (async (spec: string) => ({ url: spec })) as never,
    )
    expect(out.url).toBe("./x.js")
  })
})

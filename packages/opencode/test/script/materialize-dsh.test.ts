import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { install, needsInstall } from "../../script/materialize-dsh"

// Materialize-dsh switched from `bun install` to `@npmcli/arborist` (Task 3,
// DESIGN-dsh-poc §3.4). These tests lock in: (a) the closure install no longer
// depends on a system bun, and (b) the idempotency decision (skip install when
// the anchor already exists).

describe("materialize-dsh arborist install", () => {
  test("install materialises a closure via arborist (no system bun)", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-materialize-test-"))
    // A minimal closure manifest with a local `file:` dependency exercises the
    // same arborist reify path as the real manifest without hitting the network.
    const cordisDir = join(import.meta.dir, "..", "..", "..", "ellamaka-cordis")
    writeFileSync(
      join(home, "package.json"),
      JSON.stringify(
        {
          name: "test-dsh-closure",
          private: true,
          type: "module",
          dependencies: { "@wopal/ellamaka-cordis": `file:${cordisDir}` },
        },
        null,
        2,
      ),
    )

    await install(home)

    const anchor = join(home, "node_modules", "@wopal", "ellamaka-cordis", "package.json")
    expect(existsSync(anchor)).toBe(true)
  }, 90_000)

  test("install reifies without a package-lock (idempotent re-run)", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-materialize-idempotent-"))
    const cordisDir = join(import.meta.dir, "..", "..", "..", "ellamaka-cordis")
    writeFileSync(
      join(home, "package.json"),
      JSON.stringify(
        {
          name: "test-dsh-closure",
          private: true,
          dependencies: { "@wopal/ellamaka-cordis": `file:${cordisDir}` },
        },
        null,
        2,
      ),
    )

    await install(home)
    const anchor = join(home, "node_modules", "@wopal", "ellamaka-cordis", "package.json")
    expect(existsSync(anchor)).toBe(true)

    // Second install against the existing tree must not throw.
    await install(home)
    expect(existsSync(anchor)).toBe(true)
  }, 90_000)
})

describe("materialize-dsh idempotency decision", () => {
  test("needsInstall is true for an empty home", () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-idem-empty-"))
    expect(needsInstall(home)).toBe(true)
  })

  test("needsInstall is false once the dsh anchor exists", () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-idem-anchor-"))
    const anchorDir = join(home, "node_modules", "@deepseek-ai", "dsh")
    mkdirSync(anchorDir, { recursive: true })
    writeFileSync(join(anchorDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh" }))
    expect(needsInstall(home)).toBe(false)
  })
})

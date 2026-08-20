import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { SLOW_DIRS, planning } from "./run-tests"

const SLOW = ["server", "session", "cli", "snapshot", "project", "tool", "control-plane"]
const FAST = ["acp", "config", "mcp", "util"]

const roots: string[] = []

function makeTestRoot(dirs: string[], files: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "run-tests-"))
  roots.push(root)
  for (const dir of dirs) {
    mkdirSync(join(root, dir))
    writeFileSync(join(root, dir, "sample.test.ts"), "test('x', () => {})")
  }
  for (const file of files) {
    writeFileSync(join(root, file), "test('x', () => {})")
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("planning mode expansion", () => {
  test("unit includes only fast directories, excludes all slow directories, sorted", () => {
    const root = makeTestRoot([...SLOW, ...FAST])
    const dirs = planning("unit", root)
    expect(dirs).toEqual(FAST.map((name) => `test/${name}`))
    for (const slow of SLOW) expect(dirs).not.toContain(`test/${slow}`)
  })

  test("unit handles an empty or all-slow test root without error", () => {
    const root = makeTestRoot([...SLOW])
    expect(planning("unit", root)).toEqual([])
  })

  test("unit includes top-level *.test.ts files alongside fast directories", () => {
    const root = makeTestRoot([...SLOW, ...FAST], ["permission-task.test.ts", "other.test.ts"])
    const dirs = planning("unit", root)
    expect(dirs).toContain("test/permission-task.test.ts")
    expect(dirs).toContain("test/other.test.ts")
    for (const slow of SLOW) expect(dirs).not.toContain(`test/${slow}`)
    expect([...dirs]).toEqual([...dirs].sort())
  })

  test("slow returns exactly the slow directory list", () => {
    const root = makeTestRoot([...SLOW, ...FAST])
    expect(planning("slow", root)).toEqual(SLOW.map((name) => `test/${name}`))
  })

  test("all returns an empty directory array (bun runs everything)", () => {
    const root = makeTestRoot([...SLOW, ...FAST])
    expect(planning("all", root)).toEqual([])
  })

  test("invalid mode throws", () => {
    const root = makeTestRoot([...FAST])
    expect(() => planning("invalid" as never, root)).toThrow()
  })

  test("SLOW_DIRS matches the documented slow directory list", () => {
    expect(SLOW_DIRS).toEqual(SLOW)
  })
})

import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { needsJsonMigration } from "./migration-check"

describe("needsJsonMigration", () => {
  test("returns false for in-memory db", () => {
    expect(needsJsonMigration({ OPENCODE_DB: ":memory:" }, "/tmp/whatever")).toBe(false)
  })

  test("returns false when no legacy json storage directory exists", () => {
    const root = join(tmpdir(), `mig-empty-${process.pid}-${Date.now()}`)
    expect(needsJsonMigration({}, root)).toBe(false)
  })

  test("returns true when legacy json storage directory exists", () => {
    const root = join(tmpdir(), `mig-storage-${process.pid}-${Date.now()}`)
    try {
      mkdirSync(join(root, "ellamaka", "data", "storage"), { recursive: true })
      expect(needsJsonMigration({}, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("honors explicit WOPAL_HOME when root is undefined", () => {
    // When no root passed, fall back to env WOPAL_HOME — sanity that it does not throw
    expect(() => needsJsonMigration({ WOPAL_HOME: join(tmpdir(), `mig-env-${process.pid}`) }, undefined)).not.toThrow()
  })
})

import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
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

  test("returns false when storage exists but only contains active Storage paths", () => {
    // storage/ 目录存在只代表用过 ellamaka；session_diff/ 是 Storage 服务的活跃
    // 写入路径，不算 legacy 迁移目标。复现真实机器状态。
    const root = join(tmpdir(), `mig-active-${process.pid}-${Date.now()}`)
    try {
      mkdirSync(join(root, "ellamaka", "data", "storage", "session_diff"), { recursive: true })
      writeFileSync(join(root, "ellamaka", "data", "storage", "session_diff", "ses_abc.json"), "[]")
      writeFileSync(join(root, "ellamaka", "data", "storage", "migration"), "2")
      expect(needsJsonMigration({}, root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("returns false when all legacy subdirs exist but are empty", () => {
    const root = join(tmpdir(), `mig-empty-subdirs-${process.pid}-${Date.now()}`)
    try {
      const storage = join(root, "ellamaka", "data", "storage")
      for (const sub of ["project", "session", "message", "part", "todo", "permission", "session_share"]) {
        mkdirSync(join(storage, sub), { recursive: true })
      }
      expect(needsJsonMigration({}, root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("returns true when legacy project/*.json exists", () => {
    const root = join(tmpdir(), `mig-project-${process.pid}-${Date.now()}`)
    try {
      const storage = join(root, "ellamaka", "data", "storage")
      mkdirSync(join(storage, "project"), { recursive: true })
      writeFileSync(join(storage, "project", "abc.json"), "{}")
      expect(needsJsonMigration({}, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("returns true when legacy session/<projectID>/*.json exists", () => {
    const root = join(tmpdir(), `mig-session-${process.pid}-${Date.now()}`)
    try {
      const storage = join(root, "ellamaka", "data", "storage")
      mkdirSync(join(storage, "session", "proj_123"), { recursive: true })
      writeFileSync(join(storage, "session", "proj_123", "ses_456.json"), "{}")
      expect(needsJsonMigration({}, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("returns true when legacy session/<projectID>/ subdir exists even without json inside", () => {
    // JsonMigration 扫描 session/*/*.json；只要有 projectID 子目录就可能是 legacy 布局
    const root = join(tmpdir(), `mig-session-dir-${process.pid}-${Date.now()}`)
    try {
      const storage = join(root, "ellamaka", "data", "storage")
      mkdirSync(join(storage, "session", "proj_123"), { recursive: true })
      expect(needsJsonMigration({}, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("returns true when legacy message/<messageID>/ subdir exists", () => {
    const root = join(tmpdir(), `mig-message-${process.pid}-${Date.now()}`)
    try {
      const storage = join(root, "ellamaka", "data", "storage")
      mkdirSync(join(storage, "message", "msg_abc"), { recursive: true })
      expect(needsJsonMigration({}, root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("honors explicit WOPAL_HOME when root is undefined", () => {
    expect(() => needsJsonMigration({ WOPAL_HOME: join(tmpdir(), `mig-env-${process.pid}`) }, undefined)).not.toThrow()
  })
})

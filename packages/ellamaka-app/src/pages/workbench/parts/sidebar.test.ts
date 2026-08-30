import { describe, expect, test } from "bun:test"
import { resolveSidebarNav } from "./sidebar-nav"

/**
 * B-03: the file tree feature (and its sidebar view) must respond to the
 * Workbench `display.showFileTree` state. When the feature is off, the "files"
 * nav falls back to "sessions" so the toggle (mod+\ or the settings switch)
 * produces exactly one consistent UI change, and no half-on state remains.
 */
describe("resolveSidebarNav (B-03)", () => {
  test("keeps sessions while the file tree is enabled", () => {
    expect(resolveSidebarNav("sessions", true)).toBe("sessions")
  })

  test("falls back from files to sessions when the file tree is disabled", () => {
    expect(resolveSidebarNav("files", false)).toBe("sessions")
  })

  test("keeps files when the file tree is enabled", () => {
    expect(resolveSidebarNav("files", true)).toBe("files")
  })

  test("does not touch maintenance when the file tree is disabled", () => {
    expect(resolveSidebarNav("maintenance", false)).toBe("maintenance")
  })
})

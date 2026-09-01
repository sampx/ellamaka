import { describe, expect, test } from "bun:test"
import { fileTreePanelIdentity } from "./file-tree-panel-identity"

describe("fileTreePanelIdentity", () => {
  test("keeps a stable key and path for a directory so the tree does not remount spuriously", () => {
    const a = fileTreePanelIdentity("/fixtures/workspaces/space-a")
    const again = fileTreePanelIdentity("/fixtures/workspaces/space-a")

    expect(a.key).toBe(again.key)
    expect(a.path).toBe("/fixtures/workspaces/space-a")
  })

  test("changes the keyed identity when the directory changes", () => {
    const a = fileTreePanelIdentity("/fixtures/workspaces/space-a")
    const b = fileTreePanelIdentity("/fixtures/workspaces/space-b")

    expect(a.key).not.toBe(b.key)
    expect(b.path).toBe("/fixtures/workspaces/space-b")
  })

  test("treats the empty (General) directory as a valid well-formed identity", () => {
    const identity = fileTreePanelIdentity("")

    expect(identity.path).toBe("")
    expect(identity.key).toContain("file-tree-panel")
    expect(identity.key).toContain("\n")
  })
})

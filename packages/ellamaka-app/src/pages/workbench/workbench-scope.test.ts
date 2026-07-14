import { describe, expect, test } from "bun:test"
import {
  GENERAL_SCOPE_NAME,
  GENERAL_SCOPE_PATH,
  scopeFromTab,
  scopeKey,
  scopeName,
  scopePath,
  spaceScope,
} from "./workbench-scope"

describe("SpaceScope", () => {
  test("represents General explicitly while preserving its API boundary path", () => {
    const scope = scopeFromTab({ name: GENERAL_SCOPE_NAME, path: GENERAL_SCOPE_PATH, type: "general" })

    expect(scope).toEqual({ kind: "general" })
    expect(scopeKey(scope)).toBe("general")
    expect(scopeName(scope)).toBe(GENERAL_SCOPE_NAME)
    expect(scopePath(scope)).toBe(GENERAL_SCOPE_PATH)
  })

  test("normalizes a Space path without treating it as a truthiness flag", () => {
    const scope = spaceScope("Space A", "/fixtures/workspaces/space-a/")

    expect(scope).toEqual({ kind: "space", name: "Space A", path: "/fixtures/workspaces/space-a" })
    expect(scopeKey(scope)).toBe("space:/fixtures/workspaces/space-a")
  })

  test("rejects an empty path for a named Space", () => {
    expect(() => spaceScope("Space A", "")).toThrow("Space scope requires a non-empty path")
  })
})

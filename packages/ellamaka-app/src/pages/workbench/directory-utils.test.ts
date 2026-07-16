import { describe, expect, test } from "bun:test"
import { sanitizeDirectory } from "./directory-utils"

describe("sanitizeDirectory", () => {
  test("returns empty string for General space (legitimate empty path)", () => {
    expect(sanitizeDirectory("")).toBe("")
  })

  test("returns the same absolute POSIX path", () => {
    expect(sanitizeDirectory("/home/user/project")).toBe("/home/user/project")
  })

  test("returns undefined for path containing .. traversal", () => {
    expect(sanitizeDirectory("/abs/../etc")).toBeUndefined()
  })

  test("returns undefined for relative path", () => {
    expect(sanitizeDirectory("relative/path")).toBeUndefined()
  })

  test("normalizes backslashes to forward slashes", () => {
    expect(sanitizeDirectory("/abs\\path")).toBe("/abs/path")
  })

  test("strips . self-reference segments", () => {
    expect(sanitizeDirectory("/abs/./path")).toBe("/abs/path")
  })

  test("returns undefined for non-string input", () => {
    expect(sanitizeDirectory(undefined)).toBeUndefined()
    expect(sanitizeDirectory(null)).toBeUndefined()
    expect(sanitizeDirectory(123)).toBeUndefined()
    expect(sanitizeDirectory({})).toBeUndefined()
  })

  test("accepts Windows absolute path with drive letter", () => {
    expect(sanitizeDirectory("C:/Users/project")).toBe("C:/Users/project")
  })

  test("normalizes Windows backslash path with drive letter", () => {
    expect(sanitizeDirectory("C:\\Users\\project")).toBe("C:/Users/project")
  })

  test("strips trailing slash for consistency", () => {
    expect(sanitizeDirectory("/home/user/project/")).toBe("/home/user/project")
  })

  test("rejects path with .. segment even when normalized from backslashes", () => {
    expect(sanitizeDirectory("C:\\Users\\..\\etc")).toBeUndefined()
  })

  test("rejects path starting with .. even if absolute", () => {
    expect(sanitizeDirectory("/../etc")).toBeUndefined()
  })

  test("rejects path with multiple .. segments", () => {
    expect(sanitizeDirectory("/a/b/../../c")).toBeUndefined()
  })

  test("handles path with only root", () => {
    expect(sanitizeDirectory("/")).toBe("/")
  })

  test("handles Windows root with drive letter", () => {
    expect(sanitizeDirectory("D:/")).toBe("D:")
  })
})

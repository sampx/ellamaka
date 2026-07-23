import { describe, expect, test, jest } from "bun:test"
import { resolvePtyCommand, type LookupFn } from "../../src/pty/command"

describe("pty command resolution", () => {
  describe("non-Windows", () => {
    test("returns bare command unchanged", () => {
      expect(resolvePtyCommand("ellamaka", "darwin")).toBe("ellamaka")
    })

    test("returns absolute path unchanged", () => {
      expect(resolvePtyCommand("/usr/bin/ellamaka", "darwin")).toBe("/usr/bin/ellamaka")
    })

    test("returns relative path unchanged", () => {
      expect(resolvePtyCommand("./bin/ellamaka", "darwin")).toBe("./bin/ellamaka")
    })

    test("defaults to process.platform", () => {
      const result = resolvePtyCommand("ellamaka")
      expect(result).toBe("ellamaka")
    })

    test("never invokes lookup", () => {
      const lookup = jest.fn<LookupFn>(() => null)
      expect(resolvePtyCommand("ellamaka", "darwin", undefined, lookup)).toBe("ellamaka")
      expect(lookup).not.toHaveBeenCalled()
    })
  })

  describe("win32", () => {
    test("resolves bare command via lookup with custom PATH and PATHEXT", () => {
      const lookup = jest.fn<LookupFn>(() => "C:\\Program Files\\ellamaka\\ellamaka.exe")
      const env: NodeJS.ProcessEnv = { PATH: "C:\\Program Files\\ellamaka", PATHEXT: ".EXE" }
      const resolved = resolvePtyCommand("ellamaka", "win32", env, lookup)
      expect(resolved).toBe("C:\\Program Files\\ellamaka\\ellamaka.exe")
      expect(lookup).toHaveBeenCalledTimes(1)
      expect(lookup).toHaveBeenCalledWith("ellamaka", env)
    })

    test("preserves explicit absolute path without invoking lookup", () => {
      const lookup = jest.fn<LookupFn>(() => null)
      expect(resolvePtyCommand("C:\\Program Files\\app.exe", "win32", undefined, lookup)).toBe("C:\\Program Files\\app.exe")
      expect(lookup).not.toHaveBeenCalled()
    })

    test("preserves relative path with forward slash without invoking lookup", () => {
      const lookup = jest.fn<LookupFn>(() => null)
      expect(resolvePtyCommand("./app.exe", "win32", undefined, lookup)).toBe("./app.exe")
      expect(lookup).not.toHaveBeenCalled()
    })

    test("preserves relative path with backslash without invoking lookup", () => {
      const lookup = jest.fn<LookupFn>(() => null)
      expect(resolvePtyCommand(".\\app.exe", "win32", undefined, lookup)).toBe(".\\app.exe")
      expect(lookup).not.toHaveBeenCalled()
    })

    test("falls back to original command when lookup returns null", () => {
      const lookup = jest.fn<LookupFn>(() => null)
      expect(resolvePtyCommand("nonexistent-command-xyz-12345", "win32", undefined, lookup)).toBe("nonexistent-command-xyz-12345")
      expect(lookup).toHaveBeenCalledTimes(1)
    })
  })
})

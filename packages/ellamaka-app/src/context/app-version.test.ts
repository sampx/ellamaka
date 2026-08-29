import { describe, expect, test } from "bun:test"
import { resolveAppVersion, resolvePlatformVersion } from "./app-version"

describe("resolveAppVersion", () => {
  test("returns the active server's health version", () => {
    const health = {
      "http://a": { version: "1.2.3" },
      "http://b": { version: "2.0.0" },
    }
    expect(resolveAppVersion(health, "http://a")).toBe("1.2.3")
    expect(resolveAppVersion(health, "http://b")).toBe("2.0.0")
  })

  test("returns undefined when the active server has no health entry", () => {
    const health = { "http://a": { version: "1.2.3" } }
    expect(resolveAppVersion(health, "http://b")).toBeUndefined()
  })

  test("returns undefined when the active server's health carries no version", () => {
    const health = { "http://a": { healthy: true } } as Record<string, { version?: string } | undefined>
    expect(resolveAppVersion(health, "http://a")).toBeUndefined()
  })

  test("returns undefined when the active server's health is pending", () => {
    const health = { "http://a": undefined }
    expect(resolveAppVersion(health, "http://a")).toBeUndefined()
  })
})

describe("resolvePlatformVersion", () => {
  test("uses the resolved runtime version when available", () => {
    expect(resolvePlatformVersion("1.2.3", "1.15.13")).toBe("1.2.3")
  })

  test("falls back to the package version when runtime is unresolved", () => {
    expect(resolvePlatformVersion(undefined, "1.15.13")).toBe("1.15.13")
  })
})

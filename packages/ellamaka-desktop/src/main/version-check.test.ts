import { describe, expect, test } from "bun:test"
import { checkWopalCliVersion, checkEngineMajorMinor, authorizeVersionChecks } from "./version-check"

describe("version-check: checkWopalCliVersion", () => {
  test("rejects installed version below minimum", () => {
    const result = checkWopalCliVersion("0.3.12", "0.3.13")
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/too low|below|minimum/i)
  })

  test("accepts installed version equal to minimum", () => {
    const result = checkWopalCliVersion("0.3.13", "0.3.13")
    expect(result.ok).toBe(true)
  })

  test("accepts installed version above minimum", () => {
    const result = checkWopalCliVersion("0.3.14", "0.3.13")
    expect(result.ok).toBe(true)
  })

  test("accepts dev prerelease whose base version meets minimum", () => {
    const result = checkWopalCliVersion("0.3.14-dev", "0.3.13")
    expect(result.ok).toBe(true)
  })

  test("accepts dev prerelease whose base version equals minimum", () => {
    const result = checkWopalCliVersion("0.3.13-dev", "0.3.13")
    expect(result.ok).toBe(true)
  })

  test("rejects dev prerelease whose base version is below minimum", () => {
    const result = checkWopalCliVersion("0.3.12-dev", "0.3.13")
    expect(result.ok).toBe(false)
  })
})

describe("version-check: checkEngineMajorMinor", () => {
  test("accepts matching major.minor with different patch", () => {
    const result = checkEngineMajorMinor("2.0.1", "2.0.3")
    expect(result.ok).toBe(true)
  })

  test("rejects mismatched minor version", () => {
    const result = checkEngineMajorMinor("2.1.0", "2.0.3")
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/major|minor|mismatch/i)
  })

  test("accepts matching major.minor ignoring prerelease", () => {
    const result = checkEngineMajorMinor("2.0.1", "2.0.3-beta.1")
    expect(result.ok).toBe(true)
  })
})

describe("version-check: authorizeVersionChecks", () => {
  test("denies when wopal-cli is below the minimum", () => {
    const result = authorizeVersionChecks({
      wopalCliVersion: "0.3.12",
      minWopalCliVersion: "0.3.13",
      desktopVersion: "2.0.1",
      engineCliVersion: "2.0.3",
    })
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/wopal/i)
  })

  test("denies when engine major.minor mismatches desktop", () => {
    const result = authorizeVersionChecks({
      wopalCliVersion: "0.3.14",
      minWopalCliVersion: "0.3.13",
      desktopVersion: "2.0.1",
      engineCliVersion: "2.1.0",
    })
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/ellamaka|engine|major|minor/i)
  })

  test("authorizes when both checks pass", () => {
    const result = authorizeVersionChecks({
      wopalCliVersion: "0.3.14",
      minWopalCliVersion: "0.3.13",
      desktopVersion: "2.0.1",
      engineCliVersion: "2.0.3",
    })
    expect(result.authorized).toBe(true)
  })
})

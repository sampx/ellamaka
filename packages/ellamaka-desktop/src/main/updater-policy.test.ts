import { describe, expect, test } from "bun:test"
import { authorizeUpdate, type UpdateAuthorizationInput } from "./updater-policy"

function validInput(overrides: Partial<UpdateAuthorizationInput> = {}): UpdateAuthorizationInput {
  return {
    currentVersion: "1.16.2",
    currentChannel: "stable",
    targetVersion: "1.17.0",
    targetChannel: "stable",
    targetManifestVersion: "1.17.0",
    ...overrides,
  }
}

describe("updater: authorizeUpdate policy gate", () => {
  test("authorizes a valid stable upgrade", () => {
    const result = authorizeUpdate(validInput())
    expect(result.authorized).toBe(true)
  })

  test("rejects downgrade", () => {
    const result = authorizeUpdate(
      validInput({ currentVersion: "1.17.0", targetVersion: "1.16.2" }),
    )
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/downgrade/)
  })

  test("rejects cross-channel (stable to beta)", () => {
    const result = authorizeUpdate(
      validInput({ currentChannel: "stable", targetChannel: "beta", targetVersion: "1.17.0-beta.1" }),
    )
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/channel/)
  })

  test("rejects when target manifest version mismatches updater version", () => {
    const result = authorizeUpdate(
      validInput({ targetVersion: "1.17.0", targetManifestVersion: "1.17.1" }),
    )
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/manifest/)
  })

  test("authorizes beta channel upgrade within beta", () => {
    const result = authorizeUpdate(
      validInput({
        currentVersion: "1.16.0-beta.1",
        currentChannel: "beta",
        targetVersion: "1.16.0-beta.2",
        targetChannel: "beta",
        targetManifestVersion: "1.16.0-beta.2",
      }),
    )
    expect(result.authorized).toBe(true)
  })

  test("rejects same version (no-op)", () => {
    const result = authorizeUpdate(
      validInput({ currentVersion: "1.17.0", targetVersion: "1.17.0" }),
    )
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/same|no-op|downgrade/)
  })
})

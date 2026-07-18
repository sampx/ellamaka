import { describe, expect, test } from "bun:test"
import { classifyWopalCliVersion, MIN_WOPAL_CLI_VERSION } from "../../src/wopal/cli-contract"

describe("wopal CLI contract", () => {
  test("accepts the minimum compatible release", () => {
    expect(classifyWopalCliVersion(MIN_WOPAL_CLI_VERSION)).toEqual({
      state: "ok",
      requiredVersion: MIN_WOPAL_CLI_VERSION,
      actualVersion: MIN_WOPAL_CLI_VERSION,
    })
  })

  test("rejects releases below the required version", () => {
    expect(classifyWopalCliVersion("0.3.3")).toEqual({
      state: "incompatible",
      requiredVersion: MIN_WOPAL_CLI_VERSION,
      actualVersion: "0.3.3",
    })
  })

  test("rejects prereleases before the required stable release", () => {
    expect(classifyWopalCliVersion("0.3.4-dev.1")).toEqual({
      state: "incompatible",
      requiredVersion: MIN_WOPAL_CLI_VERSION,
      actualVersion: "0.3.4-dev.1",
    })
  })

  test("marks non-semver output as broken", () => {
    expect(classifyWopalCliVersion("dev")).toEqual({
      state: "broken",
      requiredVersion: MIN_WOPAL_CLI_VERSION,
      actualVersion: "dev",
    })
  })
})

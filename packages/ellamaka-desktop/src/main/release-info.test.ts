import { describe, expect, test } from "bun:test"
import { createReleaseInfo } from "./release-info"

describe("release info", () => {
  test("identifies a retagged build with its immutable commit", () => {
    expect(createReleaseInfo("1.15.13-beta.1", "91a7db1f22a2007588ee2a62e5d738b7d8e80291")).toEqual({
      version: "1.15.13-beta.1",
      build: "91a7db1f22a2007588ee2a62e5d738b7d8e80291",
      displayVersion: "1.15.13-beta.1 (91a7db1f22a2)",
    })
  })

  test("keeps local builds readable without a release commit", () => {
    expect(createReleaseInfo("1.15.13")).toEqual({
      version: "1.15.13",
      build: undefined,
      displayVersion: "1.15.13",
    })
  })
})

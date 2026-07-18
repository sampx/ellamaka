import { describe, expect, test } from "bun:test"
import { canUseSpaceControl } from "./cli-health"

describe("canUseSpaceControl", () => {
  test("allows Space Control only for a verified compatible CLI", () => {
    expect(canUseSpaceControl({ state: "ok", requiredVersion: "0.3.4" })).toBe(true)
  })

  test.each([undefined, { state: "missing" }, { state: "incompatible" }, { state: "broken" }])(
    "keeps Space Control unavailable until CLI health is verified: %p",
    (cli) => {
      expect(canUseSpaceControl(cli && { ...cli, requiredVersion: "0.3.4" })).toBe(false)
    },
  )
})

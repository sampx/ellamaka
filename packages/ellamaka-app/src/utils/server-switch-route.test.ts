import { describe, expect, test } from "bun:test"
import { serverSwitchRedirect } from "./server-switch-route"

describe("serverSwitchRedirect", () => {
  test("keeps Workbench routes active when switching servers", () => {
    expect(serverSwitchRedirect("/workbench")).toBeUndefined()
    expect(serverSwitchRedirect("/workbench/session")).toBeUndefined()
  })

  test("returns to home from the original UI when switching servers", () => {
    expect(serverSwitchRedirect("/")).toBe("/")
    expect(serverSwitchRedirect("/project/session/id")).toBe("/")
  })
})

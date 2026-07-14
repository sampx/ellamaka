import { describe, expect, test } from "bun:test"
import { panelChatRoute } from "./panel-chat-route"

describe("panelChatRoute", () => {
  test("changes the keyed router identity for a new Session or directory", () => {
    const first = panelChatRoute("/fixtures/workspaces/space-a", "session-a")
    const nextSession = panelChatRoute("/fixtures/workspaces/space-a", "session-b")
    const nextDirectory = panelChatRoute("/fixtures/workspaces/space-b", "session-b")

    expect(first.key).not.toBe(nextSession.key)
    expect(nextSession.key).not.toBe(nextDirectory.key)
    expect(nextDirectory.path).toContain("/session/session-b")
  })
})

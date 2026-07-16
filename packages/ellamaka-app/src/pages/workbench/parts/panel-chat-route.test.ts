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

  test("keeps the routed PanelChat boundary required by bound sessions", async () => {
    const source = await Bun.file(new URL("./panel-chat.tsx", import.meta.url)).text()

    expect(source).toContain('import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"')
    expect(source).toContain('path="/:dir/session/:id"')
    expect(source).toContain("panelChatRoute(props.directory, props.session.id)")
  })
})

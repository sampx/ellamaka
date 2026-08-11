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
    const registry = await Bun.file(new URL("../view-registry.tsx", import.meta.url)).text()
    const panel = await Bun.file(new URL("./panel.tsx", import.meta.url)).text()

    expect(source).toContain('import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"')
    expect(source).toContain('path="/:dir/session/:id"')
    expect(source).toContain("panelChatRoute(props.directory, props.session.id)")
    expect(source).toContain("props.onPromptReady?.(el)")
    expect(source).toContain("canRestorePromptFocus={props.canRestorePromptFocus}")
    expect(registry).toContain("onPromptReady={ctx.onPromptReady}")
    expect(registry).toContain("canRestorePromptFocus={ctx.canRestorePromptFocus}")
    expect(panel).toContain("onPromptReady: handlePromptReady")
    expect(panel).toContain("canRestorePromptFocus: () =>")
  })

  test("keeps the panel prompt focus guard global instead of panel-bounded", async () => {
    const panel = await Bun.file(new URL("./panel.tsx", import.meta.url)).text()

    expect(panel).toContain("shouldPreservePanelPointerFocus(active)")
    expect(panel).not.toContain("panel?.contains(active)")
    expect(panel).not.toContain("panel.contains(active)")
  })
})

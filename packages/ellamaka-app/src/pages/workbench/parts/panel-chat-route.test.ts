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

  test("keeps transcript, live status and composer on one readable lane", async () => {
    const source = await Bun.file(new URL("./panel-chat.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("../../../index.css", import.meta.url)).text()

    expect(source).toContain('data-component="workbench-chat"')
    expect(css).toContain("--workbench-chat-readable-width: 98ch")
    expect(css).toContain('[data-component="workbench-chat"] [data-component="session-prompt-dock"] > div')
    expect(css).toContain('[data-component="chat-live-activity-slot"]')
    expect(css).toContain("max-width: var(--workbench-chat-readable-width)")
  })

  test("wires the followup queue so a prompt submitted while the agent works is not dropped", async () => {
    const source = await Bun.file(new URL("./panel-chat.tsx", import.meta.url)).text()
    const followup = await Bun.file(new URL("./panel-chat-followup.ts", import.meta.url)).text()
    const composer = await Bun.file(new URL("./panel-chat-composer.tsx", import.meta.url)).text()
    const dock = await Bun.file(new URL("../../session/composer/session-followup-dock.tsx", import.meta.url)).text()
    const zh = await Bun.file(new URL("../../../i18n/zh.ts", import.meta.url)).text()

    // The panel chat must forward the followup queue to the shared composer so
    // a prompt typed while the session is busy is queued and shown instead of
    // being silently lost.
    expect(source).toContain("queueEnabled")
    expect(source).toContain("queueFollowup")
    expect(source).toContain("followupDock()")
    expect(source).toContain("sendFollowup(props.session.id, id, { manual: true })")
    expect(source).toContain("followup={")
    expect(composer).toContain("followup?:")
    expect(composer).toContain("followup={props.followup}")

    // A queue item remains local while the current turn is busy, so the user
    // can withdraw it back into the composer without creating a transcript
    // message. Delivery starts only after the turn becomes idle.
    expect(followup).toContain("if (state.busy) return")
    expect(source).toContain("busy: busy(sessionID)")
    expect(source).toContain("withdrawFollowup")
    expect(source).toContain('setFollowup("edit", props.session.id')
    expect(source).not.toContain("messageID: item.id")
    expect(source).not.toContain("resume: !!input.manual")
    expect(source).not.toContain("hiddenUserMessageIDs={pendingFollowupIDs()}")
    expect(dock).toContain("onWithdraw")
    expect(dock).toContain('language.t("session.followupDock.withdraw")')
    expect(zh).toContain('"session.followupDock.withdraw": "撤回"')
  })
})

/** @jsx h */
import { describe, expect, mock, test } from "bun:test"
import { render } from "solid-js/web"
import h from "solid-js/h"
import { createSignal } from "solid-js"
import type { JSX } from "solid-js"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { PromptNavigator, type PromptNavigatorProps } from "./prompt-navigator"

mock.module("@opencode-ai/ui/icon", () => ({
  Icon: (props: { name: string }) => <span data-slot="chat-icon" data-icon={props.name} />,
}))

function userMessage(id: string, text: string): UserMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: 1000 },
    agent: "primary",
    model: { providerID: "openai", modelID: "gpt-4o" },
  }
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: "ses_1", messageID, type: "text", text }
}

function mount(node: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(node, host)
  return host
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function installChatStyles() {
  if (document.querySelector("style[data-test='chat-styles']")) return
  const css = await Bun.file(new URL("../../index.css", import.meta.url)).text()
  const style = document.createElement("style")
  style.dataset.test = "chat-styles"
  style.textContent = css
  document.head.appendChild(style)
}

function baseProps(overrides: Partial<PromptNavigatorProps> = {}): PromptNavigatorProps {
  return {
    sessionID: "ses_1",
    userMessages: [],
    historyMore: false,
    historyLoading: false,
    loadOlder: async () => {},
    onJump: () => {},
    ...overrides,
  }
}

describe("PromptNavigator", () => {
  test("renders a tick rail with one tick per loaded user message", () => {
    const u1 = userMessage("u1", "hello")
    const u2 = userMessage("u2", "world")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1, u2],
        })}
      />
    ))

    expect(host.querySelector("[data-component='chat-prompt-rail']")).not.toBeNull()
    expect(host.querySelectorAll("[data-slot='chat-prompt-tick']").length).toBe(2)
    host.remove()
  })

  test("opens a directory popover with user and assistant summaries", async () => {
    const u1 = userMessage("u1", "hello")
    const a1: AssistantMessage = {
      id: "a1",
      sessionID: "ses_1",
      role: "assistant",
      time: { created: 2000, completed: 3000 },
      parentID: "u1",
      modelID: "gpt-4o",
      providerID: "openai",
      mode: "primary",
      agent: "primary",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
          getParts: (id: string) =>
            id === "u1" ? [textPart("p1", "u1", "hello")] : [textPart("p2", "a1", "**reply** with `code`")],
          assistantByParent: { u1: [a1] },
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    expect(popover.getAttribute("data-open")).toBe("true")
    expect(host.textContent).toContain("hello")
    expect(host.textContent).toContain("reply with code")
    expect(host.textContent).not.toContain("**reply**")
    host.remove()
  })

  test("calls loadOlder when the directory opens and historyMore is true", async () => {
    let loaded = 0
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
          historyMore: true,
          loadOlder: async () => {
            loaded += 1
          },
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    expect(loaded).toBeGreaterThan(0)
    host.remove()
  })

  test("jumps to a prompt via onJump when a directory item is clicked", async () => {
    let jumped: string | undefined
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
          onJump: (id: string) => {
            jumped = id
          },
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()
    const item = host.querySelector("[data-slot='chat-prompt-item']") as HTMLElement
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    expect(jumped).toBe("u1")
    host.remove()
  })

  test("supports keyboard navigation with ArrowUp/ArrowDown/Enter/Escape", async () => {
    const u1 = userMessage("u1", "hello")
    const u2 = userMessage("u2", "world")
    let jumped: string | undefined
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1, u2],
          onJump: (id: string) => {
            jumped = id
          },
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await tick()

    expect(jumped).toBe("u2")
    host.remove()
  })

  test("triggers history hydration when the directory opens and historyMore is true", async () => {
    let calls = 0
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
          historyMore: true,
          loadOlder: async () => {
            calls += 1
          },
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    // loadOlder is useSessionHistoryLoader.loadAndReveal, which owns the serial
    // page loop; the navigator triggers it once on open.
    expect(calls).toBe(1)
    host.remove()
  })

  test("renders previous and next buttons that jump by offset", async () => {
    const u1 = userMessage("u1", "hello")
    const u2 = userMessage("u2", "world")
    let jumped: string | undefined
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1, u2],
          activeUserMessageID: "u1",
          onJump: (id: string) => {
            jumped = id
          },
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const next = host.querySelector("[data-slot='chat-prompt-next']") as HTMLElement
    next.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    expect(jumped).toBe("u2")
    host.remove()
  })

  test("highlights the active turn in the directory", async () => {
    const u1 = userMessage("u1", "hello")
    const u2 = userMessage("u2", "world")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1, u2],
          activeUserMessageID: "u2",
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const active = host.querySelector("[data-slot='chat-prompt-item'][data-active='true']") as HTMLElement
    expect(active).not.toBeNull()
    expect(active.getAttribute("data-message-id")).toBe("u2")
    host.remove()
  })

  test("Escape closes the popover and returns focus to the rail", async () => {
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await tick()

    expect(popover.getAttribute("data-open")).toBe("false")
    expect(document.activeElement).toBe(rail)
    host.remove()
  })

  test("does not open the directory popover when the rail is hovered", async () => {
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await tick()

    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    expect(popover.getAttribute("data-open")).toBe("false")
    host.remove()
  })

  test("shows a single-message preview with only the user prompt when a tick is hovered", async () => {
    const u1 = userMessage("u1", "hello")
    const a1: AssistantMessage = {
      id: "a1",
      sessionID: "ses_1",
      role: "assistant",
      time: { created: 2000, completed: 3000 },
      parentID: "u1",
      modelID: "gpt-4o",
      providerID: "openai",
      mode: "primary",
      agent: "primary",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
          getParts: (id: string) =>
            id === "u1" ? [textPart("p1", "u1", "hello question")] : [textPart("p2", "a1", "agent answer")],
          assistantByParent: { u1: [a1] },
        })}
      />
    ))

    const tickEl = host.querySelector("[data-slot='chat-prompt-tick']") as HTMLElement
    tickEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await tick()

    const preview = host.querySelector("[data-component='chat-prompt-preview']") as HTMLElement
    expect(preview.getAttribute("data-open")).toBe("true")
    expect(preview.textContent).toContain("hello question")
    expect(preview.textContent).not.toContain("agent answer")
    host.remove()
  })

  test("hides the preview when the pointer leaves the tick", async () => {
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ))

    const tickEl = host.querySelector("[data-slot='chat-prompt-tick']") as HTMLElement
    const preview = host.querySelector("[data-component='chat-prompt-preview']") as HTMLElement
    tickEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await tick()
    expect(preview.getAttribute("data-open")).toBe("true")

    tickEl.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))
    await tick()
    expect(preview.getAttribute("data-open")).toBe("false")
    host.remove()
  })

  test("hides the preview after jumping via a tick click", async () => {
    const u1 = userMessage("u1", "hello")
    let jumped: string | undefined
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
          onJump: (id: string) => {
            jumped = id
          },
        })}
      />
    ))

    const tickEl = host.querySelector("[data-slot='chat-prompt-tick']") as HTMLElement
    const preview = host.querySelector("[data-component='chat-prompt-preview']") as HTMLElement
    tickEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await tick()
    expect(preview.getAttribute("data-open")).toBe("true")

    tickEl.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()
    expect(jumped).toBe("u1")
    expect(preview.getAttribute("data-open")).toBe("false")
    host.remove()
  })

  test("suppresses the preview while the directory popover is open", async () => {
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const tickEl = host.querySelector("[data-slot='chat-prompt-tick']") as HTMLElement
    tickEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await tick()

    const preview = host.querySelector("[data-component='chat-prompt-preview']") as HTMLElement
    expect(preview.getAttribute("data-open")).toBe("false")
    host.remove()
  })

  test("keeps the click-opened popover open after the pointer leaves the rail", async () => {
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    rail.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))
    popover.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))
    await wait(160)

    expect(popover.getAttribute("data-open")).toBe("true")
    host.remove()
  })

  test("narrow panel popover width is constrained to the timeline container", async () => {
    const u1 = userMessage("u1", "hello")
    const host = mount(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ))

    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    rail.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    expect(popover.getAttribute("data-open")).toBe("true")
    // The popover is always mounted; its width is governed by CSS
    // `min(360px, calc(100% - 24px))` relative to the timeline container.
    expect(popover).not.toBeNull()
    host.remove()
  })

  test("positions the popover against the timeline width, not the rail's own width", async () => {
    await installChatStyles()
    const u1 = userMessage("u1", "hello")
    const host = document.createElement("div")
    const timeline = document.createElement("div")
    timeline.dataset.component = "chat-timeline"
    timeline.style.width = "300px"
    host.appendChild(timeline)
    document.body.appendChild(host)
    render(() => (
      <PromptNavigator
        {...baseProps({
          userMessages: [u1],
        })}
      />
    ), timeline)

    const navigator = host.querySelector("[data-component='chat-prompt-navigator']") as HTMLElement
    const rail = host.querySelector("[data-component='chat-prompt-rail']") as HTMLElement
    const popover = host.querySelector("[data-component='chat-prompt-popover']") as HTMLElement
    const timelineStyle = getComputedStyle(timeline)
    const navigatorStyle = getComputedStyle(navigator)
    const railStyle = getComputedStyle(rail)
    const popoverStyle = getComputedStyle(popover)

    expect(timelineStyle.position).toBe("relative")
    expect(timelineStyle.width).toBe("300px")
    expect(navigatorStyle.position).toBe("static")
    expect(railStyle.position).toBe("absolute")
    expect(popoverStyle.position).toBe("absolute")
    expect(popoverStyle.left).toBe("32px")
    expect(popoverStyle.width).toBe("calc(100% - 44px)")
    expect(popoverStyle.maxWidth).toBe("360px")
    host.remove()
  })
})

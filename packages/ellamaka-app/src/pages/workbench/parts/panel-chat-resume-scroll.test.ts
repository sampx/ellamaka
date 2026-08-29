import { describe, expect, test } from "bun:test"
import { shouldResumeChatOnEnd } from "./panel-chat-resume-scroll"

function dispatchKeydown(target: HTMLElement, init: KeyboardEventInit = {}) {
  let result = false
  target.addEventListener("keydown", (event) => {
    result = shouldResumeChatOnEnd(event)
  }, { once: true })
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true, ...init }))
  return result
}

describe("shouldResumeChatOnEnd", () => {
  test("handles an unmodified End key pressed in the transcript", () => {
    expect(dispatchKeydown(document.createElement("div"))).toBe(true)
  })

  test("preserves End for editable and interactive controls", () => {
    expect(dispatchKeydown(document.createElement("textarea"))).toBe(false)
    expect(dispatchKeydown(document.createElement("button"))).toBe(false)
  })

  test("uses End from an empty chat prompt but preserves a drafted prompt", () => {
    const prompt = document.createElement("div")
    prompt.dataset.component = "prompt-input"
    prompt.contentEditable = "true"
    expect(dispatchKeydown(prompt)).toBe(true)

    prompt.textContent = "draft"
    expect(dispatchKeydown(prompt)).toBe(false)
  })

  test("preserves selection and platform shortcut variants", () => {
    expect(dispatchKeydown(document.createElement("div"), { shiftKey: true })).toBe(false)
    expect(dispatchKeydown(document.createElement("div"), { ctrlKey: true })).toBe(false)
    expect(dispatchKeydown(document.createElement("div"), { metaKey: true })).toBe(false)
    expect(dispatchKeydown(document.createElement("div"), { altKey: true })).toBe(false)
  })
})

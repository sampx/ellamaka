/** @jsx h */
import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import h from "solid-js/h"
import { createSignal } from "solid-js"
import { PromptSurfaceGate } from "./prompt-surface-gate"

describe("PromptSurfaceGate", () => {
  test("keeps children mounted across mode toggles (same node identity)", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const [mode, setMode] = createSignal<"prompt" | "prompt-disabled">("prompt")

    render(
      () => (
        <PromptSurfaceGate mode={() => mode()}>
          <div data-child="1" />
        </PromptSurfaceGate>
      ),
      host,
    )

    const first = host.querySelector("[data-child]")
    expect(first).not.toBeNull()

    setMode("prompt-disabled")
    expect(host.querySelector("[data-child]")).toBe(first)

    setMode("prompt")
    expect(host.querySelector("[data-child]")).toBe(first)

    host.remove()
  })

  test("blocks focus while disabled via inert and restores it after", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const [mode, setMode] = createSignal<"prompt" | "prompt-disabled">("prompt")

    render(
      () => (
        <PromptSurfaceGate mode={() => mode()}>
          <input data-input="1" />
        </PromptSurfaceGate>
      ),
      host,
    )

    const input = host.querySelector("[data-input]") as HTMLInputElement
    const gate = host.querySelector("[data-component='prompt-surface-gate']") as HTMLElement

    input.focus()
    expect(document.activeElement).toBe(input)
    expect(gate.hasAttribute("inert")).toBe(false)

    setMode("prompt-disabled")
    expect(gate.hasAttribute("inert")).toBe(true)
    input.blur()
    input.focus()
    expect(document.activeElement).not.toBe(input)

    let keydown = 0
    input.addEventListener("keydown", () => keydown++)
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(keydown).toBe(0)

    setMode("prompt")
    expect(gate.hasAttribute("inert")).toBe(false)
    input.focus()
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(keydown).toBe(1)

    host.remove()
  })
})

import { createEffect, type JSX } from "solid-js"
import h from "solid-js/h"

/**
 * Wraps the prompt surface so a blocked session disables interaction
 * without unmounting the prompt. `inert` blocks keyboard, pointer, and
 * focus interaction natively while keeping the subtree (and its popover
 * state) mounted. Capture-phase event blocking backs it up so keyboard
 * and paste input cannot reach the prompt editor.
 */
export function PromptSurfaceGate(props: {
  mode: "prompt" | "prompt-disabled" | (() => "prompt" | "prompt-disabled")
  children: JSX.Element
}): JSX.Element {
  let ref: HTMLDivElement | undefined
  const mode = () => {
    const m = props.mode
    return typeof m === "function" ? m() : m
  }
  const block = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  createEffect(() => {
    const disabled = mode() === "prompt-disabled"
    if (!ref) return
    if (disabled) {
      ref.setAttribute("inert", "")
      ref.classList.add("pointer-events-none", "opacity-60")
      ref.addEventListener("keydown", block, true)
      ref.addEventListener("keyup", block, true)
      ref.addEventListener("paste", block, true)
      ref.addEventListener("beforeinput", block, true)
    } else {
      ref.removeAttribute("inert")
      ref.classList.remove("pointer-events-none", "opacity-60")
      ref.removeEventListener("keydown", block, true)
      ref.removeEventListener("keyup", block, true)
      ref.removeEventListener("paste", block, true)
      ref.removeEventListener("beforeinput", block, true)
    }
  })
  return h(
    "div",
    {
      ref: (el: HTMLDivElement) => {
        ref = el
      },
      "data-component": "prompt-surface-gate",
    },
    props.children,
  ) as unknown as JSX.Element
}

import { describe, expect, test } from "bun:test"
import { getPanelHeaderViews } from "./panel-header-views"

const views = [
  { id: "tui", label: "TUI", requiresSession: true, availableInOpen: false },
  { id: "terminal", label: "Terminal", requiresSession: false, availableInOpen: true },
  { id: "chat", label: "Chat", requiresSession: true, availableInOpen: false },
  { id: "context", label: "Context", requiresSession: true, availableInOpen: false },
]

describe("getPanelHeaderViews", () => {
  test("hides all view buttons for empty slots", () => {
    expect(getPanelHeaderViews(views, "empty")).toEqual([])
  })

  test("keeps only session views for bound panels", () => {
    expect(getPanelHeaderViews(views, "bound").map((view) => view.id)).toEqual(["tui", "chat", "context"])
  })

  test("disables non-open views for open terminal panels", () => {
    expect(getPanelHeaderViews(views, "open")).toEqual([
      { ...views[0], disabled: true },
      { ...views[1], disabled: false },
      { ...views[2], disabled: true },
      { ...views[3], disabled: true },
    ])
  })
})

import { describe, expect, test } from "bun:test"
import { getPanelHeaderViews } from "./panel-header-views"

const views = [
  { id: "tui", label: "TUI", requiresSession: true },
  { id: "chat", label: "Chat", requiresSession: true },
  { id: "context", label: "Context", requiresSession: true },
]

describe("getPanelHeaderViews", () => {
  test("hides all view buttons for empty slots", () => {
    expect(getPanelHeaderViews(views, "empty")).toEqual([])
  })

  test("keeps only session views for bound panels", () => {
    expect(getPanelHeaderViews(views, "bound").map((view) => view.id)).toEqual(["tui", "chat", "context"])
  })
})

import { describe, expect, test } from "bun:test"
import { getStatusBarSegments } from "./status-bar-segments"

describe("getStatusBarSegments", () => {
  test("returns space name segment only when activePanelID is undefined", () => {
    const segments = getStatusBarSegments({
      spaceName: "main",
      activePanelID: undefined,
      panels: [],
      getSessionTitle: () => undefined,
    })
    expect(segments).toEqual([
      { type: "space", text: "main" }
    ])
  })

  test("returns space name segment only when active panel is not found in panels list", () => {
    const segments = getStatusBarSegments({
      spaceName: "main",
      activePanelID: "p-missing",
      panels: [
        { id: "p-1", slotState: "empty", directory: "/workspace/main" }
      ],
      getSessionTitle: () => undefined,
    })
    expect(segments).toEqual([
      { type: "space", text: "main" }
    ])
  })

  test("returns space, panel index and formatted path segments for empty slot panel", () => {
    const segments = getStatusBarSegments({
      spaceName: "main",
      activePanelID: "p-2",
      panels: [
        { id: "p-1", slotState: "empty", directory: "/workspace/main" },
        { id: "p-2", slotState: "empty", directory: "/workspace/main/sub" }
      ],
      getSessionTitle: () => undefined,
    })
    expect(segments).toEqual([
      { type: "space", text: "main" },
      { type: "panel", text: "P2/2" },
      { type: "path", text: "workspace/main/sub" }
    ])
  })

  test("returns space, panel, session title and formatted path segments if bound and session title exists", () => {
    const getSessionTitle = (id: string) => {
      if (id === "ses-1") return "Fix CSS Bug"
      return undefined
    }

    const segments = getStatusBarSegments({
      spaceName: "General",
      activePanelID: "p-1",
      panels: [
        { id: "p-1", slotState: "bound", boundSessionId: "ses-1", directory: "/workspace/general" }
      ],
      getSessionTitle,
    })
    expect(segments).toEqual([
      { type: "space", text: "General" },
      { type: "panel", text: "P1/1" },
      { type: "session", text: "Fix CSS Bug" },
      { type: "path", text: "workspace/general" }
    ])
  })

  test("returns space, panel and formatted path segments if bound but session title is missing", () => {
    const segments = getStatusBarSegments({
      spaceName: "General",
      activePanelID: "p-1",
      panels: [
        { id: "p-1", slotState: "bound", boundSessionId: "ses-2", directory: "/workspace/general" }
      ],
      getSessionTitle: () => undefined,
    })
    expect(segments).toEqual([
      { type: "space", text: "General" },
      { type: "panel", text: "P1/1" },
      { type: "path", text: "workspace/general" }
    ])
  })
})

import { describe, expect, test } from "bun:test"
import {
  fetchSessionGroups,
  resolveTargetPanel,
  getPanelBadge,
  type SessionGroupsSDK,
  type OpenSessionWB,
} from "./session-tree-services"

// ── Helpers ─────────────────────────────────────────────────────────────────

type MockGroup = {
  id: string
  title: string
  type: "space" | "general"
  sessionCount: number | string
  sessions: Array<{
    id: string
    title: string
    directory: string
    directoryHealth: "healthy" | "missing" | "unavailable"
    agent?: string
    timeCreated: number | string
    timeUpdated: number | string
  }>
}

function mockSDK(groups: MockGroup[]): SessionGroupsSDK {
  return {
    client: {
      workbench: {
        sessionGroups: async () => ({ data: { groups } }),
      },
    },
  }
}

function mockSDKThrows(error: Error): SessionGroupsSDK {
  return {
    client: {
      workbench: {
        sessionGroups: async () => { throw error },
      },
    },
  }
}

function panel(
  overrides: Partial<{
    id: string
    slotState: "empty" | "bound"
    boundSessionId: string
    viewMode: string
    mode: "" | "tui" | "chat"
    directory: string
    width: number
  }> = {},
) {
  return {
    id: "p-1",
    slotState: "empty" as const,
    boundSessionId: undefined,
    viewMode: undefined,
    mode: "" as const,
    directory: "/",
    width: 1,
    ...overrides,
  }
}

function wbWithPanels(
  spacePath: string,
  panels: ReturnType<typeof panel>[],
  activeTabPath?: string,
): OpenSessionWB {
  const spaces: Record<string, { panels: typeof panels; activePanelID: string }> = {
    [spacePath]: { panels, activePanelID: panels[0]?.id ?? "" },
  }
  return {
    spaces,
    openTab: () => {},
    ensureSpace: () => {},
    setStatusMessage: () => {},
    activeTab: () =>
      activeTabPath !== undefined
        ? { name: "test", path: activeTabPath }
        : undefined,
  }
}

// ── fetchSessionGroups ──────────────────────────────────────────────────────

describe("fetchSessionGroups", () => {
  test("SDK returns groups → normalizes and returns them", async () => {
    const sdk = mockSDK([
      {
        id: "space-a",
        title: "Space A",
        type: "space",
        sessionCount: 2,
        sessions: [
          {
            id: "s1",
            title: "Session 1",
            directory: "/a",
            directoryHealth: "healthy",
            agent: "tui",
            timeCreated: 1000,
            timeUpdated: 2000,
          },
          {
            id: "s2",
            title: "Session 2",
            directory: "/a/b",
            directoryHealth: "missing",
            timeCreated: "3000" as unknown as number,
            timeUpdated: "4000" as unknown as number,
          },
        ],
      },
    ])

    const result = await fetchSessionGroups(sdk)

    expect(result).toEqual([
      {
        id: "space-a",
        title: "Space A",
        type: "space",
        sessionCount: 2,
        sessions: [
          {
            id: "s1",
            title: "Session 1",
            directory: "/a",
            directoryHealth: "healthy",
            agent: "tui",
            timeCreated: 1000,
            timeUpdated: 2000,
          },
          {
            id: "s2",
            title: "Session 2",
            directory: "/a/b",
            directoryHealth: "missing",
            agent: undefined,
            timeCreated: 0,
            timeUpdated: 0,
          },
        ],
      },
    ])
  })

  test("SDK returns empty groups → returns empty array", async () => {
    const sdk = mockSDK([])
    const result = await fetchSessionGroups(sdk)
    expect(result).toEqual([])
  })

  test("SDK returns null/undefined data → returns empty array", async () => {
    const sdk: SessionGroupsSDK = {
      client: {
        workbench: {
          sessionGroups: async () => ({ data: undefined }),
        },
      },
    }
    const result = await fetchSessionGroups(sdk)
    expect(result).toEqual([])
  })

  test("SDK throws → propagates error", async () => {
    const error = new Error("Network failure")
    const sdk = mockSDKThrows(error)
    await expect(fetchSessionGroups(sdk)).rejects.toThrow("Network failure")
  })

  test("non-numeric sessionCount is normalized to 0", async () => {
    const sdk = mockSDK([
      {
        id: "g1",
        title: "G1",
        type: "general",
        sessionCount: "NaN",
        sessions: [],
      },
    ])
    const result = await fetchSessionGroups(sdk)
    expect(result[0].sessionCount).toBe(0)
  })

  test("undefined sessions array is normalized to empty array", async () => {
    const sdk: SessionGroupsSDK = {
      client: {
        workbench: {
          sessionGroups: async () => ({
            data: {
              groups: [
                {
                  id: "g1",
                  title: "G1",
                  type: "general",
                  sessionCount: 0,
                  sessions: undefined as unknown as [],
                },
              ],
            },
          }),
        },
      },
    }
    const result = await fetchSessionGroups(sdk)
    expect(result[0].sessions).toEqual([])
  })
})

// ── resolveTargetPanel ──────────────────────────────────────────────────────

describe("resolveTargetPanel", () => {
  test("empty panel exists → returns empty panel for direct load", () => {
    const panels = [
      panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
      panel({ id: "p2", slotState: "empty" }),
    ]
    const result = resolveTargetPanel(panels, "p1", 3)
    expect(result).toEqual({ kind: "empty", panel: panels[1] })
  })

  test("no empty panel, < maxPanels → returns new", () => {
    const panels = [
      panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
      panel({ id: "p2", slotState: "bound", boundSessionId: "s2" }),
    ]
    const result = resolveTargetPanel(panels, "p1", 3)
    expect(result).toEqual({ kind: "new" })
  })

  test("no empty panel, = maxPanels → returns overwrite with active panel", () => {
    const panels = [
      panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
      panel({ id: "p2", slotState: "bound", boundSessionId: "s2" }),
      panel({ id: "p3", slotState: "bound", boundSessionId: "s3" }),
    ]
    const result = resolveTargetPanel(panels, "p2", 3)
    expect(result).toEqual({ kind: "overwrite", panel: panels[1], index: 2 })
  })

  test("no empty panel, = maxPanels, active panel not found → overwrite first panel", () => {
    const panels = [
      panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
      panel({ id: "p2", slotState: "bound", boundSessionId: "s2" }),
    ]
    const result = resolveTargetPanel(panels, "nonexistent", 2)
    expect(result).toEqual({ kind: "overwrite", panel: panels[0], index: 1 })
  })

  test("single empty panel in 3-panel space → returns empty", () => {
    const panels = [
      panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
      panel({ id: "p2", slotState: "bound", boundSessionId: "s2" }),
      panel({ id: "p3", slotState: "empty" }),
    ]
    const result = resolveTargetPanel(panels, "p1", 3)
    expect(result).toEqual({ kind: "empty", panel: panels[2] })
  })
})

// ── getPanelBadge ───────────────────────────────────────────────────────────

describe("getPanelBadge", () => {
  test("returns badge for bound session in active space", () => {
    const wb = wbWithPanels(
      "/space",
      [
        panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
        panel({ id: "p2", slotState: "bound", boundSessionId: "s2" }),
      ],
      "/space",
    )
    expect(getPanelBadge(wb, "s2")).toBe("P2")
  })

  test("returns badge from non-active space as fallback", () => {
    const wb = wbWithPanels(
      "/other",
      [
        panel({ id: "p1", slotState: "bound", boundSessionId: "s1" }),
        panel({ id: "p2", slotState: "bound", boundSessionId: "s2" }),
      ],
      "/active",
    )
    // Also register /active space so the fallback scan can find the session
    wb.spaces["/active"] = {
      panels: [panel({ id: "pa", slotState: "empty" })],
      activePanelID: "pa",
    }
    expect(getPanelBadge(wb, "s1")).toBe("P1")
  })

  test("returns undefined for unbound session", () => {
    const wb = wbWithPanels(
      "/space",
      [panel({ id: "p1", slotState: "empty" })],
      "/space",
    )
    expect(getPanelBadge(wb, "unknown")).toBeUndefined()
  })

  test("returns undefined when no panels are bound", () => {
    const wb = wbWithPanels(
      "/space",
      [panel({ id: "p1", slotState: "empty" }), panel({ id: "p2", slotState: "empty" })],
      "/space",
    )
    expect(getPanelBadge(wb, "s1")).toBeUndefined()
  })

  test("skips active space in fallback scan to avoid double-counting", () => {
    const wb = wbWithPanels(
      "/active",
      [panel({ id: "p1", slotState: "bound", boundSessionId: "s1" })],
      "/active",
    )
    // Session is in active space — should find it via activePath
    expect(getPanelBadge(wb, "s1")).toBe("P1")
  })
})

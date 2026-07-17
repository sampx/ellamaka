import { describe, expect, test } from "bun:test"
import {
  fetchSessionGroups,
  fetchSessionTree,
  createSessionGroupsLoader,
  resolveTargetPanel,
  getPanelBadge,
  mergeTree,
  type SessionGroupsSDK,
  type SessionGroup,
  type SessionTreeScope,
  type WorkbenchSessionTree,
  type OpenSessionWB,
} from "./session-tree-services"
import { mergeSessionTreeSessions } from "./session-tree-merge"
import type { Session } from "../session-store"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

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
    findSessionBinding: (sessionID) => {
      for (const [path, space] of Object.entries(spaces)) {
        const panel = space.panels.find(
          (candidate) => candidate.slotState === "bound" && candidate.boundSessionId === sessionID,
        )
        if (panel) return { spacePath: path, panelID: panel.id }
      }
      return undefined
    },
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
            timeCreated: "3000",
            timeUpdated: "4000",
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
                  sessions: undefined,
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

describe("fetchSessionTree", () => {
  test("preserves General and same-name Spaces by their path identity and locations", async () => {
    const tree = await fetchSessionTree({
      client: {
        workbench: {
          sessionTree: async () => ({
            data: {
              scopes: [
                {
                  key: "general",
                  kind: "general" as const,
                  name: "General",
                  path: "",
                  sessionCount: 1,
                  truncated: false,
                  locations: [{
                    key: "general-date:2026-07-16",
                    kind: "general-date" as const,
                    name: "2026-07-16",
                    path: "",
                    sessionCount: 1,
                    sessions: [{
                      id: "general-session",
                      title: "General",
                      directory: "/home/.wopal/general_tasks/2026-07-16",
                      directoryHealth: "healthy" as const,
                      marker: "",
                      timeCreated: 1,
                      timeUpdated: 2,
                    }],
                  }],
                },
                {
                  key: "space:/fixtures/two",
                  kind: "space" as const,
                  name: "Shared",
                  path: "/fixtures/two",
                  sessionCount: 1,
                  truncated: false,
                  locations: [{
                    key: "space:/fixtures/two:root",
                    kind: "space-root" as const,
                    name: "Root",
                    path: "/fixtures/two",
                    sessionCount: 1,
                    sessions: [{
                      id: "space-session",
                      title: "Space",
                      directory: "/fixtures/two",
                      directoryHealth: "healthy" as const,
                      marker: "",
                      timeCreated: 3,
                      timeUpdated: 4,
                    }],
                  }],
                },
              ],
            },
          }),
        },
      },
    })

    expect(tree.scopes.map((scope) => scope.path)).toEqual(["", "/fixtures/two"])
    expect(tree.scopes[1]?.locations[0]).toMatchObject({ kind: "space-root", label: "Root" })
  })

  test("preserves marker, relativePath, and branch fields for project and worktree sessions", async () => {
    const tree = await fetchSessionTree({
      client: {
        workbench: {
          sessionTree: async () => ({
            data: {
              scopes: [{
                key: "space:/proj",
                kind: "space" as const,
                name: "P",
                path: "/proj",
                sessionCount: 3,
                truncated: false,
                locations: [{
                  key: "project:/proj/repo",
                  kind: "project" as const,
                  name: "repo",
                  path: "/proj/repo",
                  sessionCount: 3,
                  sessions: [
                    { id: "root", title: "R", directory: "/proj/repo", directoryHealth: "healthy" as const, marker: "", timeCreated: 1, timeUpdated: 1 },
                    { id: "wt", title: "W", directory: "/outside/wt", directoryHealth: "healthy" as const, marker: "worktree", relativePath: undefined, branch: "feature/x", timeCreated: 2, timeUpdated: 2 },
                    { id: "sub", title: "S", directory: "/proj/repo/pkg", directoryHealth: "healthy" as const, marker: "directory", relativePath: "pkg", timeCreated: 3, timeUpdated: 3 },
                  ],
                }],
              }],
            },
          }),
        },
      },
    })

    const sessions = tree.scopes[0]!.locations[0]!.sessions
    expect(sessions.map((s) => [s.id, s.marker, s.relativePath, s.branch])).toEqual([
      ["root", "", undefined, undefined],
      ["wt", "worktree", undefined, "feature/x"],
      ["sub", "directory", "pkg", undefined],
    ])
  })
})

describe("createSessionGroupsLoader", () => {
  test("keeps the newest response when overlapping requests resolve out of order", async () => {
    const first = deferred<SessionGroup[]>()
    const second = deferred<SessionGroup[]>()
    const commits: string[] = []
    let request = 0

    const loader = createSessionGroupsLoader({
      fetch: () => {
        request += 1
        if (request === 1) return first.promise
        return second.promise
      },
      commit: (groups) => commits.push(groups[0]?.title ?? "empty"),
      setLoading: () => {},
      onError: () => {},
    })

    const initial = loader()
    const refresh = loader()
    second.resolve([{ id: "second", title: "Latest", type: "general", sessionCount: 0, sessions: [] }])
    await refresh
    first.resolve([{ id: "first", title: "Stale", type: "general", sessionCount: 0, sessions: [] }])
    await initial

    expect(commits).toEqual(["Latest"])
  })

  test("skips setLoading(true) when hasData reports existing data (silent refresh)", async () => {
    const loadingEvents: boolean[] = []
    const first = deferred<SessionGroup[]>()
    const second = deferred<SessionGroup[]>()
    let request = 0
    let hasData = false

    const loader = createSessionGroupsLoader({
      fetch: () => {
        request += 1
        return request === 1 ? first.promise : second.promise
      },
      commit: () => { hasData = true },
      setLoading: (v) => { loadingEvents.push(v) },
      onError: () => {},
      hasData: () => hasData,
    })

    const initial = loader()
    first.resolve([])
    await initial
    loadingEvents.length = 0

    const refresh = loader()
    second.resolve([])
    await refresh

    // Silent refresh: no loading toggle at all when data already exists
    expect(loadingEvents).toEqual([])
  })

  test("sets loading on first load when no data exists yet", async () => {
    const loadingEvents: boolean[] = []
    const first = deferred<SessionGroup[]>()

    const loader = createSessionGroupsLoader({
      fetch: () => first.promise,
      commit: () => {},
      setLoading: (v) => { loadingEvents.push(v) },
      onError: () => {},
      hasData: () => false,
    })

    const task = loader()
    first.resolve([])
    await task

    expect(loadingEvents).toEqual([true, false])
  })
})

function makeScope(overrides: Partial<SessionTreeScope> = {}): SessionTreeScope {
  return {
    path: "/space",
    name: "Space",
    kind: "space",
    sessionCount: 1,
    truncated: false,
    locations: [{
      key: "space:/space:root",
      label: "Root",
      kind: "space-root",
      sessions: [{
        id: "s1",
        title: "Session 1",
        directory: "/space",
        directoryHealth: "healthy",
        timeCreated: 1,
        timeUpdated: 2,
      }],
    }],
    ...overrides,
  }
}

describe("mergeTree", () => {
  test("returns next unchanged when prev is empty (initial load)", () => {
    const next: WorkbenchSessionTree = { scopes: [makeScope()] }
    const merged = mergeTree({ scopes: [] }, next)
    expect(merged).toBe(next)
  })

  test("returns prev unchanged when scope/loc/session fields all match", () => {
    const prev: WorkbenchSessionTree = { scopes: [makeScope()] }
    // Reconstruct a structurally equal but reference-distinct tree
    const next: WorkbenchSessionTree = {
      scopes: [{
        path: "/space",
        name: "Space",
        kind: "space",
        sessionCount: 1,
        truncated: false,
        locations: [{
          key: "space:/space:root",
          label: "Root",
          kind: "space-root",
          sessions: [{
            id: "s1",
            title: "Session 1",
            directory: "/space",
            directoryHealth: "healthy",
            timeCreated: 1,
            timeUpdated: 2,
          }],
        }],
      }],
    }
    const merged = mergeTree(prev, next)
    // Identity preserved at every level
    expect(merged).toBe(prev)
    expect(merged.scopes[0]).toBe(prev.scopes[0])
    expect(merged.scopes[0].locations[0]).toBe(prev.scopes[0].locations[0])
    expect(merged.scopes[0].locations[0].sessions[0]).toBe(prev.scopes[0].locations[0].sessions[0])
  })

  test("reuses unchanged session refs and only swaps the one whose title changed", () => {
    const prev: WorkbenchSessionTree = { scopes: [makeScope()] }
    const next: WorkbenchSessionTree = {
      scopes: [{
        path: "/space",
        name: "Space",
        kind: "space",
        sessionCount: 2,
        truncated: false,
        locations: [{
          key: "space:/space:root",
          label: "Root",
          kind: "space-root",
          sessions: [
            { id: "s1", title: "Session 1 RENAMED", directory: "/space", directoryHealth: "healthy", timeCreated: 1, timeUpdated: 3 },
            { id: "s2", title: "Session 2", directory: "/space", directoryHealth: "healthy", timeCreated: 4, timeUpdated: 5 },
          ],
        }],
      }],
    }
    const merged = mergeTree(prev, next)
    expect(merged).not.toBe(prev)             // sessionCount changed → new scope
    expect(merged.scopes[0]).not.toBe(prev.scopes[0])
    expect(merged.scopes[0].locations[0]).not.toBe(prev.scopes[0].locations[0])
    // s1 changed title → new ref
    const mergedS1 = merged.scopes[0].locations[0].sessions.find((s) => s.id === "s1")
    const prevS1 = prev.scopes[0].locations[0].sessions.find((s) => s.id === "s1")
    expect(mergedS1).not.toBe(prevS1)
    expect(mergedS1?.title).toBe("Session 1 RENAMED")
    // s2 is new, never in prev
    expect(merged.scopes[0].locations[0].sessions.find((s) => s.id === "s2")?.title).toBe("Session 2")
  })

  test("returns next when scope count differs (structural change)", () => {
    const prev: WorkbenchSessionTree = { scopes: [makeScope()] }
    const next: WorkbenchSessionTree = { scopes: [makeScope(), makeScope({ path: "/other" })] }
    expect(mergeTree(prev, next)).toBe(next)
  })
})

describe("mergeSessionTreeSessions", () => {
  test("uses the current session projection title before a group refetch completes", () => {
    const local: Session = {
      id: "session-1",
      spaceName: "Space A",
      projectPath: "/space-a",
      type: "chat",
      title: "After",
      directoryHealth: "healthy",
      createdAt: 1,
      lastActiveAt: 1,
    }

    const merged = mergeSessionTreeSessions(
      [{ id: "session-1", title: "Before" }],
      () => false,
      [local],
    )

    expect(merged).toEqual([{ id: "session-1", title: "After", status: "idle" }])
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

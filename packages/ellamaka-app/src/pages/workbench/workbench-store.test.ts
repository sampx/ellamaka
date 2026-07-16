import { describe, expect, test } from "bun:test"
import { createWorkbenchStore, type PersistedWorkbench } from "./workbench-store"

const fixture = (): PersistedWorkbench => ({
  display: {
    showTitlebar: true,
    showStatusbar: true,
    showSpaceRail: true,
  },
  spaces: {
    "/fixtures/space-a": {
      activePanelID: "panel-a",
      panels: [
        {
          id: "panel-a",
          slotState: "bound",
          boundSessionId: "session-a",
          mode: "chat",
          viewMode: "chat",
          directory: "/fixtures/space-a/project-a",
          width: 2,
          tuiPtyId: "pty-a",
        },
        {
          id: "panel-b",
          slotState: "empty",
          mode: "",
          directory: "/fixtures/space-a",
          width: 3,
        },
      ],
    },
  },
  tabs: [
    { name: "General", path: "", type: "general" },
    { name: "Space A", path: "/fixtures/space-a", type: "space" },
  ],
  activeSpaceName: "Space A",
})

describe("WorkbenchStore", () => {
  test("hydrates and snapshots layout without sharing mutable input objects", () => {
    const input = fixture()
    const store = createWorkbenchStore()

    store.hydrate(input)
    input.spaces["/fixtures/space-a"].panels[0].directory = "/mutated"

    expect(store.spaceState("/fixtures/space-a")?.panels[0]?.directory).toBe("/fixtures/space-a/project-a")
    expect(store.snapshot()).toEqual(fixture())
  })

  test("removes a panel synchronously and normalizes the remaining layout", () => {
    const store = createWorkbenchStore(fixture())

    expect(store.removePanel("/fixtures/space-a", "panel-a")).toBe(true)
    expect(store.spaceState("/fixtures/space-a")).toEqual({
      activePanelID: "panel-b",
      panels: [
        {
          id: "panel-b",
          slotState: "empty",
          mode: "",
          directory: "/fixtures/space-a",
          width: 1,
        },
      ],
    })
    expect(store.removePanel("/fixtures/space-a", "panel-b")).toBe(false)
  })

  test("binds and unbinds a server projection without consulting an external store", () => {
    const store = createWorkbenchStore(fixture())

    store.bindSessionToPanel("/fixtures/space-a", "panel-b", {
      id: "session-b",
      directory: "/fixtures/space-a/project-b",
      type: "chat",
    })
    expect(store.spaceState("/fixtures/space-a")?.panels[1]).toMatchObject({
      slotState: "bound",
      boundSessionId: "session-b",
      directory: "/fixtures/space-a/project-b",
      mode: "chat",
      viewMode: "chat",
    })

    expect(store.unbindSessionFromPanel("/fixtures/space-a", "panel-a")).toBe(true)
    expect(store.spaceState("/fixtures/space-a")?.panels[0]).toMatchObject({
      slotState: "empty",
      tuiPtyId: undefined,
      termPtyId: undefined,
      splitPtyId: undefined,
    })
  })

  test("removes a space and its tab while selecting a deterministic fallback", () => {
    const store = createWorkbenchStore(fixture())

    expect(store.removeSpace("/fixtures/space-a")).toBe(true)
    expect(store.spaceState("/fixtures/space-a")).toBeUndefined()
    expect(store.tabs).toEqual([{ name: "General", path: "", type: "general" }])
    expect(store.activeSpaceName).toBe("General")
    expect(store.removeSpace("/fixtures/space-a")).toBe(false)
  })
})

describe("WorkbenchStore hydrate/migrate", () => {
  test("migrates legacy panels without slotState to have default slotState", () => {
    const legacy = {
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {
        "/fixtures/space-a": {
          activePanelID: "panel-a",
          panels: [
            { id: "panel-a", mode: "", directory: "/fixtures/space-a", width: 1 },
            { id: "panel-b", mode: "tui", directory: "/fixtures/space-a", width: 1, tuiPtyId: "pty-1" },
          ],
        },
      },
      tabs: [{ name: "General", path: "", type: "general" }],
      activeSpaceName: "General",
    } as unknown as PersistedWorkbench

    const store = createWorkbenchStore()
    store.hydrate(legacy)

    const space = store.spaceState("/fixtures/space-a")
    expect(space?.panels[0].slotState).toBe("empty")
    expect(space?.panels[0].viewMode).toBeUndefined()
    expect(space?.panels[1].slotState).toBe("bound")
    expect(space?.panels[1].viewMode).toBe("tui")
  })

  test("hydrate prepends General tab when tabs lack a General entry", () => {
    const store = createWorkbenchStore()
    store.hydrate({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [{ name: "Space A", path: "/fixtures/space-a", type: "space" }],
      activeSpaceName: "Space A",
    })

    expect(store.tabs).toEqual([
      { name: "General", path: "", type: "general" },
      { name: "Space A", path: "/fixtures/space-a", type: "space" },
    ])
  })

  test("hydrate does not duplicate General tab when already present", () => {
    const store = createWorkbenchStore()
    store.hydrate({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [
        { name: "General", path: "", type: "general" },
        { name: "Space A", path: "/fixtures/space-a", type: "space" },
      ],
      activeSpaceName: "Space A",
    })

    expect(store.tabs).toHaveLength(2)
  })

  test("hydrate falls back to General when activeSpaceName is falsy", () => {
    const store = createWorkbenchStore()
    store.hydrate({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [{ name: "General", path: "", type: "general" }],
    })

    expect(store.activeSpaceName).toBe("General")
  })

  test("validateTabs removes invalid tabs and falls back to General when activeSpaceName is not in validNames", () => {
    const store = createWorkbenchStore({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [
        { name: "General", path: "", type: "general" },
        { name: "Space A", path: "/fixtures/space-a", type: "space" },
        { name: "Space B", path: "/fixtures/space-b", type: "space" },
      ],
      activeSpaceName: "Space A",
    })

    store.validateTabs(new Set(["Space B"]))

    expect(store.tabs).toEqual([
      { name: "General", path: "", type: "general" },
      { name: "Space B", path: "/fixtures/space-b", type: "space" },
    ])
    expect(store.activeSpaceName).toBe("General")
  })

  test("validateTabs keeps activeSpaceName when it is still valid", () => {
    const store = createWorkbenchStore({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [
        { name: "General", path: "", type: "general" },
        { name: "Space A", path: "/fixtures/space-a", type: "space" },
      ],
      activeSpaceName: "Space A",
    })

    store.validateTabs(new Set(["Space A"]))

    expect(store.tabs).toHaveLength(2)
    expect(store.activeSpaceName).toBe("Space A")
  })
})

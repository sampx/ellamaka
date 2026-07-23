import { describe, expect, test } from "bun:test"
import { createWorkbenchStore, type HydratableWorkbench, type PersistedWorkbench } from "./workbench-store"

const fixture = (): PersistedWorkbench => ({
  schemaVersion: 2,
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
  activeTabPath: "/fixtures/space-a",
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
    const restoredPanel = store.spaceState("/fixtures/space-a")?.panels[0]
    expect(restoredPanel?.slotState).toBe("empty")
    expect(restoredPanel?.tuiPtyId).toBeUndefined()
    expect(restoredPanel?.termPtyId).toBeUndefined()
    expect(restoredPanel?.splitPtyId).toBeUndefined()
  })

  test("removes a space and its tab while selecting a deterministic fallback", () => {
    const store = createWorkbenchStore(fixture())

    expect(store.removeSpace("/fixtures/space-a")).toBe(true)
    expect(store.spaceState("/fixtures/space-a")).toBeUndefined()
    expect(store.tabs).toEqual([{ name: "General", path: "", type: "general" }])
    expect(store.activeSpaceName).toBe("General")
    expect(store.removeSpace("/fixtures/space-a")).toBe(false)
  })

  test("findSessionBinding returns the owning Space path and Panel ID", () => {
    const store = createWorkbenchStore(fixture())
    expect(store.findSessionBinding("session-a")).toEqual({ spacePath: "/fixtures/space-a", panelID: "panel-a" })
    expect(store.findSessionBinding("session-b")).toBeUndefined()
    expect(store.findSessionBinding("missing")).toBeUndefined()
  })

  test("findSessionBinding tracks a session after it is bound to another Panel", () => {
    const store = createWorkbenchStore(fixture())
    store.bindSessionToPanel("/fixtures/space-a", "panel-b", {
      id: "session-b",
      directory: "/fixtures/space-a/project-b",
      type: "chat",
    })
    expect(store.findSessionBinding("session-b")).toEqual({ spacePath: "/fixtures/space-a", panelID: "panel-b" })
    store.unbindSessionFromPanel("/fixtures/space-a", "panel-b")
    expect(store.findSessionBinding("session-b")).toBeUndefined()
  })

  test("findSessionBinding ignores bound sessions in spaces whose tab is not open", () => {
    const store = createWorkbenchStore(fixture())
    // Close Space A tab while keeping space state in store.spaces
    store.removeSpace("/fixtures/space-a")
    expect(store.spaceState("/fixtures/space-a")).toBeUndefined()
    
    // Manually ensure space state exists without tab
    store.ensureSpace("/fixtures/space-a")
    store.bindSessionToPanel("/fixtures/space-a", "panel-a", {
      id: "session-a",
      directory: "/fixtures/space-a/project-a",
      type: "chat",
    })
    // Tab for Space A is not open, so findSessionBinding must return undefined
    expect(store.findSessionBinding("session-a")).toBeUndefined()
    expect(store.isSessionBound("session-a")).toBe(false)
  })
})

describe("WorkbenchStore hydrate/migrate", () => {
  test("migrates a legacy active space name to its unique path identity", () => {
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

    expect(store.activeTabPath).toBe("/fixtures/space-a")
    expect(store.snapshot()).toMatchObject({ schemaVersion: 2, activeTabPath: "/fixtures/space-a" })
  })

  test("keeps duplicate display names distinct by path after migration", () => {
    const store = createWorkbenchStore()
    store.hydrate({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [
        { name: "General", path: "", type: "general" },
        { name: "Shared", path: "/fixtures/one", type: "space" },
        { name: "Shared", path: "/fixtures/two", type: "space" },
      ],
      activeTabPath: "/fixtures/two",
    })

    expect(store.activeTab()?.path).toBe("/fixtures/two")
    store.setActive("/fixtures/one")
    expect(store.activeTabPath).toBe("/fixtures/one")
    store.closeTab("/fixtures/one")
    expect(store.tabs.map((tab) => tab.path)).toEqual(["", "/fixtures/two"])
  })

  test("falls back to General when a legacy display name is ambiguous", () => {
    const store = createWorkbenchStore()
    store.hydrate({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [
        { name: "General", path: "", type: "general" },
        { name: "Shared", path: "/fixtures/one", type: "space" },
        { name: "Shared", path: "/fixtures/two", type: "space" },
      ],
      activeSpaceName: "Shared",
    })

    expect(store.activeTabPath).toBe("")
  })

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
    } satisfies HydratableWorkbench

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

    store.validateTabs(new Set(["/fixtures/space-b"]))

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

    store.validateTabs(new Set(["/fixtures/space-a"]))

    expect(store.tabs).toHaveLength(2)
    expect(store.activeSpaceName).toBe("Space A")
  })

  test("pins and unpins a space tab, preventing close when pinned", () => {
    const store = createWorkbenchStore(fixture())

    expect(store.closeTab("")).toBe(false) // General cannot be closed

    store.pinTab("/fixtures/space-a")
    expect(store.tabs.find((t) => t.path === "/fixtures/space-a")?.pinned).toBe(true)

    // Cannot close pinned tab
    expect(store.closeTab("/fixtures/space-a")).toBe(false)
    expect(store.tabs).toHaveLength(2)

    store.unpinTab("/fixtures/space-a")
    expect(store.tabs.find((t) => t.path === "/fixtures/space-a")?.pinned).toBe(false)

    // Now can close
    expect(store.closeTab("/fixtures/space-a")).toBe(true)
    expect(store.tabs).toHaveLength(1)
  })

  test("pinning preserves the existing tab order", () => {
    const input = fixture()
    input.tabs.push({ name: "Space B", path: "/fixtures/space-b", type: "space" })
    const store = createWorkbenchStore(input)
    const initialOrder = store.tabs.map((tab) => tab.path)

    store.pinTab("/fixtures/space-b")
    expect(store.tabs.map((tab) => tab.path)).toEqual(initialOrder)

    store.unpinTab("/fixtures/space-b")
    expect(store.tabs.map((tab) => tab.path)).toEqual(initialOrder)
  })

  test("clears space state when space is explicitly removed and opens fresh empty panel next time", () => {
    const store = createWorkbenchStore(fixture())

    expect(store.spaces["/fixtures/space-a"]).toBeDefined()
    expect(store.removeSpace("/fixtures/space-a")).toBe(true)

    // Space state must be deleted from spaces map on explicit removeSpace
    expect(store.spaces["/fixtures/space-a"]).toBeUndefined()

    // When opening space again, ensureSpace initializes a clean empty panel
    store.ensureSpace("/fixtures/space-a")
    expect(store.spaces["/fixtures/space-a"]?.panels).toHaveLength(1)
    expect(store.spaces["/fixtures/space-a"]?.panels[0].slotState).toBe("empty")
  })

  test("closes other tabs and closes right tabs while preserving pinned and general tabs", () => {
    const store = createWorkbenchStore({
      display: { showTitlebar: true, showStatusbar: true, showSpaceRail: true },
      spaces: {},
      tabs: [
        { name: "General", path: "", type: "general" },
        { name: "Space A", path: "/space-a", type: "space", pinned: true },
        { name: "Space B", path: "/space-b", type: "space" },
        { name: "Space C", path: "/space-c", type: "space" },
      ],
      activeTabPath: "/space-b",
    })

    store.closeRightTabs("/space-b")
    expect(store.tabs.map((t) => t.path)).toEqual(["", "/space-a", "/space-b"])

    store.closeOtherTabs("/space-b")
    expect(store.tabs.map((t) => t.path)).toEqual(["", "/space-a", "/space-b"])
  })

  test("normalizes Windows backslash paths seamlessly for spaces and tabs lookup", () => {
    const store = createWorkbenchStore()
    const winPath = "C:\\Users\\Sam\\Project"
    const normPath = "C:/Users/Sam/Project"

    store.ensureSpace(winPath)
    expect(store.spaceState(winPath)).toBeDefined()
    expect(store.spaceState(normPath)).toBeDefined()
    expect(store.spaceState(winPath)).toBe(store.spaceState(normPath))

    const panel = store.spaceState(normPath)?.panels[0]
    expect(panel).toBeDefined()

    store.openTab({ name: "Win Project", path: winPath, type: "space" })
    expect(store.activeTabPath).toBe(normPath)
    expect(store.tabs.some((t) => t.path === normPath)).toBe(true)
  })
})

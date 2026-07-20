import { batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { GENERAL_SPACE_NAME } from "./workbench-scope"

export type PanelMode = "" | "tui" | "chat"
export type PanelSlotState = "empty" | "bound"
export type PanelViewMode = string

export type WorkbenchPanel = {
  id: string
  slotState: PanelSlotState
  boundSessionId?: string
  viewMode?: PanelViewMode
  mode: PanelMode
  directory: string
  width: number
  splitTerminal?: boolean
  tuiPtyId?: string
  termPtyId?: string
  splitPtyId?: string
  splitHeight?: number
}

export type SpaceWorkbenchState = {
  panels: WorkbenchPanel[]
  activePanelID: string
}

export type WorkbenchDisplayState = {
  showTitlebar: boolean
  showStatusbar: boolean
  showSpaceRail: boolean
}

export type WopalSpace = {
  name: string
  path: string
  type?: string
  pinned?: boolean
}

export type PersistedWorkbench = {
  schemaVersion?: number
  display: WorkbenchDisplayState
  spaces: Record<string, SpaceWorkbenchState>
  tabs: WopalSpace[]
  activeTabPath?: string
  /** Legacy v1 field. Read only during hydration; never written back. */
  activeSpaceName?: string
}

export type HydratableWorkbench = Omit<PersistedWorkbench, "spaces"> & {
  spaces: Record<string, {
    panels: Array<Omit<WorkbenchPanel, "slotState" | "viewMode"> & {
      slotState?: PanelSlotState
      viewMode?: PanelViewMode
    }>
    activePanelID: string
  }>
}

export type WorkbenchSessionBinding = {
  id: string
  directory: string
  type: PanelMode
}

export const GENERAL_TAB_NAME = GENERAL_SPACE_NAME
export const GENERAL_TAB_PATH = ""

export const DISPLAY_DEFAULTS: WorkbenchDisplayState = {
  showTitlebar: true,
  showStatusbar: true,
  showSpaceRail: true,
}

export const PERSISTED_DEFAULTS: PersistedWorkbench = {
  schemaVersion: 2,
  display: { ...DISPLAY_DEFAULTS },
  spaces: {},
  tabs: [{ name: GENERAL_TAB_NAME, path: GENERAL_TAB_PATH, type: "general" }],
  activeTabPath: GENERAL_TAB_PATH,
}

let nextPanelSequence = 0

function uniquePanelID() {
  nextPanelSequence += 1
  return `p-${Date.now().toString(36)}-${nextPanelSequence}`
}

function defaultSpaceState(directory = "/"): SpaceWorkbenchState {
  const firstID = uniquePanelID()
  return {
    panels: [{ id: firstID, slotState: "empty", mode: "", directory, width: 1 }],
    activePanelID: firstID,
  }
}

function hydratePanel(
  panel: Omit<WorkbenchPanel, "slotState" | "viewMode"> & { slotState?: PanelSlotState; viewMode?: PanelViewMode },
): WorkbenchPanel {
  const viewMode = panel.viewMode ?? (panel.tuiPtyId ? "tui" : undefined)
  return {
    ...panel,
    slotState: panel.slotState ?? (panel.tuiPtyId ? "bound" : "empty"),
    ...(viewMode === undefined ? {} : { viewMode }),
  }
}

export function clonePersistedWorkbench(value: PersistedWorkbench): PersistedWorkbench
export function clonePersistedWorkbench(value: HydratableWorkbench): HydratableWorkbench
export function clonePersistedWorkbench(value: HydratableWorkbench): HydratableWorkbench {
  return {
    schemaVersion: value.schemaVersion,
    display: { ...DISPLAY_DEFAULTS, ...value.display },
    spaces: Object.fromEntries(
      Object.entries(value.spaces ?? {}).map(([spacePath, space]) => [
        spacePath,
        {
          ...space,
          panels: (space.panels ?? []).map((panel) => ({ ...panel })),
        },
      ]),
    ),
    tabs: (value.tabs ?? []).map((tab) => ({ ...tab })),
    ...(value.activeTabPath === undefined ? {} : { activeTabPath: value.activeTabPath }),
    ...(value.activeSpaceName === undefined ? {} : { activeSpaceName: value.activeSpaceName }),
  }
}

function normalizePersistedWorkbench(value: HydratableWorkbench): PersistedWorkbench {
  const snapshot = clonePersistedWorkbench(value)
  const tabs = snapshot.tabs.some((tab) => tab.path === GENERAL_TAB_PATH)
    ? snapshot.tabs
    : [{ name: GENERAL_TAB_NAME, path: GENERAL_TAB_PATH, type: "general" }, ...snapshot.tabs]
  const requestedPath = snapshot.activeTabPath
  const legacyMatches = snapshot.activeSpaceName
    ? tabs.filter((tab) => tab.name === snapshot.activeSpaceName)
    : []
  const activeTabPath = requestedPath !== undefined && tabs.some((tab) => tab.path === requestedPath)
    ? requestedPath
    : legacyMatches.length === 1
      ? legacyMatches[0].path
      : GENERAL_TAB_PATH
  return {
    schemaVersion: 2,
    display: snapshot.display,
    spaces: Object.fromEntries(
      Object.entries(snapshot.spaces).map(([path, space]) => [
        path,
        {
          ...space,
          panels: space.panels.map(hydratePanel),
        },
      ]),
    ),
    tabs,
    activeTabPath,
  }
}

function isPanelMode(mode: PanelViewMode): mode is PanelMode {
  return mode === "" || mode === "tui" || mode === "chat"
}

export function createWorkbenchStore(initial: PersistedWorkbench = PERSISTED_DEFAULTS) {
  const [store, setStore] = createStore<PersistedWorkbench>(normalizePersistedWorkbench(initial))

  function migrateLegacyPanels(path: string) {
    const space = store.spaces[path]
    if (!space?.panels.some((panel) => panel.slotState === undefined)) return
    setStore("spaces", path, "panels", (panels) =>
      panels.map((panel) => {
        if (panel.slotState !== undefined) return panel
        if (panel.tuiPtyId) return { ...panel, slotState: "bound", viewMode: "tui" }
        return { ...panel, slotState: "empty" }
      }),
    )
  }

  function hydrate(value: HydratableWorkbench) {
    const snapshot = normalizePersistedWorkbench(value)
    batch(() => {
      setStore("display", snapshot.display)
      setStore("spaces", snapshot.spaces)
      setStore("tabs", snapshot.tabs)
      setStore("activeTabPath", snapshot.activeTabPath ?? GENERAL_TAB_PATH)
      setStore("schemaVersion", 2)
    })
  }

  function snapshot() {
    return clonePersistedWorkbench(store)
  }

  function trackPersisted() {
    store.schemaVersion
    store.activeTabPath
    store.display.showTitlebar
    store.display.showStatusbar
    store.display.showSpaceRail
    for (const tab of store.tabs) {
      tab.name
      tab.path
      tab.type
      tab.pinned
    }
    for (const [path, space] of Object.entries(store.spaces)) {
      path
      space.activePanelID
      for (const panel of space.panels) {
        panel.id
        panel.slotState
        panel.boundSessionId
        panel.viewMode
        panel.mode
        panel.directory
        panel.width
        panel.splitTerminal
        panel.tuiPtyId
        panel.termPtyId
        panel.splitPtyId
        panel.splitHeight
      }
    }
  }

  function spaceState(path: string): SpaceWorkbenchState | undefined {
    return store.spaces[path]
  }

  function ensureSpace(path: string) {
    if (!store.spaces[path]) {
      setStore("spaces", path, defaultSpaceState(path))
      return
    }
    migrateLegacyPanels(path)
  }

  function addPanel(path: string): string | undefined {
    ensureSpace(path)
    const space = store.spaces[path]
    if (!space || space.panels.length >= 3) return undefined
    const id = uniquePanelID()
    setStore("spaces", path, "panels", space.panels.length, {
      id,
      slotState: "empty",
      mode: "",
      viewMode: "chat",
      directory: path,
      width: 1,
    })
    return id
  }

  function removePanel(path: string, id: string) {
    const space = store.spaces[path]
    if (!space || space.panels.length <= 1 || !space.panels.some((panel) => panel.id === id)) return false
    setStore(
      "spaces",
      path,
      produce((value) => {
        const index = value.panels.findIndex((panel) => panel.id === id)
        if (index === -1) return
        value.panels.splice(index, 1)
        if (value.activePanelID === id) value.activePanelID = value.panels[0]?.id ?? ""
        value.panels.forEach((panel) => {
          panel.width = 1
        })
      }),
    )
    return true
  }

  function setPanelMode(path: string, id: string, mode: PanelMode) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === id, produce((panel) => {
      panel.mode = mode
      panel.viewMode = mode
    }))
  }

  function setPanelPtyId(path: string, id: string, type: "tui" | "term" | "split", ptyID: string | undefined) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === id, produce((panel) => {
      if (type === "tui") panel.tuiPtyId = ptyID
      else if (type === "term") panel.termPtyId = ptyID
      else panel.splitPtyId = ptyID
    }))
  }

  function setPanelSplitTerminal(path: string, id: string, open: boolean) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === id, "splitTerminal", open)
  }

  function setActivePanel(path: string, id: string) {
    ensureSpace(path)
    if (!store.spaces[path]?.panels.some((panel) => panel.id === id)) return
    setStore("spaces", path, "activePanelID", id)
  }

  function setPanelDirectory(path: string, id: string, directory: string) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === id, "directory", directory)
  }

  function setDisplay<K extends keyof WorkbenchDisplayState>(key: K, value: WorkbenchDisplayState[K]) {
    setStore("display", key, value)
  }

  function setPanelWidth(path: string, id: string, width: number) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === id, "width", width)
  }

  function setPanelSplitHeight(path: string, id: string, height: number) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === id, "splitHeight", height)
  }

  function resetPanelWidths(path: string) {
    ensureSpace(path)
    setStore("spaces", path, "panels", () => true, "width", 1)
  }

  function reorderTabs() {
    setStore("tabs", (tabs) => {
      const general = tabs.filter((t) => t.path === GENERAL_TAB_PATH)
      const pinned = tabs.filter((t) => t.path !== GENERAL_TAB_PATH && t.pinned)
      const unpinned = tabs.filter((t) => t.path !== GENERAL_TAB_PATH && !t.pinned)
      return [...general, ...pinned, ...unpinned]
    })
  }

  function pinTab(path: string) {
    if (path === GENERAL_TAB_PATH) return
    const index = store.tabs.findIndex((tab) => tab.path === path)
    if (index !== -1) {
      batch(() => {
        setStore("tabs", index, "pinned", true)
        reorderTabs()
      })
    }
  }

  function unpinTab(path: string) {
    if (path === GENERAL_TAB_PATH) return
    const index = store.tabs.findIndex((tab) => tab.path === path)
    if (index !== -1) {
      batch(() => {
        setStore("tabs", index, "pinned", false)
        reorderTabs()
      })
    }
  }

  function closeTab(path: string) {
    if (path === GENERAL_TAB_PATH) return false
    const index = store.tabs.findIndex((tab) => tab.path === path)
    if (index === -1) return false
    if (store.tabs[index].pinned) return false
    batch(() => {
      setStore("tabs", (tabs) => tabs.filter((tab) => tab.path !== path))
      if (store.activeTabPath === path) {
        const next = store.tabs[index + 1] ?? store.tabs[index - 1]
        setStore("activeTabPath", next?.path ?? GENERAL_TAB_PATH)
      }
    })
    return true
  }

  function closeOtherTabs(path: string) {
    batch(() => {
      setStore("tabs", (tabs) => tabs.filter((tab) => tab.path === GENERAL_TAB_PATH || tab.pinned || tab.path === path))
      if (!store.tabs.some((tab) => tab.path === store.activeTabPath)) {
        setStore("activeTabPath", path)
      }
    })
  }

  function closeRightTabs(path: string) {
    const index = store.tabs.findIndex((tab) => tab.path === path)
    if (index === -1) return
    batch(() => {
      setStore("tabs", (tabs) => tabs.filter((tab, i) => i <= index || tab.path === GENERAL_TAB_PATH || tab.pinned))
      if (!store.tabs.some((tab) => tab.path === store.activeTabPath)) {
        setStore("activeTabPath", path)
      }
    })
  }

  function removeSpace(path: string) {
    if (!store.spaces[path]) return false
    const tab = store.tabs.find((candidate) => candidate.path === path)
    batch(() => {
      if (tab) closeTab(tab.path)
      setStore("spaces", produce((spaces) => {
        delete spaces[path]
      }))
    })
    return true
  }

  function bindSessionToPanel(path: string, panelID: string, session: WorkbenchSessionBinding) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === panelID, produce((panel) => {
      panel.slotState = "bound"
      panel.boundSessionId = session.id
      panel.viewMode = session.type
      panel.mode = session.type
      panel.directory = session.directory || path
    }))
  }

  function unbindSessionFromPanel(path: string, panelID: string) {
    const panel = store.spaces[path]?.panels.find((candidate) => candidate.id === panelID)
    if (!panel || (panel.slotState === "empty" && !panel.boundSessionId)) return false
    setStore("spaces", path, "panels", (candidate) => candidate.id === panelID, produce((value) => {
      value.slotState = "empty"
      value.boundSessionId = undefined
      value.tuiPtyId = undefined
      value.termPtyId = undefined
      value.splitPtyId = undefined
      value.splitTerminal = false
    }))
    return true
  }

  function unbindSessionGlobal(sessionID: string) {
    let changed = false
    batch(() => {
      for (const [path, space] of Object.entries(store.spaces)) {
        for (const panel of space.panels) {
          if (panel.boundSessionId !== sessionID) continue
          changed = unbindSessionFromPanel(path, panel.id) || changed
        }
      }
    })
    return changed
  }

  function setPanelSlotState(path: string, panelID: string, state: PanelSlotState) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === panelID, "slotState", state)
  }

  function setPanelViewMode(path: string, panelID: string, mode: PanelViewMode) {
    ensureSpace(path)
    setStore("spaces", path, "panels", (panel) => panel.id === panelID, produce((panel) => {
      panel.viewMode = mode
      if (isPanelMode(mode)) panel.mode = mode
    }))
  }

  function isSessionBound(sessionID: string) {
    return findSessionBinding(sessionID) !== undefined
  }

  function boundPanelIdForSession(sessionID: string): string | undefined {
    return findSessionBinding(sessionID)?.panelID
  }

  // Canonical, structured binding lookup shared by the deep-link coordinator
  // and the Session Tree. Returns the owning Space path and Panel ID so callers
  // never re-scan `spaces` and lose which Space a binding belongs to.
  function findSessionBinding(sessionID: string): { spacePath: string; panelID: string } | undefined {
    for (const [spacePath, space] of Object.entries(store.spaces)) {
      if (!store.tabs.some((tab) => tab.path === spacePath)) continue
      const panel = space.panels.find(
        (candidate) => candidate.boundSessionId === sessionID && candidate.slotState === "bound",
      )
      if (panel) return { spacePath, panelID: panel.id }
    }
    return undefined
  }

  function activeTab() {
    return store.tabs.find((tab) => tab.path === store.activeTabPath)
  }

  function openTab(space: WopalSpace) {
    batch(() => {
      if (!store.tabs.some((tab) => tab.path === space.path)) {
        setStore("tabs", store.tabs.length, { ...space })
      }
      setStore("activeTabPath", space.path)
    })
  }

  function setActive(path: string) {
    if (store.tabs.some((tab) => tab.path === path)) setStore("activeTabPath", path)
  }

  function validateTabs(validPaths: Set<string>) {
    batch(() => {
      setStore("tabs", (tabs) => {
        const filtered = tabs.filter((tab) => tab.path === GENERAL_TAB_PATH || validPaths.has(tab.path))
        return filtered.length === tabs.length ? tabs : filtered
      })
      const current = store.activeTabPath
      if (!store.tabs.some((tab) => tab.path === current)) {
        setStore("activeTabPath", store.tabs[0]?.path ?? GENERAL_TAB_PATH)
      }
    })
  }

  return {
    hydrate,
    snapshot,
    trackPersisted,
    get display() { return store.display },
    get spaces() { return store.spaces },
    spaceState,
    ensureSpace,
    addPanel,
    removePanel,
    setPanelMode,
    setPanelPtyId,
    setPanelSplitTerminal,
    setActivePanel,
    setPanelDirectory,
    setDisplay,
    removeSpace,
    setPanelWidth,
    setPanelSplitHeight,
    resetPanelWidths,
    bindSessionToPanel,
    unbindSessionFromPanel,
    unbindSessionGlobal,
    setPanelSlotState,
    setPanelViewMode,
    isSessionBound,
    boundPanelIdForSession,
    findSessionBinding,
    get tabs() { return store.tabs },
    activeTab,
    get activeDirectory() {
      const tab = activeTab()
      const space = tab ? store.spaces[tab.path] : undefined
      return space?.panels.find((panel) => panel.id === space.activePanelID)?.directory ?? ""
    },
    get activeTabPath() { return store.activeTabPath ?? GENERAL_TAB_PATH },
    get activeSpaceName() { return activeTab()?.name ?? GENERAL_TAB_NAME },
    openTab,
    closeTab,
    closeOtherTabs,
    closeRightTabs,
    pinTab,
    unpinTab,
    setActive,
    validateTabs,
  }
}

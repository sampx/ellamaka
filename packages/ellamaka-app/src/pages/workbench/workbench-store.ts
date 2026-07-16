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
}

export type PersistedWorkbench = {
  display: WorkbenchDisplayState
  spaces: Record<string, SpaceWorkbenchState>
  tabs: WopalSpace[]
  activeSpaceName?: string
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
  display: { ...DISPLAY_DEFAULTS },
  spaces: {},
  tabs: [{ name: GENERAL_TAB_NAME, path: GENERAL_TAB_PATH, type: "general" }],
  activeSpaceName: GENERAL_TAB_NAME,
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

export function clonePersistedWorkbench(value: PersistedWorkbench): PersistedWorkbench {
  return {
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
    activeSpaceName: value.activeSpaceName,
  }
}

function isPanelMode(mode: PanelViewMode): mode is PanelMode {
  return mode === "" || mode === "tui" || mode === "chat"
}

export function createWorkbenchStore(initial: PersistedWorkbench = PERSISTED_DEFAULTS) {
  const [store, setStore] = createStore<PersistedWorkbench>(clonePersistedWorkbench(initial))

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

  function hydrate(value: PersistedWorkbench) {
    const snapshot = clonePersistedWorkbench(value)
    const tabs = snapshot.tabs.some((tab) => tab.path === GENERAL_TAB_PATH)
      ? snapshot.tabs
      : [{ name: GENERAL_TAB_NAME, path: GENERAL_TAB_PATH, type: "general" }, ...snapshot.tabs]
    batch(() => {
      setStore("display", snapshot.display)
      setStore("spaces", snapshot.spaces)
      setStore("tabs", tabs)
      setStore("activeSpaceName", snapshot.activeSpaceName || GENERAL_TAB_NAME)
    })
    for (const path of Object.keys(snapshot.spaces)) migrateLegacyPanels(path)
  }

  function snapshot() {
    return clonePersistedWorkbench(store)
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

  function closeTab(name: string) {
    if (name === GENERAL_TAB_NAME) return false
    const index = store.tabs.findIndex((tab) => tab.name === name)
    if (index === -1) return false
    batch(() => {
      setStore("tabs", (tabs) => tabs.filter((tab) => tab.name !== name))
      if (store.activeSpaceName === name) {
        const next = store.tabs[index + 1] ?? store.tabs[index - 1]
        setStore("activeSpaceName", next?.name ?? GENERAL_TAB_NAME)
      }
    })
    return true
  }

  function removeSpace(path: string) {
    if (!store.spaces[path]) return false
    const tab = store.tabs.find((candidate) => candidate.path === path)
    batch(() => {
      if (tab) closeTab(tab.name)
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
    return Object.values(store.spaces).some((space) =>
      space.panels.some((panel) => panel.boundSessionId === sessionID && panel.slotState === "bound"),
    )
  }

  function boundPanelIdForSession(sessionID: string): string | undefined {
    for (const space of Object.values(store.spaces)) {
      const panel = space.panels.find((candidate) =>
        candidate.boundSessionId === sessionID && candidate.slotState === "bound",
      )
      if (panel) return panel.id
    }
    return undefined
  }

  function activeTab() {
    return store.tabs.find((tab) => tab.name === store.activeSpaceName)
  }

  function openTab(space: WopalSpace) {
    batch(() => {
      if (!store.tabs.some((tab) => tab.name === space.name)) {
        setStore("tabs", store.tabs.length, { ...space })
      }
      setStore("activeSpaceName", space.name)
    })
  }

  function setActive(name: string) {
    if (store.tabs.some((tab) => tab.name === name)) setStore("activeSpaceName", name)
  }

  function validateTabs(validNames: Set<string>) {
    batch(() => {
      setStore("tabs", (tabs) => {
        const filtered = tabs.filter((tab) => tab.name === GENERAL_TAB_NAME || validNames.has(tab.name))
        return filtered.length === tabs.length ? tabs : filtered
      })
      const current = store.activeSpaceName
      if (current && current !== GENERAL_TAB_NAME && !validNames.has(current)) {
        setStore("activeSpaceName", store.tabs[0]?.name ?? GENERAL_TAB_NAME)
      } else if (!current && store.tabs.length > 0) {
        setStore("activeSpaceName", store.tabs[0].name)
      }
    })
  }

  return {
    hydrate,
    snapshot,
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
    get tabs() { return store.tabs },
    activeTab,
    get activeDirectory() {
      const tab = activeTab()
      const space = tab ? store.spaces[tab.path] : undefined
      return space?.panels.find((panel) => panel.id === space.activePanelID)?.directory ?? ""
    },
    get activeSpaceName() { return store.activeSpaceName },
    openTab,
    closeTab,
    setActive,
    validateTabs,
  }
}

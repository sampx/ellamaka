import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export type PanelMode = "tui" | "chat"

export type WorkbenchPanel = {
  id: string
  mode: PanelMode
  directory: string
  width: number
}

export type SpaceWorkbenchState = {
  panels: WorkbenchPanel[]
  activePanelID: string
  terminalDockOpen: boolean
}

export type WorkbenchDisplayState = {
  showTitlebar: boolean
  showStatusbar: boolean
  showSpaceRail: boolean
}

type PersistedWorkbench = {
  display: WorkbenchDisplayState
  spaces: Record<string, SpaceWorkbenchState>
}

function defaultSpaceState(directory = "/"): SpaceWorkbenchState {
  const firstID = uniqueID()
  return {
    panels: [{ id: firstID, mode: "tui", directory, width: 1 }],
    activePanelID: firstID,
    terminalDockOpen: false,
  }
}

let _nextPanelSeq = 0
function uniqueID(): string {
  _nextPanelSeq++
  const ts = Date.now().toString(36)
  return `p-${ts}-${_nextPanelSeq}`
}

const DISPLAY_DEFAULTS: WorkbenchDisplayState = {
  showTitlebar: true,
  showStatusbar: true,
  showSpaceRail: true,
}

const PERSISTED_DEFAULTS: PersistedWorkbench = {
  display: { ...DISPLAY_DEFAULTS },
  spaces: {},
}

export const { use: useWorkbenchState, provider: WorkbenchStateProvider } = createSimpleContext({
  name: "WorkbenchState",
  init: () => {
    const [store, setStore] = persisted(
      Persist.global("workbench.v2", ["workbench", "workbench.v1"]),
      createStore<PersistedWorkbench>(PERSISTED_DEFAULTS),
    )

    const display = createMemo(() => store.display)

    function spaceState(path: string): SpaceWorkbenchState | undefined {
      return store.spaces[path]
    }

    function ensureSpace(path: string) {
      if (!store.spaces[path]) setStore("spaces", path, defaultSpaceState(path))
    }

    function addPanel(path: string): string | undefined {
      ensureSpace(path)
      const space = store.spaces[path]
      if (!space || space.panels.length >= 3) return
      const id = uniqueID()
      setStore("spaces", path, "panels", (panels) => [
        ...panels,
        { id, mode: "tui" as PanelMode, directory: path, width: 1 },
      ])
      return id
    }

    function removePanel(path: string, id: string) {
      const space = store.spaces[path]
      if (!space || space.panels.length <= 1) return
      batch(() => {
        setStore(
          "spaces",
          path,
          produce((s) => {
            s.panels = s.panels.filter((p) => p.id !== id)
            if (s.activePanelID === id) s.activePanelID = s.panels[0]?.id ?? ""
          }),
        )
      })
    }

    function setPanelMode(path: string, id: string, mode: PanelMode) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === id,
        produce((panel) => {
          panel.mode = mode
        }),
      )
    }

    function setActivePanel(path: string, id: string) {
      ensureSpace(path)
      setStore("spaces", path, "activePanelID", id)
    }

    function setPanelDirectory(path: string, id: string, directory: string) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === id,
        produce((panel) => {
          panel.directory = directory
        }),
      )
    }

    function toggleTerminalDock(path: string) {
      ensureSpace(path)
      setStore("spaces", path, "terminalDockOpen", (v) => !v)
    }

    function setDisplay<K extends keyof WorkbenchDisplayState>(key: K, value: WorkbenchDisplayState[K]) {
      setStore("display", key, value)
    }

    return {
      display,
      spaceState,
      ensureSpace,
      addPanel,
      removePanel,
      setPanelMode,
      setActivePanel,
      setPanelDirectory,
      toggleTerminalDock,
      setDisplay,
    }
  },
})

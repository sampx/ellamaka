import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionStore } from "./session-store"

export type PanelMode = "tui" | "chat" | "terminal"
export type PanelSlotState = "empty" | "open" | "bound"
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
    panels: [{ id: firstID, slotState: "empty", mode: "" as PanelMode, directory, width: 1 }],
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
    const sdk = useServerSDK()
    const sessionStore = useSessionStore()
    const [store, setStore] = persisted(
      Persist.global("workbench.v2", ["workbench", "workbench.v1"]),
      createStore<PersistedWorkbench>(PERSISTED_DEFAULTS),
    )

    const display = createMemo(() => store.display)

    // PTY instances don't survive page refresh — clear stale IDs on mount.
    // slotState, boundSessionId, directory etc. are preserved; view-registry
    // will recreate PTY connections as needed via createEffect.
    onMount(() => {
      Object.keys(store.spaces).forEach((path) => clearSpacePtyIds(path))
    })

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

    function migrateLegacyPanels(path: string) {
      const space = store.spaces[path]
      if (!space) return
      const needsMigration = space.panels.some(
        (p) => (p as Record<string, unknown>).slotState === undefined,
      )
      if (!needsMigration) return
      setStore("spaces", path, "panels", (panels) =>
        panels.map((panel) => {
          if ((panel as Record<string, unknown>).slotState !== undefined) return panel
          if (panel.tuiPtyId) {
            return { ...panel, slotState: "bound" as PanelSlotState, viewMode: "tui" }
          }
          if (panel.termPtyId) {
            return { ...panel, slotState: "open" as PanelSlotState, viewMode: "terminal" }
          }
          return { ...panel, slotState: "empty" as PanelSlotState }
        }),
      )
    }

    function addPanel(path: string): string | undefined {
      ensureSpace(path)
      const space = store.spaces[path]
      if (!space || space.panels.length >= 3) return
      const id = uniqueID()
      setStore("spaces", path, "panels", (panels) => [
        ...panels,
        { id, slotState: "empty" as PanelSlotState, mode: "" as PanelMode, directory: path, width: 1 },
      ])
      return id
    }

    function removePanel(path: string, id: string) {
      const space = store.spaces[path]
      if (!space || space.panels.length <= 1) return

      const panel = space.panels.find((p) => p.id === id)
      if (panel) {
        // Skip tuiPtyId for bound panels — let TUI process exit naturally
        if (panel.tuiPtyId && panel.slotState !== "bound") {
          sdk.client.pty.remove({ ptyID: panel.tuiPtyId }).catch(console.error)
        }
        if (panel.termPtyId) {
          sdk.client.pty.remove({ ptyID: panel.termPtyId }).catch(console.error)
        }
        if (panel.splitPtyId) {
          sdk.client.pty.remove({ ptyID: panel.splitPtyId }).catch(console.error)
        }
      }

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
          panel.viewMode = mode
        }),
      )
    }

    function setPanelPtyId(path: string, id: string, type: "tui" | "term" | "split", ptyId: string | undefined) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === id,
        produce((panel) => {
          if (type === "tui") panel.tuiPtyId = ptyId
          else if (type === "term") panel.termPtyId = ptyId
          else if (type === "split") panel.splitPtyId = ptyId
        }),
      )
    }

    function setPanelSplitTerminal(path: string, id: string, open: boolean) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === id,
        produce((panel) => {
          panel.splitTerminal = open
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

    function setPanelWidth(path: string, id: string, width: number) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === id,
        produce((panel) => {
          panel.width = width
        }),
      )
    }

    function setPanelSplitHeight(path: string, id: string, height: number) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === id,
        produce((panel) => {
          panel.splitHeight = height
        }),
      )
    }

    function resetPanelWidths(path: string) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        () => true,
        produce((panel) => {
          panel.width = 1
        }),
      )
    }

    function clearSpacePtyIds(path: string) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        () => true,
        produce((panel) => {
          panel.tuiPtyId = undefined
          panel.termPtyId = undefined
          panel.splitPtyId = undefined
        }),
      )
    }

    function removeSpace(path: string) {
      if (!store.spaces[path]) return
      setStore(
        "spaces",
        produce((spaces) => {
          delete spaces[path]
        }),
      )
    }

    function bindSessionToPanel(path: string, panelId: string, sessionId: string) {
      ensureSpace(path)
      const session = sessionStore.getSession(sessionId)
      if (!session) return
      const sessionDir = session.projectPath || path
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === panelId,
        produce((panel) => {
          panel.slotState = "bound"
          panel.boundSessionId = sessionId
          panel.viewMode = session.type
          panel.mode = session.type as PanelMode
          panel.directory = sessionDir
        }),
      )
    }

    function unbindSessionFromPanel(path: string, panelId: string) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === panelId,
        produce((panel) => {
          panel.slotState = "empty"
          panel.boundSessionId = undefined
          panel.viewMode = undefined
          panel.mode = "" as PanelMode
        }),
      )
    }

    function setPanelSlotState(path: string, panelId: string, state: PanelSlotState) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === panelId,
        produce((panel) => {
          panel.slotState = state
        }),
      )
    }

    function setPanelViewMode(path: string, panelId: string, mode: PanelViewMode) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === panelId,
        produce((panel) => {
          panel.viewMode = mode
          panel.mode = mode as PanelMode
        }),
      )
    }

    function openTerminalInPanel(path: string, panelId: string, directory: string) {
      ensureSpace(path)
      setStore(
        "spaces",
        path,
        "panels",
        (p) => p.id === panelId,
        produce((panel) => {
          panel.slotState = "open"
          panel.viewMode = "terminal"
          panel.mode = "terminal" as PanelMode
          panel.directory = directory
        }),
      )
    }

    return {
      display,
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
      toggleTerminalDock,
      setDisplay,
      clearSpacePtyIds,
      removeSpace,
      setPanelWidth,
      setPanelSplitHeight,
      resetPanelWidths,
      bindSessionToPanel,
      unbindSessionFromPanel,
      setPanelSlotState,
      setPanelViewMode,
      openTerminalInPanel,
    }
  },
})

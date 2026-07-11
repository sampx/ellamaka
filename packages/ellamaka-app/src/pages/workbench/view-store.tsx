import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, onMount, createEffect, createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { makePersisted } from "@solid-primitives/storage"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionStore } from "./session-store"
import { ptyManager, ptyReferences } from "./pty-manager"

export type PanelMode = "tui" | "chat"
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

type PersistedWorkbench = {
  display: WorkbenchDisplayState
  spaces: Record<string, SpaceWorkbenchState>
  tabs: WopalSpace[]
  activeSpaceName?: string
}

function defaultSpaceState(directory = "/"): SpaceWorkbenchState {
  const firstID = uniqueID()
  return {
    panels: [{ id: firstID, slotState: "empty", mode: "" as PanelMode, directory, width: 1 }],
    activePanelID: firstID,
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

export const GENERAL_TAB_NAME = "General"
export const GENERAL_TAB_PATH = ""

const PERSISTED_DEFAULTS: PersistedWorkbench = {
  display: { ...DISPLAY_DEFAULTS },
  spaces: {},
  tabs: [{ name: GENERAL_TAB_NAME, path: GENERAL_TAB_PATH, type: "general" }],
  activeSpaceName: GENERAL_TAB_NAME,
}

export const { use: useWorkbenchState, provider: WorkbenchStateProvider } = createSimpleContext({
  name: "WorkbenchState",
  init: () => {
    const sdk = useServerSDK()
    const sessionStore = useSessionStore()

    // 物理擦除历史 Key 债务，干净无污染
    if (typeof window !== "undefined" && window.localStorage) {
      const dirtyKeys = ["workbench.v2", "workbench.v1", "workbench.spacetabs", "workbench.activespace"]
      for (const key of dirtyKeys) {
        try {
          window.localStorage.removeItem(key)
        } catch (e) {
          console.error("Failed to remove legacy storage key", key, e)
        }
      }
    }

    // 1. 使用 sessionStorage 进行多 Tab 隔离存储
    const [persistedStore, setPersistedStore] = makePersisted(
      createStore<PersistedWorkbench>(PERSISTED_DEFAULTS),
      {
        name: "workbench",
        storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
      }
    )

    // 2. 内存工作 Store - 支持 0 延迟实时交互
    const [store, setStore] = createStore<PersistedWorkbench>(JSON.parse(JSON.stringify(PERSISTED_DEFAULTS)))
    const [storeHydrated, setStoreHydrated] = createSignal(false)

    // 在 mounted 时，一次性同步复制 sessionStorage 的数据至运行 Store
    onMount(() => {
      const snapshot = JSON.parse(JSON.stringify(persistedStore))
      let tabs = snapshot.tabs || []
      if (!tabs.some((t: any) => t.path === GENERAL_TAB_PATH)) {
        tabs = [{ name: GENERAL_TAB_NAME, path: GENERAL_TAB_PATH, type: "general" }, ...tabs]
      }
      batch(() => {
        setStore("display", snapshot.display)
        setStore("spaces", snapshot.spaces)
        setStore("tabs", tabs)
        setStore("activeSpaceName", snapshot.activeSpaceName || GENERAL_TAB_NAME)
      })
      setStoreHydrated(true)
    })

    const ready = () => storeHydrated()

    const [refreshVersion, setRefreshVersion] = createSignal(0)
    function triggerRefresh() {
      setRefreshVersion((v) => v + 1)
    }

    const [statusMessage, setStatusMessage] = createSignal("提示：双击会话或拖拽会话到面板中即可在工作台打开")

    // 3. 150ms debounce 防抖优化写入
    let saveTimer: any = null
    let isDirty = false

    const syncToPersisted = () => {
      if (!isDirty) return
      isDirty = false
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const snapshot = JSON.parse(JSON.stringify(store))
      batch(() => {
        setPersistedStore("display", snapshot.display)
        setPersistedStore("spaces", snapshot.spaces)
        setPersistedStore("tabs", snapshot.tabs)
        setPersistedStore("activeSpaceName", snapshot.activeSpaceName)
      })
    }

    const queueSave = () => {
      isDirty = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(syncToPersisted, 150)
    }

    createEffect(() => {
      // 建立深度响应式依赖
      JSON.stringify(store)
      if (ready() && storeHydrated()) {
        queueSave()
      }
    })

    // 4. visibilitychange/pagehide 事件同步 Flush 门禁
    onMount(() => {
      const handleVisibility = () => {
        if (document.visibilityState === "hidden") {
          syncToPersisted()
        }
      }
      window.addEventListener("visibilitychange", handleVisibility)
      window.addEventListener("pagehide", syncToPersisted)
      onCleanup(() => {
        window.removeEventListener("visibilitychange", handleVisibility)
        window.removeEventListener("pagehide", syncToPersisted)
        if (saveTimer) clearTimeout(saveTimer)
      })
    })

    const display = createMemo(() => store.display)

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
          return { ...panel, slotState: "empty" as PanelSlotState }
        }),
      )
    }

    function addPanel(path: string): string | undefined {
      ensureSpace(path)
      const space = store.spaces[path]
      if (!space || space.panels.length >= 3) return
      const id = uniqueID()
      setStore("spaces", path, "panels", space.panels.length, {
        id,
        slotState: "empty" as PanelSlotState,
        mode: "" as PanelMode,
        viewMode: "chat",
        directory: path,
        width: 1,
      })
      return id
    }

    function removePanel(path: string, id: string) {
      const space = store.spaces[path]
      if (!space || space.panels.length <= 1) return

      const panel = space.panels.find((p) => p.id === id)
      if (panel) {
        void ptyManager.disposePanel(path, id, sdk, ptyReferences(panel))
      }

      batch(() => {
        setStore(
          "spaces",
          path,
          produce((s) => {
            const index = s.panels.findIndex((p) => p.id === id)
            if (index !== -1) {
              s.panels.splice(index, 1)
            }
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
      // 同时在 Tabs 中关闭对应的 tab
      const foundTab = store.tabs.find((t) => t.path === path)
      if (foundTab) {
        closeTab(foundTab.name)
      }
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
        }),
      )
    }

    function unbindSessionGlobal(sessionId: string) {
      batch(() => {
        Object.keys(store.spaces).forEach((path) => {
          const space = store.spaces[path]
          if (!space) return
          space.panels.forEach((panel) => {
            if (panel.boundSessionId === sessionId) {
              unbindSessionFromPanel(path, panel.id)
            }
          })
        })
      })
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

    // 5. 动态计算 Session 状态派生，实现单向解耦
    function isSessionBound(sessionId: string): boolean {
      for (const spacePath of Object.keys(store.spaces)) {
        const space = store.spaces[spacePath]
        if (!space) continue
        const found = space.panels.some((p) => p.boundSessionId === sessionId && p.slotState === "bound")
        if (found) return true
      }
      return false
    }

    function boundPanelIdForSession(sessionId: string): string | undefined {
      for (const spacePath of Object.keys(store.spaces)) {
        const space = store.spaces[spacePath]
        if (!space) continue
        const found = space.panels.find((p) => p.boundSessionId === sessionId && p.slotState === "bound")
        if (found) return found.id
      }
      return undefined
    }

    // 6. Tabs 和 Active Space 逻辑合并
    const activeTab = createMemo(() => store.tabs.find((t) => t.name === store.activeSpaceName))

    function openTab(space: WopalSpace) {
      batch(() => {
        if (!store.tabs.find((t) => t.name === space.name)) {
          setStore("tabs", store.tabs.length, { name: space.name, path: space.path, type: space.type })
        }
        setStore("activeSpaceName", space.name)
      })
    }

    function closeTab(name: string) {
      if (name === GENERAL_TAB_NAME) return
      batch(() => {
        const idx = store.tabs.findIndex((t) => t.name === name)
        if (idx === -1) return
        setStore("tabs", (arr) => arr.filter((t) => t.name !== name))
        if (store.activeSpaceName === name) {
          const next = store.tabs[idx + 1] ?? store.tabs[idx - 1]
          setStore("activeSpaceName", next?.name)
        }
      })
    }

    function setActive(name: string) {
      if (store.tabs.find((t) => t.name === name)) {
        setStore("activeSpaceName", name)
      }
    }

    function validateTabs(validNames: Set<string>) {
      batch(() => {
        setStore("tabs", (prev) => {
          const filtered = prev.filter((t) => t.name === GENERAL_TAB_NAME || validNames.has(t.name))
          return filtered.length === prev.length ? prev : filtered
        })
        const current = store.activeSpaceName
        if (current && current !== GENERAL_TAB_NAME && !validNames.has(current)) {
          setStore("activeSpaceName", store.tabs[0]?.name)
        } else if (!current && store.tabs.length > 0) {
          setStore("activeSpaceName", store.tabs[0].name)
        }
      })
    }

    return {
      ready: storeHydrated,
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
      setDisplay,
      clearSpacePtyIds,
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
      get activeSpaceName() { return store.activeSpaceName },
      openTab,
      closeTab,
      setActive,
      validateTabs,
      get statusMessage() { return statusMessage() },
      setStatusMessage,
      get refreshVersion() { return refreshVersion() },
      triggerRefresh,
    }
  },
})

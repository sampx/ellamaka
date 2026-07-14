import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { batch, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import {
  clonePersistedWorkbench,
  createWorkbenchStore,
  PERSISTED_DEFAULTS,
  type PersistedWorkbench,
  type WorkbenchSessionBinding,
} from "./workbench-store"

export {
  DISPLAY_DEFAULTS,
  GENERAL_TAB_NAME,
  GENERAL_TAB_PATH,
  type PanelMode,
  type PanelSlotState,
  type PanelViewMode,
  type SpaceWorkbenchState,
  type WorkbenchDisplayState,
  type WorkbenchPanel,
  type WopalSpace,
} from "./workbench-store"

const STATUS_MESSAGE_DURATION = 5_000

const WorkbenchStateContext = createSimpleContext({
  name: "WorkbenchState",
  init: () => {
    const workbench = createWorkbenchStore()
    const [hydrated, setHydrated] = createSignal(false)

    if (typeof window !== "undefined" && window.localStorage) {
      for (const key of ["workbench.v2", "workbench.v1", "workbench.spacetabs", "workbench.activespace"]) {
        try {
          window.localStorage.removeItem(key)
        } catch (error) {
          console.error("Failed to remove legacy storage key", key, error)
        }
      }
    }

    const [persisted, setPersisted] = makePersisted(
      createStore<PersistedWorkbench>(clonePersistedWorkbench(PERSISTED_DEFAULTS)),
      {
        name: "workbench",
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
      },
    )

    onMount(() => {
      workbench.hydrate(persisted)
      setHydrated(true)
    })

    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let dirty = false

    const syncToPersisted = () => {
      if (!dirty) return
      dirty = false
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = undefined
      const snapshot = workbench.snapshot()
      batch(() => {
        setPersisted("display", snapshot.display)
        setPersisted("spaces", snapshot.spaces)
        setPersisted("tabs", snapshot.tabs)
        setPersisted("activeSpaceName", snapshot.activeSpaceName)
      })
    }

    const queueSave = () => {
      dirty = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(syncToPersisted, 150)
    }

    createEffect(() => {
      JSON.stringify(workbench.snapshot())
      if (hydrated()) queueSave()
    })

    onMount(() => {
      const handleVisibility = () => {
        if (document.visibilityState === "hidden") syncToPersisted()
      }
      const handlePageHide = () => syncToPersisted()
      window.addEventListener("visibilitychange", handleVisibility)
      window.addEventListener("pagehide", handlePageHide)
      onCleanup(() => {
        window.removeEventListener("visibilitychange", handleVisibility)
        window.removeEventListener("pagehide", handlePageHide)
        if (saveTimer) clearTimeout(saveTimer)
      })
    })

    const [refreshVersion, setRefreshVersion] = createSignal(0)
    const [persistentHint, setPersistentHintValue] = createSignal("")
    const [statusMessage, setStatusMessageValue] = createSignal("")
    let persistentHintTimer: ReturnType<typeof setTimeout> | undefined
    let statusMessageTimer: ReturnType<typeof setTimeout> | undefined

    const timedMessage = (
      message: string,
      timer: ReturnType<typeof setTimeout> | undefined,
      setTimer: (value: ReturnType<typeof setTimeout> | undefined) => void,
      setValue: (value: string) => void,
    ) => {
      if (timer) clearTimeout(timer)
      setTimer(undefined)
      setValue(message)
      if (!message) return
      setTimer(setTimeout(() => {
        setValue("")
        setTimer(undefined)
      }, STATUS_MESSAGE_DURATION))
    }

    const setPersistentHint = (message: string) => {
      timedMessage(message, persistentHintTimer, (value) => { persistentHintTimer = value }, setPersistentHintValue)
    }
    const setStatusMessage = (message: string) => {
      timedMessage(message, statusMessageTimer, (value) => { statusMessageTimer = value }, setStatusMessageValue)
    }

    onCleanup(() => {
      if (persistentHintTimer) clearTimeout(persistentHintTimer)
      if (statusMessageTimer) clearTimeout(statusMessageTimer)
    })

    const bindSessionToPanel = (path: string, panelID: string, session: WorkbenchSessionBinding) =>
      workbench.bindSessionToPanel(path, panelID, session)

    return {
      ready: hydrated,
      display: () => workbench.display,
      get spaces() { return workbench.spaces },
      spaceState: workbench.spaceState,
      ensureSpace: workbench.ensureSpace,
      addPanel: workbench.addPanel,
      removePanel: workbench.removePanel,
      setPanelMode: workbench.setPanelMode,
      setPanelPtyId: workbench.setPanelPtyId,
      setPanelSplitTerminal: workbench.setPanelSplitTerminal,
      setActivePanel: workbench.setActivePanel,
      setPanelDirectory: workbench.setPanelDirectory,
      setDisplay: workbench.setDisplay,
      removeSpace: workbench.removeSpace,
      setPanelWidth: workbench.setPanelWidth,
      setPanelSplitHeight: workbench.setPanelSplitHeight,
      resetPanelWidths: workbench.resetPanelWidths,
      bindSessionToPanel,
      unbindSessionFromPanel: workbench.unbindSessionFromPanel,
      unbindSessionGlobal: workbench.unbindSessionGlobal,
      setPanelSlotState: workbench.setPanelSlotState,
      setPanelViewMode: workbench.setPanelViewMode,
      isSessionBound: workbench.isSessionBound,
      boundPanelIdForSession: workbench.boundPanelIdForSession,
      get tabs() { return workbench.tabs },
      activeTab: workbench.activeTab,
      get activeDirectory() { return workbench.activeDirectory },
      get activeSpaceName() { return workbench.activeSpaceName },
      openTab: workbench.openTab,
      closeTab: workbench.closeTab,
      setActive: workbench.setActive,
      validateTabs: workbench.validateTabs,
      get statusMessage() { return statusMessage() },
      setStatusMessage,
      get persistentHint() { return persistentHint() },
      setPersistentHint,
      get refreshVersion() { return refreshVersion() },
      triggerRefresh: () => setRefreshVersion((version) => version + 1),
    }
  },
})

export const useWorkbenchState = () => WorkbenchStateContext.use()
export const WorkbenchStateProvider = WorkbenchStateContext.provider

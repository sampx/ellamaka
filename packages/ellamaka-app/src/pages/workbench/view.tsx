import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export type WorkbenchView = "tui" | "chat" | "split"

export type WorkbenchPanel = "spaces" | "search" | "history"

export type WorkbenchState = {
  view: WorkbenchView
  activePanel: WorkbenchPanel
}

const DEFAULT_STATE: WorkbenchState = {
  view: "tui",
  activePanel: "spaces",
}

export const { use: useWorkbench, provider: WorkbenchProvider } = createSimpleContext({
  name: "Workbench",
  init: () => {
    const [store, setStore] = persisted(
      Persist.global("workbench", ["workbench.v1"]),
      createStore<WorkbenchState>({ ...DEFAULT_STATE }),
    )

    const view = createMemo(() => store.view)
    const activePanel = createMemo(() => store.activePanel)

    function setView(next: WorkbenchView) {
      if (store.view === next) return
      setStore("view", next)
    }

    function setPanel(next: WorkbenchPanel) {
      if (store.activePanel === next) return
      setStore("activePanel", next)
    }

    function togglePanel(next: WorkbenchPanel) {
      setStore("activePanel", (current) => (current === next ? "spaces" : next))
    }

    return {
      view,
      activePanel,
      setView,
      setPanel,
      togglePanel,
    }
  },
})
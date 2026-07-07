import { Show, createMemo, onMount, onCleanup } from "solid-js"
import { SpaceStoreProvider, useSpaceStore } from "./space-store"
import { WorkbenchStateProvider, useWorkbenchState } from "./view"
import { WorkbenchTitlebar } from "./parts/top-bar"
import { SpaceRail } from "./parts/sidebar"
import { Workspace } from "./parts/workspace"
import { StatusBar } from "./parts/status-bar"
import { BottomDock } from "./parts/bottom-dock"
import { useServerSDK } from "@/context/server-sdk"

function BottomDockController() {
  const store = useSpaceStore()
  const wb = useWorkbenchState()

  const terminalOpen = createMemo(() => {
    const tab = store.activeTab()
    if (!tab) return false
    const state = wb.spaceState(tab.path)
    return state?.terminalDockOpen ?? false
  })

  return <BottomDock open={terminalOpen()} />
}

function WorkbenchShell() {
  const wb = useWorkbenchState()
  const display = () => wb.display()
  const sdk = useServerSDK()

  onMount(() => {
    const handleUnload = () => {
      Object.keys(wb.spaces).forEach((path) => {
        const space = wb.spaces[path]
        if (space) {
          space.panels.forEach((panel) => {
            if (panel.tuiPtyId) {
              sdk.client.pty.remove({ ptyID: panel.tuiPtyId }).catch(console.error)
            }
            if (panel.termPtyId) {
              sdk.client.pty.remove({ ptyID: panel.termPtyId }).catch(console.error)
            }
            if (panel.splitPtyId) {
              sdk.client.pty.remove({ ptyID: panel.splitPtyId }).catch(console.error)
            }
          })
          wb.clearSpacePtyIds(path)
        }
      })
    }
    window.addEventListener("beforeunload", handleUnload)
    onCleanup(() => {
      window.removeEventListener("beforeunload", handleUnload)
    })
  })

  return (
    <div class="flex h-dvh flex-col bg-v2-background-bg-deep text-v2-text-text-base overflow-hidden">
      <Show when={display().showTitlebar}>
        <WorkbenchTitlebar />
      </Show>
      <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <SpaceRail />
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Workspace />
          <BottomDockController />
        </div>
      </div>
      <Show when={display().showStatusbar}>
        <StatusBar />
      </Show>
    </div>
  )
}

export default function Workbench() {
  return (
    <WorkbenchStateProvider>
      <SpaceStoreProvider>
        <WorkbenchShell />
      </SpaceStoreProvider>
    </WorkbenchStateProvider>
  )
}

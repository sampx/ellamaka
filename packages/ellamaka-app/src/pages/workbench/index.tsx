import { Show, createMemo, onMount, onCleanup } from "solid-js"
import { SpaceStoreProvider, useSpaceStore } from "./space-store"
import { WorkbenchStateProvider, useWorkbenchState } from "./view-store"
import { SessionStoreProvider, useSessionStore } from "./session-store"
import { WorkbenchTitlebar } from "./parts/top-bar"
import { SpaceRail } from "./parts/sidebar"
import { Workspace } from "./parts/workspace"
import { StatusBar } from "./parts/status-bar"
import { shouldUnbindSessionFromEvent } from "./parts/panel-session-lifecycle"
import { useServerSDK } from "@/context/server-sdk"
import { ptyManager } from "./pty-manager"

function WorkbenchShell() {
  const wb = useWorkbenchState()
  const spaceStore = useSpaceStore()
  const sessionStore = useSessionStore()
  const allStoresReady = () => wb.ready()
  const display = () => wb.display()
  const sdk = useServerSDK()

  onMount(() => {
    console.log("=== WORKBENCH MOUNTED ===", Date.now())
    const unsub = sdk.event.listen((e) => {
      const details = e.details as {
        type?: string
        properties?: { info?: { id?: string; time?: { archived?: number } } }
      } | undefined
      const session = details?.properties?.info
      if (shouldUnbindSessionFromEvent({ type: details?.type, timeArchived: session?.time?.archived })) {
        if (session?.id) {
          wb.unbindSessionGlobal(session.id)
          sessionStore.deleteSession(session.id)
        }
        sessionStore.triggerRefresh()
        return
      }
      if (details?.type === "session.created") {
        sessionStore.triggerRefresh()
      }
    })

    const handleUnload = () => {
      ptyManager.disposeAllSyncOnUnload(
        sdk.url,
        Object.values(wb.spaces).flatMap((space) =>
          space.panels.flatMap((panel) =>
            [panel.tuiPtyId, panel.termPtyId, panel.splitPtyId].filter((ptyId): ptyId is string => !!ptyId),
          ),
        ),
      )
    }
    window.addEventListener("beforeunload", handleUnload)
    onCleanup(() => {
      unsub()
      window.removeEventListener("beforeunload", handleUnload)
    })
  })

  return (
    <div class="flex h-dvh flex-col bg-v2-background-bg-deep text-v2-text-text-base overflow-hidden">
      <Show
        when={allStoresReady()}
        fallback={
          <div class="flex h-full items-center justify-center">
            <div class="animate-spin rounded-full h-8 w-8 border-2 border-v2-text-text-muted border-t-transparent" />
          </div>
        }
      >
        <Show when={display().showTitlebar}>
          <WorkbenchTitlebar />
        </Show>
        <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <SpaceRail />
          <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Workspace />
          </div>
        </div>
        <Show when={display().showStatusbar}>
          <StatusBar />
        </Show>
      </Show>
    </div>
  )
}

export default function Workbench() {
  return (
    <SessionStoreProvider>
      <WorkbenchStateProvider>
        <SpaceStoreProvider>
          <WorkbenchShell />
        </SpaceStoreProvider>
      </WorkbenchStateProvider>
    </SessionStoreProvider>
  )
}

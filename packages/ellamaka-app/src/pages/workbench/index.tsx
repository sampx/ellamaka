import { Show, createMemo, onMount, onCleanup } from "solid-js"
import { SpaceStoreProvider, useSpaceStore } from "./space-store"
import { WorkbenchStateProvider, useWorkbenchState } from "./view-store"
import { SessionStoreProvider, useSessionStore } from "./session-store"
import { WorkbenchTitlebar } from "./parts/top-bar"
import { SpaceRail } from "./parts/sidebar"
import { Workspace } from "./parts/workspace"
import { StatusBar } from "./parts/status-bar"
import { shouldUnbindSessionFromEvent, shouldSyncSessionTitle, workbenchSessionEvent } from "./parts/panel-session-lifecycle"
import { useServerSDK } from "@/context/server-sdk"
import { WorkbenchSingletonGuard } from "./singleton-guard"
import { useWorkbenchCommands } from "./use-workbench-commands"

function WorkbenchShell() {
  const wb = useWorkbenchState()
  useWorkbenchCommands()
  const spaceStore = useSessionStore()
  const allStoresReady = () => wb.ready()
  const display = () => wb.display()
  const sdk = useServerSDK()

  onMount(() => {
    console.log("=== WORKBENCH MOUNTED ===", Date.now())
    const unsub = sdk.event.listen((e) => {
      const session = workbenchSessionEvent(e.details as {
        type?: string
        properties?: { sessionID?: string; info?: { id?: string; title?: string; time?: { archived?: number } } }
      } | undefined)
      if (shouldUnbindSessionFromEvent({ type: session.type, timeArchived: session.timeArchived })) {
        if (session.sessionId) {
          wb.unbindSessionGlobal(session.sessionId)
          spaceStore.deleteSession(session.sessionId)
        }
        spaceStore.triggerRefresh()
        return
      }
      if (session.type === "session.created") {
        spaceStore.triggerRefresh()
      }
      if (shouldSyncSessionTitle({ type: session.type, sessionId: session.sessionId, title: session.title, localTitle: spaceStore.getSession(session.sessionId ?? "")?.title })) {
        spaceStore.syncSessionReference(session.sessionId!, { title: session.title! })
        spaceStore.triggerRefresh()
      }
    })

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }
    window.addEventListener("contextmenu", preventContextMenu)
    onCleanup(() => {
      unsub()
      window.removeEventListener("contextmenu", preventContextMenu)
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
    <WorkbenchSingletonGuard>
      <SessionStoreProvider>
        <WorkbenchStateProvider>
          <SpaceStoreProvider>
            <WorkbenchShell />
          </SpaceStoreProvider>
        </WorkbenchStateProvider>
      </SessionStoreProvider>
    </WorkbenchSingletonGuard>
  )
}

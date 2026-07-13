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
import { ptyManager } from "./pty-manager"
import { WorkbenchSingletonGuard } from "./singleton-guard"

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
      const session = workbenchSessionEvent(e.details as {
        type?: string
        properties?: { sessionID?: string; info?: { id?: string; title?: string; time?: { archived?: number } } }
      } | undefined)
      if (shouldUnbindSessionFromEvent({ type: session.type, timeArchived: session.timeArchived })) {
        if (session.sessionId) {
          wb.unbindSessionGlobal(session.sessionId)
          sessionStore.deleteSession(session.sessionId)
        }
        sessionStore.triggerRefresh()
        return
      }
      if (session.type === "session.created") {
        sessionStore.triggerRefresh()
      }
      if (shouldSyncSessionTitle({ type: session.type, sessionId: session.sessionId, title: session.title, localTitle: sessionStore.getSession(session.sessionId ?? "")?.title })) {
        sessionStore.syncSessionReference(session.sessionId!, { title: session.title! })
        sessionStore.triggerRefresh()
      }
    })

    const handleUnload = () => {
      // By the time pagehide fires, Terminal.onClose has already mutated the
      // store (ptyIds set to undefined, viewMode switched to chat) and called
      // ptyManager.delete for each panel — so wb.spaces is empty of ptyIds.
      // Drain the ptyManager's own registry (plus its disposedPendingCleanup
      // fallback) instead, where each PTY's real backend cwd is recorded at
      // ensure time so the x-opencode-directory header routes correctly.
      ptyManager.disposeEverythingOnUnload(sdk.url)
      // Persist layout with ptyIds stripped — do NOT mutate the in-memory
      // store (wb.clearAllPtyIds), because that would re-trigger SolidJS
      // createEffects in view-registry and re-create the very PTYs we just
      // killed before the page is torn down.
      wb.flushPersisted({ stripPtyIds: true })
    }
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!wb.hasActivePty()) return
      e.preventDefault()
      e.returnValue = ""
    }
    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    // use pagehide instead of unload — Chrome is deprecating unload; pagehide
    // fires reliably before the tab is torn down and lets keepalive fetch escape.
    window.addEventListener("pagehide", handleUnload)
    window.addEventListener("contextmenu", preventContextMenu)
    onCleanup(() => {
      unsub()
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("pagehide", handleUnload)
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

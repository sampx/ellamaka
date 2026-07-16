import { ErrorBoundary, Show, onMount, onCleanup } from "solid-js"
import { SpaceStoreProvider } from "./space-store"
import { WorkbenchStateProvider, useWorkbenchState } from "./view-store"
import { SessionStoreProvider, useSessionProjectionWriter, useSessionStore } from "./session-store"
import { WorkbenchTitlebar } from "./parts/top-bar"
import { SpaceRail } from "./parts/sidebar"
import { Workspace } from "./parts/workspace"
import { StatusBar } from "./parts/status-bar"
import { sessionRemovalReasonFromEvent, shouldNotifySessionRemoval, shouldSyncSessionTitle, workbenchSessionEvent } from "./parts/panel-session-lifecycle"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { WorkbenchSingletonGuard } from "./singleton-guard"
import { useWorkbenchCommands } from "./use-workbench-commands"
import { WorkbenchActionsProvider, useWorkbenchActions } from "./workbench-actions-context"
import { WorkbenchActiveDirectoryProvider } from "./workbench-directory-provider"

function WorkbenchShell() {
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  useWorkbenchCommands()
  const spaceStore = useSessionStore()
  const projection = useSessionProjectionWriter()
  const allStoresReady = () => wb.ready()
  const display = () => wb.display()
  const sdk = useServerSDK()
  const language = useLanguage()
  const t = (key: string, params?: Record<string, string | number | boolean>) => language.t(key as Parameters<typeof language.t>[0], params)

  onMount(() => {
    const unsub = sdk.event.listen((e) => {
      const session = workbenchSessionEvent(e.details)
      const removalReason = sessionRemovalReasonFromEvent({ type: session.type, timeArchived: session.timeArchived })
      if (removalReason) {
        projection.invalidate()
        if (session.sessionId) {
          const sessionID = session.sessionId
          const title = spaceStore.getSession(sessionID)?.title ?? session.title ?? sessionID
          void actions
            .unbindSessionEverywhere(sessionID)
            .then((result) => {
              projection.remove(sessionID)
              if (!shouldNotifySessionRemoval({ affectedPanelCount: result.affectedPanelCount, isBound: wb.isSessionBound(sessionID) })) return
              wb.setStatusMessage(t(
                removalReason === "archived"
                  ? "workbench.status.sessionArchivedExternally"
                  : "workbench.status.sessionDeletedExternally",
                { title },
              ))
            })
            .catch((error) => {
              console.error("Failed to release externally removed Workbench session:", error)
            })
        }
        return
      }
      if (session.type === "session.created") {
        projection.invalidate()
      }
      if (shouldSyncSessionTitle({ type: session.type, sessionId: session.sessionId, title: session.title, localTitle: spaceStore.getSession(session.sessionId ?? "")?.title })) {
        projection.patch(session.sessionId!, { title: session.title! })
        projection.invalidate()
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
          <WorkbenchActiveDirectoryProvider>
            {() => <WorkbenchTitlebar />}
          </WorkbenchActiveDirectoryProvider>
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

function WorkbenchErrorFallback(props: { error: Error; reset: () => void }) {
  return (
    <div class="flex h-dvh flex-col items-center justify-center gap-4 bg-v2-background-bg-deep text-v2-text-text-base p-8">
      <div class="text-center max-w-md">
        <h2 class="text-18-semibold text-v2-text-text-strong mb-2">
          {("工作台加载失败")}
        </h2>
        <p class="text-14-regular text-v2-text-text-muted mb-4 break-words">
          {props.error.message || "发生未知错误，请重试。"}
        </p>
        <button
          type="button"
          class="rounded-md bg-v2-icon-icon-brand px-4 py-2 text-12-bold text-white hover:opacity-90 transition-opacity"
          onClick={() => props.reset()}
        >
          {("重试")}
        </button>
      </div>
    </div>
  )
}

export default function Workbench() {
  return (
    <WorkbenchSingletonGuard>
      <SessionStoreProvider>
        <WorkbenchStateProvider>
          <WorkbenchActionsProvider>
            <SpaceStoreProvider>
              <ErrorBoundary
                fallback={(error, reset) => <WorkbenchErrorFallback error={error} reset={reset} />}
              >
                <WorkbenchShell />
              </ErrorBoundary>
            </SpaceStoreProvider>
          </WorkbenchActionsProvider>
        </WorkbenchStateProvider>
      </SessionStoreProvider>
    </WorkbenchSingletonGuard>
  )
}

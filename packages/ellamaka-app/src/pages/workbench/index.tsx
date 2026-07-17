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
import { WorkbenchActionsProvider, useWorkbenchActions } from "./workbench-actions"
import { WorkbenchRuntimeProvider } from "./workbench-runtime"
import { WorkbenchActiveDirectoryProvider } from "./workbench-directory-provider"
import { WorkbenchSessionDeepLink } from "./workbench-session-deep-link"
import { ViewRegistryProvider, useViewRegistry, registerDefaultViews } from "./view-registry"
import { reportWorkbenchError } from "./workbench-error"

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
  const t: typeof language.t = (key, params) => language.t(key, params)

  // Task 3 (O18): Register default views during Shell init instead of at
  // module level. This eliminates import-order sensitivity from the
  // previous global viewRegistry array.
  const registry = useViewRegistry()
  registerDefaultViews(registry)

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
            .catch((error) => reportWorkbenchError("release externally removed session", error))
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

  onCleanup(() => {
    actions.clearPtyMemory()
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
        <WorkbenchSessionDeepLink />
      </Show>
    </div>
  )
}

function WorkbenchErrorFallback(props: { error: Error; reset: () => void }) {
  const language = useLanguage()
  const t: typeof language.t = (key, params) => language.t(key, params)
  return (
    <div class="flex h-dvh flex-col items-center justify-center gap-4 bg-v2-background-bg-deep text-v2-text-text-base p-8">
      <div class="text-center max-w-md">
        <h2 class="text-18-semibold text-v2-text-text-strong mb-2">
          {t("workbench.error.shellLoadFailed")}
        </h2>
        <p class="text-14-regular text-v2-text-text-muted mb-4 break-words">
          {props.error.message || t("workbench.error.unknownError")}
        </p>
        <button
          type="button"
          class="rounded-md bg-v2-icon-icon-brand px-4 py-2 text-12-bold text-white hover:opacity-90 transition-opacity"
          onClick={() => props.reset()}
        >
          {t("workbench.error.retry")}
        </button>
      </div>
    </div>
  )
}

export default function Workbench() {
  return (
    // Actions and runtime status are local to this Workbench provider tree.
    <WorkbenchSingletonGuard>
      <SessionStoreProvider>
        <WorkbenchStateProvider>
          <WorkbenchRuntimeProvider>
            <WorkbenchActionsProvider>
              <SpaceStoreProvider>
                <ViewRegistryProvider>
                  <ErrorBoundary
                    fallback={(error, reset) => <WorkbenchErrorFallback error={error} reset={reset} />}
                  >
                    <WorkbenchShell />
                  </ErrorBoundary>
                </ViewRegistryProvider>
              </SpaceStoreProvider>
            </WorkbenchActionsProvider>
          </WorkbenchRuntimeProvider>
        </WorkbenchStateProvider>
      </SessionStoreProvider>
    </WorkbenchSingletonGuard>
  )
}

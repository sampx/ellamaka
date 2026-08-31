import { ErrorBoundary, Show, createEffect, createSignal, onMount, onCleanup } from "solid-js"
import { SpaceStoreProvider } from "./space-store"
import { WorkbenchStateProvider, useWorkbenchState } from "./view-store"
import { SessionStoreProvider, useSessionProjectionWriter, useSessionStore } from "./session-store"
import { WorkbenchTitlebar } from "./parts/top-bar"
import { SpaceRail } from "./parts/sidebar"
import { Workspace } from "./parts/workspace"
import { StatusBar } from "./parts/status-bar"
import { FileViewerSurface } from "./parts/file-viewer-panel"
import { closeViewerTab, openViewerFile, type OpenedFileEntry } from "./parts/file-viewer-adapter"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { sessionRemovalReasonFromEvent, shouldNotifySessionRemoval, shouldSyncSessionTitle, workbenchSessionEvent } from "./parts/panel-session-lifecycle"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { WorkbenchSingletonGuard } from "./singleton-guard"
import { useWorkbenchCommands } from "./use-workbench-commands"
import { WorkbenchActionsProvider, useWorkbenchActions } from "./workbench-actions"
import { WorkbenchRuntimeProvider, useWorkbenchRuntime } from "./workbench-runtime"
import { WorkbenchSidecarCleanupBinding } from "./workbench-sidecar-cleanup"
import { WorkbenchActiveDirectoryProvider } from "./workbench-directory-provider"
import { WorkbenchSessionDeepLink } from "./workbench-session-deep-link"
import { ViewRegistryProvider, useViewRegistry, registerDefaultViews } from "./view-registry"
import { reportWorkbenchError, type WorkbenchErrorDetail, WORKBENCH_ERROR_EVENT } from "./workbench-error"
import { CliRepairDialog } from "./parts/cli-repair-dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Toast } from "@opencode-ai/ui/toast"

function WorkbenchShell() {
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  useWorkbenchCommands()
  const spaceStore = useSessionStore()
  const projection = useSessionProjectionWriter()
  const allStoresReady = () => wb.ready()
  const display = () => wb.display()
  const sdk = useServerSDK()
  const runtime = useWorkbenchRuntime()
  const language = useLanguage()
  const dialog = useDialog()
  const t: typeof language.t = (key, params) => language.t(key, params)
  let workbenchSurface: HTMLDivElement | undefined

  // Opened file viewer state. Transient Workbench UI state (AGENTS.md §5.1):
  // files are opened into a floating tabbed surface that overlays the
  // workspace lane, so the layout never reflows when files are opened.
  const [viewerFiles, setViewerFiles] = createSignal<OpenedFileEntry[]>([])
  const [viewerActiveKey, setViewerActiveKey] = createSignal<string | undefined>(undefined)
  const viewerKeyOf = (file: OpenedFileEntry) => `${file.directory}\n${file.filePath}`
  const handleFileClick = (file: FileNode) => {
    const entry: OpenedFileEntry = {
      directory: wb.activeTabPath,
      filePath: file.path,
      name: file.name,
    }
    setViewerFiles((tabs) => openViewerFile(tabs, entry))
    setViewerActiveKey(viewerKeyOf(entry))
  }
  const closeViewerFile = (key: string) => {
    const result = closeViewerTab(viewerFiles(), viewerActiveKey() ?? "", key)
    setViewerFiles(result.tabs)
    setViewerActiveKey(result.activeKey)
  }

  const requestCliRepair = (cli: NonNullable<typeof runtime.cli>) => {
    void dialog.show(() => (
      <CliRepairDialog
        cli={cli}
        repair={runtime.repairCli}
        onRepaired={() => wb.removeDiagnostic("wopal-cli-status")}
      />
    ))
    return false
  }

  createEffect(() => {
    if (!workbenchSurface) return
    if (runtime.status === "offline") {
      workbenchSurface.setAttribute("inert", "")
      return
    }
    workbenchSurface.removeAttribute("inert")
  })

  createEffect(() => {
    const cli = runtime.cli
    if (!cli || cli.state === "ok") {
      wb.removeDiagnostic("wopal-cli-status")
      return
    }
    const text = cli.state === "missing"
      ? t("workbench.cli.missing", { required: cli.requiredVersion })
      : cli.state === "incompatible"
        ? t("workbench.cli.incompatible", { actual: cli.actualVersion ?? "unknown", required: cli.requiredVersion })
        : t("workbench.cli.broken", { required: cli.requiredVersion })
    wb.pushDiagnostic("error", text, {
      id: "wopal-cli-status",
      autoDismiss: false,
      onRetry: () => requestCliRepair(cli),
      source: "Wopal CLI",
    })
  })

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
      if (e.details?.type === "pty.deleted" && typeof e.details?.properties?.id === "string") {
        actions.clearPtyEverywhere(e.details.properties.id)
        return
      }
      if (shouldSyncSessionTitle({ type: session.type, sessionId: session.sessionId, title: session.title, localTitle: spaceStore.getSession(session.sessionId ?? "")?.title })) {
        projection.patch(session.sessionId!, { title: session.title! })
      }
    })

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        const activeTab = wb.activeTab()
        const isPinned = !activeTab || activeTab.path === "" || !!activeTab.pinned
        if (isPinned) {
          e.preventDefault()
          e.stopPropagation()
          wb.setStatusMessage(t("workbench.status.tabPinnedProtected", { default: "Pinned tab protected from closing" }))
        }
      }
    }
    window.addEventListener("contextmenu", preventContextMenu)
    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      unsub()
      window.removeEventListener("contextmenu", preventContextMenu)
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  onMount(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchErrorDetail>).detail
      wb.pushDiagnostic("error", `${detail.operation}: ${detail.message}`, {
        autoDismiss: false,
        source: detail.operation,
      })
      event.preventDefault()
    }
    window.addEventListener(WORKBENCH_ERROR_EVENT, onError)
    onCleanup(() => window.removeEventListener(WORKBENCH_ERROR_EVENT, onError))
  })

  onCleanup(() => {
    actions.clearPtyMemory()
  })

  return (
    <div class="relative h-dvh overflow-hidden bg-v2-background-bg-deep text-v2-text-text-base">
      <div ref={workbenchSurface} class="flex h-full flex-col">
        <Show
          when={allStoresReady()}
          fallback={
            <div class="flex h-full items-center justify-center">
              <div class="workbench-spinner rounded-full h-8 w-8 border-2 border-v2-text-text-muted border-t-transparent" />
            </div>
          }
        >
          <Show when={display().showTitlebar}>
            <WorkbenchActiveDirectoryProvider>
              {() => <WorkbenchTitlebar />}
            </WorkbenchActiveDirectoryProvider>
          </Show>
          <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <SpaceRail onFileClick={handleFileClick} />
            <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Workspace />
              <Show when={viewerFiles().length > 0 && viewerActiveKey()}>
                <FileViewerSurface
                  files={viewerFiles()}
                  activeKey={viewerActiveKey()!}
                  onActiveKeyChange={setViewerActiveKey}
                  onCloseFile={closeViewerFile}
                  onClose={() => {
                    setViewerFiles([])
                    setViewerActiveKey(undefined)
                  }}
                />
              </Show>
            </div>
          </div>
          <Show when={display().showStatusbar}>
            <StatusBar />
          </Show>
          <WorkbenchSessionDeepLink />
        </Show>
      </div>
      <Show when={runtime.status === "offline"}>
        <div
          class="absolute inset-0 z-50 flex items-center justify-center bg-v2-background-bg-deep/80 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
        >
          <div class="flex flex-col items-center gap-3 text-center">
            <div class="workbench-spinner rounded-full h-6 w-6 border-2 border-v2-text-text-muted border-t-transparent" />
            <p class="text-14-medium text-v2-text-text-primary">{t("workbench.runtime.offlineOverlay")}</p>
          </div>
        </div>
      </Show>
    </div>
  )
}

function WorkbenchErrorFallback(props: { error: Error; reset: () => void }) {
  const language = useLanguage()
  const t: typeof language.t = (key, params) => language.t(key, params)
  return (
    <div class="flex h-dvh flex-col items-center justify-center gap-6 bg-v2-background-bg-deep text-v2-text-text-base p-8">
      <div class="flex flex-col items-center max-w-md text-center gap-4">
        <div class="flex items-center gap-3 mb-2">
          <img src="/favicon-96x96.png" class="w-8 h-8 object-contain" alt="Icon" />
          <img src="/ellamaka-text-logo.png?v=2" class="h-7 w-auto object-contain ellamaka-logo-invert" alt="Logo" />
        </div>
        <h2 class="text-20-semibold text-v2-text-text-strong">
          {t("workbench.error.shellLoadFailed")}
        </h2>
        <p class="text-14-regular text-v2-text-text-muted break-words bg-v2-background-bg-base/60 border border-v2-border-border-base p-3.5 rounded-lg text-left w-full font-mono text-xs max-h-40 overflow-y-auto">
          {props.error.message || t("workbench.error.unknownError")}
        </p>

        <div class="flex items-center gap-3 mt-2">
          <button
            type="button"
            class="rounded-md bg-v2-icon-icon-brand px-5 py-2 text-13-semibold text-white hover:opacity-90 transition-opacity shadow-sm cursor-pointer"
            onClick={() => props.reset()}
          >
            {t("workbench.error.retry")}
          </button>
          <a
            href="https://github.com/sampx/wopal-space/issues"
            target="_blank"
            rel="noreferrer"
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-4 py-2 text-13-semibold text-v2-text-text-primary hover:bg-v2-background-bg-surface transition-colors cursor-pointer"
          >
            {t("workbench.error.feedbackIssue")}
          </a>
          <a
            href="https://wopal.cn/docs"
            target="_blank"
            rel="noreferrer"
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-4 py-2 text-13-semibold text-v2-text-text-muted hover:text-v2-text-text-primary transition-colors cursor-pointer"
          >
            {t("workbench.error.viewDocs")}
          </a>
        </div>
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
              <WorkbenchSidecarCleanupBinding />
              <SpaceStoreProvider>
                <ViewRegistryProvider>
                  <ErrorBoundary
                    fallback={(error, reset) => <WorkbenchErrorFallback error={error} reset={reset} />}
                  >
                    <WorkbenchShell />
                  </ErrorBoundary>
                  <Toast.Region />
                </ViewRegistryProvider>
              </SpaceStoreProvider>
            </WorkbenchActionsProvider>
          </WorkbenchRuntimeProvider>
        </WorkbenchStateProvider>
      </SessionStoreProvider>
    </WorkbenchSingletonGuard>
  )
}

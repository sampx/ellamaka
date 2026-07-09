import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show, createEffect, createMemo, batch } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { useWorkbenchState } from "../view"
import { useSessionStore } from "../session-store"
import { Panel } from "./panel"
import { SDKProvider } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"

export function Workspace() {
  const store = useSpaceStore()
  const wb = useWorkbenchState()
  const language = useLanguage()
  const sdk = useServerSDK()
  const t = (k: string) => language.t(k)

  const sessionStore = useSessionStore()
  const dialog = useDialog()

  const activePath = createMemo(() => store.activeTab()?.path ?? "")

  createEffect(() => {
    const path = activePath()
    if (path) wb.ensureSpace(path)
  })

  const space = createMemo(() => {
    const path = activePath()
    if (!path) return undefined
    return wb.spaceState(path)
  })

  const panels = createMemo(() => space()?.panels ?? [])
  const activePanelID = createMemo(() => space()?.activePanelID ?? panels()[0]?.id ?? "")

  let containerRef: HTMLDivElement | undefined

  const handlePanelResizeStart = (e: MouseEvent, leftIndex: number) => {
    e.preventDefault()
    const container = containerRef
    if (!container) return

    const panelElements = Array.from(container.querySelectorAll("[data-panel-id]")) as HTMLElement[]
    const leftPanelEl = panelElements[leftIndex]
    const rightPanelEl = panelElements[leftIndex + 1]
    if (!leftPanelEl || !rightPanelEl) return

    const leftPanelID = leftPanelEl.getAttribute("data-panel-id")!
    const rightPanelID = rightPanelEl.getAttribute("data-panel-id")!

    const startX = e.clientX
    const leftStartWidth = leftPanelEl.getBoundingClientRect().width
    const rightStartWidth = rightPanelEl.getBoundingClientRect().width
    const totalWidth = leftStartWidth + rightStartWidth

    const currentPanels = panels()
    const leftStartFlex = currentPanels[leftIndex].width
    const rightStartFlex = currentPanels[leftIndex + 1].width
    const flexSum = leftStartFlex + rightStartFlex

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX

      let newLeftWidth = leftStartWidth + deltaX
      let newRightWidth = rightStartWidth - deltaX

      if (newLeftWidth < 280) {
        newLeftWidth = 280
        newRightWidth = totalWidth - 280
      } else if (newRightWidth < 280) {
        newRightWidth = 280
        newLeftWidth = totalWidth - 280
      }

      const newLeftFlex = (newLeftWidth / totalWidth) * flexSum
      const newRightFlex = (newRightWidth / totalWidth) * flexSum

      const path = activePath()
      if (path) {
        batch(() => {
          wb.setPanelWidth(path, leftPanelID, newLeftFlex)
          wb.setPanelWidth(path, rightPanelID, newRightFlex)
        })
      }
    }

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  const handlePanelResizeReset = () => {
    const path = activePath()
    if (path) {
      wb.resetPanelWidths(path)
    }
  }

  const handleCloseTab = (name: string, path: string) => {
    dialog.show(() => <DialogCloseTab name={name} path={path} />)
  }

  return (
    <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-v2-background-bg-base">
      <StageHeader
        activePath={activePath()}
        panelCount={panels().length}
        onAddPanel={() => {
          const path = activePath()
          if (!path) return
          const id = wb.addPanel(path)
          if (id) wb.setActivePanel(path, id)
        }}
        onCloseTab={handleCloseTab}
      />

      <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden" ref={containerRef}>
        <Show
          when={panels().length > 0}
          fallback={
            <div class="flex flex-1 items-center justify-center text-v2-text-text-muted">
              <span class="text-12-regular">{t("workbench.workspace.empty")}</span>
            </div>
          }
        >
          <For each={panels()}>
            {(panel, index) => (
              <div class="contents">
                <SDKProvider directory={panel.directory}>
                  <Panel
                    panel={panel}
                    spaceName={store.activeTab()?.name ?? ""}
                    spacePath={activePath()}
                    isActive={panel.id === activePanelID()}
                    panelCount={panels().length}
                    onActivate={() => {
                      const path = activePath()
                      if (path) wb.setActivePanel(path, panel.id)
                    }}
                    onModeChange={(mode) => {
                      const path = activePath()
                      if (path) wb.setPanelMode(path, panel.id, mode)
                    }}
                    onRemove={() => {
                      const path = activePath()
                      if (path) wb.removePanel(path, panel.id)
                    }}
                  />
                </SDKProvider>
                <Show when={index() < panels().length - 1}>
                  <div
                    class="w-1 hover:w-1.5 z-20 cursor-col-resize bg-v2-border-border-base hover:bg-v2-icon-icon-brand transition-all flex-shrink-0"
                    onMouseDown={(e) => handlePanelResizeStart(e, index())}
                    onDblClick={handlePanelResizeReset}
                    title="双击恢复等宽"
                  />
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </main>
  )
}

function StageHeader(props: {
  activePath: string
  panelCount: number
  onAddPanel: () => void
  onCloseTab: (name: string, path: string) => void
}) {
  const store = useSpaceStore()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  return (
    <div class="flex h-8 shrink-0 items-center gap-0.5 border-b border-v2-border-border-base bg-v2-background-bg-base px-2">
      <Show when={store.tabs.length > 0}>
        <For each={store.tabs}>
          {(tab) => (
            <button
              type="button"
              class={`group flex items-center gap-1.5 rounded-t-md px-2.5 py-1 text-12-regular transition-colors ${
                store.activeName() === tab.name
                  ? "bg-v2-background-bg-deep text-v2-text-text-strong border-x border-t border-v2-border-border-base -mb-px"
                  : "text-v2-text-text-muted hover:text-v2-text-text-base"
              }`}
              onClick={() => store.setActive(tab.name)}
            >
              <span class="max-w-32 truncate">{tab.name}</span>
              <span
                class="flex size-4 items-center justify-center rounded text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onCloseTab(tab.name, tab.path)
                }}
              >
                <IconV2 name="xmark-small" />
              </span>
            </button>
          )}
        </For>
      </Show>

      <div class="grow" />

      <Show when={props.activePath}>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="plus" />}
          aria-label={t("workbench.panel.add")}
          disabled={props.panelCount >= 3}
          onClick={props.onAddPanel}
        />
      </Show>
    </div>
  )
}

function DialogCloseTab(props: { name: string; path: string }) {
  const store = useSpaceStore()
  const wb = useWorkbenchState()
  const sessionStore = useSessionStore()
  const sdk = useServerSDK()
  const language = useLanguage()
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k, params)
  const dialog = useDialog()

  const spaceName = () => props.name
  const panelCount = () => wb.spaceState(props.path)?.panels.length ?? 0
  const boundCount = () =>
    wb.spaceState(props.path)?.panels.filter((p) => p.slotState === "bound").length ?? 0

  const handleConfirm = () => {
    const path = props.path
    const name = props.name
    const space = wb.spaceState(path)

    // 1. Kill all PTYs owned by this space's panels
    if (space) {
      space.panels.forEach((panel) => {
        // Split PTY (managed by panel.tsx)
        if (panel.splitPtyId) {
          sdk.client.pty.remove({ ptyID: panel.splitPtyId }).catch(() => {})
        }
        // Legacy field PTYs (tuiPtyId/termPtyId) — may still exist from old persisted state
        if (panel.tuiPtyId) {
          sdk.client.pty.remove({ ptyID: panel.tuiPtyId }).catch(() => {})
        }
        if (panel.termPtyId) {
          sdk.client.pty.remove({ ptyID: panel.termPtyId }).catch(() => {})
        }
      })
    }

    // 2. Unbind all sessions bound to panels in this space
    if (space) {
      space.panels.forEach((panel) => {
        if (panel.boundSessionId) {
          sessionStore.unbindPanel(panel.boundSessionId)
        }
      })
    }

    // 3. Destroy the entire space state from persisted store
    wb.removeSpace(path)

    // 4. Close the tab
    store.closeTab(name)

    dialog.close()
  }

  return (
    <Dialog title={t("workbench.tabClose.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-14-regular text-text-strong">
            {t("workbench.tabClose.confirmPrefix")}「{spaceName()}」？{t("workbench.tabClose.confirmSuffix")}
          </span>
          <div class="flex flex-col gap-0.5 text-12-regular text-text-muted">
            <span>• {t("workbench.tabClose.consequencePanelsPrefix")}{panelCount()}{t("workbench.tabClose.consequencePanelsSuffix")}</span>
            <Show when={boundCount() > 0}>
              <span>• {t("workbench.tabClose.consequenceSessionsPrefix")}{boundCount()}{t("workbench.tabClose.consequenceSessionsSuffix")}</span>
            </Show>
            <span>• {t("workbench.tabClose.consequenceTerminals")}</span>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={handleConfirm}>
            {t("workbench.tabClose.confirmButton")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

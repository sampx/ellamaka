import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show, For, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view-store"
import { useWorkbenchActions } from "../workbench-actions"
import { scopeFromTab } from "../workbench-scope"
import { getPanelHeaderViews } from "./panel-header-views"
import { listViews } from "../view-registry"
import { DialogClosePanel } from "./session-tree-dialogs"
import { reportWorkbenchError } from "../workbench-error"
import type { WorkbenchPanel } from "../view-store"

export function PanelHeader(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
  isActive: boolean
  panelCount: number
  onToggleSplit: () => void
}) {
  const language = useLanguage()
  const t = (k: string, params?: Record<string, string | number | boolean>) =>
    language.t(k as Parameters<typeof language.t>[0], params)
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  const sessionStore = useSessionStore()
  const dialog = useDialog()
  const panelScope = () => scopeFromTab({ name: props.spaceName, path: props.spacePath })

  const canRemove = () => {
    if (props.panel.slotState === "empty" && props.panelCount <= 1) return false
    return true
  }
  const title = () => {
    if (props.panel.slotState === "bound") {
      const session = sessionStore.getSession(props.panel.boundSessionId ?? "")
      return session?.title ?? "Session"
    }
    const parts = props.panel.id.split("-")
    return `Panel #${parts[parts.length - 1] ?? props.panel.id}`
  }
  const headerViews = () => getPanelHeaderViews(listViews(), props.panel.slotState, props.panel.tuiPtyId)
  const hasOpenSplitPty = createMemo(() => !!props.panel.splitPtyId)

  const handleClose = () => {
    const spacePath = props.spacePath
    if (spacePath === undefined || spacePath === null) return
    void actions.closePanel({ scope: panelScope(), panelID: props.panel.id }).catch((error) =>
      reportWorkbenchError("close panel", error),
    )
  }

  return (
    <div
      class="flex h-7 shrink-0 items-center gap-1 px-2 border-b relative transition-colors duration-200"
      classList={{
        "bg-blue-50/80 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900/50": props.isActive,
        "bg-v2-background-bg-base border-v2-border-border-base": !props.isActive,
      }}
    >
      <Show when={props.isActive}>
        <div class="absolute top-0 inset-x-0 h-[2px] bg-v2-border-border-brand-strong" />
      </Show>

      <span
        class="size-2 rounded-full shrink-0"
        classList={{
          "bg-green-500": props.panel.slotState === "bound",
          "bg-v2-text-text-faint": props.panel.slotState === "empty",
        }}
      />

      <span
        class="truncate max-w-40 ml-0.5 transition-colors duration-200"
        classList={{
          "text-11-bold text-v2-text-text-strong font-semibold": props.isActive,
          "text-10-regular text-v2-text-text-muted": !props.isActive,
        }}
      >
        {title()}
      </span>

      <div class="grow" />

      <Show when={props.panel.slotState === "bound"}>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          style={{ color: hasOpenSplitPty() ? "var(--v2-icon-icon-accent)" : undefined }}
          state={props.panel.splitTerminal ? "pressed" : undefined}
          icon={<IconV2 name="terminal" />}
          aria-label={t(props.panel.splitTerminal ? "workbench.panel.splitTerminal.hide" : "workbench.panel.splitTerminal.show")}
          title={t(props.panel.splitTerminal ? "workbench.panel.splitTerminal.hide" : "workbench.panel.splitTerminal.show")}
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            props.onToggleSplit()
          }}
        />
      </Show>

      <For each={headerViews()}>
        {(view) => {
          const spacePath = props.spacePath
          return (
            <button
              type="button"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-10-regular transition-colors"
              classList={{
                "text-v2-text-text-faint cursor-not-allowed": view.disabled,
                "cursor-pointer": !view.disabled,
                "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base": props.panel.viewMode === view.id && !view.disabled,
                "text-v2-text-text-muted hover:text-v2-text-text-base": props.panel.viewMode !== view.id && !view.disabled,
              }}
              disabled={view.disabled}
              onClick={(e) => {
                e.stopPropagation()
                if (view.disabled) return
                wb.setPanelViewMode(spacePath, props.panel.id, view.id)
              }}
            >
              <span>{view.label}</span>
              <Show when={view.hasOpenTui}>
                <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent" />
              </Show>
            </button>
          )
        }}
      </For>

      <Show when={canRemove()}>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="xmark-small" />}
          aria-label="关闭"
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            if (props.panel.slotState === "bound") {
              const session = sessionStore.getSession(props.panel.boundSessionId ?? "")
              const sessionTitle = session?.title ?? t("workbench.panelClose.title")
              void dialog.show(() => (
                <DialogClosePanel
                  sessionTitle={sessionTitle}
                  onClose={async () => {
                    await actions.closePanel({ scope: panelScope(), panelID: props.panel.id })
                  }}
                />
              ))
            } else {
              setTimeout(() => handleClose(), 0)
            }
          }}
        />
      </Show>
    </div>
  )
}

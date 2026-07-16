import { Show, createEffect } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkbenchState } from "../view-store"
import { useWorkbenchActions } from "../workbench-actions"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { setInvisibleSessionDragPreview } from "./session-tree-drag-preview"
import { reportWorkbenchError } from "../workbench-error"
import { DialogOverwritePanel } from "./session-tree-dialogs"
import { getPanelBadge, openSessionInPanel, type GroupSession } from "./session-tree-services"
import type { WopalSpace } from "../space-store"

type MergedSession = {
  id: string
  title: string
  status: "idle" | "bound" | "archived"
}

export function SessionTreeRow(props: {
  session: MergedSession
  spaceName: string
  sessions: GroupSession[]
  spaces: WopalSpace[]
  activeSessionId: () => string | undefined
  pinnedSessions: () => Set<string>
  onSessionClick: (sessionId: string) => void
  onContextMenu: (e: MouseEvent) => void
  setSelectedSessionId: (id: string) => void
}) {
  const language = useLanguage()
  const t = (k: string, params?: Record<string, string | number | boolean>) =>
    language.t(k as Parameters<typeof language.t>[0], params)
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  const dialog = useDialog()

  const sessionData = () => props.sessions.find((s) => s.id === props.session.id)
  const dirHealth = () =>
    props.spaceName === "General" ? "healthy" : (sessionData()?.directoryHealth ?? "healthy")

  const handleSessionClick = () => {
    props.setSelectedSessionId(props.session.id)
    const badge = getPanelBadge(wb, props.session.id)
    if (badge) {
      let boundSpacePath: string | undefined
      let boundPanelId: string | undefined

      for (const spPath of Object.keys(wb.spaces)) {
        const spaceState = wb.spaces[spPath]
        const p = spaceState?.panels?.find(
          (panel) => panel.boundSessionId === props.session.id && panel.slotState === "bound",
        )
        if (p) {
          boundSpacePath = spPath
          boundPanelId = p.id
          break
        }
      }

      if (boundSpacePath && boundPanelId) {
        const targetSpace = props.spaces.find((s) => s.path === boundSpacePath)
        if (targetSpace) wb.openTab(targetSpace)
        wb.setActivePanel(boundSpacePath, boundPanelId)
      }
    } else {
      const targetSpace = props.spaces.find((s) => s.name === props.spaceName)
      if (targetSpace) {
        wb.openTab(targetSpace)
        wb.ensureSpace(targetSpace.path)
      }
    }
    props.onSessionClick(props.session.id)
  }

  const handleSessionDblClick = () => {
    const badge = getPanelBadge(wb, props.session.id)
    if (badge) {
      handleSessionClick()
      return
    }

    void openSessionInPanel({
      session: { id: props.session.id, title: props.session.title },
      sessionDirectory: sessionData()?.directory ?? "",
      spaceName: props.spaceName,
      spaces: props.spaces,
      wb,
      actions,
      t,
      showOverwriteDialog: (panelIndex, onConfirm) => {
        void dialog.show(() => (
          <DialogOverwritePanel
            panelIndex={panelIndex}
            onConfirm={() => {
              void onConfirm()
                .then(() => dialog.close())
                .catch((error) => reportWorkbenchError("replace session", error))
            }}
          />
        ))
      },
    })
  }

  let sessionEl: HTMLButtonElement | undefined

  createEffect(() => {
    if (props.session.id === props.activeSessionId() && sessionEl) {
      setTimeout(() => {
        sessionEl?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }, 150)
    }
  })

  function statusDotClass(status: string) {
    if (status === "bound") return "bg-green-400"
    if (status === "archived") return "bg-v2-text-text-faint"
    return "bg-v2-icon-icon-muted"
  }

  return (
    <button
      ref={sessionEl}
      type="button"
      class="group flex w-full items-center gap-2 px-2 py-0.5 text-left text-11-regular transition-all"
      classList={{
        "bg-blue-50/80 dark:bg-blue-950/40 text-v2-text-text-strong border-l-[3px] border-v2-border-border-brand-strong rounded-l-none pl-1.25 font-semibold shadow-sm":
          props.session.id === props.activeSessionId(),
        "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md":
          props.session.id !== props.activeSessionId(),
      }}
      draggable={true}
      onDragStart={(e) => {
        const dataTransfer = e.dataTransfer
        if (!dataTransfer) return
        dataTransfer.setData("text/sessionId", props.session.id)
        dataTransfer.setData("text/spaceName", props.spaceName)
        dataTransfer.setData("text/projectPath", sessionData()?.directory ?? "")
        dataTransfer.setData("text/sessionTitle", props.session.title)
        setInvisibleSessionDragPreview(dataTransfer)
      }}
      onClick={handleSessionClick}
      onDblClick={handleSessionDblClick}
      onContextMenu={props.onContextMenu}
    >
      <Show
        when={getPanelBadge(wb, props.session.id)}
        fallback={
          <Show
            when={dirHealth() !== "healthy"}
            fallback={
              <span class={`size-1.5 shrink-0 rounded-full ${statusDotClass(props.session.status)}`} />
            }
          >
            <span class="flex items-center justify-center shrink-0 text-[11px] leading-none text-amber-500">
              !
            </span>
          </Show>
        }
      >
        {(badge) => (
          <span class="flex items-center justify-center shrink-0 rounded-full px-1.25 text-[10px] font-semibold text-white bg-v2-icon-icon-brand leading-none min-w-[20px] h-4.5 select-none">
            {badge()}
          </span>
        )}
      </Show>
      <span class="flex-1 truncate">{props.session.title}</span>
      <Show when={dirHealth() !== "healthy"}>
        <span class="text-9-regular text-v2-text-text-faint shrink-0">
          {dirHealth() === "missing" ? "缺失" : "不可用"}
        </span>
      </Show>
      <Show when={props.pinnedSessions().has(props.session.id)}>
        <svg
          class="size-3 shrink-0 text-v2-icon-icon-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="17" x2="12" y2="22" />
          <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.55A2 2 0 0 1 15 9.24V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.24c0 .43-.14.85-.4 1.21L5.8 13.97A2 2 0 0 0 5 15.24V17z" />
        </svg>
      </Show>
    </button>
  )
}

import { Show, createMemo, createSignal } from "solid-js"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2.jsx"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view"
import { ContextPopup } from "./context-popup"
import type { WorkbenchPanel } from "../view"
import type { Session } from "../session-store"

/**
 * PanelChatHeader — Chat 视图专属头部。
 *
 * 职责（设计文档 §8.2/§8.3 修正版）：
 * - 右侧 Context 圆环指示器（仅 bound 状态）
 * - 右侧 Session 操作菜单（重命名/归档/复制链接/在新 Panel 打开）
 *
 * 不包含：目录路径（已在其他位置显示）、模型/智能体选择器（由 composer 提供）
 */
export function PanelChatHeader(props: {
  panel: WorkbenchPanel
  session?: Session
  spacePath: string
  spaceName: string
}) {
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()
  const [menuOpen, setMenuOpen] = createSignal(false)

  const sessionId = () => props.panel.boundSessionId
  const sessionInfo = createMemo(() => (sessionId() ? sessionStore.getSession(sessionId()!) : undefined))
  const isArchived = () => sessionInfo()?.status === "archived"

  const handleRename = () => {
    const id = sessionId()
    if (!id) return
    const current = sessionStore.getSession(id)?.title ?? ""
    const next = prompt("重命名会话", current)
    if (!next || next === current) return
    sessionStore.renameSession(id, next)
  }

  const handleArchiveToggle = () => {
    const id = sessionId()
    if (!id) return
    sessionStore.archiveSession(id, !isArchived())
  }

  const handleCopyLink = () => {
    const id = sessionId()
    if (!id) return
    const url = `${window.location.origin}${window.location.pathname}#/${btoa(props.spacePath)}/session/${id}`
    void navigator.clipboard.writeText(url).catch(() => {})
  }

  const handleOpenInNewPanel = () => {
    const id = sessionId()
    if (!id) return
    const spacePath = props.spacePath
    const newPanelId = wb.addPanel(spacePath)
    if (!newPanelId) return
    sessionStore.bindPanel(id, newPanelId)
    wb.bindSessionToPanel(spacePath, newPanelId, id)
    wb.setActivePanel(spacePath, newPanelId)
  }

  return (
    <div class="flex h-7 shrink-0 items-center gap-1 px-2 border-b border-v2-border-border-base bg-v2-background-bg-base">
      <div class="grow" />

      {/* Context indicator — only when bound to a session */}
      <Show when={props.panel.slotState === "bound" && sessionId()}>
        <ContextPopup sessionId={sessionId()} directory={props.panel.directory} />
      </Show>

      {/* Session menu — only when bound */}
      <Show when={props.panel.slotState === "bound"}>
        <MenuV2 gutter={4} modal={false} placement="bottom-end" open={menuOpen()} onOpenChange={setMenuOpen}>
          <MenuV2.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label="Session actions"
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Group>
                <MenuV2.GroupLabel>Session</MenuV2.GroupLabel>
                <MenuV2.Item onSelect={handleRename}>重命名</MenuV2.Item>
                <MenuV2.Item onSelect={handleArchiveToggle}>
                  {isArchived() ? "取消归档" : "归档"}
                </MenuV2.Item>
                <MenuV2.Item onSelect={handleCopyLink}>复制链接</MenuV2.Item>
                <MenuV2.Item onSelect={handleOpenInNewPanel}>在新 Panel 中打开</MenuV2.Item>
              </MenuV2.Group>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </Show>
    </div>
  )
}
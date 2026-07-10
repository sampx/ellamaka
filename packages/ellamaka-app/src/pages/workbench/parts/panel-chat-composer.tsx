import { SessionComposerRegion } from "@/pages/session/composer"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"

/**
 * Panel Chat Composer — thin adapter wrapping the official SessionComposerRegion.
 *
 * Uses placement="dock" (not "inline") so the composer renders in normal mode
 * rather than "new-session" variant. The "inline" placement forces variant="new-session"
 * which is only correct for new sessions, not resumed existing sessions.
 */
export function PanelChatComposer(props: {
  state: SessionComposerState
  ready: boolean
  directory: string
  inputRef: (el: HTMLDivElement) => void
  setPromptDockRef: (el: HTMLDivElement) => void
  onSubmit: () => void
  onResponseSubmit: () => void
  revert?: {
    items: Array<{ id: string; text: string }>
    restoring?: string
    disabled: boolean
    onRestore: (id: string) => void
  }
}) {
  return (
    <SessionComposerRegion
      state={props.state}
      ready={props.ready}
      centered={false}
      placement="dock"
      inputRef={props.inputRef}
      newSessionWorktree={props.directory}
      onNewSessionWorktreeReset={() => {}}
      onSubmit={props.onSubmit}
      onResponseSubmit={props.onResponseSubmit}
      setPromptDockRef={props.setPromptDockRef}
      revert={props.revert}
    />
  )
}

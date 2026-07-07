import { SessionComposerRegion } from "@/pages/session/composer"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"

/**
 * Panel Chat Composer — thin adapter wrapping the official SessionComposerRegion.
 *
 * Disables centered layout, uses inline placement, and passes directory context.
 */
export function PanelChatComposer(props: {
  state: SessionComposerState
  ready: boolean
  directory: string
  inputRef: (el: HTMLDivElement) => void
  setPromptDockRef: (el: HTMLDivElement) => void
  onSubmit: () => void
  onResponseSubmit: () => void
}) {
  return (
    <SessionComposerRegion
      state={props.state}
      ready={props.ready}
      centered={false}
      placement="inline"
      inputRef={props.inputRef}
      newSessionWorktree={props.directory}
      onNewSessionWorktreeReset={() => {}}
      onSubmit={props.onSubmit}
      onResponseSubmit={props.onResponseSubmit}
      setPromptDockRef={props.setPromptDockRef}
    />
  )
}

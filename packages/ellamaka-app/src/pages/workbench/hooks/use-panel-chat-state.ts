import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSessionComposerState } from "@/pages/session/composer"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"

export function usePanelChatState() {
  const params = useParams()
  const sessionKey = createMemo(() => `panel:${params.dir}/${params.id}`)
  const composerState = createSessionComposerState()

  return {
    sessionKey,
    composerState,
    sessionId: () => params.id,
    directory: () => params.dir,
  }
}

export type { SessionComposerState }

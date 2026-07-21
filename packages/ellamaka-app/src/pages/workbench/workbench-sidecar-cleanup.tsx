import { createEffect } from "solid-js"
import { ServerConnection, useServer } from "@/context/server"
import { useWorkbenchActions } from "./workbench-actions"

/**
 * Decides whether an authoritative server identity transition should trigger PTY cleanup.
 *
 * Trigger only when the identity moves from one non-empty value to a different
 * non-empty value. The first non-empty key (initial sidecar ready, generation
 * 0→1) does NOT trigger cleanup — it is the initial connection, not a restart.
 * Subsequent changes (generation 1→2 after sidecar restart, or URL switch on
 * Web) trigger cleanup.
 */
export function shouldTriggerCleanup(previousKey: string | undefined, currentKey: string | undefined): boolean {
  if (!previousKey) return false
  if (!currentKey) return false
  if (currentKey === previousKey) return false
  return true
}

export function resolveWorkbenchServerIdentity(input: {
  key: string | undefined
  current: ServerConnection.Any | undefined
}): string | undefined {
  if (input.current?.type === "sidecar") {
    if (input.current.generation === undefined) return undefined
    return ServerConnection.key(input.current)
  }
  if (input.key === "sidecar") return undefined
  return input.key
}

export function advanceWorkbenchServerIdentity(previousKey: string | undefined, currentKey: string | undefined) {
  return {
    key: currentKey ?? previousKey,
    triggerCleanup: shouldTriggerCleanup(previousKey, currentKey),
  }
}

/**
 * Binds live server identity changes to WorkbenchActions.clearAllPtyForServerChange().
 *
 * Context wrapper component — consumes both ServerContext (for server.key)
 * and WorkbenchActionsContext (for PTY cleanup action).
 * Mounted inside the provider tree to avoid module-level mutable refs.
 */
export function WorkbenchSidecarCleanupBinding() {
  const server = useServer()
  const actions = useWorkbenchActions()

  let previousKey: string | undefined
  createEffect(() => {
    const key = resolveWorkbenchServerIdentity({ key: server.key, current: server.current })
    const transition = advanceWorkbenchServerIdentity(previousKey, key)
    previousKey = transition.key
    if (!transition.triggerCleanup) return
    actions.clearAllPtyForServerChange()
  })

  return null
}

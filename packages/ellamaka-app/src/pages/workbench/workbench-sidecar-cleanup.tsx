import { createEffect } from "solid-js"
import { useServer } from "@/context/server"
import { useWorkbenchActions } from "./workbench-actions"

/**
 * Decides whether a server.key transition should trigger PTY cleanup.
 *
 * Trigger only when server.key moves from one non-empty value to a different
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

/**
 * Binds server.key changes to WorkbenchActions.clearAllPtyForServerChange().
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
    const key = server.key
    if (!shouldTriggerCleanup(previousKey, key)) {
      previousKey = key
      return
    }
    previousKey = key
    actions.clearAllPtyForServerChange()
  })

  return null
}

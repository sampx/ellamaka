import { createEffect } from "solid-js"
import { useServer } from "@/context/server"
import { useWorkbenchActions } from "./workbench-actions"

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

  let firstServerKey = true
  createEffect(() => {
    const key = server.key
    if (firstServerKey) {
      firstServerKey = false
      return
    }
    actions.clearAllPtyForServerChange()
  })

  return null
}
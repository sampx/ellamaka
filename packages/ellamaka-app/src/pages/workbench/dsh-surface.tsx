/** @jsx h */
import { Show, type JSX } from "solid-js"
import h from "solid-js/h"
import { useWorkbenchState } from "./view-store"

/**
 * The DSH iframe: embeds the DSH web UI under the same-origin `/dsh/` path
 * (single-port scheme, DESIGN-dsh-poc §2.1). Absent a DSH closure the iframe
 * simply won't connect.
 */
export function DshIframe(): JSX.Element {
  return (
    <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-v2-background-bg-deep">
      <iframe
        title="DSH"
        src="/dsh/"
        class="h-full w-full border-0"
        allow="clipboard-write; clipboard-read"
      />
    </div>
  )
}

/**
 * The DSH surface: shows the DSH iframe when the DSH view is visible, and the
 * regular Workbench content (children) otherwise.
 */
export function DshSurface(props: { children: JSX.Element }): JSX.Element {
  const wb = useWorkbenchState()
  return (
    <Show when={!wb.dshVisible} fallback={<DshIframe />}>
      {props.children}
    </Show>
  )
}

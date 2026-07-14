import { SDKProvider } from "@/context/sdk"
import { Show, createMemo, type JSX } from "solid-js"
import { selectActiveWorkbenchContext, type ActiveWorkbenchSnapshot } from "./active-workbench-context"
import { useWorkbenchState } from "./view-store"
import { scopeFromTab, scopeKey, type SpaceScope } from "./workbench-scope"

export type WorkbenchDirectoryTarget = {
  key: string
  scope: SpaceScope
  panelID?: string
  directory: string
}

export function selectWorkbenchDirectoryTarget(input: ActiveWorkbenchSnapshot): WorkbenchDirectoryTarget | undefined {
  const active = selectActiveWorkbenchContext(input)
  if (active) {
    return {
      key: `${scopeKey(active.scope)}\n${active.panel.id}\n${active.directory}`,
      scope: active.scope,
      panelID: active.panel.id,
      directory: active.directory,
    }
  }
  const tab = input.tabs.find((candidate) => candidate.name === input.activeSpaceName)
  if (!tab) return undefined
  const scope = scopeFromTab(tab)
  return {
    key: `${scopeKey(scope)}\n${tab.path}`,
    scope,
    directory: tab.path,
  }
}

export function WorkbenchActiveDirectoryProvider(props: {
  children: (target: WorkbenchDirectoryTarget) => JSX.Element
}) {
  const wb = useWorkbenchState()
  const target = createMemo(() => selectWorkbenchDirectoryTarget({
    spaces: wb.spaces,
    tabs: wb.tabs,
    activeSpaceName: wb.activeSpaceName,
  }))

  return (
    <Show when={target()} keyed>
      {(current) => (
        <SDKProvider directory={current.directory}>
          {props.children(current)}
        </SDKProvider>
      )}
    </Show>
  )
}

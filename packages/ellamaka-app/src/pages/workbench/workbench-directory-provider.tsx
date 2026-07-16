import { SDKProvider } from "@/context/sdk"
import { Show, createMemo, type JSX } from "solid-js"
import { selectActiveWorkbenchContext, type ActiveWorkbenchSnapshot } from "./active-workbench-context"
import { useWorkbenchState } from "./view-store"
import { scopeFromTab, scopeKey, type SpaceScope } from "./workbench-scope"
import { sanitizeDirectory } from "./directory-utils"

export type WorkbenchDirectoryTarget = {
  key: string
  scope: SpaceScope
  panelID?: string
  directory: string
}

export type WorkbenchPanelDirectoryTarget = Pick<WorkbenchDirectoryTarget, "key" | "directory">

export function selectWorkbenchPanelDirectoryTarget(input: {
  id: string
  directory: string
}): WorkbenchPanelDirectoryTarget {
  return {
    key: `${input.id}\n${input.directory}`,
    directory: input.directory,
  }
}

export function readWorkbenchDirectoryMode(input: {
  isWopalSpaceLoading: boolean
  isWopalSpace: boolean
}) {
  if (input.isWopalSpaceLoading) return false
  return input.isWopalSpace
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
      {(current) => {
        // Sanitize before handing the directory to SDKProvider: a malicious
        // or corrupted path must not become the x-opencode-directory header.
        // Empty string (General space) is allowed; unsafe values fall back
        // to empty so downstream SDK calls simply omit the header.
        const sanitized = sanitizeDirectory(current.directory)
        if (sanitized === undefined) {
          console.error("Rejected unsafe workbench directory, falling back to empty:", current.directory)
        }
        const safeDirectory = sanitized ?? ""
        return (
          <SDKProvider directory={safeDirectory}>
            {props.children({ ...current, directory: safeDirectory })}
          </SDKProvider>
        )
      }}
    </Show>
  )
}

export function WorkbenchPanelDirectoryProvider(props: {
  panelID: string
  directory: string
  children: (target: WorkbenchPanelDirectoryTarget) => JSX.Element
}) {
  const target = createMemo(() => selectWorkbenchPanelDirectoryTarget({
    id: props.panelID,
    directory: props.directory,
  }))

  return (
    <Show when={target()} keyed>
      {(current) => {
        const sanitized = sanitizeDirectory(current.directory)
        if (sanitized === undefined) {
          console.error("Rejected unsafe panel directory, falling back to empty:", current.directory)
        }
        const safeDirectory = sanitized ?? ""
        return (
          <SDKProvider directory={safeDirectory}>
            {props.children({ ...current, directory: safeDirectory })}
          </SDKProvider>
        )
      }}
    </Show>
  )
}

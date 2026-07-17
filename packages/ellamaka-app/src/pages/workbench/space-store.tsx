import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo, createResource, createSignal } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useWorkbenchState } from "./view-store"
import { reportWorkbenchError } from "./workbench-error"
import { useWorkbenchRuntime } from "./workbench-runtime"

export type WopalSpace = {
  name: string
  path: string
  type?: string
}

export async function fetchSpaces(
  sdk: { client: { wopalSpace: { spaces: () => Promise<{ data?: { spaces?: WopalSpace[] } | null }> } } },
): Promise<WopalSpace[]> {
  const res = await sdk.client.wopalSpace.spaces()
  return res.data?.spaces ?? []
}

const SpaceStoreContext = createSimpleContext({
  name: "SpaceStore",
  init: () => {
    const sdk = useServerSDK()
    const wb = useWorkbenchState()
    const runtime = useWorkbenchRuntime()

    const [spacesResource, spacesActions] = createResource(() => fetchSpaces(sdk))
    const [lastSuccessful, setLastSuccessful] = createSignal<WopalSpace[]>([])
    const [lastError, setLastError] = createSignal<unknown>()

    createEffect(() => {
      const list = spacesResource()
      if (!list) return
      setLastSuccessful(list)
      setLastError(undefined)
    })

    createEffect(() => {
      if (runtime.recoveryVersion === 0) return
      void spacesActions.refetch()
    })
    createEffect(() => {
      const error = spacesResource.error
      if (!error) return
      reportWorkbenchError("fetch spaces", error)
      setLastError(error)
    })

    const spaces = createMemo(() => spacesResource() ?? lastSuccessful())

    // 在 spaces 列表加载完毕后，校验 wb 中的 tabs 列表
    createEffect(() => {
      const list = spaces()
      if (list.length === 0) return
      const validPaths = new Set(list.map((s) => s.path))
      wb.validateTabs(validPaths)
    })

    return {
      spaces,
      get spacesLoading() { return spacesResource.loading },
      get error() { return lastError() },
      reload: () => spacesActions.refetch(),
    }
  },
})

export const useSpaceStore = () => SpaceStoreContext.use()
export const SpaceStoreProvider = SpaceStoreContext.provider

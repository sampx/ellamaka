import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo, createResource } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useWorkbenchState } from "./view-store"
import { reportWorkbenchError } from "./workbench-error"

export type WopalSpace = {
  name: string
  path: string
  type?: string
}

export async function fetchSpaces(
  sdk: { client: { wopalSpace: { spaces: () => Promise<{ data?: { spaces?: WopalSpace[] } | null }> } } },
): Promise<WopalSpace[]> {
  try {
    const res = await sdk.client.wopalSpace.spaces()
    return res.data?.spaces ?? []
  } catch (e) {
    reportWorkbenchError("fetch spaces", e)
    return []
  }
}

const SpaceStoreContext = createSimpleContext({
  name: "SpaceStore",
  init: () => {
    const sdk = useServerSDK()
    const wb = useWorkbenchState()

    const [spacesResource, spacesActions] = createResource(() => fetchSpaces(sdk))

    const spaces = createMemo(() => spacesResource() ?? [])

    // 在 spaces 列表加载完毕后，校验 wb 中的 tabs 列表
    createEffect(() => {
      const list = spaces()
      if (list.length === 0) return
      const validNames = new Set(list.map((s) => s.name))
      wb.validateTabs(validNames)
    })

    return {
      spaces,
      get spacesLoading() { return spacesResource.loading },
      reload: () => spacesActions.refetch(),
    }
  },
})

export const useSpaceStore = () => SpaceStoreContext.use()
export const SpaceStoreProvider = SpaceStoreContext.provider

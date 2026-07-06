import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"

export type WopalSpace = {
  name: string
  path: string
  type?: string
}

export type SpaceTab = {
  name: string
  path: string
  type?: string
}

export const { use: useSpaceStore, provider: SpaceStoreProvider } = createSimpleContext({
  name: "SpaceStore",
  init: () => {
    const sdk = useServerSDK()
    const [tabs, setTabs] = createStore<SpaceTab[]>([])
    const [activeName, setActiveName] = createSignal<string | undefined>(undefined)

    const [spacesResource, spacesActions] = createResource(async () => {
      try {
        const res = await sdk.client.wopalSpace.spaces()
        return res.data?.spaces ?? []
      } catch {
        return [] as WopalSpace[]
      }
    })

    const spaces = createMemo(() => spacesResource() ?? [])

    function openTab(space: WopalSpace) {
      batch(() => {
        if (!tabs.find((t) => t.name === space.name)) {
          setTabs(tabs.length, { name: space.name, path: space.path, type: space.type })
        }
        setActiveName(space.name)
      })
    }

    function closeTab(name: string) {
      batch(() => {
        const idx = tabs.findIndex((t) => t.name === name)
        if (idx === -1) return
        setTabs((arr) => arr.filter((t) => t.name !== name))
        if (activeName() === name) {
          const next = tabs[idx + 1] ?? tabs[idx - 1]
          setActiveName(next?.name)
        }
      })
    }

    const activeTab = createMemo(() => tabs.find((t) => t.name === activeName()))

    function setActive(name: string) {
      if (tabs.find((t) => t.name === name)) setActiveName(name)
    }

    return {
      spaces,
      spacesLoading: spacesResource.loading,
      reload: () => spacesActions.refetch(),
      tabs,
      activeName,
      activeTab,
      openTab,
      closeTab,
      setActive,
    }
  },
})
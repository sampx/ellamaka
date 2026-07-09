import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useServerSDK } from "@/context/server-sdk"

export type WopalSpace = {
  name: string
  path: string
  type?: string
}

export const { use: useSpaceStore, provider: SpaceStoreProvider } = createSimpleContext({
  name: "SpaceStore",
  init: () => {
    const sdk = useServerSDK()
    const [tabs, setTabs] = persisted(
      Persist.global("workbench.spacetabs", []),
      createStore<WopalSpace[]>([]),
    )
    const [activeStore, setActiveStore] = persisted(
      Persist.global("workbench.activespace", []),
      createStore<{ name: string | undefined }>({ name: undefined }),
    )
    const activeName = () => activeStore.name
    const setActiveName = (name: string | undefined) => setActiveStore("name", name)

    const [spacesResource, spacesActions] = createResource(async () => {
      try {
        const res = await sdk.client.wopalSpace.spaces()
        return res.data?.spaces ?? []
      } catch {
        return [] as WopalSpace[]
      }
    })

    const spaces = createMemo(() => spacesResource() ?? [])

    // Validate persisted tabs against actual spaces list after fetch
    createEffect(() => {
      const list = spaces()
      if (list.length === 0) return
      const validNames = new Set(list.map((s) => s.name))
      setTabs((prev) => {
        const filtered = prev.filter((t) => validNames.has(t.name))
        return filtered.length === prev.length ? prev : filtered
      })
      const current = activeName()
      if (current && !validNames.has(current)) {
        setActiveName(tabs[0]?.name)
      } else if (!current && tabs.length > 0) {
        setActiveName(tabs[0].name)
      }
    })

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

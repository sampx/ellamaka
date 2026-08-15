import { describe, expect, test } from "bun:test"
import { fetchSpaces, type WopalSpace } from "./space-store"

function mockSdk(spaces: WopalSpace[] | Error) {
  return {
    client: {
      wopalSpace: {
        spaces: async () => {
          if (spaces instanceof Error) throw spaces
          return { data: { spaces } }
        },
      },
    },
  }
}

describe("fetchSpaces", () => {
  test("returns spaces list when SDK succeeds", async () => {
    const spaces: WopalSpace[] = [
      { id: "space-a", name: "Space A", path: "/fixtures/space-a", type: "space" },
      { id: "space-b", name: "Space B", path: "/fixtures/space-b", type: "space" },
    ]
    const sdk = mockSdk(spaces)

    const result = await fetchSpaces(sdk)

    expect(result).toEqual(spaces)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("space-a")
  })

  test("propagates an SDK failure so the store can preserve the last successful list", async () => {
    const sdk = mockSdk(new Error("Network failure"))
    await expect(fetchSpaces(sdk)).rejects.toThrow("Network failure")
  })

  test("returns empty array when SDK returns null data", async () => {
    const sdk = {
      client: {
        wopalSpace: {
          spaces: async () => ({ data: null }),
        },
      },
    }

    const result = await fetchSpaces(sdk)

    expect(result).toEqual([])
  })

  test("returns empty array when SDK returns undefined data", async () => {
    const sdk = {
      client: {
        wopalSpace: {
          spaces: async () => ({}),
        },
      },
    }

    const result = await fetchSpaces(sdk)

    expect(result).toEqual([])
  })

  test("normalizes Windows backslash paths returned by SDK", async () => {
    const rawSpaces: WopalSpace[] = [
      { id: "win-space", name: "Win Space", path: "C:\\Users\\Sam\\Project", type: "space" },
    ]
    const sdk = mockSdk(rawSpaces)

    const result = await fetchSpaces(sdk)

    expect(result[0].path).toBe("C:/Users/Sam/Project")
    expect(result[0].id).toBe("win-space")
  })
})

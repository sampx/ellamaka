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
      { name: "Space A", path: "/fixtures/space-a", type: "space" },
      { name: "Space B", path: "/fixtures/space-b", type: "space" },
    ]
    const sdk = mockSdk(spaces)

    const result = await fetchSpaces(sdk)

    expect(result).toEqual(spaces)
    expect(result).toHaveLength(2)
  })

  test("returns empty array when SDK throws (does not silently swallow)", async () => {
    const sdk = mockSdk(new Error("Network failure"))

    const result = await fetchSpaces(sdk)

    expect(result).toEqual([])
    expect(Array.isArray(result)).toBe(true)
  })

  test("returns empty array when SDK returns null data", async () => {
    const sdk = {
      client: {
        wopalSpace: {
          spaces: async () => ({ data: null } as unknown as { data?: { spaces?: WopalSpace[] } }),
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
})

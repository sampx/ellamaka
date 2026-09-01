import { describe, expect, test } from "bun:test"

describe("new-layout prompt surface", () => {
  test("keeps the dark V2 base surface and raised composer elevation", async () => {
    const source = await Bun.file(new URL("../prompt-input.tsx", import.meta.url)).text()

    expect(source).toContain(
      '"group/prompt-input min-h-[96px] w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]": true',
    )
  })
})

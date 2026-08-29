import { describe, expect, test } from "bun:test"

describe("PromptInput spellcheck", () => {
  test("disables browser spellcheck for every prompt editor variant", async () => {
    const source = await Bun.file(new URL("../prompt-input.tsx", import.meta.url)).text()
    const editors = [...source.matchAll(/data-component="prompt-input"/g)]
    const disabled = [...source.matchAll(/spellcheck=\{false\}/g)]

    expect(editors).toHaveLength(2)
    expect(disabled).toHaveLength(editors.length)
    expect(source).not.toContain('spellcheck={store.mode === "normal"}')
  })
})

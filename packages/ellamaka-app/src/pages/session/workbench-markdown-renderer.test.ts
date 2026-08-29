import { describe, expect, mock, test } from "bun:test"
import DOMPurify from "dompurify"
import { streamBlocks } from "./workbench-markdown-stream"
import {
  deferredHighlight,
  fnv1a,
  preserveStreamingHighlight,
  renderMathExpressions,
  syncMarked,
} from "./markdown-highlight"

const parsed = mock((src: string) => `<p>${src}</p>`)

mock.module("@opencode-ai/ui/context/marked", () => ({
  useMarked: () => ({ parse: parsed }),
}))

mock.module("@opencode-ai/ui/context/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

/**
 * WorkbenchMarkdown component behavior is verified end-to-end through the
 * chat timeline tests, which mock this renderer at the module boundary. These
 * tests pin the streaming pipeline contract the component relies on: stable
 * blocks are never re-parsed, and only the live tail changes across a token
 * burst. They run against the pure stream module so they are immune to the
 * cross-file module mocks used by the block/timeline suites.
 */
describe("WorkbenchMarkdown streaming pipeline", () => {
  test("a completed block keeps a byte-stable src across tail growth", () => {
    const start = "# Title\n\nFirst paragraph.\n\nTail one"
    const grown = "# Title\n\nFirst paragraph.\n\nTail one grows"

    const before = streamBlocks(start, true)
    const after = streamBlocks(grown, true)

    expect(before.at(-1)?.mode).toBe("live")
    expect(after.at(-1)?.mode).toBe("live")
    expect(after.slice(0, -1).map((block) => block.src)).toEqual(before.slice(0, -1).map((block) => block.src))
    expect(after.length).toBe(before.length)
  })

  test("a streaming table finalizes row by row instead of re-parsing the whole document", () => {
    const partial = ["intro paragraph", "", "| A | B |", "|---|---|", "| 1 | 2 |", "", "tail *open"].join("\n")
    const more = `${partial} and more*`

    const before = streamBlocks(partial, true)
    const after = streamBlocks(more, true)

    const stableBefore = before.slice(0, -1)
    const stableAfter = after.slice(0, -1)
    expect(stableBefore.length).toBeGreaterThan(0)
    expect(stableAfter.map((block) => block.src)).toEqual(stableBefore.map((block) => block.src))
  })

  test("a single completed block remains a single full block", () => {
    expect(streamBlocks("# Done", false)).toEqual([{ raw: "# Done", src: "# Done", mode: "full" }])
  })

  test("completed text keeps the streaming block partition so settlement can retain its DOM", () => {
    const text = ["# Done", "", "First paragraph.", "", "```ts", "const value = 1", "```"].join("\n")
    const blocks = streamBlocks(text, false)

    expect(blocks.map((block) => block.mode)).toEqual(["full", "full", "full"])
    expect(blocks.map((block) => block.src).join("")).toBe(text)
    expect(blocks.map((block) => String(syncMarked.parse(block.src))).join("")).toBe(String(syncMarked.parse(text)))
  })

  test("a closed fenced code block at the tail renders as a full block", () => {
    const text = "Intro paragraph.\n\n```js\nconst value = 1\n```"
    const blocks = streamBlocks(text, true)
    expect(blocks.at(-1)?.mode).toBe("full")
    expect(blocks.at(-1)?.raw).toContain("```js")
  })
})

describe("WorkbenchMarkdown highlight pipeline", () => {
  test("fnv1a is deterministic and content-sensitive", () => {
    expect(fnv1a("const a = 1")).toBe(fnv1a("const a = 1"))
    expect(fnv1a("const a = 1")).not.toBe(fnv1a("const a = 2"))
  })

  test("the sync parser emits plain pre/code blocks carrying data-lang", () => {
    const html = String(syncMarked.parse("```js\nconst value = 1\n```"))
    expect(html).toContain("<pre><code")
    expect(html).toContain('data-lang="js"')
    expect(html).toContain('class="language-js"')
  })

  test("deferredHighlight upgrades a block, marks its source hash, and preserves the wrapper", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    container.innerHTML =
      '<div data-component="markdown-code"><pre><code class="language-js" data-lang="js">const value = 1</code></pre><button data-slot="markdown-copy-button"></button></div>'

    await deferredHighlight(container)

    const pre = container.querySelector("pre")
    expect(pre?.classList.contains("shiki")).toBe(true)
    expect(pre?.getAttribute("data-source-hash")).toBe(fnv1a("const value = 1"))
    expect(pre?.querySelector("code")?.getAttribute("data-highlighted")).toBe("true")
    // The markdown-code wrapper and its copy button survive the upgrade.
    expect(container.querySelector('[data-component="markdown-code"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="markdown-copy-button"]')).not.toBeNull()
    container.remove()
  })

  test("an aborted signal leaves blocks untouched", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    container.innerHTML = '<pre><code class="language-js" data-lang="js">const value = 1</code></pre>'

    await deferredHighlight(container, undefined, { aborted: true })

    expect(container.querySelector("pre")?.classList.contains("shiki")).toBe(false)
    container.remove()
  })

  test("stream settlement keeps an equal highlighted code block instead of returning to plain code", () => {
    const container = document.createElement("div")
    container.innerHTML =
      '<pre class="shiki" data-source-hash="same"><code data-highlighted="true">const value = 1</code></pre>'
    const incoming = document.createElement("pre")
    incoming.innerHTML = '<code data-lang="js">const value = 1</code>'

    expect(preserveStreamingHighlight(container.querySelector("pre")!, incoming, false)).toBe(true)
  })
})

describe("WorkbenchMarkdown math pipeline", () => {
  test("renders complete inline and display formulas while leaving code untouched", () => {
    const html = renderMathExpressions(
      '<p>Mass energy: $E = mc^2$.</p><p>$$\\frac{a}{b}$$</p><pre><code data-lang="text">$not_math$</code></pre>',
    )

    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).toContain("$not_math$")
    expect(DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } })).toContain('class="katex"')
  })

  test("keeps an unclosed streaming formula as ordinary text", () => {
    const html = renderMathExpressions("<p>Still composing $E = mc</p>")

    expect(html).toContain("$E = mc")
    expect(html).not.toContain('class="katex"')
  })
})

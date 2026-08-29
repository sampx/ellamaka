import { describe, expect, test } from "bun:test"
import { createIncrementalMarkdown, type MarkdownBlock } from "./markdown-incremental-dom"

type Labels = { copy: string; copied: string }

const labels: Labels = { copy: "Copy", copied: "Copied" }

function decorate(root: HTMLDivElement) {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    pre.setAttribute("data-decorated", "true")
  }
}

function block(key: string, html: string, mode: "full" | "live" = "full", hash?: string): MarkdownBlock {
  return { key, hash: hash ?? `hash:${html}`, html, mode }
}

function mount() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  return container
}

describe("incremental markdown DOM", () => {
  test("appends blocks between comment boundaries", () => {
    const container = mount()
    const incremental = createIncrementalMarkdown(decorate)

    const handled = incremental.render(
      true,
      container,
      [block("a", "<p>one</p>"), block("b", "<p>two</p>", "live")],
      labels,
    )

    expect(handled).toBe(true)
    expect(container.querySelectorAll("p")).toHaveLength(2)
    expect(container.textContent).toBe("onetwo")
    container.remove()
  })

  test("skips blocks whose hash is unchanged and only replaces the live tail", () => {
    const container = mount()
    const incremental = createIncrementalMarkdown(decorate)

    incremental.render(true, container, [block("a", "<p>one</p>"), block("b", "<p>two</p>", "live")], labels)
    const stable = container.querySelector("p")!
    const liveTail = container.querySelectorAll("p")[1]!

    incremental.render(true, container, [block("a", "<p>one</p>"), block("b", "<p>two and a half</p>", "live")], labels)

    expect(container.querySelector("p")).toBe(stable)
    expect(container.querySelectorAll("p")[1]).not.toBe(liveTail)
    expect(container.textContent).toContain("two and a half")
    container.remove()
  })

  test("settles compatible blocks without replacing the stable DOM", () => {
    const container = mount()
    const incremental = createIncrementalMarkdown(decorate)

    expect(
      incremental.render(false, container, [block("a", "<p>one</p>"), block("b", "<p>two</p>", "live")], labels),
    ).toBe(false)
    expect(incremental.render(true, container, [block("a", "<p>one</p>", "live")], labels)).toBe(false)
    expect(
      incremental.render(
        true,
        container,
        [block("a", "<p>one</p>"), block("b", "<p>two</p>", "live", "h:live")],
        labels,
      ),
    ).toBe(true)
    const stable = container.querySelector("p")!

    expect(
      incremental.render(
        false,
        container,
        [block("a", "<p>one</p>"), block("b", "<p>two</p>", "full", "h:full")],
        labels,
      ),
    ).toBe(true)
    expect(container.querySelector("p")).toBe(stable)
    container.remove()
  })

  test("resets when block keys diverge", () => {
    const container = mount()
    const incremental = createIncrementalMarkdown(decorate)

    incremental.render(true, container, [block("a", "<p>one</p>"), block("b", "<p>two</p>", "live")], labels)
    incremental.render(true, container, [block("x", "<p>new</p>"), block("y", "<p>tail</p>", "live")], labels)

    expect(container.textContent).toBe("newtail")
    container.remove()
  })

  test("drops extra records when the block list shrinks", () => {
    const container = mount()
    const incremental = createIncrementalMarkdown(decorate)

    incremental.render(
      true,
      container,
      [block("a", "<p>one</p>"), block("b", "<p>two</p>"), block("c", "<p>three</p>", "live")],
      labels,
    )
    expect(container.querySelectorAll("p")).toHaveLength(3)

    incremental.render(true, container, [block("a", "<p>one</p>"), block("c", "<p>three</p>", "live")], labels)
    expect(container.querySelectorAll("p")).toHaveLength(2)
    expect(container.textContent).toBe("onethree")
    container.remove()
  })

  test("keeps a growing highlighted code block via the preserve hook instead of replacing it", () => {
    const container = mount()
    const preserved: Array<[Element, Element]> = []
    const incremental = createIncrementalMarkdown(decorate, {
      cancel: () => {},
      ready: () => {},
      preserve: (from, to) => {
        preserved.push([from, to])
        return true
      },
    })

    const highlighted = '<div data-component="markdown-code"><pre class="shiki"><code>const a = 1</code></pre></div>'
    incremental.render(true, container, [block("a", "<p>intro</p>"), block("b", highlighted, "live", "h1")], labels)
    const before = container.querySelector("pre.shiki")!

    const grown = '<pre><code data-lang="js">const a = 1\nconst b = 2</code></pre>'
    incremental.render(true, container, [block("a", "<p>intro</p>"), block("b", grown, "live", "h2")], labels)

    // The preserve hook was consulted and the original highlighted <pre>
    // survived — no plain/highlight flip.
    expect(preserved).toHaveLength(1)
    expect(container.querySelector("pre.shiki")).toBe(before)
    container.remove()
  })

  test("keeps an unchanged highlighted code block while the stream settles", () => {
    const container = mount()
    const preserved: Array<[Element, Element]> = []
    const incremental = createIncrementalMarkdown(decorate, {
      cancel: () => {},
      ready: () => {},
      preserve: (from, to) => {
        preserved.push([from, to])
        return true
      },
    })

    const highlighted = '<div data-component="markdown-code"><pre class="shiki"><code>const a = 1</code></pre></div>'
    incremental.render(true, container, [block("a", "<p>intro</p>"), block("b", highlighted, "live", "h1")], labels)
    const before = container.querySelector("pre.shiki")!

    const complete = '<pre><code data-lang="js">const a = 1</code></pre>'
    expect(
      incremental.render(false, container, [block("a", "<p>intro</p>"), block("b", complete, "full", "h2")], labels),
    ).toBe(true)

    expect(preserved).toHaveLength(1)
    expect(container.querySelector("pre.shiki")).toBe(before)
    container.remove()
  })

  test("replaces the live block when the preserve hook declines", () => {
    const container = mount()
    const incremental = createIncrementalMarkdown(decorate, {
      cancel: () => {},
      ready: () => {},
      preserve: () => false,
    })

    const highlighted = '<pre class="shiki"><code>const a = 1</code></pre>'
    incremental.render(true, container, [block("a", "<p>intro</p>"), block("b", highlighted, "live", "h1")], labels)

    const grown = '<pre><code data-lang="js">different content</code></pre>'
    incremental.render(true, container, [block("a", "<p>intro</p>"), block("b", grown, "live", "h2")], labels)

    expect(container.querySelector("pre.shiki")).toBeNull()
    expect(container.textContent).toContain("different content")
    container.remove()
  })
})

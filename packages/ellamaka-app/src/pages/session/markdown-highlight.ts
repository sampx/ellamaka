import { Marked } from "marked"
import katex from "katex"
import { bundledLanguages, codeToHtml } from "shiki"

/**
 * Two-pass markdown highlight pipeline, ported from kilocode
 * (`context/marked.tsx` + `markdown.tsx` issue #6221). The parser emits plain
 * <pre><code data-lang="..."> blocks synchronously; `deferredHighlight` then
 * upgrades them to Shiki-highlighted blocks off the critical render path.
 */

const LANG_ALIASES: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  "f#": "fsharp",
  "objective-c++": "objective-cpp",
}

export const syncMarked = new Marked({ gfm: true }).use({
  renderer: {
    code({ text, lang }) {
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
      const normalized = lang ? (LANG_ALIASES[lang] ?? lang) : ""
      const safe = normalized ? normalized.replace(/[^a-zA-Z0-9_-]/g, "") : ""
      const attr = safe ? ` class="language-${safe}" data-lang="${safe}"` : ' data-lang="text"'
      return `<pre><code${attr}>${escaped}</code></pre>`
    },
  },
})

/** FNV-1a hash — lightweight source fingerprint stored in the DOM. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function renderMath(text: string, displayMode: boolean, fallback: string) {
  try {
    return katex.renderToString(text, {
      displayMode,
      throwOnError: false,
      strict: false,
    })
  } catch {
    return fallback
  }
}

/**
 * Replaces completed $...$ and $$...$$ expressions in parsed Markdown HTML.
 * It works on text nodes only, so source examples in pre/code/kbd elements
 * remain literal. An unmatched delimiter is intentionally left alone: during
 * streaming that means a formula only upgrades after its closing delimiter
 * arrives, rather than changing geometry on every delta.
 */
export function renderMathExpressions(html: string): string {
  if (!html.includes("$") || typeof document === "undefined") return html

  const root = document.createElement("div")
  root.innerHTML = html
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text && !node.parentElement?.closest("pre, code, kbd, script, style")) nodes.push(node)
  }

  const pattern = /\$\$([\s\S]+?)\$\$|(?<![\\$])\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g
  for (const node of nodes) {
    const source = node.data
    let cursor = 0
    let changed = false
    let output = ""

    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0
      const raw = match[0]
      const display = match[1] !== undefined
      const expression = match[1] ?? match[2] ?? ""
      if (!expression.trim()) continue
      output += source.slice(cursor, index)
      output += renderMath(expression, display, raw)
      cursor = index + raw.length
      changed = true
    }

    if (!changed) continue
    output += source.slice(cursor)
    const template = document.createElement("template")
    template.innerHTML = output
    node.replaceWith(template.content)
  }

  return root.innerHTML
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 500

function touch(key: string, value: string) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size <= CACHE_LIMIT) return
  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

function replaceWithHighlighted(block: Element, html: string, sourceHash: string) {
  const pre = block.parentElement
  if (!pre || !pre.isConnected) return
  const temp = document.createElement("div")
  temp.innerHTML = html
  const highlighted = temp.firstElementChild
  if (!highlighted) return
  // The morphdom guard reads this hash to skip highlighted blocks whose
  // source has not changed, so streaming re-renders never revert them to
  // plain code.
  highlighted.setAttribute("data-source-hash", sourceHash)
  highlighted.querySelector("code")?.setAttribute("data-highlighted", "true")
  const wrapper = pre.parentElement
  if (wrapper?.getAttribute("data-component") === "markdown-code") {
    wrapper.replaceChild(highlighted, pre)
    return
  }
  pre.replaceWith(highlighted)
}

/**
 * Progressive Shiki upgrade. Each block is highlighted in a setTimeout(0) so
 * the main thread stays responsive; results are cached by language+source; an
 * abort signal cancels stale passes when a newer render supersedes them. The
 * whole <pre> is replaced (inside its markdown-code wrapper, preserving the
 * copy button), and data-source-hash lets the morphdom guard preserve it.
 */
export async function deferredHighlight(
  container: HTMLElement,
  onComplete?: () => void,
  signal?: { aborted: boolean },
): Promise<void> {
  // Mermaid has a separate, completion-only SVG pipeline. Do not send it
  // through Shiki first: a plain-text highlight would create a needless
  // intermediate layout and a visible flash before the diagram appears.
  const blocks = Array.from(container.querySelectorAll("pre > code[data-lang]:not([data-highlighted])")).filter(
    (block) => (block.getAttribute("data-lang") ?? "").toLowerCase() !== "mermaid",
  )
  if (blocks.length === 0) {
    onComplete?.()
    return
  }

  for (const block of blocks) {
    if (!container.isConnected || signal?.aborted) break
    const lang = block.getAttribute("data-lang") || "text"
    const code = block.textContent ?? ""
    if (!code) continue

    const cacheKey = `${lang}\0${code}`
    const codeHash = fnv1a(code)
    const cached = cache.get(cacheKey)
    if (cached) {
      touch(cacheKey, cached)
      replaceWithHighlighted(block, cached, codeHash)
      continue
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!block.isConnected || signal?.aborted) {
          resolve()
          return
        }
        const language = lang in bundledLanguages ? lang : "text"
        codeToHtml(code, { lang: language, themes: { light: "github-light", dark: "github-dark" } })
          .then((html) => {
            if (!block.isConnected || signal?.aborted) {
              resolve()
              return
            }
            touch(cacheKey, html)
            replaceWithHighlighted(block, html, codeHash)
            resolve()
          })
          .catch(() => resolve())
      }, 0)
    })
  }

  if (container.isConnected && !signal?.aborted) {
    onComplete?.()
  }
}

type Job = {
  code: string
  lang: string
  busy: boolean
}

const jobs = new WeakMap<HTMLPreElement, Job>()

function continues(before: string, after: string) {
  const base = before.endsWith("\n") ? before.slice(0, -1) : before
  return !!base && after.startsWith(base)
}

function update(pre: HTMLPreElement, html: string, code: string) {
  if (!pre.isConnected) return
  const temp = document.createElement("div")
  temp.innerHTML = html
  const next = temp.firstElementChild
  if (!(next instanceof HTMLPreElement)) return
  const x = pre.scrollLeft
  for (const name of pre.getAttributeNames()) {
    pre.removeAttribute(name)
  }
  for (const attr of next.attributes) {
    pre.setAttribute(attr.name, attr.value)
  }
  pre.setAttribute("data-source-hash", fnv1a(code))
  pre.replaceChildren(...Array.from(next.childNodes))
  pre.querySelector("code")?.setAttribute("data-highlighted", "true")
  pre.scrollLeft = x
}

async function refresh(pre: HTMLPreElement, code: string, lang: string) {
  if (!pre.isConnected || !code) return
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  if (!pre.isConnected) return
  try {
    const language = lang in bundledLanguages ? lang : "text"
    const html = await codeToHtml(code, { lang: language, themes: { light: "github-light", dark: "github-dark" } })
    if (!pre.isConnected) return
    update(pre, html, code)
  } catch {
    // Leave the current highlight in place; the next queued pass will retry.
  }
}

function run(pre: HTMLPreElement, job: Job) {
  const code = job.code
  const lang = job.lang
  job.busy = true
  const done = () => {
    job.busy = false
    if (!pre.isConnected) return
    if (job.code !== code || job.lang !== lang) {
      run(pre, job)
      return
    }
  }
  void refresh(pre, code, lang).then(done, done)
}

function queue(pre: HTMLPreElement, code: string, lang: string) {
  const job = jobs.get(pre) ?? { code, lang, busy: false }
  job.code = code
  job.lang = lang
  jobs.set(pre, job)
  if (job.busy) return
  run(pre, job)
}

/**
 * Streaming code highlight preservation (ported from kilocode
 * `markdown-stream-highlight`). While a fenced code block is still growing,
 * replacing the whole block would flip it between plain and highlighted on
 * every token. When the new source is a continuation of the highlighted
 * source, the caller keeps the existing highlighted <pre> in place and this
 * queues a coalesced re-highlight that updates the block in place once the
 * token burst settles.
 *
 * Returns true when the caller should skip replacing the block.
 */
export function preserveStreamingHighlight(from: Element, to: Element, streaming: boolean) {
  if (!(from instanceof HTMLPreElement) || !(to instanceof HTMLPreElement)) return false
  if (!from.classList.contains("shiki") || to.classList.contains("shiki")) return false
  const before = from.querySelector("code")?.textContent ?? ""
  const after = to.querySelector("code")?.textContent ?? ""
  const lang = to.querySelector("code")?.getAttribute("data-lang") || "text"
  // The final render has the same source as the existing Shiki block. Keep
  // that DOM node rather than briefly replacing it with a plain <pre> and
  // waiting for a second asynchronous highlight pass.
  if (before === after && !!after) return true
  if (!streaming) return false
  if (!after || !continues(before, after)) return false
  queue(from, after, lang)
  return true
}

import DOMPurify from "dompurify"
import type { Mermaid } from "mermaid"
import { fnv1a } from "./markdown-highlight"

export type MermaidRenderOptions = {
  mode: "light" | "dark"
  /** Mermaid never renders a growing fence: the readable code source stays put until completion. */
  streaming: boolean
}

type AbortSignal = { aborted: boolean }

const MAX_TEXT_SIZE = 20_000
const MAX_EDGES = 500
const RENDERED = "data-mermaid-rendered"

let mermaidPromise: Promise<Mermaid> | undefined
let renderSequence = 0
let renderQueue: Promise<void> = Promise.resolve()

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((module) => module.default)
  return mermaidPromise
}

function enqueue(task: () => Promise<void>) {
  const next = renderQueue.then(task, task)
  renderQueue = next.catch(() => {})
  return next
}

function mermaidConfig(mode: MermaidRenderOptions["mode"]) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    htmlLabels: false,
    maxTextSize: MAX_TEXT_SIZE,
    maxEdges: MAX_EDGES,
    suppressErrorRendering: true,
    logLevel: "fatal" as const,
    theme: mode === "dark" ? ("dark" as const) : ("default" as const),
    // Keep host-level safety and visual decisions authoritative even if a
    // source happens to contain a Mermaid configuration directive.
    secure: ["securityLevel", "startOnLoad", "htmlLabels", "maxTextSize", "maxEdges", "theme"],
  }
}

function sourceIsAllowed(source: string) {
  if (!source.trim() || source.length > MAX_TEXT_SIZE) return false
  const leading = source.trimStart()
  // Workbench deliberately owns Mermaid configuration. Per-message init
  // directives and YAML frontmatter would otherwise be able to override
  // theme, layout limits, or renderer behavior.
  if (/^\s*%%\{/m.test(source) || leading.startsWith("---\n") || leading.startsWith("---\r\n")) return false
  // Interactive diagram links/callbacks do not belong in an assistant reply.
  return !/^\s*(?:click|call)\b/im.test(source)
}

function isMermaidCode(block: Element) {
  return (block.getAttribute("data-lang") ?? "").toLowerCase() === "mermaid"
}

function codeBlocks(container: HTMLElement) {
  return Array.from(container.querySelectorAll("pre > code[data-lang]")).filter(isMermaidCode)
}

function wrapperFor(pre: HTMLPreElement) {
  const parent = pre.parentElement
  return parent?.getAttribute("data-component") === "markdown-code" ? parent : undefined
}

function removeDiagram(wrapper: HTMLElement | undefined) {
  if (!wrapper) return
  for (const child of Array.from(wrapper.children)) {
    if (child.getAttribute("data-component") === "markdown-mermaid") child.remove()
  }
}

function showSource(pre: HTMLPreElement) {
  pre.hidden = false
  pre.removeAttribute("aria-hidden")
  pre.removeAttribute(RENDERED)
  removeDiagram(wrapperFor(pre))
}

function rendererStyles(source: string) {
  const styles: string[] = []
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
  for (const match of source.matchAll(pattern)) {
    const css = match[1]?.trim() ?? ""
    if (
      css.length > 0 &&
      css.length <= MAX_TEXT_SIZE &&
      !/(?:url\s*\(|@import|expression\s*\(|-moz-binding|behavior\s*:|<)/i.test(css)
    ) {
      styles.push(css)
    }
  }
  return styles
}

function sanitizeSvg(source: string) {
  if (!DOMPurify.isSupported) return
  const styles = rendererStyles(source)
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["a", "foreignObject", "iframe", "object", "embed", "script"],
    FORBID_ATTR: ["href", "xlink:href"],
  })
  const template = document.createElement("template")
  template.innerHTML = clean
  if (template.content.childElementCount !== 1) return
  const svg = template.content.firstElementChild
  if (!(svg instanceof SVGSVGElement)) return
  // DOMPurify intentionally drops <style> from an SVG profile. Mermaid's
  // renderer emits its palette there, so restore only CSS extracted from the
  // strict renderer output after rejecting every external or executable form.
  for (const css of styles.reverse()) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style")
    style.textContent = css
    svg.insertBefore(style, svg.firstChild)
  }
  return svg
}

function replaceDiagram(pre: HTMLPreElement, svg: SVGSVGElement, key: string, type: string) {
  const wrapper = wrapperFor(pre)
  if (!wrapper) return
  const diagram = document.createElement("div")
  diagram.setAttribute("data-component", "markdown-mermaid")
  diagram.setAttribute("data-scrollable", "true")
  diagram.setAttribute("data-mermaid-type", type)
  diagram.setAttribute("role", "img")
  diagram.setAttribute("aria-label", `Mermaid ${type} diagram`)
  diagram.appendChild(svg)

  let existing: Element | undefined
  for (const child of Array.from(wrapper.children)) {
    if (child.getAttribute("data-component") === "markdown-mermaid") {
      existing = child
      break
    }
  }
  if (existing) existing.replaceWith(diagram)
  else wrapper.insertBefore(diagram, pre)

  pre.hidden = true
  pre.setAttribute("aria-hidden", "true")
  pre.setAttribute(RENDERED, key)
}

function currentSource(pre: HTMLPreElement) {
  return pre.querySelector("code")?.textContent ?? ""
}

/**
 * Lazily upgrades completed Mermaid fences into a static, strict-security SVG.
 * The original `<pre><code>` is hidden rather than replaced, keeping the copy
 * action and a reliable readable fallback for every rendering failure.
 */
export async function deferredMermaid(
  container: HTMLElement,
  options: MermaidRenderOptions,
  signal?: AbortSignal,
): Promise<void> {
  if (options.streaming || !container.isConnected || signal?.aborted) return

  for (const code of codeBlocks(container)) {
    const pre = code.parentElement
    if (!(pre instanceof HTMLPreElement)) continue
    const source = currentSource(pre)
    const key = `${options.mode}:${fnv1a(source)}`
    if (pre.getAttribute(RENDERED) === key && pre.hidden) continue
    if (!sourceIsAllowed(source)) {
      showSource(pre)
      continue
    }

    try {
      await enqueue(async () => {
        if (!container.isConnected || signal?.aborted || currentSource(pre) !== source) return
        const mermaid = await loadMermaid()
        if (!container.isConnected || signal?.aborted || currentSource(pre) !== source) return

        mermaid.initialize(mermaidConfig(options.mode))
        const id = `workbench-mermaid-${fnv1a(`${options.mode}\0${source}`)}-${++renderSequence}`
        const result = await mermaid.render(id, source)
        if (!container.isConnected || signal?.aborted || currentSource(pre) !== source) return
        const svg = sanitizeSvg(result.svg)
        if (!svg) {
          showSource(pre)
          return
        }
        replaceDiagram(pre, svg, key, result.diagramType)
      })
    } catch {
      // Keep the original fenced source visible if Mermaid cannot parse or
      // load a diagram. A bad assistant response must never blank the turn.
      if (!signal?.aborted && currentSource(pre) === source) showSource(pre)
    }
  }
}

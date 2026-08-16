type Labels = {
  copy: string
  copied: string
}

export type MarkdownBlock = {
  key: string
  hash: string
  html: string
  mode: "full" | "live"
}

type Record = {
  key: string
  hash: string
  start: Comment
  end: Comment
}

type Decorate = (root: HTMLDivElement, labels: Labels) => void

type Hooks<Context> = {
  cancel: () => void
  ready: (container: HTMLDivElement, labels: Labels, context: Context) => void
  /**
   * Streaming code highlight preservation. When the live block's existing DOM
   * is a single highlighted <pre> and the incoming block is a single plain
   * <pre> whose source continues the old one, the hook keeps the old block and
   * queues an in-place re-highlight. Returns true to skip the replacement.
   */
  preserve?: (from: Element, to: Element) => boolean
}

/**
 * Incremental DOM renderer for streaming markdown. Each block lives between
 * comment boundary nodes; unchanged blocks (same hash) keep their DOM nodes
 * untouched and only the live tail is replaced. Ported from kilocode
 * `markdown-incremental-dom`.
 */
export function createIncrementalMarkdown<Context = never>(decorate: Decorate, hooks?: Hooks<Context>) {
  let records: Record[] = []

  const reset = () => {
    records = []
  }

  const parse = (html: string, labels: Labels) => {
    const root = document.createElement("div")
    root.innerHTML = html
    decorate(root, labels)
    const fragment = document.createDocumentFragment()
    while (root.firstChild) fragment.appendChild(root.firstChild)
    return fragment
  }

  const remove = (record: Record) => {
    const parent = record.start.parentNode
    if (!parent || record.end.parentNode !== parent) return false

    const nodes: ChildNode[] = []
    let node: ChildNode | null = record.start
    while (node && node.parentNode === parent) {
      nodes.push(node)
      if (node === record.end) {
        for (const item of nodes) parent.removeChild(item)
        return true
      }
      node = node.nextSibling
    }
    return false
  }

  const replace = (record: Record, block: MarkdownBlock, labels: Labels) => {
    // Streaming code continuation: when the existing live DOM is exactly one
    // highlighted <pre> (inside its markdown-code wrapper) and the incoming
    // block is a single plain <pre> that continues it, keep the highlighted
    // block and let the preserve hook re-highlight in place. A wholesale
    // replace would flip the block between plain and highlighted per token.
    const current = record.start.nextSibling
    if (
      block.mode === "live" &&
      hooks?.preserve &&
      current &&
      current !== record.end &&
      current.nextSibling === record.end
    ) {
      const candidate = current instanceof HTMLElement && current.getAttribute("data-component") === "markdown-code"
        ? current.querySelector("pre")
        : current
      const incoming = document.createElement("div")
      incoming.innerHTML = block.html
      const to = incoming.children.length === 1 ? incoming.firstElementChild : null
      const toPre = to instanceof HTMLElement && to.getAttribute("data-component") === "markdown-code"
        ? to.querySelector("pre")
        : to
      if (candidate instanceof HTMLPreElement && toPre instanceof HTMLPreElement) {
        if (hooks.preserve(candidate, toPre)) {
          record.hash = block.hash
          return
        }
      }
    }

    let node = record.start.nextSibling
    while (node && node !== record.end) {
      const next: ChildNode | null = node.nextSibling
      node.parentNode?.removeChild(node)
      node = next
    }
    record.end.parentNode?.insertBefore(parse(block.html, labels), record.end)
    record.hash = block.hash
  }

  const append = (container: HTMLDivElement, block: MarkdownBlock, labels: Labels) => {
    // Comment boundaries preserve the exact Markdown child structure, so
    // existing direct-child CSS and copy behavior do not need wrapper
    // exceptions.
    const start = document.createComment(`markdown:${block.key}:start`)
    const end = document.createComment(`markdown:${block.key}:end`)
    container.appendChild(start)
    container.appendChild(parse(block.html, labels))
    container.appendChild(end)
    records.push({ key: block.key, hash: block.hash, start, end })
  }

  const update = (container: HTMLDivElement, blocks: MarkdownBlock[], labels: Labels) => {
    if (blocks.length < 2) return false
    if (blocks.slice(0, -1).some((block) => block.mode !== "full")) return false

    if (records.some((record) => !record.start.isConnected || !record.end.isConnected)) reset()
    const shared = Math.min(records.length, blocks.length)
    if (records.slice(0, shared).some((record, index) => record.key !== blocks[index]?.key)) {
      reset()
      container.replaceChildren()
    }

    if (records.length === 0) container.replaceChildren()

    while (records.length > blocks.length) {
      const record = records.at(-1)
      if (!record || !remove(record)) {
        reset()
        return false
      }
      records.pop()
    }

    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]!
      const record = records[index]
      if (!record) {
        append(container, block, labels)
        continue
      }
      if (record.hash === block.hash) continue
      replace(record, block, labels)
    }
    return true
  }

  const render = (
    streaming: boolean,
    container: HTMLDivElement,
    blocks: MarkdownBlock[],
    labels: Labels,
    context?: Context,
  ) => {
    if (!streaming || !update(container, blocks, labels)) return false
    hooks?.cancel()
    hooks?.ready(container, labels, context as Context)
    return true
  }

  return { reset, render, update }
}

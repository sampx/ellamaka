import type { StreamBlock } from "./workbench-markdown-stream"

type Token = {
  type: string
  raw: string
}

/**
 * Splits lexed top-level tokens into stable blocks. Every token except the
 * last keeps a byte-stable raw across stream updates, so the parse/sanitize
 * cache can reuse it and only the live tail is re-parsed and re-rendered.
 * Ported from kilocode `markdown-stable-blocks`.
 */
export function stableBlocks(tokens: Token[], live: (raw: string) => string): StreamBlock[] | undefined {
  const indexes = tokens.flatMap((token, index) => (token.type === "space" ? [] : [index]))
  if (indexes.length < 2) return

  const raw = (start: number, end = tokens.length) =>
    tokens
      .slice(start, end)
      .map((token) => token.raw)
      .join("")
  const stable = indexes.slice(0, -1).map((start, index) => {
    const value = raw(start, indexes[index + 1])
    return { raw: value, src: value, mode: "full" as const }
  })
  const tail = raw(indexes.at(-1)!)
  return [...stable, { raw: tail, src: live(tail), mode: "live" }]
}

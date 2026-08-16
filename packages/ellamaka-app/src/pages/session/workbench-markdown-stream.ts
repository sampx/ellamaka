import { marked, type Tokens } from "marked"
import remend from "remend"
import { stableBlocks } from "./markdown-stable-blocks"

export type StreamBlock = {
  raw: string
  src: string
  mode: "full" | "live"
}

function refs(text: string) {
  return /^\[[^\]]+\]:\s+\S+/m.test(text) || /^\[\^[^\]]+\]:\s+/m.test(text)
}

function open(raw: string) {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
  if (!match) return false
  const mark = match[1]
  if (!mark) return false
  const char = mark[0]
  const size = mark.length
  const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? ""
  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last)
}

function heal(text: string) {
  return remend(text, { linkMode: "text-only" })
}

/**
 * Splits streaming markdown into renderable blocks. Completed top-level
 * tokens become stable `full` blocks; only the still-growing tail is healed
 * and marked `live`. Falls back to the shared code-block split for an open
 * fenced block. Ported from kilocode `markdown-stream`.
 */
export function streamBlocks(text: string, live: boolean): StreamBlock[] {
  if (!live) return [{ raw: text, src: text, mode: "full" }]
  const src = heal(text)
  if (refs(text)) return [{ raw: text, src, mode: "live" }]
  const tokens = marked.lexer(text)
  const candidate = tokens.findLast((token) => token.type !== "space")
  const blocks = candidate && !open(candidate.raw) ? stableBlocks(tokens, heal) : undefined
  if (blocks) {
    // A closed fenced code block at the tail is already stable: its raw will
    // not change unless new content opens a fresh block, so render it as a
    // full markdown block instead of treating it as a growing plain-text tail.
    if (candidate?.type === "code" && !open(candidate.raw)) {
      return blocks.map((block, index) =>
        index === blocks.length - 1 ? { ...block, mode: "full" as const } : block,
      )
    }
    return blocks
  }
  const tail = tokens.findLastIndex((token) => token.type !== "space")
  if (tail < 0) return [{ raw: text, src, mode: "live" }]
  const last = tokens[tail]
  if (!last || last.type !== "code") return [{ raw: text, src, mode: "live" }]
  const code = last as Tokens.Code
  if (!open(code.raw)) return [{ raw: text, src, mode: "live" }]
  const head = tokens
    .slice(0, tail)
    .map((token) => token.raw)
    .join("")
  if (!head) return [{ raw: code.raw, src: code.raw, mode: "live" }]
  return [
    { raw: head, src: heal(head), mode: "live" },
    { raw: code.raw, src: code.raw, mode: "live" },
  ]
}

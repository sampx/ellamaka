import { readFileSync, writeFileSync } from "node:fs"
import { existsSync } from "node:fs"

/**
 * User patch layer (`cordis.patch.yml`) write library (Plan Task 7).
 *
 * Implements the CLI's enable/disable surface with the SAME semantics as the
 * official dshmarket `src/patch.ts` (lab reference):
 *
 * - `disableRow`: append a `- id: X` + `  disabled: true` block (idempotent).
 * - `enableRow`: remove the disabled block; when a lower layer (bundle/home
 *   patch) holds the row down, force-enable it with `disabled: false`.
 * - `readUserPatchState`: line-wise scan of the disables / forced / inserts
 *   the layer declares (deliberately not a YAML parse — a plain
 *   `- id: X` + `disabled: ...` pair is enough for the CLI's needs).
 *
 * All writes serialize through a queued writer, so concurrent CLI processes
 * never interleave read-modify-write cycles on the same file. Row ids are
 * validated against the plain-scalar rule before any write.
 */

/** The patch state one file declares. */
export interface PatchState {
  /** Row ids the user patch disables (`disabled: true`). */
  disables: string[]
  /** Row ids the user patch force-enables (`disabled: false`). */
  forced: string[]
  /** Row ids the user patch inserts (from `- insert:` blocks). */
  inserts: string[]
}

/** Row ids allowed to be written: plain unquoted YAML scalars. */
const ROW_ID_RE = /^[A-Za-z0-9_.-]+$/u

/** One queued write chain per process (CLI usage is one file per run). */
let writeChain: Promise<unknown> = Promise.resolve()

/**
 * Serialize `fn` through the process-wide write chain: every queued write
 * observes the file state left by the previous one (official queuedWrite
 * semantics).
 */
export function queuedWrite<T>(fn: () => Promise<T>): Promise<T> {
  const task = writeChain.then(fn, fn)
  writeChain = task.catch(() => undefined)
  return task
}

/**
 * Line-wise scan of one patch file. A missing file is the ordinary empty
 * state (a fresh profile's patch layer).
 */
export function readUserPatchState(patchPath: string): PatchState {
  const disables: string[] = []
  const forced: string[] = []
  const inserts: string[] = []
  let text = ""
  try {
    text = readFileSync(patchPath, "utf8")
  } catch {
    return { disables, forced, inserts }
  }
  const lines = text.split(/\r?\n/u)
  let inInsert = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (/^- insert:\s*$/u.test(line)) {
      inInsert = true
      continue
    }
    if (/^- /u.test(line)) inInsert = false
    if (inInsert) {
      const insertRow = /^ {4}- id: ([A-Za-z0-9_.-]+)/u.exec(line)
      if (insertRow !== null) inserts.push(insertRow[1])
      continue
    }
    const disableRow = /^- id: ([A-Za-z0-9_.-]+)\s*$/u.exec(line)
    if (disableRow === null) continue
    const next = lines[index + 1] ?? ""
    if (/^ {2}disabled: true\s*$/u.test(next)) disables.push(disableRow[1])
    else if (/^ {2}disabled: false\s*$/u.test(next)) forced.push(disableRow[1])
  }
  return { disables, forced, inserts }
}

/** Escape a row id for literal RegExp use. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Restore the empty-list placeholder when nothing else is left: removing the
 * LAST row must leave a valid top-level array, not a file of pure comments
 * (an invalid layer bricks the profile boot — official withPlaceholderRestored
 * semantics).
 */
function withPlaceholderRestored(text: string): string {
  const stripped = text.replace(/^[ \t]*#.*$/gmu, "").trim()
  if (stripped !== "") return text
  // Nothing but comments (or nothing at all) is left: restore the empty
  // placeholder so the layer stays a valid top-level array.
  return "[]\n"
}

/** Append one row block to the patch file (creating a valid array first). */
function appendPatchEntry(patchPath: string, block: string): { ok: boolean; reason: string | null } {
  let text = ""
  try {
    text = readFileSync(patchPath, "utf8")
  } catch {
    text = ""
  }
  if (existsSync(patchPath) && text.trim() !== "" && !text.trimEnd().startsWith("#") && !text.trim().startsWith("[]") && !/^\s*- /mu.test(text)) {
    // Not a top-level array and not the empty placeholder: refuse rather
    // than corrupt a structure this dialect does not understand.
    return { ok: false, reason: "补丁层不是合法的条目数组,已拒绝追加以免破坏 / the patch layer is not a valid entry list; refused to append" }
  }
  if (text.trim().startsWith("[]")) {
    // Replace the empty placeholder with the first row.
    const replaced = text.replace(/\[\][ \t]*(\r?\n|$)/u, block)
    writeFileSync(patchPath, replaced)
    return { ok: true, reason: null }
  }
  const next = text.endsWith("\n") || text === "" ? text : `${text}\n`
  writeFileSync(patchPath, `${next}${block}`)
  return { ok: true, reason: null }
}

/** One disable/enable block for a row id. */
function rowBlock(rowId: string, disabled: boolean): string {
  return `- id: ${rowId}\n  disabled: ${disabled}\n`
}

/**
 * Disable one row: append `- id: X` + `disabled: true` (idempotent).
 */
export function disableRow(patchPath: string, rowId: string): Promise<{ ok: boolean; reason: string | null }> {
  return queuedWrite(async () => {
    if (!ROW_ID_RE.test(rowId)) {
      return { ok: false, reason: `行 id 含特殊字符,不支持写入补丁层 / row id ${JSON.stringify(rowId)} cannot be written to the patch layer` }
    }
    const state = readUserPatchState(patchPath)
    if (state.disables.includes(rowId)) return { ok: true, reason: null }
    return appendPatchEntry(patchPath, rowBlock(rowId, true))
  })
}

/**
 * Enable one row: remove the `disabled: true` block; force-enable with
 * `disabled: false` when a lower layer (bundle/home patch) holds it down.
 */
export function enableRow(patchPath: string, rowId: string): Promise<{ ok: boolean; reason: string | null }> {
  return queuedWrite(async () => {
    if (!ROW_ID_RE.test(rowId)) {
      return { ok: false, reason: `行 id 含特殊字符,不支持写入补丁层 / row id ${JSON.stringify(rowId)} cannot be written to the patch layer` }
    }
    const state = readUserPatchState(patchPath)
    const blockRe = new RegExp(`^- id: ['"]?${escapeRegExp(rowId)}['"]?\\r?\\n  disabled: true\\r?\\n`, "mu")
    const text = (() => {
      try {
        return readFileSync(patchPath, "utf8")
      } catch {
        return ""
      }
    })()
    if (blockRe.test(text)) {
      writeFileSync(patchPath, withPlaceholderRestored(text.replace(blockRe, "")))
      return { ok: true, reason: null }
    }
    if (state.forced.includes(rowId)) return { ok: true, reason: null }
    return appendPatchEntry(patchPath, rowBlock(rowId, false))
  })
}

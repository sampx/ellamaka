import type { Message } from "@opencode-ai/sdk/v2"
import { Binary } from "@opencode-ai/core/util/binary"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Merge an API snapshot (`incoming`) into the current store array (`existing`)
 * while preserving the id-lexicographic sort contract required by
 * `Binary.search`/`Binary.insert`.
 *
 * The API response is ordered by `(time_created, id)`, which is a different key
 * than pure id order. Trusting the API's return order would break the binary
 * search invariant, so every incoming message is upserted by id:
 * - found in `existing` → replaced with the incoming (API) version
 * - not found → inserted at the correct id-ordered position
 * - messages in `existing` that are absent from `incoming` are kept (they were
 *   added by realtime events after the API snapshot was taken)
 *
 * Before returning, the array is validated to be strictly id-ascending. A
 * violation is recorded through the Log module (never console.warn, which
 * pollutes TUI rendering) as a runtime observer for the ordering contract.
 *
 * On an id conflict the two sources (realtime event vs API snapshot) cannot be
 * told apart by version or timestamp, so the assistant lifecycle is used as a
 * monotonic guard: `time.completed` is a one-way state (undefined → number,
 * never written back). If the existing (event-side) message is a completed
 * assistant and the incoming (snapshot-side) message lacks `completed`, the
 * snapshot was taken before completion landed and is stale for that field —
 * keep the existing message whole so a stale snapshot can never regress a
 * finished assistant into a permanently QUEUED one. All other conflicts use
 * the incoming (API-authoritative) version.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const result = existing.slice()
  for (const message of incoming) {
    const match = Binary.search(result, message.id, (m) => m.id)
    if (match.found) {
      const current = result[match.index]!
      if (keepExisting(current, message)) {
        continue
      }
      result[match.index] = message
    } else {
      Binary.insert(result, message, (m) => m.id)
    }
  }
  assertOrdered(result)
  return result
}

/**
 * Decide whether an id conflict should keep the existing (event-side) message
 * instead of the incoming (snapshot-side) one. Returns true only when the
 * existing message is a completed assistant and the incoming one lacks
 * `time.completed` — the stale-snapshot regression case.
 */
function keepExisting(existing: Message, incoming: Message): boolean {
  if (existing.role !== "assistant") return false
  if (existing.time.completed == null) return false
  if (incoming.role !== "assistant") return false
  return incoming.time.completed == null
}

function assertOrdered(messages: Message[]) {
  for (let i = 1; i < messages.length; i++) {
    if (messages[i]!.id <= messages[i - 1]!.id) {
      Log.Default.warn("tui message array lost id ordering", {
        index: i,
        prev: messages[i - 1]!.id,
        current: messages[i]!.id,
      })
      break
    }
  }
}

import { describe, expect, test } from "bun:test"
import { flushStdout, restoreTerminal } from "@/cli/cmd/tui/exit-flush"

type FakeStream = {
  writes: string[]
  writeReturn: boolean | undefined
  drainCb?: () => void
  write: (chunk: string, cb?: () => void) => boolean | undefined
  once: (ev: "drain", cb: () => void) => void
}

function makeStream(writeReturn: boolean | undefined = true): FakeStream {
  const writes: string[] = []
  const stream: FakeStream = {
    writes,
    writeReturn,
    drainCb: undefined,
    write(chunk, cb) {
      writes.push(chunk)
      if (writeReturn !== false && cb) cb()
      return writeReturn
    },
    once(ev, cb) {
      if (ev === "drain") stream.drainCb = cb
    },
  }
  return stream
}

describe("restoreTerminal", () => {
  test("writes the three ANSI restore sequences in order", () => {
    const stream = makeStream()
    restoreTerminal(stream)
    expect(stream.writes).toEqual(["\x1b[?1003l", "\x1b[?1006l", "\x1b[?1049l"])
  })
})

describe("flushStdout", () => {
  test("resolves immediately when write returns true (no buffering)", async () => {
    const stream = makeStream(true)
    await flushStdout(stream)
    expect(stream.writes).toEqual([""])
  })

  test("resolves on drain when write returns false (buffer full)", async () => {
    const stream = makeStream(false)
    let resolved = false
    const promise = flushStdout(stream).then(() => {
      resolved = true
    })
    // Not resolved yet because write returned false and drain has not fired.
    await Promise.resolve()
    expect(resolved).toBe(false)
    stream.drainCb?.()
    await promise
    expect(resolved).toBe(true)
  })

  test("resolves after the timeout when neither callback nor drain fires", async () => {
    const stream = makeStream(false)
    const start = Date.now()
    await flushStdout(stream, 50)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })
})

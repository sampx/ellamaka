// Pure helpers for the TUI exit path. Streams are injected so the logic is
// unit-testable without touching the real stdout.

type RestoreStream = {
  write(chunk: string): unknown
}

type FlushStream = {
  write(chunk: string, cb?: () => void): boolean | undefined
  once?(ev: "drain", cb: () => void): void
}

// Explicitly restore terminal modes before the renderer is destroyed: leave
// alt-screen, disable SGR mouse reporting, and disable mouse-motion tracking.
// Written before renderer.destroy() so the terminal is restored even if the
// destroy itself hangs.
export function restoreTerminal(stream: RestoreStream): void {
  stream.write("\x1b[?1003l") // disable mouse-motion tracking
  stream.write("\x1b[?1006l") // disable SGR mouse reporting
  stream.write("\x1b[?1049l") // leave alt-screen
}

// Wait for the stdout buffer to drain before the process exits, so the ANSI
// restore sequence written by renderer.destroy() is not truncated. The empty
// write callback fires in order after prior writes flush; if the write returns
// false (buffer full) we fall back to the drain event. A bounded timeout
// guarantees the exit path never hangs forever if the terminal freezes and
// neither the callback nor drain fires.
export function flushStdout(stream: FlushStream, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    const ok = stream.write("", resolve)
    if (ok === false) stream.once?.("drain", resolve)
    const timer = setTimeout(resolve, timeoutMs)
    if (typeof timer.unref === "function") timer.unref()
  })
}

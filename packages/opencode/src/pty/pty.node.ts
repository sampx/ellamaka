import * as pty from "@lydell/node-pty"
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const proc = pty.spawn(file, args, opts)
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      // node-pty unix kill(signal) only signals the single child pid. The child
      // is spawned with setsid (session/process-group leader), so to force-kill
      // the whole group we send the signal to the negative pid on unix. On
      // win32 node-pty throws when a signal argument is passed, so fall back to
      // the no-arg kill() (TerminateProcess, equivalent to a hard kill).
      if (process.platform === "win32") {
        proc.kill()
        return
      }
      proc.kill(signal)
      if (signal) {
        try {
          process.kill(-proc.pid, signal)
        } catch {}
      }
    },
  }
}

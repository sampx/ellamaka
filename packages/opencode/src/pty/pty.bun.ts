import { spawn as create } from "bun-pty"
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const pty = create(file, args, opts)
  return {
    pid: pty.pid,
    onData(listener) {
      return pty.onData(listener)
    },
    onExit(listener) {
      return pty.onExit(listener)
    },
    write(data) {
      pty.write(data)
    },
    resize(cols, rows) {
      pty.resize(cols, rows)
    },
    kill(signal) {
      // bun-pty's FFI kill only receives the handle; the signal argument is
      // used solely for the JS-side onExit payload, and native side always
      // sends SIGHUP to the single child pid. To force-kill the whole process
      // group (the child is spawned with setsid, so it is the session leader),
      // send the signal to the negative pid on unix. On win32 there is no
      // negative-pid kill, so keep the native kill as-is.
      pty.kill(signal)
      if (process.platform !== "win32" && signal) {
        try {
          process.kill(-this.pid, signal)
        } catch {}
      }
    },
  }
}

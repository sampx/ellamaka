import { which } from "@/util/which"
import path from "path"

export type LookupFn = (cmd: string, env?: NodeJS.ProcessEnv) => string | null

export function resolvePtyCommand(
  command: string,
  platform: string = process.platform,
  env?: NodeJS.ProcessEnv,
  lookup: LookupFn = which,
): string {
  if (platform !== "win32") return command
  if (path.isAbsolute(command)) return command
  if (command.includes("/") || command.includes("\\")) return command
  return lookup(command, env) ?? command
}

export * as PtyCommand from "./command"

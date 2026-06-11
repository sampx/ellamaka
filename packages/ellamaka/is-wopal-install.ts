import path from "path"
import os from "os"

export function isWopalInstall(): boolean {
  const raw = process.env.WOPAL_HOME || path.join(os.homedir(), ".wopal")
  const wopalHome = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw
  return process.execPath.includes(path.join(wopalHome, "bin") + path.sep)
}

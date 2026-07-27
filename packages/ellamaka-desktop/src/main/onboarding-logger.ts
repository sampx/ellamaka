import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export function getOnboardingLogger(homePath?: string) {
  const actualHome = homePath ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
  const logDir = join(actualHome, "logs")
  const logFile = join(logDir, "onboarding.log")

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  return {
    log: (message: string) => {
      try {
        if (existsSync(logFile)) {
          const stats = statSync(logFile)
          if (stats.size > 1024 * 1024) {
            renameSync(logFile, `${logFile}.1`)
          }
        }
        
        // Desensitize token/keys
        const safeMessage = message.replace(/(?:gh[pousr]_[a-zA-Z0-9]{36,}|sk-[a-zA-Z0-9]{32,})/g, "***")
        const timestamp = new Date().toISOString()
        appendFileSync(logFile, `[${timestamp}] ${safeMessage}\n`)
      } catch {}
    }
  }
}

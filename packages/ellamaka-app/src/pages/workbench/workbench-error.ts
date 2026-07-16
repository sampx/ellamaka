import { showToast } from "@opencode-ai/ui/toast"

type ErrorLike = {
  message?: string
  statusCode?: number
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as ErrorLike).message
    if (typeof msg === "string") return msg
  }
  return String(error)
}

function extractStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as ErrorLike).statusCode
    if (typeof code === "number") return code
  }
  return undefined
}

export function reportWorkbenchError(
  operation: string,
  error: unknown,
  options?: { silent?: boolean },
): void {
  const message = extractMessage(error)
  const statusCode = extractStatusCode(error)

  const logParts = [`[workbench] ${operation} failed:`, message]
  if (statusCode !== undefined) logParts.push(`(status: ${statusCode})`)
  console.error(...logParts)

  if (options?.silent) return

  showToast({
    variant: "error",
    title: operation,
    description: message,
  })
}

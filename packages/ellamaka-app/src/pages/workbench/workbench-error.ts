import { showToast } from "@opencode-ai/ui/toast"

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  return String(error)
}

function extractStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") return error.statusCode
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

import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test"
import { reportWorkbenchError } from "./workbench-error"

describe("reportWorkbenchError", () => {
  let consoleErrorSpy: ReturnType<typeof mock>
  let toastSpy: ReturnType<typeof mock>

  beforeEach(() => {
    consoleErrorSpy = mock((..._args: unknown[]) => {})
    console.error = consoleErrorSpy as unknown as typeof console.error

    toastSpy = mock((_opts: unknown) => {})
    mock.module("@opencode-ai/ui/toast", () => ({
      showToast: toastSpy,
    }))
  })

  afterEach(() => {
    mock.restore()
  })

  it("logs sanitized message and calls showToast for Error", () => {
    reportWorkbenchError("rename session", new Error("Network error"))

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logArgs = consoleErrorSpy.mock.calls[0] as string[]
    expect(logArgs[0]).toContain("[workbench] rename session failed:")
    expect(logArgs[1]).toBe("Network error")

    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toastArg = toastSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(toastArg.variant).toBe("error")
    expect(toastArg.title).toBe("rename session")
    expect(toastArg.description).toBe("Network error")
  })

  it("includes statusCode in log when error has statusCode", () => {
    const err = new Error("Not Found") as Error & { statusCode: number }
    err.statusCode = 404
    reportWorkbenchError("load session", err)

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logArgs = consoleErrorSpy.mock.calls[0] as string[]
    expect(logArgs[2]).toContain("status: 404")
  })

  it("does not call showToast when silent is true", () => {
    reportWorkbenchError("abort", new Error("Aborted"), { silent: true })

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledTimes(0)
  })

  it("handles non-Error values gracefully", () => {
    reportWorkbenchError("unknown op", "something went wrong")

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logArgs = consoleErrorSpy.mock.calls[0] as string[]
    expect(logArgs[1]).toBe("something went wrong")

    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toastArg = toastSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(toastArg.description).toBe("something went wrong")
  })

  it("handles null/undefined gracefully", () => {
    reportWorkbenchError("null op", null)

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logArgs = consoleErrorSpy.mock.calls[0] as string[]
    expect(logArgs[1]).toBe("null")

    expect(toastSpy).toHaveBeenCalledTimes(1)
  })

  it("handles object with message property", () => {
    reportWorkbenchError("custom error", { message: "Custom fail" })

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logArgs = consoleErrorSpy.mock.calls[0] as string[]
    expect(logArgs[1]).toBe("Custom fail")
  })
})

import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useCheckServerHealth } from "@/utils/server-health"

export type WorkbenchRuntimeStatus = "online" | "degraded" | "recovering" | "offline"

const WorkbenchRuntimeContext = createSimpleContext({
  name: "WorkbenchRuntime",
  init: () => {
    const server = useServer()
    const sdk = useServerSDK()
    const checkHealth = useCheckServerHealth()
    const [status, setStatus] = createSignal<WorkbenchRuntimeStatus>("recovering")
    const [recoveryVersion, setRecoveryVersion] = createSignal(0)
    let becameOnline = false
    let request = 0

    const refresh = async () => {
      const current = server.current
      const eventStatus = sdk.eventStatus
      if (!current) {
        setStatus("offline")
        return
      }
      const id = request + 1
      request = id
      const health = await checkHealth(current.http)
      if (id !== request) return
      const next: WorkbenchRuntimeStatus = !health.healthy
        ? "offline"
        : eventStatus === "connected"
          ? "online"
          : eventStatus === "connecting"
            ? "recovering"
            : "degraded"
      const previous = status()
      setStatus(next)
      if (next === "online" && becameOnline && previous !== "online") {
        setRecoveryVersion((value) => value + 1)
      }
      if (next === "online") becameOnline = true
    }

    createEffect(() => {
      server.key
      sdk.eventStatus
      void refresh()
    })

    const timer = setInterval(() => void refresh(), 5_000)
    onCleanup(() => clearInterval(timer))

    return {
      get status() {
        return status()
      },
      get recoveryVersion() {
        return recoveryVersion()
      },
      canWrite: () => status() === "online" || status() === "degraded",
      retry: refresh,
    }
  },
})

export const useWorkbenchRuntime = () => WorkbenchRuntimeContext.use()
export const WorkbenchRuntimeProvider = WorkbenchRuntimeContext.provider

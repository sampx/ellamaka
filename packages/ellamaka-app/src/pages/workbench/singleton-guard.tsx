import { Show, createSignal, onMount, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"

const LOCK_NAME = "ellamaka-workbench-instance"

type GuardState = "acquiring" | "locked" | "blocked"

export function WorkbenchSingletonGuard(props: { children: any }) {
  const language = useLanguage()
  const t = (k: string) => language.t(k)
  const [state, setState] = createSignal<GuardState>("acquiring")
  let releaseLock: (() => void) | undefined

  onMount(() => {
    if (!("locks" in navigator)) {
      setState("locked")
      return
    }
    void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        setState("blocked")
        return
      }
      setState("locked")
      await new Promise<void>((resolve) => {
        releaseLock = resolve
      })
    })
  })

  onCleanup(() => {
    releaseLock?.()
  })

  return (
    <Show
      when={state() !== "blocked"}
      fallback={
        <div class="flex h-dvh flex-col items-center justify-center gap-4 bg-v2-background-bg-deep text-v2-text-text-base p-8">
          <div class="text-center max-w-md">
            <h2 class="text-18-semibold text-text-strong mb-2">
              {t("workbench.singleton.title")}
            </h2>
            <p class="text-14-regular text-text-muted">
              {t("workbench.singleton.message")}
            </p>
          </div>
        </div>
      }
    >
      <Show when={state() === "locked"}>
        {props.children}
      </Show>
    </Show>
  )
}

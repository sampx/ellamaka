import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useWorkbench } from "../view"

export function StatusBar() {
  const workbench = useWorkbench()
  const server = useServer()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  return (
    <footer class="flex h-5 shrink-0 items-center gap-3 px-3 bg-v2-background-bg-base border-t border-v2-border-border-base text-10-regular text-v2-text-text-muted">
      <span class="size-1.5 rounded-full bg-v2-icon-icon-success" />
      <span class="truncate">{server.name}</span>
      <span class="text-v2-text-text-faint">·</span>
      <span class="uppercase">{workbench.view()}</span>
      <div class="grow" />
      <span class="text-v2-text-text-faint">
        <Show when={workbench.view() === "tui"}>⌘1</Show>
        <Show when={workbench.view() === "chat"}>⌘2</Show>
        <Show when={workbench.view() === "split"}>⌘3</Show>
      </span>
    </footer>
  )
}
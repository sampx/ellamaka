import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { useLanguage } from "@/context/language"

export function BottomDock(props: { open: boolean }) {
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  if (!props.open) return null

  return (
    <div class="flex h-40 shrink-0 flex-col border-t border-v2-border-border-base bg-v2-background-bg-deep">
      <div class="flex h-6 shrink-0 items-center gap-2 px-3 border-b border-v2-border-border-base">
        <IconV2 name="terminal" class="size-3 text-v2-icon-icon-muted" />
        <span class="text-10-medium text-v2-text-text-muted uppercase [letter-spacing:1px]">
          {t("workbench.terminal.dock")}
        </span>
      </div>
      <div class="flex flex-1 items-center justify-center text-v2-text-text-muted">
        <span class="text-12-regular">{t("workbench.terminal.placeholder")}</span>
      </div>
    </div>
  )
}

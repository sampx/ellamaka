import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { resolveOfficialRoute } from "../surface-route"

export function WorkbenchTitlebar() {
  const store = useSpaceStore()
  const language = useLanguage()
  const navigate = useNavigate()
  const t = (k: string) => language.t(k)

  const activeName = () => store.activeTab()?.name ?? ""

  return (
    <header class="flex h-10 shrink-0 items-center gap-3 px-3 bg-v2-background-bg-base border-b border-v2-border-border-base">
      <div class="flex items-center gap-2 text-v2-text-text-strong [font-weight:530] text-14-regular">
        <div class="size-4 rounded-[5px] bg-gradient-to-br from-v2-icon-icon-brand to-v2-icon-icon-accent" />
        <span class="tracking-wide">Ellamaka</span>
      </div>

      <Show when={activeName()}>
        <span class="text-12-regular text-v2-text-text-muted">·</span>
        <span class="text-12-regular text-v2-text-text-base truncate max-w-48">{activeName()}</span>
      </Show>

      <div class="grow" />

      <ButtonV2
        variant="ghost"
        size="normal"
        class="h-8 shrink-0 px-2 text-v2-text-text-muted"
        onClick={() => navigate(resolveOfficialRoute())}
      >
        {t("workbench.returnToApp")}
      </ButtonV2>
    </header>
  )
}

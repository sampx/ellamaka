import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useWorkbenchState } from "../view-store"
import { resolveOfficialRoute } from "../surface-route"

export function WorkbenchTitlebar() {
  const wb = useWorkbenchState()
  const language = useLanguage()
  const navigate = useNavigate()
  const t = (k: string) => language.t(k)

  const activeName = () => wb.activeTab()?.name ?? ""

  return (
    <header class="flex h-10 shrink-0 items-center gap-3 px-3 bg-v2-background-bg-base border-b border-v2-border-border-base">
      <div class="flex items-center gap-2 text-v2-text-text-strong [font-weight:600] text-14-regular select-none">
        <div class="relative size-4.5 flex items-center justify-center rounded-[5px] bg-gradient-to-tr from-[#9b51e0] via-[#3b82f6] to-[#00f2fe] shadow-[0_0_6px_rgba(59,130,246,0.35)] overflow-hidden">
          <div class="absolute inset-[1px] rounded-[4px] bg-v2-background-bg-base flex items-center justify-center">
            <span class="text-8-bold bg-gradient-to-r from-[#9b51e0] to-[#00f2fe] bg-clip-text text-transparent leading-none">E</span>
          </div>
        </div>
        <span class="tracking-wider bg-gradient-to-r from-v2-text-text-strong via-v2-text-text-strong to-v2-text-text-muted bg-clip-text text-transparent">Ellamaka</span>
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

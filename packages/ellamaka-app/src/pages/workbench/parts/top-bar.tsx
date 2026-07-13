import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { createMemo, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useWorkbenchState } from "../view-store"
import { resolveOfficialRoute } from "../surface-route"

export function WorkbenchTitlebar() {
  const wb = useWorkbenchState()
  const sdk = useServerSDK()
  const language = useLanguage()
  const navigate = useNavigate()
  const t = (k: string) => language.t(k)

  const activeDir = () => wb.activeDirectory
  const dirSdk = createMemo(() => {
    const dir = activeDir()
    if (!dir) return
    return sdk.createDirSdkContext(dir)
  })
  const isWopalSpace = () => dirSdk()?.isWopalSpace ?? false

  const activeTab = () => wb.activeTab()
  const spaceType = () => activeTab()?.type?.toUpperCase() ?? ""

  return (
    <header class="flex h-10 shrink-0 items-center gap-3 px-3 bg-v2-background-bg-base border-b border-v2-border-border-base">
      <div class="flex items-center gap-2 text-v2-text-text-strong [font-weight:530] text-14-regular">
        <img src="/favicon-96x96-v3.png?v=4" class="w-5 h-5 object-contain" alt="Icon" />
        <img src="/ellamaka-text-logo.png?v=2" class="h-5 w-auto object-contain ellamaka-logo-invert" alt="Logo" />
      </div>

      <Show when={isWopalSpace()}>
        <span class="text-12-regular text-v2-text-text-muted">·</span>
        <span class="text-12-regular text-v2-text-text-base">
          WopalSpace
          <Show when={spaceType()}>
            {` · ${spaceType()}`}
          </Show>
        </span>
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

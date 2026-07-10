import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2.jsx"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useWorkbenchState } from "../view-store"

export function WorkbenchSettingsMenu() {
  const wb = useWorkbenchState()
  const language = useLanguage()
  const dialog = useDialog()
  const t = (k: string) => language.t(k)
  const [open, setOpen] = createSignal(false)

  function openGlobalSettings() {
    setOpen(false)
    void import("@/components/dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  return (
    <MenuV2 gutter={4} modal={false} placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <MenuV2.Trigger
        as={IconButtonV2}
        variant="ghost-muted"
        size="small"
        icon={<IconV2 name="settings-gear" />}
        aria-label={t("workbench.settings.title")}
      />
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Item onSelect={openGlobalSettings}>
            <IconV2 name="sliders" class="mr-2" />
            {t("workbench.settings.appearance")}
          </MenuV2.Item>
          <MenuV2.Separator />
          <MenuV2.Item
            onSelect={() => {
              wb.setDisplay("showTitlebar", !wb.display().showTitlebar)
            }}
          >
            <Show when={wb.display().showTitlebar} fallback={<IconV2 name="outline-dots" class="mr-2" />}>
              <IconV2 name="check" class="mr-2" />
            </Show>
            {t("workbench.settings.showTitlebar")}
          </MenuV2.Item>
          <MenuV2.Item
            onSelect={() => {
              wb.setDisplay("showStatusbar", !wb.display().showStatusbar)
            }}
          >
            <Show when={wb.display().showStatusbar} fallback={<IconV2 name="outline-dots" class="mr-2" />}>
              <IconV2 name="check" class="mr-2" />
            </Show>
            {t("workbench.settings.showStatusbar")}
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

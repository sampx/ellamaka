import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"

function createTranslator(language: ReturnType<typeof useLanguage>): typeof language.t {
  return (key, params) => language.t(key, params)
}

export function DialogOverwritePanel(props: {
  panelIndex: number
  onConfirm: () => void
}) {
  const language = useLanguage()
  const t = createTranslator(language)
  const dialog = useDialog()

  return (
    <Dialog title={t("workbench.panel.overwriteTitle") || "覆盖会话窗口"} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {t("workbench.panel.overwriteConfirmText", { index: String(props.panelIndex) }) ||
              `确定要覆盖面板 #${props.panelIndex} 的当前会话吗？`}
          </span>
          <span class="text-12-regular text-text-muted">
            {t("workbench.panel.overwriteConfirmHint") ||
              "覆盖后原有会话将自动解绑，您可以在左侧会话列表中随时重新恢复。"}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {t("common.cancel") || "取消"}
          </Button>
          <Button variant="primary" size="large" onClick={props.onConfirm}>
            {t("common.confirm") || "确认"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogCrossSpaceWarning(props: {
  dragSpace: string
  targetSpace: string
}) {
  const language = useLanguage()
  const t = createTranslator(language)
  const dialog = useDialog()

  return (
    <Dialog title={t("common.warning") || "空间不匹配提示"} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {t("workbench.panel.crossSpaceWarningText", {
              dragSpace: props.dragSpace,
              targetSpace: props.targetSpace,
            }) || `该会话属于空间 "${props.dragSpace}"，无法装载到 "${props.targetSpace}" 中。`}
          </span>
          <span class="text-12-regular text-text-muted">
            {t("workbench.panel.crossSpaceWarningHint") || "请先在左侧切换到对应的空间进行操作。"}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="primary" size="large" onClick={() => dialog.close()}>
            {t("common.confirm") || "确认"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogRenameSession(props: {
  currentTitle: string
  onRename: (title: string) => Promise<void>
}) {
  const language = useLanguage()
  const t = createTranslator(language)
  const dialog = useDialog()
  const [val, setVal] = createSignal(props.currentTitle)
  let inputEl: HTMLInputElement | undefined

  const submit = () => {
    const trimmed = val().trim()
    if (trimmed && trimmed !== props.currentTitle) {
      void props.onRename(trimmed).then(() => dialog.close())
    } else {
      dialog.close()
    }
  }

  setTimeout(() => {
    inputEl?.focus()
    inputEl?.select()
  }, 50)

  return (
    <Dialog title={t("workbench.tree.rename") || "重命名会话"} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
        <div class="flex flex-col gap-2">
          <input
            ref={inputEl}
            type="text"
            class="w-full px-3 py-1.5 text-12-regular text-text-strong bg-v2-background-bg-deep border border-v2-border-border-base rounded-md focus:outline-none focus:border-v2-border-border-brand-strong"
            value={val()}
            onInput={(e) => setVal(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") dialog.close()
            }}
          />
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {t("common.cancel") || "取消"}
          </Button>
          <Button variant="primary" size="large" onClick={submit}>
            {t("common.confirm") || "确认"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogDeleteSession(props: {
  sessionTitle: string
  onDelete: () => Promise<void>
}) {
  const language = useLanguage()
  const t = createTranslator(language)
  const dialog = useDialog()

  return (
    <Dialog title={t("common.delete") || "删除会话"} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {t("workbench.tree.deleteConfirmText", { title: props.sessionTitle }) ||
              `确定要删除会话 "${props.sessionTitle}" 吗？`}
          </span>
          <span class="text-12-regular text-text-muted">
            {t("workbench.tree.deleteConfirmHint") || "删除后，该会话记录将从列表中彻底移除。"}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {t("common.cancel") || "取消"}
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={async () => {
              await props.onDelete()
              dialog.close()
            }}
          >
            {t("common.confirm") || "确认"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogClosePanel(props: {
  sessionTitle: string
  onClose: () => Promise<void>
}) {
  const language = useLanguage()
  const t = createTranslator(language)
  const dialog = useDialog()

  return (
    <Dialog title={t("workbench.panelClose.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[380px]">
        <div class="flex flex-col gap-3">
          <span class="text-14-medium text-v2-text-text-strong">
            {t("workbench.panelClose.confirm", { title: props.sessionTitle })}
          </span>
          <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-deep p-3 text-12-regular text-v2-text-text-muted">
            <span class="text-12-medium text-v2-text-text-base mb-1">
              {t("workbench.panelClose.desc")}
            </span>
            <span>
              {t("workbench.panelClose.consequenceSession")}
            </span>
            <span class="text-amber-500/95 dark:text-amber-400/90 font-medium">
              {t("workbench.panelClose.consequenceTerminal")}
            </span>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={async () => {
              await props.onClose()
              dialog.close()
            }}
          >
            {t("workbench.panelClose.confirmButton")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

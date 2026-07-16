import { useCommand, type CommandOption } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useWorkbenchActions } from "@/pages/workbench/workbench-actions"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createEffect, createMemo, on } from "solid-js"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useWorkbenchCommands = () => {
  const command = useCommand()
  const language = useLanguage()
  const actions = useWorkbenchActions()
  const layout = useLayout()
  const platform = usePlatform()
  const settings = useSettings()
  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const modelCommand = withCategory(language.t("command.category.model"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const desktopV2 = () => platform.platform === "desktop" && settings.general.newLayoutDesigns()
  const shown = () => (desktopV2() ? settings.general.showFileTree() : true)

  const proxyAction = (id: string) => ({
    get disabled() { return !actions.canExecuteActivePanelAction(id) },
    onSelect: () => actions.executeActivePanelAction(id),
  })

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => {
        const active = actions.activeTarget()
        if (active) actions.addPanel(active.scope)
      },
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      keybind: "mod+z",
      ...proxyAction("session.undo"),
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      keybind: "mod+shift+z",
      ...proxyAction("session.redo"),
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      ...proxyAction("session.compact"),
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      ...proxyAction("session.fork"),
    }),
  ]

  const shareCmds = () => [
    sessionCommand({
      id: "session.share",
      title: language.t("command.session.share"),
      description: language.t("command.session.share.description"),
      slash: "share",
      ...proxyAction("session.share"),
    }),
    sessionCommand({
      id: "session.unshare",
      title: language.t("command.session.unshare"),
      description: language.t("command.session.unshare.description"),
      slash: "unshare",
      ...proxyAction("session.unshare"),
    }),
  ]

  const fileCmds = () => [
    fileCommand({
      id: "file.open",
      title: language.t("command.file.open"),
      description: language.t("palette.search.placeholder"),
      keybind: "mod+k,mod+p",
      slash: "open",
      ...proxyAction("file.open"),
    }),
    fileCommand({
      id: "tab.close",
      title: language.t("command.tab.close"),
      keybind: "mod+w",
      ...proxyAction("tab.close"),
    }),
  ]

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      ...proxyAction("context.addSelection"),
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      keybind: "ctrl+`",
      slash: "terminal",
      ...proxyAction("terminal.toggle"),
    }),
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      ...proxyAction("review.toggle"),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(), // layout.fileTree is globally accessible
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      ...proxyAction("input.focus"),
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      ...proxyAction("terminal.new"),
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      ...proxyAction("message.previous"),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      ...proxyAction("message.next"),
    }),
  ]

  const modelCmds = () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      ...proxyAction("model.choose"),
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      ...proxyAction("model.variant.cycle"),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      ...proxyAction("mcp.toggle"),
    }),
  ]

  const agentCmds = () => [
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      ...proxyAction("agent.cycle"),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      ...proxyAction("agent.cycle.reverse"),
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      ...proxyAction("permissions.autoaccept"),
    }),
  ]

  const commands = createMemo(() => [
    ...sessionCmds(),
    ...shareCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...modelCmds(),
    ...mcpCmds(),
    ...agentCmds(),
    ...permissionsCmds(),
  ])

  createEffect(on(commands, (cmds) => {
    command.register("workbench.session", () => cmds)
  }))
}

export type StatusBarSegment = {
  type: "space" | "panel" | "session" | "path"
  text: string
}

export type StatusBarMetadataInput = {
  spaceName: string
  activePanelID: string | undefined
  panels: Array<{
    id: string
    slotState: string
    directory: string
    boundSessionId?: string
  }>
  getSessionTitle: (sessionId: string) => string | undefined
}

export function getStatusBarSegments(input: StatusBarMetadataInput): StatusBarSegment[] {
  const { spaceName, activePanelID, panels, getSessionTitle } = input
  const segments: StatusBarSegment[] = []
  if (!spaceName) return segments

  segments.push({ type: "space", text: spaceName })

  if (!activePanelID) return segments
  const idx = panels.findIndex((panel) => panel.id === activePanelID)
  if (idx === -1) return segments
  const panel = panels[idx]

  segments.push({
    type: "panel",
    text: `P${idx + 1}/${panels.length}`,
  })

  if (panel.slotState === "bound" && panel.boundSessionId) {
    const title = getSessionTitle(panel.boundSessionId)
    if (title) segments.push({ type: "session", text: title })
  }

  if (panel.directory) {
    segments.push({
      type: "path",
      text: panel.directory.startsWith("/") ? panel.directory.slice(1) : panel.directory,
    })
  }

  return segments
}

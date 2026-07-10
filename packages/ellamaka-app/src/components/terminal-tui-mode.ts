export function isEllamakaTuiTitle(title: string) {
  const normalized = title.trim().toLowerCase()
  return normalized === "ellamaka" || normalized.startsWith("ellamaka |")
}

export function shouldUseTuiTerminalMode(input: {
  isDedicatedTui: boolean
  isEllamakaTitle: boolean
  isAlternateBuffer: boolean
}) {
  return input.isDedicatedTui || (input.isEllamakaTitle && input.isAlternateBuffer)
}

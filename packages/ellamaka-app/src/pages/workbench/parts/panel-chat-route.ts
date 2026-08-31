import { base64Encode } from "@wopal/core/util/encode"

export function panelChatRoute(directory: string, sessionID: string) {
  const path = `/${base64Encode(directory)}/session/${sessionID}`
  return { key: `${directory}\n${sessionID}`, path }
}

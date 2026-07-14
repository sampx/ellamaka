export function completeFork(input: {
  sessionID: string
  href: string
  onSuccess?: (newSessionID: string) => void
  navigate: (href: string) => void
}) {
  if (input.onSuccess) {
    input.onSuccess(input.sessionID)
    return
  }
  input.navigate(input.href)
}

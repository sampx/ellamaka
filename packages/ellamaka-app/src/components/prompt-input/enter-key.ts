export function shouldInsertPromptNewline(event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey">): boolean {
  return event.key === "Enter" && (event.shiftKey || event.altKey)
}

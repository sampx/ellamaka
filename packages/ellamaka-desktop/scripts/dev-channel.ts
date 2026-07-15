export function resolveDevSidecarChannel(value = process.env.OPENCODE_CHANNEL): string {
  return value?.trim() || "local"
}

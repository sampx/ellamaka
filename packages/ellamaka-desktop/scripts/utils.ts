export type Channel = "main" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "main" || raw === "beta" || raw === "prod") return raw
  return "main"
}

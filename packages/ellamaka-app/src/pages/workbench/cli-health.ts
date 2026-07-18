import type { WopalCliHealth } from "@/utils/server-health"

export function canUseSpaceControl(cli: WopalCliHealth | undefined) {
  return cli?.state === "ok"
}

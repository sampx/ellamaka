import { $ } from "bun"
import { resolveDevSidecarChannel } from "./dev-channel"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

process.env.OPENCODE_CHANNEL = resolveDevSidecarChannel()
await $`cd ../opencode && bun script/build-node.ts`

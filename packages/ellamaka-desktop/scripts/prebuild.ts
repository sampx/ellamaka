#!/usr/bin/env bun
import { $ } from "bun"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolveChannel } from "./utils"

import { resolve } from "node:path"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`
await $`bun ./scripts/copy-dsh-materialize.ts`

await $`cd ../opencode && bun script/build-node.ts`

// Generate resources/release-identity.json. Per docs/DISTRIBUTION.md §5.4,
// Desktop packages embed the same release context that produced the build.
// For local dev builds (channel "main"), a development identity is written;
// for beta/prod, a release-context.json (if provided via env) is the source.
await writeEmbeddedReleaseIdentity(channel)

async function writeEmbeddedReleaseIdentity(channel: "main" | "beta" | "prod") {
  const resourcesDir = resolve(import.meta.dir, "..", "resources")
  const outPath = join(resourcesDir, "release-identity.json")
  const ctxPath = process.env.ELLAMAKA_RELEASE_CONTEXT_PATH

  let identity: Record<string, unknown>
  if ((channel === "beta" || channel === "prod") && ctxPath) {
    const ctx = JSON.parse(await Bun.file(ctxPath).text())
    identity = {
      schemaVersion: 2,
      kind: "release",
      product: "ellamaka-desktop",
      version: ctx.version,
      channel: ctx.channel,
      upstream: ctx.upstream,
      build: ctx.build,
    }
  } else {
    const version = process.env.OPENCODE_VERSION?.trim() || "0.0.0-dev"
    identity = {
      schemaVersion: 2,
      kind: "development",
      product: "ellamaka-desktop",
      version,
      channel: channel === "main" ? "main" : "local",
      build: {
        ...(process.env.OPENCODE_BUILD_ID && /^[0-9a-f]{40}$/.test(process.env.OPENCODE_BUILD_ID)
          ? { gitCommit: process.env.OPENCODE_BUILD_ID }
          : {}),
        builtAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    }
  }
  writeFileSync(outPath, JSON.stringify(identity, null, 2) + "\n")
  console.log(`[prebuild] wrote ${outPath}`)
}

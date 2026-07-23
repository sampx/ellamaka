import { readFileSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"

type PackageMetadata = {
  ellamakaBuild?: unknown
}

export type ReleaseInfo = {
  version: string
  build?: string
  displayVersion: string
}

export function createReleaseInfo(version: string, build?: string): ReleaseInfo {
  const normalizedBuild = build?.trim() || undefined
  return {
    version,
    build: normalizedBuild,
    displayVersion: normalizedBuild ? `${version} (${normalizedBuild.slice(0, 12)})` : version,
  }
}

export function getReleaseInfo(): ReleaseInfo {
  let build: string | undefined
  try {
    const metadata = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as PackageMetadata
    if (typeof metadata.ellamakaBuild === "string") build = metadata.ellamakaBuild
  } catch {}

  return createReleaseInfo(app.getVersion(), build)
}

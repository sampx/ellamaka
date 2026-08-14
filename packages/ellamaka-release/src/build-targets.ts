// build-targets.ts — target matrix and filtering for the branded CLI build.
//
// Pure module (no build side effects) so the filtering rules are unit-testable.
// A silent empty target list once wiped dist/ and shipped a no-artifact
// "successful" release (the ellamaka-cli-v2.0.2 incident), so filtering now
// fails fast when no target survives.

export type BuildTarget = {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}

export const ALL_TARGETS: BuildTarget[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "arm64" },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]

// --platform accepts user-friendly names; "all" (the CI workflow default)
// means no platform filter.
const PLATFORM_MAP: Record<string, string> = {
  mac: "darwin",
  darwin: "darwin",
  linux: "linux",
  win: "win32",
  windows: "win32",
  win32: "win32",
}

// The primary release matrix: 5 native + 3 baseline per docs/DISTRIBUTION.md.
function isPrimary(item: BuildTarget): boolean {
  if (item.os === "darwin" && item.arch === "arm64") return true
  if (item.os === "darwin" && item.arch === "x64") return true
  if (item.os === "linux" && item.arch === "x64" && item.abi === undefined) return true
  if (item.os === "linux" && item.arch === "arm64" && item.abi === undefined) return true
  if (item.os === "win32" && item.arch === "x64") return true
  return false
}

export type FilterOptions = {
  targets?: BuildTarget[]
  platformArg?: string | null
  archArg?: string | null
  singleFlag?: boolean
  baselineFlag?: boolean
  currentPlatform?: string
  currentArch?: string
}

export function filterTargets(options: FilterOptions): BuildTarget[] {
  const {
    targets = ALL_TARGETS,
    platformArg,
    archArg,
    singleFlag = false,
    baselineFlag = false,
    currentPlatform = process.platform,
    currentArch = process.arch,
  } = options

  let result = [...targets]

  if (platformArg && platformArg !== "all") {
    const platforms = platformArg.split(",").map((p) => PLATFORM_MAP[p.trim()] ?? p.trim())
    result = result.filter((item) => platforms.includes(item.os))
  }

  if (archArg === "primary") {
    result = result.filter(isPrimary)
  } else if (archArg) {
    const arches = archArg.split(",").map((a) => a.trim())
    result = result.filter((item) => arches.includes(item.arch))
  }

  if (singleFlag) {
    const arches = archArg && archArg !== "primary" ? archArg.split(",").map((a) => a.trim()) : [currentArch]
    result = result.filter((item) => {
      if (item.os !== currentPlatform) return false
      if (!arches.includes(item.arch)) return false
      if (item.avx2 === false && !baselineFlag) return false
      if (item.abi !== undefined) return false
      return true
    })
  }

  if (result.length === 0) {
    throw new Error(
      `no build targets match platform=${platformArg ?? "(none)"} arch=${archArg ?? "(none)"} single=${singleFlag} — refusing to build an empty target set`,
    )
  }

  return result
}

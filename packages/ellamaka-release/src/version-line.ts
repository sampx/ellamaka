// version-line.ts — 统一版本线模型：根 package.json 是产品版本线 base 的唯一
// 真相源；产品锚点（ellamaka-cli / ellamaka-desktop）只承载通道状态（-rc.N /
// -beta.N 后缀）。任何发布动作的版本推断都从版本线出发，两个产品从此不再
// 各自独立计数。

export type Channel = "stable" | "rc" | "beta"

export interface VersionState {
  /** 版本线 base（X.Y.Z），来自根 package.json */
  line: string
  /** 产品锚点当前版本（X.Y.Z 或 X.Y.Z-kind.N） */
  anchor: string
}

export interface ParsedVersion {
  base: [number, number, number]
  kind: "rc" | "beta" | null
  n: number
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|beta)\.(\d+))?$/

export function parseVersion(input: string): ParsedVersion {
  const m = input.trim().match(VERSION_RE)
  if (!m) throw new Error(`无效版本号: ${input} (期望 X.Y.Z 或 X.Y.Z-rc.N / X.Y.Z-beta.N)`)
  return {
    base: [Number(m[1]), Number(m[2]), Number(m[3])],
    kind: (m[4] as ParsedVersion["kind"]) ?? null,
    n: m[5] ? Number(m[5]) : 0,
  }
}

export function formatVersion(v: ParsedVersion): string {
  const base = v.base.join(".")
  return v.kind ? `${base}-${v.kind}.${v.n}` : base
}

export function compareBase(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

// inferNextVersion — 从版本线推断目标版本。
//
//   stable  → 版本线 base 本身（2.0.4-rc.2 发 prod 时 → 2.0.4）
//   minor/major → 版本线 base 升位，通道重置
//   rc/beta → 锚点在该 base 上有序列则 N+1 续发，否则从 .1 起步
//
// 不变式：目标 base 永远等于版本线 base。锚点领先版本线 = 版本线外乱 bump，
// 直接拒绝（drift guard）。
export function inferNextVersion(
  state: VersionState,
  channel: Channel | "minor" | "major",
  explicitVersion?: string,
): string {
  const line = parseVersion(state.line)
  const anchor = parseVersion(state.anchor)

  if (compareBase(anchor.base, line.base) > 0) {
    throw new Error(
      `锚点 ${state.anchor} 领先版本线 ${state.line}：产品锚点不得越过版本线 bump，请先修正根 package.json`,
    )
  }

  if (explicitVersion) {
    const explicit = parseVersion(explicitVersion)
    if (compareBase(explicit.base, line.base) !== 0) {
      throw new Error(
        `显式版本 ${explicitVersion} 不在版本线 ${state.line} 上；如需开新版本线请先 bump 根 package.json`,
      )
    }
    return explicitVersion
  }

  if (channel === "minor" || channel === "major") {
    const next: ParsedVersion = { ...line }
    if (channel === "minor") next.base = [line.base[0], line.base[1] + 1, 0]
    else next.base = [line.base[0] + 1, 0, 0]
    // minor/major 意味着开新版本线：返回的目标 base 将写回根（由调用方处理）。
    return formatVersion({ ...next, kind: null, n: 0 })
  }

  if (channel === "stable") {
    return formatVersion({ base: line.base, kind: null, n: 0 })
  }

  // rc/beta：锚点已在该 base 上带同 kind 后缀 → 续 N+1；否则从 .1 起步。
  const onLine = compareBase(anchor.base, line.base) === 0
  if (onLine && anchor.kind === channel) {
    return formatVersion({ base: line.base, kind: channel, n: anchor.n + 1 })
  }
  return formatVersion({ base: line.base, kind: channel, n: 1 })
}

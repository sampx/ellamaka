// packages/ellamaka-desktop/src/main/updater-policy.ts
//
// Update authorization policy gate. Per docs/RELEASE-IDENTITY.md §10,
// electron-updater only handles platform feed/download/install. The
// authorization decision (same channel, no downgrade, manifest version
// match) is made here before electron-updater is allowed to proceed.
//
// This module is pure (no electron/electron-updater imports) so it can be
// tested without the electron mock.

export type UpdateAuthorizationInput = {
  currentVersion: string
  currentChannel: string
  targetVersion: string
  targetChannel: string
  targetManifestVersion: string
}

export type UpdateAuthorization = {
  authorized: boolean
  reason?: string
}

function compareSemVer(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number(n))
  const pb = b.split(/[.-]/).map((n) => Number(n))
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  // prerelease: stable (no 4th part) > prerelease
  const aPre = a.includes("-")
  const bPre = b.includes("-")
  if (!aPre && bPre) return 1
  if (aPre && !bPre) return -1
  if (aPre && bPre) return (pa[4] ?? 0) - (pb[4] ?? 0)
  return 0
}

/**
 * Authorize an update from currentVersion/channel to targetVersion/channel.
 * The target manifest version must equal the updater-reported version.
 * Returns authorized=true only when all checks pass.
 */
export function authorizeUpdate(input: UpdateAuthorizationInput): UpdateAuthorization {
  if (input.currentChannel !== input.targetChannel) {
    return { authorized: false, reason: `cross-channel update denied: ${input.currentChannel} -> ${input.targetChannel}` }
  }
  if (compareSemVer(input.targetVersion, input.currentVersion) <= 0) {
    return { authorized: false, reason: `downgrade or no-op denied: ${input.currentVersion} -> ${input.targetVersion}` }
  }
  if (input.targetManifestVersion !== input.targetVersion) {
    return {
      authorized: false,
      reason: `manifest version ${input.targetManifestVersion} mismatches updater version ${input.targetVersion}`,
    }
  }
  return { authorized: true }
}

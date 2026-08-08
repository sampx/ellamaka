#!/bin/bash
# scripts/lib/version.sh — shared build version resolution for ellamaka
# CLI / Desktop / sidecar builds. Sourced by scripts/build.sh and
# scripts/dev.sh.

# resolve_build_version <product> <suffix> [project_root]
#
# Resolves the build version as <next>-<suffix>.<timestamp>: the next patch
# version after the highest SemVer tag of the product (stable preferred over
# prerelease, e.g. latest ellamaka-cli-v2.0.1 → 2.0.2), suffixed with "main"
# (CLI) or the channel (Desktop), then a local timestamp. An exact tag on
# HEAD wins and is used verbatim (release builds).
function resolve_build_version() {
  local product="$1" suffix="$2" project_root="${3:-$PROJECT_ROOT}"
  local exact_tag version_tag timestamp
  local product_filter="${product}-v*"

  exact_tag=$(git -C "$project_root" describe --tags --exact-match HEAD 2>/dev/null || true)
  exact_tag="${exact_tag#v}"
  if [[ -n "$exact_tag" ]]; then
    echo "$exact_tag"
    return
  fi

  # Highest SemVer tag for this product (stable beats prerelease at the same
  # X.Y.Z), then the next patch version. git's own --sort=v:refname does not
  # follow SemVer prerelease precedence, so selection happens in node.
  version_tag=$(git -C "$project_root" tag -l "$product_filter" 2>/dev/null | node -e "
    let best = null
    for (const raw of require('fs').readFileSync(0, 'utf8').split('\n')) {
      const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)(?:-(.+))?\$/)
      if (!m) continue
      const key = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1]
      const cmp = (a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2] || a[3]-b[3]
      if (!best || cmp(key, best) > 0) best = key
    }
    if (!best) { console.log(''); process.exit(0) }
    console.log([best[0], best[1], best[2] + 1].join('.'))
  ")

  if [[ -n "$version_tag" ]]; then
    timestamp=$(date +"%Y%m%d%H%M%S")
    echo "${version_tag}-${suffix}.${timestamp}"
  else
    timestamp=$(date +"%Y%m%d%H%M%S")
    echo "0.0.0-${suffix}.${timestamp}"
  fi
}

# suggest_release_version <product> <channel> [project_root]
#
# Suggests the next release version (no timestamp) for tag-release:
#   channel stable/prod: next patch after the highest stable tag; if the
#   highest beta base is ahead of the highest stable base, the beta base
#   itself (2.0.0-beta.4 → 2.0.0).
#   channel beta: bump N while the beta sequence is ongoing (highest beta
#   base ahead of the highest stable base), otherwise a fresh -beta.1 on
#   the next patch of the highest stable base.
# No tags at all → 0.1.0 (operator may override interactively).
function suggest_release_version() {
  local product="$1" channel="$2" project_root="${3:-$PROJECT_ROOT}"
  local product_filter="${product}-v*"
  git -C "$project_root" tag -l "$product_filter" 2>/dev/null | node -e "
    const cmp3 = (a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]
    let stable = null, beta = null
    for (const raw of require('fs').readFileSync(0, 'utf8').split('\n')) {
      const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/)
      if (!m) continue
      const key = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? null : Number(m[4])]
      if (key[3] === null) {
        if (!stable || cmp3(key, stable) > 0) stable = key
      } else {
        if (!beta || cmp3(key, beta) > 0 || (cmp3(key, beta) === 0 && key[3] > beta[3])) beta = key
      }
    }
    const baseStr = (k) => k[0] + '.' + k[1] + '.' + k[2]
    const patchUp = (k) => k[0] + '.' + k[1] + '.' + (k[2] + 1)
    const betaAhead = beta && (!stable || cmp3(beta, stable) > 0)
    let out
    if ('$channel' === 'beta') {
      if (betaAhead) out = baseStr(beta) + '-beta.' + (beta[3] + 1)
      else out = (stable ? patchUp(stable) : (beta ? patchUp(beta) : '0.1.0')) + '-beta.1'
    } else {
      if (betaAhead) out = baseStr(beta)
      else out = stable ? patchUp(stable) : (beta ? patchUp(beta) : '0.1.0')
    }
    console.log(out)
  "
}

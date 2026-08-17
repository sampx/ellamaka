# @wopal/ellamaka-cordis

Ellamaka's single cordis boundary package (CORDIS DESIGN §9 red line 1):
every `@deepseek-ai/cordis` import in this repository converges here.

## Per-instance hubs (D-06)

`cordisHubLayer` provisions a `CordisHubService` — a per-directory hub
registry. Hubs are created lazily on first dispatch into an instance
directory, shared by all dispatches in it, and disposed when the registry
entry is invalidated (host instance disposal) or the layer scope closes.

## Mountable plugin list (Q3, rolling)

Conformance-verified dsh plugins (CORDIS DESIGN §10). Each entry records the
verified version and the gate that proves it.

| Plugin | Version | Gates |
|---|---|---|
| `dsh-spill` + `dsh-spill-local` + `dsh-spill-policy` | 0.1.0-rc.6 | `test/spill.test.ts`, `test/forbidden-load.test.ts` (zero runtime load of the six forbidden packages), opencode `test/cordis/spill-conversation.test.ts` |

## Dependency notes

- The spill trio's required peers pull `dsh-session` into node_modules for
  type resolution only (`import type { SessionId }`, erased at compile time).
  Runtime loading of the six deeply-coupled packages is forbidden and gated
  by `test/forbidden-load.test.ts` (red line §9.2, runtime semantics).
- `dsh-tools` is pinned as a direct dependency because it is a required peer
  of `dsh-spill-policy` (type resolution only; zero imports from this
  package's src, zero runtime load).

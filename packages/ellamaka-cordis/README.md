# @wopal/ellamaka-cordis

Ellamaka's single cordis boundary package (CORDIS DESIGN §7 current convention 1):
every `@deepseek-ai/cordis` import in this repository converges here.

## Per-instance hubs (D-06)

`cordisHubLayer` provisions a `CordisHubService` — a per-directory hub
registry. Hubs are created lazily on first dispatch into an instance
directory, shared by all dispatches in it, and disposed when the registry
entry is invalidated (host instance disposal) or the layer scope closes.

## Mountable plugin list (Q3, rolling)

Conformance-verified dsh plugins (DSH POC DESIGN §4.1). Each entry records the
verified version and the gate that proves it.

| Plugin | Version | Gates |
|---|---|---|
| (none currently mounted) | — | — |

## Dependency notes

- The six deeply-coupled dsh packages (agent-loop/session/session-query/
  compaction/subagent/schedule) must never be runtime-loaded. This is gated
  by `test/forbidden-load.test.ts` (§7 current convention, runtime semantics).

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import type { SpaceEntry } from "../../src/wopal/cli-schema"
import type { SpaceSnapshot, SpaceRegistry } from "../../src/wopal/space-registry"
import { SpaceRegistry as SpaceRegistryService } from "../../src/wopal/space-registry"
import { SpaceControlUnavailable, CapabilityContractError } from "../../src/wopal/cli-schema"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Helper: build a mock registry that records refreshSpaces calls
// ---------------------------------------------------------------------------

function makeMockRegistry(opts: {
  getSpaces: () => Effect.Effect<SpaceSnapshot>
  refreshSpaces: (execPath: string) => Effect.Effect<SpaceSnapshot, SpaceControlUnavailable | CapabilityContractError>
}): SpaceRegistry {
  return {
    getSpaces: opts.getSpaces,
    refreshSpaces: opts.refreshSpaces,
    refreshProjects: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
    searchSpace: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
  }
}

// ---------------------------------------------------------------------------
// resolveSpaces (imported from the handler — must be exported for testing)
// ---------------------------------------------------------------------------

import { resolveSpaces } from "../../src/server/routes/instance/httpapi/handlers/wopal-space"

const it = testEffect(SpaceRegistryService.defaultLayer)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wopal-space-handler", () => {
  it.instance("default layer executes a capability command", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const executable = path.join(instance.directory, "wopal")
      yield* Effect.promise(() =>
        Bun.write(
          executable,
          '#!/bin/sh\nprintf \'%s\\n\' \'{"apiVersion":"wopal.capability/v1","capability":"space.list","ok":true,"data":{"items":[{"name":"test-space","path":"/tmp/test-space","type":"local"}],"total":1}}\'\n',
        ),
      )
      yield* Effect.promise(() => fs.chmod(executable, 0o755))

      const registry = yield* SpaceRegistryService.Service
      const snapshot = yield* registry.refreshSpaces(executable)
      expect(snapshot.spaces).toEqual([{ name: "test-space", path: "/tmp/test-space", type: "local" }])
    }),
  )

  test("resolveSpaces returns cached spaces when cache is populated", async () => {
    const cached: SpaceEntry[] = [{ name: "test-space", path: "/tmp/test", type: "local" }]
    let refreshCalled = false

    const registry = makeMockRegistry({
      getSpaces: () => Effect.succeed({ spaces: cached, refreshedAt: Date.now() }),
      refreshSpaces: (_execPath) => {
        refreshCalled = true
        return Effect.succeed({ spaces: [], refreshedAt: 0 })
      },
    })

    const result = await Effect.runPromise(resolveSpaces(registry))
    expect(result).toEqual(cached)
    expect(refreshCalled).toBe(false)
  })

  test("resolveSpaces refreshes through correct CLI path when cache is empty", async () => {
    let capturedPath = ""
    const refreshed: SpaceEntry[] = [{ name: "space-1", path: "/tmp/space1", type: "local" }]

    const registry = makeMockRegistry({
      getSpaces: () => Effect.succeed({ spaces: [] as SpaceEntry[], refreshedAt: 0 }),
      refreshSpaces: (execPath) => {
        capturedPath = execPath
        return Effect.succeed({ spaces: refreshed, refreshedAt: Date.now() })
      },
    })

    const result = await Effect.runPromise(resolveSpaces(registry))
    expect(result).toEqual(refreshed)
    expect(capturedPath).toContain("bin/wopal")
    expect(capturedPath).not.toBe("")
  })

  test("resolveSpaces returns empty list when refresh fails", async () => {
    const registry = makeMockRegistry({
      getSpaces: () => Effect.succeed({ spaces: [] as SpaceEntry[], refreshedAt: 0 }),
      refreshSpaces: () =>
        Effect.fail(new SpaceControlUnavailable({ message: "CLI unavailable", reason: "test" })),
    })

    const result = await Effect.runPromise(resolveSpaces(registry))
    expect(result).toEqual([])
  })

  test("resolveSpaces returns empty list when refresh returns CapabilityContractError", async () => {
    const registry = makeMockRegistry({
      getSpaces: () => Effect.succeed({ spaces: [] as SpaceEntry[], refreshedAt: 0 }),
      refreshSpaces: () =>
        Effect.fail(
          new CapabilityContractError({ message: "Contract mismatch", capability: "space.list", detail: "test" }),
        ),
    })

    const result = await Effect.runPromise(resolveSpaces(registry))
    expect(result).toEqual([])
  })
})

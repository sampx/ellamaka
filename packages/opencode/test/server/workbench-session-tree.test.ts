import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, realpath, symlink } from "fs/promises"
import os from "os"
import path from "path"
import {
  buildWorkbenchSessionTree,
  resolveSpaceDirectory,
} from "../../src/workbench/session-tree"

describe("Workbench session tree", () => {
  test("uses canonical paths, longest matching scope, and external worktree ownership", () => {
    const result = buildWorkbenchSessionTree({
      spaces: [
        { name: "Team", path: "/spaces/team" },
        { name: "Web", path: "/spaces/team/web" },
      ],
      projects: [{ name: "app", path: "/spaces/team/web/app" }],
      worktrees: [{ projectPath: "/spaces/team/web/app", path: "/outside/app-feature", branch: "feature/tree" }],
      sessions: [
        session({ id: "old", directory: "/spaces/team/web/app", timeUpdated: 10 }),
        session({ id: "subdir", directory: "/spaces/team/web/app/packages/ui", timeUpdated: 30 }),
        session({ id: "worktree", directory: "/outside/app-feature", timeUpdated: 40 }),
        session({ id: "web-root", directory: "/spaces/team/web", timeUpdated: 20 }),
        session({ id: "team-root", directory: "/spaces/team", timeUpdated: 50 }),
        session({ id: "general", directory: "/general/tasks", timeUpdated: 60 }),
        session({ id: "archived", directory: "/spaces/team/web", timeArchived: 1 }),
        session({ id: "child", directory: "/spaces/team/web", parentID: "old" }),
      ],
      limitPerScope: 200,
    })

    expect(result.scopes.map((scope) => [scope.key, scope.name, scope.sessionCount])).toEqual([
      ["general", "General", 1],
      ["space:/spaces/team", "Team", 1],
      ["space:/spaces/team/web", "Web", 4],
    ])

    const web = result.scopes[2]!
    expect(web.locations.map((location) => [location.kind, location.path, location.sessionCount])).toEqual([
      ["space-root", "/spaces/team/web", 1],
      ["project", "/spaces/team/web/app", 3],
    ])
    expect(web.locations[1]!.sessions.map((item) => [item.id, item.marker, item.relativePath, item.branch])).toEqual([
      ["worktree", "worktree", undefined, "feature/tree"],
      ["subdir", "directory", "packages/ui", undefined],
      ["old", "", undefined, undefined],
    ])
  })

  test("keeps registered empty scopes, groups General by creation date (newest first), and reports scope-local truncation", () => {
    // timeCreated values land on 2026-07-16 (a,c,d) and 2026-07-15 (b).
    // The newer date must sort first regardless of session.directory.
    // timeUpdated drives intra-bucket order (c newest, then a, then d).
    const result = buildWorkbenchSessionTree({
      spaces: [{ name: "Empty", path: "/spaces/empty" }],
      projects: [],
      worktrees: [],
      sessions: [
        session({ id: "a", directory: "/general/a", timeCreated: new Date("2026-07-16T10:00:00").getTime(), timeUpdated: 1 }),
        session({ id: "b", directory: "/general/b", timeCreated: new Date("2026-07-15T10:00:00").getTime(), timeUpdated: 2 }),
        session({ id: "c", directory: "/general/a", timeCreated: new Date("2026-07-16T22:00:00").getTime(), timeUpdated: 3 }),
        session({ id: "d", directory: "/general/d", timeCreated: new Date("2026-07-16T08:00:00").getTime(), timeUpdated: 0 }),
      ],
      limitPerScope: 3,
    })

    // 4 General sessions, limit 3 → truncated. Sort by timeUpdated desc: c(3), b(2), a(1), d(0) → top 3 = c, b, a.
    expect(result.scopes.map((scope) => [scope.key, scope.sessionCount, scope.truncated])).toEqual([
      ["general", 3, true],
      ["space:/spaces/empty", 0, false],
    ])
    // General groups by date (not directory), newest date first.
    // /general/a and /general/b sessions both land in their timeCreated date bucket.
    expect(result.scopes[0]!.locations.map((location) => [location.kind, location.key, location.name, location.sessions.map((session) => session.id)])).toEqual([
      ["general-date", "general-date:2026-07-16", "2026-07-16", ["c", "a"]],
      ["general-date", "general-date:2026-07-15", "2026-07-15", ["b"]],
    ])
  })

  test("General session directory is preserved verbatim while grouping key comes from timeCreated", () => {
    const result = buildWorkbenchSessionTree({
      spaces: [],
      projects: [],
      worktrees: [],
      sessions: [
        session({ id: "custom", directory: "/Users/me/custom-dir", timeCreated: new Date("2026-07-16T03:00:00").getTime(), timeUpdated: 1 }),
        session({ id: "provisioned", directory: "/home/.wopal/general_tasks/2026-07-16", timeCreated: new Date("2026-07-16T15:00:00").getTime(), timeUpdated: 2 }),
      ],
      limitPerScope: 200,
    })
    const general = result.scopes[0]!
    expect(general.locations).toHaveLength(1)
    expect(general.locations[0]!.kind).toBe("general-date")
    expect(general.locations[0]!.name).toBe("2026-07-16")
    // The two sessions keep their original directories even though they share a date bucket.
    expect(general.locations[0]!.sessions.map((session) => [session.id, session.directory])).toEqual([
      ["provisioned", "/home/.wopal/general_tasks/2026-07-16"],
      ["custom", "/Users/me/custom-dir"],
    ])
  })

  test("rejects absolute, traversal, and symlink escape targets before provisioning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-space-"))
    const child = `${root}/child`
    const outside = await mkdtemp(path.join(os.tmpdir(), "workbench-outside-"))
    await mkdir(child)
    await Bun.write(`${root}/marker`, "root")
    await Bun.write(`${child}/.keep`, "child")
    await Bun.write(`${outside}/.keep`, "outside")
    await symlink(outside, `${root}/escape`)

    await expect(resolveSpaceDirectory(root, "child")).resolves.toBe(await realpath(child))
    await expect(resolveSpaceDirectory(root, "../outside")).rejects.toThrow("relative")
    await expect(resolveSpaceDirectory(root, "/tmp")).rejects.toThrow("relative")
    await expect(resolveSpaceDirectory(root, "escape")).rejects.toThrow("inside")
  })
})

function session(input: {
  id: string
  directory: string
  timeUpdated?: number
  timeCreated?: number
  timeArchived?: number
  parentID?: string
}) {
  return {
    id: input.id,
    title: input.id,
    directory: input.directory,
    timeCreated: input.timeCreated ?? input.timeUpdated ?? 0,
    timeUpdated: input.timeUpdated ?? 0,
    timeArchived: input.timeArchived,
    parentID: input.parentID,
    directoryHealth: "healthy" as const,
  }
}

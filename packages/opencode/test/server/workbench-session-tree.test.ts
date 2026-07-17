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

  test("keeps registered empty scopes, groups General by directory, and reports scope-local truncation", () => {
    const result = buildWorkbenchSessionTree({
      spaces: [{ name: "Empty", path: "/spaces/empty" }],
      projects: [],
      worktrees: [],
      sessions: [
        session({ id: "a", directory: "/general/a", timeUpdated: 1 }),
        session({ id: "b", directory: "/general/b", timeUpdated: 2 }),
        session({ id: "c", directory: "/general/a", timeUpdated: 3 }),
      ],
      limitPerScope: 2,
    })

    expect(result.scopes.map((scope) => [scope.key, scope.sessionCount, scope.truncated])).toEqual([
      ["general", 2, true],
      ["space:/spaces/empty", 0, false],
    ])
    expect(result.scopes[0]!.locations.map((location) => [location.key, location.sessions.map((session) => session.id)])).toEqual([
      ["general-directory:/general/a", ["c"]],
      ["general-directory:/general/b", ["b"]],
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
  timeArchived?: number
  parentID?: string
}) {
  return {
    id: input.id,
    title: input.id,
    directory: input.directory,
    timeCreated: input.timeUpdated ?? 0,
    timeUpdated: input.timeUpdated ?? 0,
    timeArchived: input.timeArchived,
    parentID: input.parentID,
    directoryHealth: "healthy" as const,
  }
}

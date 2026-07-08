import { test, describe, expect } from "bun:test"
import path from "path"
import fs from "fs"
import { $ } from "bun"
import { tmpdir } from "../fixture/fixture"
import {
  groupSessionsBySpace,
  scanFirstLevelGitRepos,
  listProjectWorktrees,
  checkWorktreeStale,
  realpathSafe,
  getProjectName,
} from "../../src/server/routes/instance/httpapi/handlers/wopal-space-grouping"
import type { Session } from "../../src/session/session"
import type { Project } from "../../src/project/project"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (
  id: string,
  directory: string,
  opts?: { archived?: boolean; agent?: string; title?: string },
): Session.Info =>
  ({
    id,
    title: opts?.title ?? "test-" + id,
    directory,
    agent: opts?.agent,
    time: {
      created: 1000,
      updated: 1000,
      archived: opts?.archived ? 2000 : undefined,
    },
  } as Session.Info)

const makeProject = (worktree: string, name?: string): Project.Info => ({ worktree, name } as Project.Info)

/** Local mirror of scanDirectories for search tests (production fn in wopal-space.ts is not exported). */
function scanDirectories(root: string, maxDepth: number): string[] {
  const results: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue
      const childPath = path.join(dir, name)
      try {
        if (!fs.statSync(childPath).isDirectory()) continue
      } catch {
        continue
      }
      results.push(childPath)
      walk(childPath, depth + 1)
    }
  }
  walk(root, 0)
  return results
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wopal-space-overview", () => {
  // Test 1: 空间内 project 归组 — 一级 git repo 的 session 归到 rootSessions
  test("groups session at project root into rootSessions with marker=\"\"", async () => {
    await using space = await tmpdir()
    const projectDir = path.join(space.path, "myproject")
    await fs.promises.mkdir(projectDir)
    await $`git init`.cwd(projectDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(projectDir).quiet()
    await $`git config user.name "Test"`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "init"`.cwd(projectDir).quiet()

    const session = makeSession("s1", projectDir)
    const result = groupSessionsBySpace(space.path, [session], [])

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].path).toBe(projectDir)
    expect(result.projects[0].vcs).toBe("git")
    expect(result.projects[0].rootSessions).toHaveLength(1)
    expect(result.projects[0].rootSessions[0].id).toBe("s1")
    expect(result.projects[0].rootSessions[0].marker).toBe("")
    expect(result.projects[0].rootSessions[0].directory).toBe(projectDir)
    expect(result.spaceRootSessions).toHaveLength(0)
  })

  // Test 2: 子目录 session 归组 — directory=project 子目录 → directories 分组, marker="directory"
  test("groups session in project subdirectory into directories with marker=\"directory\"", async () => {
    await using space = await tmpdir()
    const projectDir = path.join(space.path, "myproject")
    await fs.promises.mkdir(projectDir)
    await $`git init`.cwd(projectDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(projectDir).quiet()
    await $`git config user.name "Test"`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "init"`.cwd(projectDir).quiet()

    const srcDir = path.join(projectDir, "src")
    await fs.promises.mkdir(srcDir)

    const session = makeSession("s2", srcDir)
    const result = groupSessionsBySpace(space.path, [session], [])

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].rootSessions).toHaveLength(0)
    expect(result.projects[0].directories).toHaveLength(1)
    expect(result.projects[0].directories[0].path).toBe(srcDir)
    expect(result.projects[0].directories[0].sessionCount).toBe(1)
    expect(result.projects[0].directories[0].sessions[0].id).toBe("s2")
    expect(result.projects[0].directories[0].sessions[0].marker).toBe("directory")
  })

  // Test 3: worktree session 归组 — worktree 下创建 session → 归主项目 worktrees 分组, marker="worktree"
  test("groups session in worktree into worktrees with marker=\"worktree\"", async () => {
    await using space = await tmpdir()
    const projectDir = path.join(space.path, "myproject")
    await fs.promises.mkdir(projectDir)
    await $`git init`.cwd(projectDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(projectDir).quiet()
    await $`git config user.name "Test"`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "init"`.cwd(projectDir).quiet()

    // Create worktree inside the project dir so it's not a separate first-level git repo
    const wtDir = path.join(projectDir, "wt")
    await $`git worktree add ${wtDir}`.cwd(projectDir).quiet()

    const session = makeSession("s3", wtDir)
    const result = groupSessionsBySpace(space.path, [session], [])

    expect(result.projects).toHaveLength(1)
    const wtGroup = result.projects[0].worktrees.find((w) => w.worktreePath === wtDir)
    expect(wtGroup).toBeDefined()
    expect(wtGroup!.stale).toBe(false)
    expect(wtGroup!.sessionCount).toBe(1)
    expect(wtGroup!.sessions).toHaveLength(1)
    expect(wtGroup!.sessions[0].id).toBe("s3")
    expect(wtGroup!.sessions[0].marker).toBe("worktree")
  })

  // Test 4: stale worktree — 删除 worktree 目录 → stale=true, sessions=[]
  test("detects stale worktree when directory is deleted, sessionCount=0 sessions=[]", async () => {
    await using space = await tmpdir()
    const projectDir = path.join(space.path, "myproject")
    await fs.promises.mkdir(projectDir)
    await $`git init`.cwd(projectDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(projectDir).quiet()
    await $`git config user.name "Test"`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "init"`.cwd(projectDir).quiet()

    // Create worktree inside the project dir so it's not a separate first-level git repo
    const wtDir = path.join(projectDir, "wt")
    await $`git worktree add ${wtDir}`.cwd(projectDir).quiet()

    // Verify worktree is not stale initially
    expect(checkWorktreeStale(wtDir)).toBe(false)

    // Delete the worktree directory to make it stale
    fs.rmSync(wtDir, { recursive: true, force: true })

    // checkWorktreeStale should now return true
    expect(checkWorktreeStale(wtDir)).toBe(true)

    const result = groupSessionsBySpace(space.path, [], [])
    expect(result.projects).toHaveLength(1)
    const wtGroup = result.projects[0].worktrees.find((w) => w.worktreePath === wtDir)
    expect(wtGroup).toBeDefined()
    expect(wtGroup!.stale).toBe(true)
    expect(wtGroup!.sessionCount).toBe(0)
    expect(wtGroup!.sessions).toHaveLength(0)
  })

  // Test 5: 空间根 session（空间根非 git repo）— directory=spacePath → spaceRootSessions
  test("places session at space root into spaceRootSessions when space is not a git repo", async () => {
    await using space = await tmpdir()

    const session = makeSession("s5", space.path)
    const result = groupSessionsBySpace(space.path, [session], [])

    expect(result.projects).toHaveLength(0)
    expect(result.spaceRootSessions).toHaveLength(1)
    expect(result.spaceRootSessions[0].id).toBe("s5")
    expect(result.spaceRootSessions[0].directory).toBe(space.path)
  })

  // Test 6: 非空间 session — directory 不在任何空间 → 被过滤掉
  test("excludes sessions outside space from grouping result", async () => {
    await using space = await tmpdir()
    const projectDir = path.join(space.path, "myproject")
    await fs.promises.mkdir(projectDir)
    await $`git init`.cwd(projectDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(projectDir).quiet()
    await $`git config user.name "Test"`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "init"`.cwd(projectDir).quiet()

    await using outside = await tmpdir()
    const session = makeSession("s6", outside.path)

    const result = groupSessionsBySpace(space.path, [session], [])

    // Git repo detected by scanner (verified separately)
    expect(scanFirstLevelGitRepos(space.path)).toContain(projectDir)
    // Session outside space should not appear anywhere (project hidden since it has no in-space sessions)
    expect(result.projects).toHaveLength(0)
    const allSessionIds = [
      ...result.projects.flatMap((p) => [
        ...p.rootSessions,
        ...p.directories.flatMap((d) => d.sessions),
        ...p.worktrees.flatMap((w) => w.sessions),
      ]),
      ...result.spaceRootSessions,
    ].map((s) => s.id)
    expect(allSessionIds).not.toContain("s6")
    expect(result.spaceRootSessions).toHaveLength(0)
  })

  // Test 7: realpath — space.path 是软链接, realpath 后匹配
  test("realpathSafe resolves symlink and grouping matches real path", async () => {
    await using space = await tmpdir()
    const projectDir = path.join(space.path, "myproject")
    await fs.promises.mkdir(projectDir)
    await $`git init`.cwd(projectDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(projectDir).quiet()
    await $`git config user.name "Test"`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "init"`.cwd(projectDir).quiet()

    // Create symlink to space directory
    const linkPath = space.path + "-link"
    fs.symlinkSync(space.path, linkPath)

    // realpathSafe resolves symlink
    expect(realpathSafe(linkPath)).toBe(space.path)

    // realpathSafe returns original path for non-existent paths
    expect(realpathSafe("/nonexistent/path/xyz")).toBe("/nonexistent/path/xyz")

    // Grouping with resolved realpath works correctly
    const session = makeSession("s7", projectDir)
    const result = groupSessionsBySpace(realpathSafe(linkPath), [session], [])

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].path).toBe(projectDir)
    expect(result.projects[0].rootSessions).toHaveLength(1)
    expect(result.projects[0].rootSessions[0].id).toBe("s7")
  })

  // Test 8: 搜索 — query 匹配子目录, 限制前 50
  test("scanDirectories finds subdirectories matching query, limited to 50", async () => {
    await using root = await tmpdir()
    await fs.promises.mkdir(path.join(root.path, "foobar"))
    await fs.promises.mkdir(path.join(root.path, "baz"))
    await fs.promises.mkdir(path.join(root.path, "foo-qux"))
    await fs.promises.mkdir(path.join(root.path, "other"))
    await fs.promises.mkdir(path.join(root.path, "deep-foo"))

    const allDirs = scanDirectories(root.path, 3)
    const q = "foo"
    const matched = allDirs.filter((d) => path.basename(d).toLowerCase().includes(q))
    const limited = matched.slice(0, 50)

    expect(limited).toHaveLength(3)
    expect(limited).toContain(path.join(root.path, "foobar"))
    expect(limited).toContain(path.join(root.path, "foo-qux"))
    expect(limited).toContain(path.join(root.path, "deep-foo"))
    expect(limited).not.toContain(path.join(root.path, "baz"))
    expect(limited).not.toContain(path.join(root.path, "other"))
  })

  // Test 9: 搜索深度限制 — 深层子目录不被扫描
  test("scanDirectories respects maxDepth, excludes directories beyond limit", async () => {
    await using root = await tmpdir()
    const l1 = path.join(root.path, "l1")
    const l2 = path.join(l1, "l2")
    const l3 = path.join(l2, "l3")
    const l4 = path.join(l3, "l4")
    const l5 = path.join(l4, "l5")
    await fs.promises.mkdir(l5, { recursive: true })

    // maxDepth=3: root children start at depth 0, so l1-l4 are included, l5 excluded
    const dirs = scanDirectories(root.path, 3)

    expect(dirs).toContain(l1)
    expect(dirs).toContain(l2)
    expect(dirs).toContain(l3)
    expect(dirs).toContain(l4)
    expect(dirs).not.toContain(l5)
  })

  // Test 10: 边界 — 空间不存在、空 query、空 session 列表、archived sessions
  test("handles edge cases: empty sessions, archived sessions, no git repos, project name resolution", async () => {
    await using space = await tmpdir()

    // Empty sessions → empty result
    const empty = groupSessionsBySpace(space.path, [], [])
    expect(empty.projects).toHaveLength(0)
    expect(empty.spaceRootSessions).toHaveLength(0)

    // Archived sessions are filtered out
    const archived = makeSession("arch", space.path, { archived: true })
    const withArchived = groupSessionsBySpace(space.path, [archived], [])
    expect(withArchived.spaceRootSessions).toHaveLength(0)

    // Space with no git repos → no projects, but space root sessions still work
    const session = makeSession("s10", space.path)
    const noGit = groupSessionsBySpace(space.path, [session], [])
    expect(noGit.projects).toHaveLength(0)
    expect(noGit.spaceRootSessions).toHaveLength(1)

    // scanFirstLevelGitRepos on empty/non-git dir returns []
    expect(scanFirstLevelGitRepos(space.path)).toHaveLength(0)

    // getProjectName fallback
    expect(getProjectName(undefined, "/foo/bar")).toBe("bar")
    expect(getProjectName(makeProject("/foo/bar", "My Project"), "/foo/bar")).toBe("My Project")

    // checkWorktreeStale on non-existent path
    expect(checkWorktreeStale("/nonexistent/path/xyz")).toBe(true)
  })
})

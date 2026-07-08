import { execSync } from "child_process"
import { existsSync, readdirSync, realpathSync, statSync } from "fs"
import path from "path"
import type { Session } from "@/session/session"
import type { Project } from "@/project/project"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkbenchSessionMarker = "" | "directory" | "worktree"

export interface WorkbenchSessionSummary {
  id: string
  title: string
  directory: string
  marker: WorkbenchSessionMarker
  agent?: string
  timeCreated: number
  timeUpdated: number
  timeArchived?: number
}

export interface WorkbenchDirectoryGroup {
  path: string
  sessionCount: number
  sessions: WorkbenchSessionSummary[]
}

export interface WorkbenchWorktreeGroup {
  worktreePath: string
  branch?: string
  stale: boolean
  sessionCount: number
  sessions: WorkbenchSessionSummary[]
}

export interface WorkbenchProject {
  path: string
  displayPath: string
  name?: string
  vcs?: "git"
  sessionCount: number
  rootSessions: WorkbenchSessionSummary[]
  directories: WorkbenchDirectoryGroup[]
  worktrees: WorkbenchWorktreeGroup[]
}

export interface GroupResult {
  projects: WorkbenchProject[]
  spaceRootSessions: WorkbenchSessionSummary[]
}

export interface WorktreeInfo {
  worktreePath: string
  branch?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** fs.realpathSync wrapper; falls back to original path on failure. */
export function realpathSafe(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Resolve project name from Project.Info.name or path.basename. */
export function getProjectName(projectInfo: Project.Info | undefined, p: string): string | undefined {
  return projectInfo?.name || path.basename(p)
}

// ---------------------------------------------------------------------------
// Git repo scanning
// ---------------------------------------------------------------------------

/** Scan first-level subdirectories of spaceRealPath for git repos. Deduplicates by toplevel. */
export function scanFirstLevelGitRepos(spaceRealPath: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(spaceRealPath)
  } catch {
    return []
  }

  const repos = new Set<string>()
  for (const name of entries) {
    const childPath = path.join(spaceRealPath, name)
    try {
      if (!statSync(childPath).isDirectory()) continue
    } catch {
      continue
    }
    try {
      const toplevel = execSync("git rev-parse --show-toplevel", {
        cwd: childPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      // Exclude the space root itself — it is not a project (D-02)
      if (toplevel && toplevel !== spaceRealPath) repos.add(toplevel)
    } catch {
      // Not a git repo, skip
    }
  }
  return [...repos]
}

// ---------------------------------------------------------------------------
// Worktree listing
// ---------------------------------------------------------------------------

function parseWorktreePorcelain(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.worktreePath) {
        worktrees.push({ worktreePath: current.worktreePath, branch: current.branch })
      }
      current = { worktreePath: line.slice("worktree ".length) }
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length)
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref
    }
  }

  if (current.worktreePath) {
    worktrees.push({ worktreePath: current.worktreePath, branch: current.branch })
  }

  return worktrees
}

/** List all worktrees (including main) for a git repo via `git worktree list --porcelain`. */
export function listProjectWorktrees(repoRoot: string): WorktreeInfo[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return parseWorktreePorcelain(output)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Stale detection
// ---------------------------------------------------------------------------

/** Check if a worktree path is stale (missing or broken git state). */
export function checkWorktreeStale(worktreePath: string): boolean {
  if (!existsSync(worktreePath)) return true
  try {
    execSync("git status", {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return false
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// Session → summary
// ---------------------------------------------------------------------------

function toSummary(session: Session.Info): WorkbenchSessionSummary {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    marker: "",
    agent: session.agent,
    timeCreated: session.time.created,
    timeUpdated: session.time.updated,
    timeArchived: session.time.archived,
  }
}

// ---------------------------------------------------------------------------
// Main grouping function
// ---------------------------------------------------------------------------

/**
 * Group sessions by Workbench space→project→[subdirectory|worktree] model.
 *
 * - Filters out archived sessions (timeArchived != null).
 * - directory === spaceRealPath → always spaceRootSessions.
 * - directory under a first-level git repo root → project rootSessions (marker=""),
 *   subdirectory group (marker="directory"), or worktree group (marker="worktree").
 * - directory under spaceRealPath but not matching any project → spaceRootSessions (fallback).
 * - Stale worktrees get sessionCount=0, sessions=[].
 */
export function groupSessionsBySpace(
  spaceRealPath: string,
  sessions: Session.Info[],
  projects: Project.Info[],
): GroupResult {
  const active = sessions.filter((s) => s.time.archived == null)

  const repoRoots = scanFirstLevelGitRepos(spaceRealPath)

  // Build worktree list per repo root
  const projectWorktrees = new Map<string, WorktreeInfo[]>()
  for (const root of repoRoots) {
    projectWorktrees.set(root, listProjectWorktrees(root))
  }

  // Build project lookup by worktree path (for name resolution)
  const projectByPath = new Map<string, Project.Info>()
  for (const p of projects) {
    projectByPath.set(p.worktree, p)
  }

  // Result accumulators
  const spaceRootSessions: WorkbenchSessionSummary[] = []

  type ProjectAccum = {
    rootSessions: WorkbenchSessionSummary[]
    dirGroups: Map<string, WorkbenchSessionSummary[]>
    worktreeSessions: Map<string, WorkbenchSessionSummary[]>
  }

  const projectAccums = new Map<string, ProjectAccum>()
  for (const root of repoRoots) {
    projectAccums.set(root, {
      rootSessions: [],
      dirGroups: new Map(),
      worktreeSessions: new Map(),
    })
  }

  // Classify each active session
  for (const session of active) {
    const summary = toSummary(session)
    const dir = session.directory

    // Rule 1: directory === spaceRealPath → always spaceRootSessions
    if (dir === spaceRealPath) {
      spaceRootSessions.push(summary)
      continue
    }

    // Rule 2: find which project this session belongs to
    let matched = false
    for (const root of repoRoots) {
      if (dir !== root && !dir.startsWith(root + "/")) continue

      const accum = projectAccums.get(root)!
      const worktrees = projectWorktrees.get(root) || []

      // Check worktrees first (more specific than project root)
      let matchedWorktree = false
      for (const wt of worktrees) {
        // Skip main worktree — its path === repoRoot; root sessions use marker="" not "worktree"
        if (wt.worktreePath === root) continue
        if (dir === wt.worktreePath || dir.startsWith(wt.worktreePath + "/")) {
          const existing = accum.worktreeSessions.get(wt.worktreePath) || []
          existing.push({ ...summary, marker: "worktree" })
          accum.worktreeSessions.set(wt.worktreePath, existing)
          matchedWorktree = true
          break
        }
      }

      if (matchedWorktree) {
        matched = true
        break
      }

      // Not under any worktree → classify as root or subdirectory
      if (dir === root) {
        accum.rootSessions.push({ ...summary, marker: "" })
      } else {
        const relative = dir.slice(root.length + 1)
        const firstDir = relative.split("/")[0]
        const groupPath = path.join(root, firstDir)
        const existing = accum.dirGroups.get(groupPath) || []
        existing.push({ ...summary, marker: "directory" })
        accum.dirGroups.set(groupPath, existing)
      }

      matched = true
      break
    }

    // Rule 3: under spaceRealPath but not matching any project → spaceRootSessions (fallback)
    if (!matched && dir.startsWith(spaceRealPath + "/")) {
      spaceRootSessions.push(summary)
    }
    // If directory is not under spaceRealPath at all, skip
  }

  // Build result projects
  const resultProjects: WorkbenchProject[] = []
  for (const root of repoRoots) {
    const accum = projectAccums.get(root)!
    const worktrees = projectWorktrees.get(root) || []
    const projInfo = projectByPath.get(root)

    // Only show worktrees under this space path; exclude main worktree (path === repoRoot) and cross-space worktrees
    const wtGroups: WorkbenchWorktreeGroup[] = worktrees
      .filter((wt) => wt.worktreePath !== root)
      .filter((wt) => wt.worktreePath === spaceRealPath || wt.worktreePath.startsWith(spaceRealPath + "/"))
      .map((wt) => {
        const stale = checkWorktreeStale(wt.worktreePath)
        const sessions = stale ? [] : (accum.worktreeSessions.get(wt.worktreePath) || [])
        return {
          worktreePath: wt.worktreePath,
          branch: wt.branch,
          stale,
          sessionCount: stale ? 0 : sessions.length,
          sessions,
        }
      })

    const dirGroups: WorkbenchDirectoryGroup[] = [...accum.dirGroups.entries()].map(([p, s]) => ({
      path: p,
      sessionCount: s.length,
      sessions: s,
    }))

    const totalCount =
      accum.rootSessions.length +
      dirGroups.reduce((sum, g) => sum + g.sessionCount, 0) +
      wtGroups.reduce((sum, g) => sum + g.sessionCount, 0)

    resultProjects.push({
      path: root,
      displayPath: root,
      name: getProjectName(projInfo, root),
      vcs: "git",
      sessionCount: totalCount,
      rootSessions: accum.rootSessions,
      directories: dirGroups,
      worktrees: wtGroups,
    })
  }

  return {
    projects: resultProjects,
    spaceRootSessions,
  }
}

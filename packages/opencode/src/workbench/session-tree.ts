import path from "path"
import { realpath } from "fs/promises"

export type WorkbenchDirectoryHealth = "healthy" | "missing" | "unavailable"
export type WorkbenchSessionMarker = "" | "directory" | "worktree"

export type WorkbenchTreeSession = {
  id: string
  title: string
  directory: string
  timeCreated: number
  timeUpdated: number
  directoryHealth: WorkbenchDirectoryHealth
  parentID?: string
  timeArchived?: number
}

export type WorkbenchTreeInput = {
  spaces: Array<{ name: string; path: string }>
  projects: Array<{ name: string; path: string }>
  worktrees: Array<{ projectPath: string; path: string; branch?: string }>
  sessions: WorkbenchTreeSession[]
  limitPerScope: number
}

export type WorkbenchSessionTree = {
  scopes: Array<{
    key: string
    kind: "general" | "space"
    name: string
    path: string
    sessionCount: number
    truncated: boolean
    locations: Array<{
      key: string
      kind: "general-directory" | "general-date" | "space-root" | "project"
      name: string
      path: string
      sessionCount: number
      sessions: Array<{
        id: string
        title: string
        directory: string
        relativePath?: string
        marker: WorkbenchSessionMarker
        branch?: string
        directoryHealth: WorkbenchDirectoryHealth
        timeCreated: number
        timeUpdated: number
      }>
    }>
  }>
}

type Scope = {
  key: string
  kind: "general" | "space"
  name: string
  path: string
}

type ClassifiedSession = {
  session: WorkbenchTreeSession
  scope: Scope
  location: {
    key: string
      kind: "general-directory" | "general-date" | "space-root" | "project"
      name: string
      path: string
    }
    marker: WorkbenchSessionMarker
    relativePath?: string
    branch?: string
  }

export function normalizeWorkbenchPath(value: string) {
  const normalized = value.replaceAll("\\", "/")
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, "")
}

export function isPathWithin(root: string, candidate: string) {
  const normalizedRoot = normalizeWorkbenchPath(root)
  const normalizedCandidate = normalizeWorkbenchPath(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

export function buildWorkbenchSessionTree(input: WorkbenchTreeInput): WorkbenchSessionTree {
  const general: Scope = { key: "general", kind: "general", name: "General", path: "" }
  const spaces = input.spaces
    .map((space) => ({
      key: `space:${normalizeWorkbenchPath(space.path)}`,
      kind: "space" as const,
      name: space.name,
      path: normalizeWorkbenchPath(space.path),
    }))
    .sort(compareScope)
  const scopes = [general, ...spaces]
  const spacesBySpecificity = [...spaces].sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
  const knownScopes = new Map(scopes.map((scope) => [scope.key, scope]))
  const projects = input.projects
    .map((project) => ({ ...project, path: normalizeWorkbenchPath(project.path) }))
    .sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
  const worktrees = input.worktrees
    .map((worktree) => ({
      ...worktree,
      path: normalizeWorkbenchPath(worktree.path),
      projectPath: normalizeWorkbenchPath(worktree.projectPath),
    }))
    .sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
  const grouped = new Map<string, ClassifiedSession[]>()
  for (const scope of scopes) grouped.set(scope.key, [])

  for (const session of input.sessions) {
    if (session.parentID || session.timeArchived !== undefined) continue
    const classified = classifySession({ session: { ...session, directory: normalizeWorkbenchPath(session.directory) }, spaces: spacesBySpecificity, projects, worktrees, general })
    const bucket = grouped.get(classified.scope.key)
    if (bucket) bucket.push(classified)
  }

  return {
    scopes: scopes.map((scope) => {
      const sessions = (grouped.get(scope.key) ?? []).sort(compareClassifiedSession)
      const accepted = sessions.slice(0, input.limitPerScope)
      const locations = new Map<string, { info: ClassifiedSession["location"]; sessions: ClassifiedSession[] }>()
      for (const session of accepted) {
        const bucket = locations.get(session.location.key) ?? { info: session.location, sessions: [] }
        bucket.sessions.push(session)
        locations.set(session.location.key, bucket)
      }

      return {
        key: scope.key,
        kind: scope.kind,
        name: scope.name,
        path: scope.path,
        sessionCount: accepted.length,
        truncated: sessions.length > accepted.length,
        locations: [...locations.values()]
          .sort((a, b) => compareLocation(a.info, b.info))
          .map((location) => ({
            ...location.info,
            sessionCount: location.sessions.length,
            sessions: location.sessions.sort(compareClassifiedSession).map((item) => ({
              id: item.session.id,
              title: item.session.title,
              directory: item.session.directory,
              relativePath: item.relativePath,
              marker: item.marker,
              branch: item.branch,
              directoryHealth: item.session.directoryHealth,
              timeCreated: item.session.timeCreated,
              timeUpdated: item.session.timeUpdated,
            })),
          })),
      }
    }),
  }
}

export async function resolveSpaceDirectory(spacePath: string, relativeDirectory?: string) {
  const root = await requireRealPath(spacePath, "Space directory is unavailable")
  if (!relativeDirectory) return root
  const normalized = relativeDirectory.replaceAll("\\", "/")
  if (
    path.isAbsolute(relativeDirectory) ||
    path.win32.isAbsolute(relativeDirectory) ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("Space directory must be a non-empty safe relative path")
  }
  const lexical = path.resolve(root, normalized)
  if (!isPathWithin(root, lexical)) throw new Error("Space directory must remain inside its Space")
  const target = await requireRealPath(lexical, "Session directory is unavailable")
  if (!isPathWithin(root, target)) throw new Error("Session directory must remain inside its Space")
  return target
}

async function requireRealPath(value: string, message: string) {
  try {
    return normalizeWorkbenchPath(await realpath(value))
  } catch {
    throw new Error(message)
  }
}

function classifySession(input: {
  session: WorkbenchTreeSession
  spaces: Scope[]
  projects: Array<{ name: string; path: string }>
  worktrees: Array<{ projectPath: string; path: string; branch?: string }>
  general: Scope
}): ClassifiedSession {
  const worktree = input.worktrees.find((candidate) => isPathWithin(candidate.path, input.session.directory))
  if (worktree) {
    const project = input.projects.find((candidate) => candidate.path === worktree.projectPath)
    const scope = project ? ownerScope(project.path, input.spaces) : undefined
    if (scope && project) {
      return {
        session: input.session,
        scope,
        location: projectLocation(project),
        marker: "worktree",
        relativePath: relativePath(worktree.path, input.session.directory),
        branch: worktree.branch,
      }
    }
  }

  const project = input.projects.find((candidate) => isPathWithin(candidate.path, input.session.directory))
  if (project) {
    const scope = ownerScope(project.path, input.spaces)
    if (scope) {
      const relative = relativePath(project.path, input.session.directory)
      return {
        session: input.session,
        scope,
        location: projectLocation(project),
        marker: relative ? "directory" : "",
        relativePath: relative,
      }
    }
  }

  const scope = ownerScope(input.session.directory, input.spaces)
  if (scope) {
    return {
      session: input.session,
      scope,
      location: {
        key: `space-root:${scope.path}`,
        kind: "space-root",
        name: scope.name,
        path: scope.path,
      },
      marker: input.session.directory === scope.path ? "" : "directory",
      relativePath: relativePath(scope.path, input.session.directory),
    }
  }

  return {
    session: input.session,
    scope: input.general,
    location: generalDateLocation(input.session.timeCreated),
    marker: "",
  }
}

// General sessions group by the local-calendar date derived from timeCreated,
// regardless of which physical directory the session actually lives in.
// `directory` stays as the user's (or provisioner's) chosen path; only the
// tree grouping key comes from the date. This lets sessions in custom
// directories and sessions in the provisioner's date directory render under
// the same date bucket without rewriting directory ownership.
function generalDateLocation(timeCreated: number) {
  const date = new Date(timeCreated)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  const label = `${y}-${m}-${d}`
  return {
    key: `general-date:${label}`,
    kind: "general-date" as const,
    name: label,
    path: "",
  }
}

function ownerScope(path: string, spaces: Scope[]) {
  return spaces.find((space) => isPathWithin(space.path, path))
}

function projectLocation(project: { name: string; path: string }) {
  return {
    key: `project:${project.path}`,
    kind: "project" as const,
    name: project.name || path.basename(project.path),
    path: project.path,
  }
}

function relativePath(root: string, value: string) {
  if (root === value) return undefined
  return normalizeWorkbenchPath(path.relative(root, value)) || undefined
}

function compareScope(a: Scope, b: Scope) {
  return a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
}

function compareLocation(
  a: ClassifiedSession["location"],
  b: ClassifiedSession["location"],
) {
  // `general-date` sorts newest-first by its `YYYY-MM-DD` name, which sorts
  // lexicographically the same as chronologically.
  if (a.kind === "general-date" && b.kind === "general-date") {
    return b.name.localeCompare(a.name)
  }
  const rank = { "general-date": 0, "general-directory": 0, "space-root": 0, project: 1 }
  return rank[a.kind] - rank[b.kind] || a.name.localeCompare(a.name) || a.path.localeCompare(b.path)
}

function compareClassifiedSession(a: ClassifiedSession, b: ClassifiedSession) {
  return b.session.timeUpdated - a.session.timeUpdated || b.session.id.localeCompare(a.session.id)
}

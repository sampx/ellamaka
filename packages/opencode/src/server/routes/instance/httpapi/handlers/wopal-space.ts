import path from "path"
import { execSync } from "child_process"
import { existsSync, readdirSync, statSync } from "fs"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { ConfigParse } from "@/config/parse"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { ProjectTable } from "@/project/project.sql"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { InvalidRequestError } from "../errors"
import type { WopalSpaceEntry } from "../groups/wopal-space"
import { realpathSafe, groupSessionsBySpace } from "./wopal-space-grouping"
import type { Session } from "@/session/session"
import type { Project } from "@/project/project"

const SPACES_FILE = path.join(Global.Path.config, "settings.jsonc")

// Query all sessions directly from the database (no InstanceRef needed)
function queryAllSessions(): Session.Info[] {
  return Database.use((db) =>
    db
      .select({
        id: SessionTable.id,
        title: SessionTable.title,
        directory: SessionTable.directory,
        agent: SessionTable.agent,
        projectID: SessionTable.project_id,
        time_created: SessionTable.time_created,
        time_updated: SessionTable.time_updated,
        time_archived: SessionTable.time_archived,
      })
      .from(SessionTable)
      .all(),
  ).map((row) => ({
    id: row.id,
    title: row.title,
    directory: row.directory,
    agent: row.agent ?? undefined,
    projectID: row.projectID,
    slug: "",
    version: "",
    time: {
      created: row.time_created ?? 0,
      updated: row.time_updated ?? 0,
      archived: row.time_archived ?? undefined,
    },
  })) as Session.Info[]
}

// Query all projects directly from the database (no InstanceRef needed)
function queryAllProjects(): Project.Info[] {
  return Database.use((db) =>
    db
      .select({
        id: ProjectTable.id,
        worktree: ProjectTable.worktree,
        name: ProjectTable.name,
        vcs: ProjectTable.vcs,
      })
      .from(ProjectTable)
      .all(),
  ).map((row) => ({
    id: row.id,
    worktree: row.worktree,
    name: row.name ?? undefined,
    vcs: row.vcs as "git" | undefined,
    sandboxes: [],
    time: { created: 0, updated: 0 },
  })) as Project.Info[]
}

const readSpaces = Effect.fn("WopalSpaceHttpApi.readSpaces")(function* () {
  const fs = yield* AppFileSystem.Service
  const text = yield* fs.readFileStringSafe(SPACES_FILE).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!text) return [] as WopalSpaceEntry[]
  const raw = ConfigParse.jsonc(text, SPACES_FILE)
  const spaces = (raw as { spaces?: Record<string, { path: string; type?: string }> })?.spaces
  if (!spaces || typeof spaces !== "object") return [] as WopalSpaceEntry[]
  return Object.entries(spaces).map(([name, info]) => ({
    name,
    path: info?.path ?? "",
    type: info?.type,
  }))
})

const isGitRepo = (dir: string): boolean => {
  try {
    execSync("git -C " + dir + " rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return true
  } catch {
    return false
  }
}

const scanDirectories = (root: string, maxDepth: number): string[] => {
  const results: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue
      const childPath = path.join(dir, name)
      try {
        if (!statSync(childPath).isDirectory()) continue
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

export const wopalSpaceHandlers = HttpApiBuilder.group(RootHttpApi, "wopal-space", (handlers) =>
  Effect.gen(function* () {
    const spaces = Effect.fn("WopalSpaceHttpApi.spaces")(function* () {
      const list = yield* readSpaces()
      return { spaces: list }
    })

    const spaceOverview = Effect.fn("WopalSpaceHttpApi.spaceOverview")(function* (ctx: {
      query: { spaceName: string }
    }) {
      const list = yield* readSpaces()
      const entry = list.find((s) => s.name === ctx.query.spaceName)
      if (!entry) return yield* new InvalidRequestError({ message: "Space not found: " + ctx.query.spaceName })
      const spaceRealPath = realpathSafe(entry.path)
      const sessions = queryAllSessions()
      const projects = queryAllProjects()
      const { projects: groupedProjects, spaceRootSessions } = groupSessionsBySpace(
        spaceRealPath,
        sessions,
        projects,
      )
      return {
        spaceName: ctx.query.spaceName,
        spacePath: entry.path,
        spaceRootSessionCount: spaceRootSessions.length,
        spaceRootSessions,
        projects: groupedProjects,
      }
    })

    const nonSpaceOverview = Effect.fn("WopalSpaceHttpApi.nonSpaceOverview")(function* () {
      const list = yield* readSpaces()
      const spaceRealPaths = new Set(list.map((s) => realpathSafe(s.path)))
      const sessions = queryAllSessions()
      const active = sessions.filter((s) => s.time.archived == null)
      const orphan = active.filter((s) => {
        for (const sp of spaceRealPaths) {
          if (s.directory === sp || s.directory.startsWith(sp + "/")) return false
        }
        return true
      })
      const dirMap = new Map<string, typeof orphan>()
      for (const s of orphan) {
        const existing = dirMap.get(s.directory) || []
        existing.push(s)
        dirMap.set(s.directory, existing)
      }
      const orphanDirectories = [...dirMap.entries()].map(([p, s]) => ({
        path: p,
        sessionCount: s.length,
        sessions: s.map((s) => ({
          id: s.id,
          title: s.title,
          directory: s.directory,
          marker: "" as const,
          agent: s.agent,
          timeCreated: s.time.created,
          timeUpdated: s.time.updated,
          timeArchived: s.time.archived,
        })),
      }))
      return { orphanDirectories }
    })

    const searchDirectories = Effect.fn("WopalSpaceHttpApi.searchDirectories")(function* (ctx: {
      query: { spaceName: string; query: string }
    }) {
      const list = yield* readSpaces()
      const entry = list.find((s) => s.name === ctx.query.spaceName)
      if (!entry) return yield* new InvalidRequestError({ message: "Space not found: " + ctx.query.spaceName })
      const spaceRealPath = realpathSafe(entry.path)
      if (!ctx.query.query) return { directories: [] }
      const allDirs = scanDirectories(spaceRealPath, 3)
      const q = ctx.query.query.toLowerCase()
      const matched = allDirs.filter((d) => path.basename(d).toLowerCase().includes(q))
      const limited = matched.slice(0, 50)
      const directories = limited.map((d) => ({
        path: d,
        displayPath: d,
        isGitRepo: isGitRepo(d),
      }))
      return { directories }
    })

    const recentDirectories = Effect.fn("WopalSpaceHttpApi.recentDirectories")(function* (ctx: {
      query: { spaceName: string }
    }) {
      const list = yield* readSpaces()
      const entry = list.find((s) => s.name === ctx.query.spaceName)
      if (!entry) return yield* new InvalidRequestError({ message: "Space not found: " + ctx.query.spaceName })
      const spaceRealPath = realpathSafe(entry.path)
      const sessions = queryAllSessions()
      const active = sessions.filter(
        (s) =>
          s.time.archived == null &&
          (s.directory === spaceRealPath || s.directory.startsWith(spaceRealPath + "/")),
      )
      const dirLatest = new Map<string, number>()
      for (const s of active) {
        const prev = dirLatest.get(s.directory)
        if (prev === undefined || s.time.created > prev) {
          dirLatest.set(s.directory, s.time.created)
        }
      }
      const sorted = [...dirLatest.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
      const directories = sorted.map(([p]) => ({
        path: p,
        displayPath: p,
        isGitRepo: isGitRepo(p),
      }))
      return { directories }
    })

    return handlers
      .handle("spaces", spaces)
      .handle("spaceOverview", spaceOverview)
      .handle("nonSpaceOverview", nonSpaceOverview)
      .handle("searchDirectories", searchDirectories)
      .handle("recentDirectories", recentDirectories)
  }),
)

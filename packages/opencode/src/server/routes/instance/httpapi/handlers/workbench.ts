import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { InvalidRequestError } from "../errors"
import { SessionProvisioner } from "@/workbench/session-provisioner"
import { SessionProjection } from "@/workbench/session-projection"
import { SessionDirectoryHealth } from "@/workbench/session-directory-health"

export const workbenchHandlers = HttpApiBuilder.group(RootHttpApi, "workbench", (handlers) =>
  Effect.gen(function* () {
    const provisioner = yield* SessionProvisioner.Service
    const projection = yield* SessionProjection.Service
    const health = yield* SessionDirectoryHealth.Service

    const createSession = Effect.fn("WorkbenchHttpApi.createSession")(function* (ctx: {
      payload: {
        target: { type: "general" } | { type: "space"; space: string; directory?: string }
        title?: string
        agent?: string
      }
    }) {
      const { target, title, agent } = ctx.payload

      if (target.type === "general") {
        const result = yield* provisioner.provisionGeneral({ title, agent }).pipe(
          Effect.catch((cause) =>
            Effect.fail(
              new InvalidRequestError({
                message: "Failed to provision general session",
                kind: String(cause),
              }),
            ),
          ),
        )
        const dirHealth = yield* health.check(result.directory)
        return {
          id: result.id,
          title: result.title,
          directory: result.directory,
          directoryHealth: dirHealth,
          agent,
          timeCreated: Date.now(),
          timeUpdated: Date.now(),
        }
      }

      // target.type === "space"
      const result = yield* provisioner
        .provisionSpace({
          spaceName: target.space,
          relativeDirectory: target.directory,
          title,
          agent,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.fail(
              new InvalidRequestError({
                message: "Failed to provision space session",
                kind: String(cause),
              }),
            ),
          ),
        )
      const dirHealth = yield* health.check(result.directory)
      return {
        id: result.id,
        title: result.title,
        directory: result.directory,
        directoryHealth: dirHealth,
        agent,
        timeCreated: Date.now(),
        timeUpdated: Date.now(),
      }
    })

    const sessionGroups = Effect.fn("WorkbenchHttpApi.sessionGroups")(function* () {
      const groups = yield* projection.getSessionGroups()
      const enriched = yield* Effect.all(
        groups.map((group) =>
          Effect.gen(function* () {
            const sessions = yield* Effect.all(
              group.sessions.map((s) =>
                Effect.gen(function* () {
                  const dirHealth = yield* health.check(s.directory)
                  return {
                    id: s.id,
                    title: s.title,
                    directory: s.directory,
                    directoryHealth: dirHealth,
                    agent: s.agent,
                    timeCreated: s.timeCreated,
                    timeUpdated: s.timeUpdated,
                  }
                }),
              ),
            )
            return {
              id: group.id,
              title: group.title,
              type: group.type,
              sessionCount: sessions.length,
              sessions,
            }
          }),
        ),
      )
      return { groups: enriched }
    })

    return handlers.handle("createSession", createSession).handle("sessionGroups", sessionGroups)
  }),
)
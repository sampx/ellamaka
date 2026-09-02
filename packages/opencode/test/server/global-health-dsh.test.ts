import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { ServerAuth } from "../../src/server/auth"
import { CliContract } from "../../src/wopal/cli-contract"
import { SpaceRegistry } from "../../src/wopal/space-registry"
import { SessionProjection } from "../../src/workbench/session-projection"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { wopalSpaceHandlers } from "../../src/server/routes/instance/httpapi/handlers/wopal-space"
import { workbenchHandlers } from "../../src/server/routes/instance/httpapi/handlers/workbench"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, globalHandlers, wopalSpaceHandlers, workbenchHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.layer({ password: Option.none(), username: "opencode" })),
  Layer.provide(CliContract.defaultLayer),
  Layer.provide(SpaceRegistry.defaultLayer),
  Layer.provide(SessionProjection.defaultLayer),
  Layer.provide(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
)
const it = testEffect(apiLayer)

describe("global health dsh field", () => {
  it.live("reports dsh enabled by default", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(GlobalPaths.health)
      expect(response.status).toBe(200)
      const body = (yield* response.json) as { dsh?: boolean }
      expect(body.dsh).toBe(true)
    }),
  )

  it.live("reports dsh disabled when ELLAMAKA_DSH=0", () =>
    Effect.gen(function* () {
      const previous = process.env.ELLAMAKA_DSH
      process.env.ELLAMAKA_DSH = "0"
      const response = yield* HttpClient.get(GlobalPaths.health).pipe(
        Effect.ensuring(Effect.sync(() => {
          if (previous === undefined) delete process.env.ELLAMAKA_DSH
          else process.env.ELLAMAKA_DSH = previous
        })),
      )
      expect(response.status).toBe(200)
      const body = (yield* response.json) as { dsh?: boolean }
      expect(body.dsh).toBe(false)
    }),
  )
})

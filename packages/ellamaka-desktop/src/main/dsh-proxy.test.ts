import { describe, expect, test } from "bun:test"
import { createDshProxy } from "./dsh-proxy"

describe("createDshProxy", () => {
  test("forwards the launch-token exchange and reuses its cookie", async () => {
    const requests: Array<{ url: string; headers: Headers }> = []
    const proxy = createDshProxy(async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) })
      if (requests.length === 1) {
        return new Response(null, {
          status: 303,
          headers: {
            location: "/dsh/",
            "set-cookie": "dsh_session=authenticated; HttpOnly; SameSite=Strict",
          },
        })
      }
      return new Response("ok")
    })
    proxy.setTarget("http://127.0.0.1:4097")

    const exchange = await proxy.handle(new Request("oc://renderer/dsh/?token=launch-token"))
    const authenticated = await proxy.handle(new Request("oc://renderer/dsh/api/session"))

    expect(exchange?.status).toBe(303)
    expect(exchange?.headers.get("location")).toBe("/dsh/")
    expect(exchange?.headers.get("set-cookie")).toBeNull()
    expect(await authenticated?.text()).toBe("ok")
    expect(requests).toHaveLength(2)
    expect(requests[0]?.url).toBe("http://127.0.0.1:4097/dsh/?token=launch-token")
    expect(requests[0]?.headers.get("origin")).toBe("http://127.0.0.1:4097")
    expect(requests[1]?.headers.get("cookie")).toBe("dsh_session=authenticated")
  })

  test("does not claim non-DSH routes or requests without a target", async () => {
    const proxy = createDshProxy(async () => new Response("unexpected"))

    expect(await proxy.handle(new Request("oc://renderer/index.html"))).toBeUndefined()
    expect(await proxy.handle(new Request("oc://renderer/dsh/"))).toBeUndefined()
  })
})

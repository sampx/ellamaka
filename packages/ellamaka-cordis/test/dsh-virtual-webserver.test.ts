import { describe, expect, test } from "bun:test"
import { Context } from "@deepseek-ai/cordis"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { once } from "node:events"
import { connect } from "node:net"
import { Duplex } from "node:stream"
import { VirtualWebServer, type VirtualWebServerOptions } from "../src/dsh-virtual-webserver"

/** A minimal cordis context with an emit/on pair for index-inject. */
function makeCtx() {
  return new Context()
}

function makeServer() {
  const server = createServer()
  return server
}

async function listen(server: Server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return { port, baseUrl: `http://127.0.0.1:${port}` }
}

async function get(baseUrl: string, path: string) {
  const res = await fetch(baseUrl + path)
  return { status: res.status, body: await res.text() }
}

/** Run a browser script in an isolated VM with fake fetch/WebSocket/EventSource. */
function runInIsolatedVm(script: string, calls: { fetch: unknown[]; ws: unknown[]; es: unknown[] }) {
  const sandbox = {
    fetch: (...args: unknown[]) => {
      calls.fetch.push(args)
      return Promise.resolve({ ok: true })
    },
    WebSocket: class {
      constructor(...args: unknown[]) {
        calls.ws.push(args)
      }
    },
    EventSource: class {
      constructor(...args: unknown[]) {
        calls.es.push(args)
      }
    },
    console,
  }
  const vm = require("node:vm")
  vm.runInNewContext(script, sandbox)
  return sandbox
}

describe("VirtualWebServer route matching", () => {
  test("exact wins over prefix; longest prefix wins among prefixes", async () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const server = makeServer()
    const { baseUrl } = await listen(server)
    vws.attach(server)

    const seen: string[] = []
    vws.register({ kind: "exact", path: "/api/x", handler: (req, res) => { seen.push("exact"); res.writeHead(200); res.end("exact") } })
    vws.register({ kind: "prefix", path: "/api", handler: (req, res) => { seen.push("prefix-api"); res.writeHead(200); res.end("prefix-api") } })
    vws.register({ kind: "prefix", path: "/api/x", handler: (req, res) => { seen.push("prefix-x"); res.writeHead(200); res.end("prefix-x") } })

    expect((await get(baseUrl, "/api/x")).body).toBe("exact")
    expect((await get(baseUrl, "/api/y")).body).toBe("prefix-api")
    expect((await get(baseUrl, "/api/x/y")).body).toBe("prefix-x")

    server.close()
  })

  test("no route falls back; no fallback returns 404", async () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const server = makeServer()
    const { baseUrl } = await listen(server)
    vws.attach(server)

    expect((await get(baseUrl, "/nope")).status).toBe(404)

    vws.registerFallback((req, res) => { res.writeHead(200); res.end("fallback") })
    expect((await get(baseUrl, "/nope")).body).toBe("fallback")

    server.close()
  })

  test("duplicate route/upgrade/fallback throws like the official WebServer", () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    vws.register({ kind: "exact", path: "/a", handler: () => {} })
    expect(() => vws.register({ kind: "exact", path: "/a", handler: () => {} })).toThrow(/duplicate exact route/)
    vws.registerUpgrade({ path: "/up", handler: () => {} })
    expect(() => vws.registerUpgrade({ path: "/up", handler: () => {} })).toThrow(/duplicate upgrade route/)
    vws.registerFallback(() => {})
    expect(() => vws.registerFallback(() => {})).toThrow(/fallback already registered/)
  })
})

describe("VirtualWebServer index taps", () => {
  test("applyIndexTaps runs taps in registration order; dispose removes one", () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const disposeA = vws.tapIndex((html) => html + "A")
    vws.tapIndex((html) => html + "B")
    expect(vws.applyIndexTaps("x")).toBe("xAB")
    disposeA()
    expect(vws.applyIndexTaps("x")).toBe("xB")
  })

  test("renderIndex renders index-inject rows first, then raw taps; __DSH_BOOT__ preserved", () => {
    const ctx = makeCtx()
    ctx.on("webserver/index-inject", (table: unknown[]) => {
      table.push({ kind: "script", placement: "head", text: "window.__DSH_BOOT__ = {x:1}" })
    })
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    vws.tapIndex((html) => html + "<!--tap-->")
    const html = "<html><head></head><body></body></html>"
    const out = vws.renderIndex(html)
    expect(out).toContain("window.__DSH_BOOT__")
    expect(out).toContain("<!--tap-->")
    // injection lands before the tap
    expect(out.indexOf("__DSH_BOOT__")).toBeLessThan(out.indexOf("<!--tap-->"))
  })
})

describe("VirtualWebServer index static rewrite", () => {
  test("rewrites /assets, /favicon.svg, /plugins to /dsh and removes manifest link", () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const html = `<!doctype html><html><head>
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/favicon.svg" />
      <script type="module" src="/assets/index.js"></script>
      <link rel="stylesheet" href="/assets/index.css">
    </head><body></body></html>`
    const out = vws.rewriteIndex(html)
    expect(out).not.toContain("manifest.webmanifest")
    expect(out).toContain('href="/dsh/favicon.svg"')
    expect(out).toContain('src="/dsh/assets/index.js"')
    expect(out).toContain('href="/dsh/assets/index.css"')
  })
})

describe("VirtualWebServer iframe prefix adaptation", () => {
  test("fetch /api/x -> /dsh/api/x; WebSocket /api/events.mux -> /dsh/api/events.mux; EventSource /plugins/events -> /dsh/plugins/events", () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const calls = { fetch: [], ws: [], es: [] }
    const script = vws.iframeAdapterScript()
    runInIsolatedVm(script, calls)
    // The adapter installs wrappers; drive them by evaluating the wrapped calls.
    const sandbox = runInIsolatedVm(
      script +
        `;fetch("/api/x"); new WebSocket("/api/events.mux"); new EventSource("/plugins/events");`,
      calls,
    )
    expect(calls.fetch[0][0]).toBe("/dsh/api/x")
    expect(calls.ws[0][0]).toBe("/dsh/api/events.mux")
    expect(calls.es[0][0]).toBe("/dsh/plugins/events")
  })

  test("external URLs and existing /dsh URLs stay unchanged", () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const calls = { fetch: [], ws: [], es: [] }
    const script = vws.iframeAdapterScript()
    runInIsolatedVm(
      script +
        `;fetch("https://example.com/x"); fetch("/dsh/api/y"); new WebSocket("wss://example.com/ws"); new EventSource("/dsh/plugins/events");`,
      calls,
    )
    expect(calls.fetch[0][0]).toBe("https://example.com/x")
    expect(calls.fetch[1][0]).toBe("/dsh/api/y")
    expect(calls.ws[0][0]).toBe("wss://example.com/ws")
    expect(calls.es[0][0]).toBe("/dsh/plugins/events")
  })
})

describe("VirtualWebServer upgrade socket cleanup", () => {
  test("host dispose closes sockets dispatched through the virtual webserver", async () => {
    const ctx = makeCtx()
    const vws = new VirtualWebServer(ctx, { host: "127.0.0.1", port: 0 })
    const server = makeServer()
    const { port } = await listen(server)
    vws.attach(server)

    let socketClosed = false
    vws.registerUpgrade({
      path: "/api/events.mux",
      handler: (req, socket) => {
        socket.once("close", () => { socketClosed = true })
      },
    })

    const socket = connect(port, "127.0.0.1")
    socket.write(
      "GET /api/events.mux HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "\r\n",
    )
    await once(socket, "connect")
    // Give the upgrade dispatch a tick to register the socket.
    await new Promise((r) => setTimeout(r, 20))

    vws.dispose()
    await once(socket, "close")
    expect(socketClosed).toBe(true)

    server.close()
  })
})

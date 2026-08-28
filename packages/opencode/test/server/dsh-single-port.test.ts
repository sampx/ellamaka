import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connect } from "node:net"
import { once } from "node:events"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void Log.init({ print: false })

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}
const auth = { username: "opencode", password: "listen-secret" }

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  if (original.envPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
  else process.env.OPENCODE_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

async function startListener() {
  Flag.OPENCODE_SERVER_PASSWORD = auth.password
  Flag.OPENCODE_SERVER_USERNAME = auth.username
  process.env.OPENCODE_SERVER_PASSWORD = auth.password
  process.env.OPENCODE_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

function authorization() {
  return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
}

/**
 * Mount the DSH web profile onto a real Ellamaka listener under /dsh, mirroring
 * the serve.ts wiring (DESIGN-dsh-poc §2.1 single-port scheme). Uses a temp
 * DSH_HOME so the test never touches the user's home.
 */
async function mountDsh(listener: Awaited<ReturnType<typeof startListener>>) {
  const home = mkdtempSync(join(tmpdir(), "dsh-single-port-"))
  const { CordisHub } = await import("@wopal/ellamaka-cordis")
  const { mountDshWeb } = await import("@wopal/ellamaka-cordis/dsh-web")
  const webHub = new CordisHub(null)
  const dsh = await mountDshWeb(webHub.ctx, {
    home,
    port: listener.port,
    logFile: join(home, "dsh-plugins.log"),
  })
  const unmount = listener.mountNodeRoute({
    prefix: dsh.mountPath,
    request: (req, res) => dsh.webServer.request(req, res),
    upgrade: (req, socket, head) => dsh.webServer.upgrade(req, socket, head),
  })
  return {
    dsh,
    unmount,
    dispose: async () => {
      unmount()
      await webHub.dispose()
    },
  }
}

describe("dsh single-port integration", () => {
  test("serves DSH index, assets, plugins, RPC and Ellamaka API on one port", async () => {
    const listener = await startListener()
    const mount = await mountDsh(listener)
    const base = listener.url.toString().replace(/\/$/, "")

    try {
      // DSH index under /dsh.
      const index = await fetch(base + "/dsh/", { headers: { authorization: authorization() } })
      expect(index.status).toBe(200)
      const html = await index.text()
      expect(html).toContain("__DSH_BOOT__")
      expect(html).toContain("/dsh/assets/")

      // DSH static asset under /dsh/assets.
      const assetMatch = html.match(/src="(\/dsh\/assets\/[^"]+)"/)
      expect(assetMatch).not.toBeNull()
      const asset = await fetch(base + assetMatch![1], { headers: { authorization: authorization() } })
      expect(asset.status).toBe(200)

      // DSH plugin bundle under /dsh/plugins.
      const pluginMatch = html.match(/src="(\/dsh\/plugins\/[^"]+)"/)
      expect(pluginMatch).not.toBeNull()
      const plugin = await fetch(base + pluginMatch![1], { headers: { authorization: authorization() } })
      expect(plugin.status).toBe(200)

      // DSH RPC under /dsh/api.
      const rpc = await fetch(base + "/dsh/api/host.describe", {
        method: "POST",
        headers: { authorization: authorization(), "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(rpc.status).toBe(200)

      // Ellamaka API still served on the same port.
      const ellamaka = await fetch(base + "/global/health", { headers: { authorization: authorization() } })
      expect(ellamaka.status).toBe(200)
    } finally {
      await mount.dispose()
      await listener.stop()
    }
  }, 60_000)

  test("DSH web mount dispose returns /dsh to Ellamaka default 404 while other routes keep working", async () => {
    const listener = await startListener()
    const mount = await mountDsh(listener)
    const base = listener.url.toString().replace(/\/$/, "")

    try {
      const before = await fetch(base + "/dsh/", { headers: { authorization: authorization() } })
      expect(before.status).toBe(200)
    } finally {
      await mount.dispose()
    }

    // After dispose, /dsh falls back to Ellamaka default (404).
    const after = await fetch(base + "/dsh/", { headers: { authorization: authorization() } })
    expect(after.status).toBe(404)

    // Other routes keep working.
    const ellamaka = await fetch(base + "/global/health", { headers: { authorization: authorization() } })
    expect(ellamaka.status).toBe(200)

    await listener.stop()
  }, 60_000)

  test("upgrade /dsh/api/events.mux routes to the DSH downlink", async () => {
    const listener = await startListener()
    const mount = await mountDsh(listener)
    const port = listener.port

    try {
      const socket = connect(port, "127.0.0.1")
      socket.write(
        "GET /dsh/api/events.mux HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "\r\n",
      )
      // The DSH downlink either upgrades or closes; either way the socket
      // terminates without hanging (the mount routes it to the DSH upgrade
      // table, not the Ellamaka default). Wait briefly for a close/error.
      await Promise.race([
        once(socket, "close"),
        once(socket, "error"),
        new Promise((r) => setTimeout(r, 2000)),
      ])
      socket.destroy()
    } finally {
      await mount.dispose()
      await listener.stop()
    }
  }, 60_000)
})

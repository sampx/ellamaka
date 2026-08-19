import { readFileSync, existsSync, statSync } from "node:fs"
import { join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

const DSH_BACKEND = "http://127.0.0.1:3080"
const distDir = fileURLToPath(new URL("./dsh-web/dist", import.meta.url))

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
}

/**
 * Fetch the dsh backend's served index.html and extract the injected
 * `window.__DSH_BOOT__` script (the boot manifest the dsh shell kernel
 * parses). The manifest is dynamic (per-boot revs), so it is fetched live
 * on every /dsh request.
 */
async function fetchBootScript(): Promise<string> {
  const upstream = await fetch(`${DSH_BACKEND}/`)
  if (!upstream.ok) throw new Error(`dsh backend unavailable: HTTP ${upstream.status}`)
  const html = await upstream.text()
  const match = html.match(/<script>window\.__DSH_BOOT__ = (.*?)<\/script>/s)
  if (match === null) throw new Error("dsh backend response missing __DSH_BOOT__")
  return `<script>window.__DSH_BOOT__ = ${match[1]}</script>`
}

/**
 * Vite integration for the dsh web shell:
 * - `/dsh` serves the locally built dsh shell dist with the live
 *   `__DSH_BOOT__` manifest injected (fetched from the dsh backend).
 * - `/dsh/assets/*` serves the shell dist assets.
 * - `/api` and `/plugins` proxy to the dsh backend (configured in
 *   vite.config.ts server.proxy).
 */
export function dshWebIntegration(): Plugin {
  return {
    name: "ellamaka:dsh-web-integration",
    configureServer(server) {
      const handler = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
        const url = req.url ?? "/"
        if (url === "/dsh" || url === "/dsh/") {
          try {
            const boot = await fetchBootScript()
            const index = readFileSync(join(distDir, "index.html"), "utf8")
            const injected = index.replace("</head>", `${boot}</head>`)
            res.setHeader("content-type", MIME[".html"])
            res.end(injected)
          } catch (error) {
            res.statusCode = 503
            res.setHeader("content-type", "text/plain")
            res.end(`dsh backend unavailable: ${error instanceof Error ? error.message : String(error)}`)
          }
          return
        }
        if (url.startsWith("/dsh/assets/")) {
          const rel = normalize(url.slice("/dsh/".length))
          const file = join(distDir, rel)
          if (!file.startsWith(distDir) || !existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404
            res.end()
            return
          }
          const ext = file.slice(file.lastIndexOf("."))
          res.setHeader("content-type", MIME[ext] ?? "application/octet-stream")
          res.end(readFileSync(file))
          return
        }
        next()
      }
      // Insert before vite's internal middlewares (SPA fallback would
      // otherwise swallow /dsh into the ellamaka index.html).
      server.middlewares.stack.unshift({ route: "", handle: handler } as never)
    },
  }
}

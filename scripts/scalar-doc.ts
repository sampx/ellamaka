#!/usr/bin/env bun

/**
 * API Reference — Scalar UI with full proxy
 *
 * Serves Scalar UI on a separate port, proxies all API requests to ellamaka.
 * This enables "Try it out" debugging with correct server URL.
 *
 * Usage:
 *   bun run scripts/scalar-doc.ts          → http://localhost:4100
 *   SCALAR_PORT=8080 bun run scripts/scalar-doc.ts
 *   SCALAR_API=http://127.0.0.1:3000 bun run scripts/scalar-doc.ts
 */

import { serve } from "bun"

const PORT = Number(process.env.SCALAR_PORT) || 4100
const API_SERVER = process.env.SCALAR_API || "http://127.0.0.1:4097"
const STATIC_SPEC = import.meta.dir + "/../packages/sdk/openapi.json"
const SPEC_PATH = "/api/doc.json"

const HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ellamaka API Reference</title>
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '${SPEC_PATH}',
        'servers': [{'url': '${API_SERVER}', 'description': 'ellamaka dev'}]
      })
    </script>
  </body>
</html>`


serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const { pathname, search } = url

    // UI
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    }

    // OpenAPI spec
    if (pathname === SPEC_PATH) {
      const file = Bun.file(STATIC_SPEC)
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
          },
        })
      }
      return new Response("Spec not found", { status: 404 })
    }

    // Proxy all other requests to ellamaka
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "*",
        },
      })
    }

    const targetUrl = API_SERVER + pathname + search
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    })
    const body = await resp.arrayBuffer()
    return new Response(body, {
      status: resp.status,
      headers: {
        "content-type": resp.headers.get("content-type") || "application/octet-stream",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "*",
      },
    })
  },
})

console.log(`
  ellamaka API Reference (Scalar)
  ─────────────────────────────────────
  UI:         http://localhost:${PORT}
  API Server: ${API_SERVER}
  ─────────────────────────────────────
  Override: SCALAR_PORT=8080 SCALAR_API=http://host:port bun run scripts/scalar-doc.ts
`)
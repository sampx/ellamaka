import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/**
 * Vite config for the dsh web shell, mirroring dsh's official apps/web build.
 *
 * The shell-related client packages are compiled from SOURCE (vendored under
 * vendor-dsh/), not from their pre-bundled npm libs. This is the critical
 * browserization difference: when the Loader's `process`/`node:module`
 * references are compiled by vite, the `define`/alias mappings below reach
 * them; the tsdown-bundled npm lib already resolved those probes at package
 * build time, so vite's mappings never touched them and the Loader's
 * `fromInternal()` returned an empty slot → `Cannot read ... 'load'`.
 *
 * Browserization of the vendored cordis Loader:
 * - `node:module` maps to a throwing stub (createRequire is unreachable in
 *   the browser boot path).
 * - `process.versions.node` → `"0.0.0"`: fromInternal() probes the Node major
 *   — "0.0.0" takes neither branch, returning undefined (exactly the empty
 *   internal slot the shell boot fills with the client module loader).
 * - `process.execArgv` → `[]` and `process.env.CORDIS_SHARED` → `undefined`
 *   let the Loader's env branches take their browser defaults.
 */
export default defineConfig({
  plugins: [react()],
  root: src("."),
  base: "/dsh/",
  build: {
    outDir: src("./dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    // Order matters — subpath aliases must win over bare-name prefixes.
    alias: [
      { find: /^node:module$/, replacement: src("./src/node-module-stub.ts") },
      { find: /^@deepseek-ai\/dsh-client-web$/, replacement: src("./vendor-dsh/packages/client/web/src/boot.tsx") },
      { find: /^@deepseek-ai\/dsh-client-modules\/client$/, replacement: src("./vendor-dsh/packages/client/modules/src/client/index.ts") },
    ],
  },
  define: {
    "process.versions.node": '"0.0.0"',
    "process.execArgv": "[]",
    "process.env.CORDIS_SHARED": "undefined",
  },
})

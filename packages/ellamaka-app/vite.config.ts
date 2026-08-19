import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import { dshWebIntegration } from "./dsh-web-integration"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, dshWebIntegration(), sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      "/api": {
        // changeOrigin MUST stay false: the dsh backend's /api browser-trust
        // fence (api-request-trust) compares Origin.host against Host.host.
        // Rewriting Host to the 127.0.0.1:3080 target while Origin stays
        // localhost:3000 mismatches them and 403s every RPC call. Keeping the
        // original Host (loopback) makes the pair match.
        target: "http://127.0.0.1:3080",
        changeOrigin: false,
        ws: true,
      },
      "/plugins": {
        target: "http://127.0.0.1:3080",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})

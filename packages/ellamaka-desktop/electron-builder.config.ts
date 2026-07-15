import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "main" || raw === "beta" || raw === "prod") return raw
  return "main"
})()

const getBase = (): Configuration => ({
  artifactName: "ellamaka-desktop-${os}-${arch}.${ext}",
  copyright: "Copyright © 2025 Ellamaka",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icons/icon.icns",
    hardenedRuntime: false,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: false,
    target: ["dmg", "zip"],
    artifactName: "ellamaka-desktop-${os}-${arch}.${ext}",
  },
  dmg: {
    sign: false,
  },
  protocols: {
    name: "Ellamaka",
    schemes: ["ellamaka"],
  },
  win: {
    icon: "resources/icons/icon.ico",
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: "resources/icons/icon.ico",
    installerHeaderIcon: "resources/icons/icon.ico",
  },
  linux: {
    icon: "resources/icons",
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
    artifactName: "ellamaka-desktop-${os}-${arch}.${ext}",
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "main": {
      return {
        ...base,
        appId: "ai.ellamaka.desktop.main",
        productName: "Ellamaka Main",
        rpm: { packageName: "ellamaka-main" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.ellamaka.desktop.beta",
        productName: "Ellamaka Beta",
        protocols: { name: "Ellamaka Beta", schemes: ["ellamaka"] },
        rpm: { packageName: "ellamaka-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.ellamaka.desktop",
        productName: "Ellamaka",
        protocols: { name: "Ellamaka", schemes: ["ellamaka"] },
        rpm: { packageName: "ellamaka" },
      }
    }
  }
}

export default getConfig()

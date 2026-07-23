import type { Configuration } from "electron-builder"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "main" || raw === "beta" || raw === "prod") return raw
  return "main"
})()
const version = process.env.OPENCODE_VERSION?.trim()
const build = process.env.OPENCODE_BUILD_ID?.trim()

function getPublishUrl(): string | undefined {
  if (channel === "beta") return "https://download.coursedao.com/ellamaka-desktop/beta/latest"
  if (channel === "prod") return "https://download.coursedao.com/ellamaka-desktop/latest"
  return undefined
}

const packageName = (() => {
  if (channel === "beta") return "ellamaka-beta"
  if (channel === "main") return "ellamaka-main"
  return "ellamaka"
})()

const getBase = (): Configuration => ({
  artifactName: "ellamaka-desktop-${os}-${arch}.${ext}",
  copyright: "Copyright © 2025 Ellamaka",
  extraMetadata: {
    name: packageName,
    ...(version ? { version } : {}),
    ...(build ? { ellamakaBuild: build } : {}),
  },
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
    identity: "-",
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
    executableName: "ellamaka",
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
    executableName: "ellamaka",
  },
})

function getConfig(): Configuration {
  const base = getBase()
  const publishUrl = getPublishUrl()
  const publish = publishUrl ? { provider: "generic" as const, url: publishUrl, channel: "latest" } : undefined

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
        publish,
        protocols: { name: "Ellamaka Beta", schemes: ["ellamaka"] },
        rpm: { packageName: "ellamaka-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.ellamaka.desktop",
        productName: "Ellamaka",
        publish,
        protocols: { name: "Ellamaka", schemes: ["ellamaka"] },
        rpm: { packageName: "ellamaka" },
      }
    }
  }
  throw new Error("Unsupported desktop channel")
}

export default getConfig()

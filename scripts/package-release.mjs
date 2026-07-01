#!/usr/bin/env node

import { createHash } from "crypto"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function fileSize(filePath) {
  return fs.statSync(filePath).size
}

function toCamel(flag) {
  return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function parseArgs(argv) {
  const args = argv.slice(2)
  const subcommand = args[0]
  if (subcommand !== "manifest") {
    throw new Error("Usage: package-release.mjs manifest [options]")
  }

  const flags = {}
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue
    const key = toCamel(args[i].slice(2))
    if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[key] = args[++i]
      continue
    }
    flags[key] = true
  }

  const required = ["archivesDir", "version", "outputDir", "tag"]
  for (const key of required) {
    if (!flags[key]) throw new Error(`Missing required flag: --${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`)
  }

  return {
    subcommand,
    flags: {
      archivesDir: flags.archivesDir,
      version: flags.version,
      outputDir: flags.outputDir,
      tag: flags.tag,
      baseUrl: flags.baseUrl || "https://download.coursedao.com/ellamaka",
    },
  }
}

export function parseArchiveName(filename) {
  // Matches: ellamaka-<os>-<arch>[-baseline].<ext>
  // Examples:
  //   ellamaka-darwin-arm64.tar.gz       → os=darwin, arch=arm64, variant=null
  //   ellamaka-linux-x64-baseline.tar.gz → os=linux, arch=x64, variant=baseline
  const match = filename.match(
    /^ellamaka-([^-]+)-(arm64|x64)(?:-(baseline))?\.(tar\.gz|zip)$/,
  )
  if (!match) throw new Error(`Cannot parse archive name: ${filename}`)
  return {
    os: match[1],
    arch: match[2],
    variant: match[3] ?? null,
    ext: match[4],
  }
}

function osLabel(os) {
  if (os === "darwin") return "macOS"
  if (os === "linux") return "Linux"
  if (os === "windows") return "Windows"
  return os
}

function archLabel(arch) {
  if (arch === "arm64") return "ARM64"
  if (arch === "x64") return "x64"
  return arch
}

export function buildReleaseNotes(version, artifacts, manifestUrl, checksumsUrl) {
  const lines = [
    "## Downloads",
    "",
    "| OS | Arch | Download |",
    "| --- | --- | --- |",
    ...artifacts.map((artifact) => `| ${osLabel(artifact.os)} | ${archLabel(artifact.arch)} | [${artifact.name}](${artifact.url}) |`),
    "",
    "## Verification",
    "",
    `- Manifest: ${manifestUrl}`,
    `- Checksums: ${checksumsUrl}`,
    "",
  ]

  return lines.join("\n")
}

export function manifestCommand(flags) {
  const archivesDir = path.resolve(projectRoot, flags.archivesDir)
  const outputDir = path.resolve(projectRoot, flags.outputDir)
  const baseUrl = flags.baseUrl || "https://download.coursedao.com/ellamaka"

  if (!fs.existsSync(archivesDir)) throw new Error(`Archives directory not found: ${archivesDir}`)

  const files = fs
    .readdirSync(archivesDir)
    .filter((file) => file.startsWith("ellamaka-") && (file.endsWith(".tar.gz") || file.endsWith(".zip")))
    .sort()

  if (files.length === 0) throw new Error("No archive files found matching ellamaka-*-*.tar.gz or ellamaka-*-*.zip")

  const versionBaseUrl = `${baseUrl}/${flags.tag}`
  const manifestUrl = `${versionBaseUrl}/manifest.json`
  const checksumsUrl = `${versionBaseUrl}/checksums.txt`
  const artifacts = files.map((file) => {
    const filePath = path.join(archivesDir, file)
    const parsed = parseArchiveName(file)
    return {
      name: file,
      os: parsed.os,
      arch: parsed.arch,
      variant: parsed.variant,
      url: `${versionBaseUrl}/${file}`,
      sha256: sha256(filePath),
      size: fileSize(filePath),
    }
  })

  const manifest = {
    version: flags.version,
    artifacts,
    checksumsUrl,
  }
  const checksumLines = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`)

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  fs.writeFileSync(path.join(outputDir, "checksums.txt"), checksumLines.join("\n") + "\n")
  fs.writeFileSync(path.join(outputDir, "release-notes.md"), buildReleaseNotes(flags.version, artifacts, manifestUrl, checksumsUrl))

  console.log(`Generated: ${path.join(outputDir, "manifest.json")}`)
  console.log(`Generated: ${path.join(outputDir, "checksums.txt")}`)
  console.log(`Generated: ${path.join(outputDir, "release-notes.md")}`)
  console.log(`Artifacts: ${artifacts.length}`)

  return { manifest, artifacts }
}

function main() {
  const parsed = parseArgs(process.argv)
  manifestCommand(parsed.flags)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  try {
    main()
  } catch (err) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

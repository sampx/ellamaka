#!/usr/bin/env node

import fs from "fs"
import path from "path"

function toCamel(flag) {
  return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function parseArgs(argv) {
  const flags = {}
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue
    const key = toCamel(argv[i].slice(2))
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags[key] = argv[++i]
      continue
    }
    flags[key] = true
  }

  const required = ["version", "repo", "tag", "notesFile"]
  for (const key of required) {
    if (!flags[key]) throw new Error(`Missing required flag: --${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`)
  }

  return {
    version: flags.version,
    repo: flags.repo,
    tag: flags.tag,
    notesFile: flags.notesFile,
    productName: flags.productName || "ellamaka",
    baseUrl: flags.baseUrl || "https://gitee.com/api/v5",
  }
}

export function parseRepo(repo) {
  const parts = repo.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`Invalid --repo format: ${repo}. Expected owner/repo`)
  return { owner: parts[0], repo: parts[1] }
}

export function buildCreateBody({ version, tag, notesContent, token, productName = "ellamaka" }) {
  return {
    tag_name: tag,
    name: `${productName} v${version}`,
    body: notesContent,
    target_commitish: "main",
    prerelease: false,
    access_token: token,
  }
}

export function buildUpdateBody({ version, tag, notesContent, token, productName = "ellamaka" }) {
  return {
    tag_name: tag,
    name: `${productName} v${version}`,
    body: notesContent,
    access_token: token,
  }
}

async function readJson(resp, context) {
  const text = await resp.text()
  if (!resp.ok) throw new Error(`${context} failed: HTTP ${resp.status} — ${text}`)
  if (!text) return null
  return JSON.parse(text)
}

export async function createOrGetRelease({ fetch, baseUrl, owner, repo, tag, version, notesContent, token, productName = "ellamaka" }) {
  const tagUrl = `${baseUrl}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}?access_token=${encodeURIComponent(token)}`
  const tagResp = await fetch(tagUrl, { method: "GET" })
  const tagBody = tagResp.status === 404 ? null : await readJson(tagResp, "lookup release by tag")

  if (tagBody && typeof tagBody === "object" && tagBody.id) {
    // Delete and recreate so created_at reflects the current release date.
    // PATCH preserves the original created_at, which keeps the release from
    // appearing as "latest" on the Gitee homepage.
    const deleteUrl = `${baseUrl}/repos/${owner}/${repo}/releases/${tagBody.id}?access_token=${encodeURIComponent(token)}`
    const deleteResp = await fetch(deleteUrl, { method: "DELETE" })
    if (deleteResp.status !== 204) {
      const text = await deleteResp.text()
      throw new Error(`delete release failed: HTTP ${deleteResp.status} — ${text}`)
    }
  }

  const createUrl = `${baseUrl}/repos/${owner}/${repo}/releases`
  const createResp = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCreateBody({ version, tag, notesContent, token, productName })),
  })
  const created = await readJson(createResp, "create release")
  if (!created || !created.id) throw new Error(`Create returned no id: ${JSON.stringify(created)}`)
  return { id: created.id, created: true }
}

async function main() {
  const flags = parseArgs(process.argv)
  const { owner, repo } = parseRepo(flags.repo)
  const token = process.env.GITEE_TOKEN

  if (!token) throw new Error("GITEE_TOKEN environment variable is required")

  const notesPath = path.resolve(flags.notesFile)
  if (!fs.existsSync(notesPath)) throw new Error(`Notes file not found: ${notesPath}`)

  const notesContent = fs.readFileSync(notesPath, "utf8").trim()
  console.log(`Gitee release: ${owner}/${repo} tag=${flags.tag}`)
  console.log(`Notes size: ${notesContent.length} bytes`)

  const result = await createOrGetRelease({
    fetch: globalThis.fetch.bind(globalThis),
    baseUrl: flags.baseUrl,
    owner,
    repo,
    tag: flags.tag,
    version: flags.version,
    notesContent,
    token,
    productName: flags.productName,
  })

  console.log(result.created ? `Created release id=${result.id}` : `Updated release id=${result.id}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
}

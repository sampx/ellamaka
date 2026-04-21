import fs from "fs/promises"
import path from "path"
import os from "os"
import { Filesystem } from "../util"
import { Flock } from "@opencode-ai/shared/util/flock"

const root = process.env.WOPAL_HOME || path.join(os.homedir(), ".wopal")

const data = path.join(root, "ellamaka", "data")
const cache = path.join(root, "ellamaka", "cache")
const config = path.join(root, "ellamaka", "config")
const state = path.join(root, "ellamaka", "state")

export const Path = {
  // Allow override via OPENCODE_TEST_HOME for test isolation
  get home() {
    return process.env.OPENCODE_TEST_HOME || os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  cache,
  config,
  state,
}

// Initialize Flock with global state path
Flock.setGlobal({ state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch {}
  await Filesystem.write(path.join(Path.cache, "version"), CACHE_VERSION)
}

export * as Global from "."

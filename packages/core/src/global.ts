import path from "path"
import fs from "fs/promises"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"

// WOPAL_HOME: ellamaka customization — use ~/.wopal/ellamaka/* paths
// tilde is a shell construct — Node.js does not expand it, resolve manually
const wopalHomeRaw = process.env.WOPAL_HOME || path.join(os.homedir(), ".wopal")
const wopalRoot = wopalHomeRaw.startsWith("~/")
  ? path.join(os.homedir(), wopalHomeRaw.slice(2))
  : wopalHomeRaw
const data = path.join(wopalRoot, "ellamaka", "data")
const cache = path.join(wopalRoot, "ellamaka", "cache")
const config = path.join(wopalRoot, "ellamaka", "config")
const state = path.join(wopalRoot, "ellamaka", "state")

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  cache,
  config,
  state,
}

export const Path = paths

Flock.setGlobal({ state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"
const cacheVersionPath = path.join(Path.cache, "version")
const currentVersion = await fs.readFile(cacheVersionPath, "utf-8").catch(() => "0")
if (currentVersion !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Path.cache)
    await Promise.all(contents.map((item) => fs.rm(path.join(Path.cache, item), { recursive: true, force: true })))
  } catch {}
  await fs.writeFile(cacheVersionPath, CACHE_VERSION)
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly bin: string
  readonly log: string
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      home: Path.home,
      data: Path.data,
      cache: Path.cache,
      config: Path.config,
      state: Path.state,
      bin: Path.bin,
      log: Path.log,
    })
  }),
)

export * as Global from "./global"

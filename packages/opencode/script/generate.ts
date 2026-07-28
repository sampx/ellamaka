import path from "path"
import { fileURLToPath } from "url"
import { existsSync, readFileSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"

async function loadModelsData(): Promise<string> {
  if (process.env.MODELS_DEV_API_JSON && existsSync(process.env.MODELS_DEV_API_JSON)) {
    return await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${modelsUrl}/api.json`, { signal: controller.signal })
    clearTimeout(timer)
    if (res.ok) {
      return await res.text()
    }
  } catch (_err) {
    console.warn("[generate] Warning: Failed to fetch models.dev (network unavailable/timed out). Falling back to local snapshot.")
  }

  const ciPath = path.resolve(dir, "../../.ci/models.json")
  if (existsSync(ciPath)) {
    return readFileSync(ciPath, "utf-8")
  }

  return "{}"
}

export const modelsData = await loadModelsData()
console.log("Loaded models.dev snapshot")

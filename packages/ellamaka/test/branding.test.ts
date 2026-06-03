import { describe, test, expect, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir as osTmpdir } from "os"
import { detectWopalSpace } from "../detect"
import { BINARY_NAME, BINARY_TITLE, VERSION_PREFIX } from "../branding"
import { ellamaka, wordmark } from "../logo"

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

function makeTmpdir(): string {
  const dir = mkdtempSync(join(osTmpdir(), "ellamaka-test-"))
  tmpDirs.push(dir)
  return dir
}

function setupWopalSpace(dir: string, settingsContent: string | null) {
  const wopalDir = join(dir, ".wopal")
  mkdirSync(join(wopalDir, "config"), { recursive: true })
  if (settingsContent !== null) {
    writeFileSync(join(wopalDir, "config", "settings.jsonc"), settingsContent)
  }
}

describe("detectWopalSpace", () => {
  test("returns true when settings.jsonc contains ellamaka key", () => {
    const dir = makeTmpdir()
    setupWopalSpace(dir, `{ "ellamaka": { "model": "test" } }`)
    expect(detectWopalSpace(dir)).toBe(true)
  })

  test("returns true when ellamaka key has whitespace around colon", () => {
    const dir = makeTmpdir()
    setupWopalSpace(dir, `{
  "ellamaka" : { "default_agent": "wopal" }
}`)
    expect(detectWopalSpace(dir)).toBe(true)
  })

  test("returns true with settings.json (no c)", () => {
    const dir = makeTmpdir()
    const wopalDir = join(dir, ".wopal")
    mkdirSync(join(wopalDir, "config"), { recursive: true })
    writeFileSync(join(wopalDir, "config", "settings.json"), `{ "ellamaka": {} }`)
    expect(detectWopalSpace(dir)).toBe(true)
  })

  test("returns false when settings.jsonc exists but has no ellamaka key", () => {
    const dir = makeTmpdir()
    setupWopalSpace(dir, `{ "other": { "key": "value" } }`)
    expect(detectWopalSpace(dir)).toBe(false)
  })

  test("returns false when .wopal exists but no config directory", () => {
    const dir = makeTmpdir()
    mkdirSync(join(dir, ".wopal"), { recursive: true })
    expect(detectWopalSpace(dir)).toBe(false)
  })

  test("returns false when no .wopal directory exists", () => {
    const dir = makeTmpdir()
    expect(detectWopalSpace(dir)).toBe(false)
  })

  test("returns false at filesystem root", () => {
    expect(detectWopalSpace("/")).toBe(false)
  })

  test("walks up from nested subdirectory", () => {
    const dir = makeTmpdir()
    setupWopalSpace(dir, `{ "ellamaka": {} }`)
    const nested = join(dir, "projects", "my-app", "src", "components")
    mkdirSync(nested, { recursive: true })
    expect(detectWopalSpace(nested)).toBe(true)
  })

  test("prefers settings.jsonc over settings.json", () => {
    const dir = makeTmpdir()
    const wopalDir = join(dir, ".wopal")
    mkdirSync(join(wopalDir, "config"), { recursive: true })
    writeFileSync(join(wopalDir, "config", "settings.json"), `{ "ellamaka": {} }`)
    writeFileSync(join(wopalDir, "config", "settings.jsonc"), `{ "ellamaka": { "model": "jsonc-wins" } }`)
    expect(detectWopalSpace(dir)).toBe(true)
  })
})

describe("branding constants", () => {
  test("BINARY_NAME is ellamaka", () => {
    expect(BINARY_NAME).toBe("ellamaka")
  })

  test("BINARY_TITLE is Ellamaka", () => {
    expect(BINARY_TITLE).toBe("Ellamaka")
  })

  test("VERSION_PREFIX is ellamaka", () => {
    expect(VERSION_PREFIX).toBe("ellamaka")
  })
})

describe("logo", () => {
  test("left and right glyph arrays have the same number of rows", () => {
    expect(ellamaka.left.length).toBe(ellamaka.right.length)
    expect(ellamaka.left.length).toBeGreaterThan(0)
  })

  test("left rows have consistent width and right rows have consistent width", () => {
    const leftWidth = ellamaka.left[0].length
    const rightWidth = ellamaka.right[0].length
    for (let i = 0; i < ellamaka.left.length; i++) {
      expect(ellamaka.left[i].length).toBe(leftWidth)
      expect(ellamaka.right[i].length).toBe(rightWidth)
    }
  })

  test("wordmark combines left + space + right per row", () => {
    expect(wordmark.length).toBe(ellamaka.left.length)
    for (let i = 0; i < wordmark.length; i++) {
      expect(wordmark[i]).toBe(ellamaka.left[i] + " " + ellamaka.right[i])
    }
  })
})
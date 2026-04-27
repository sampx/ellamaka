#!/usr/bin/env bun

/**
 * darwin 单目标编译脚本
 *
 * 运行方式:
 *   cd packages/opencode && bun run script/build-darwin.ts [options]
 *
 * 选项:
 *   --arch <x64|arm64>     目标架构 (默认: x64)
 *   --skip-install         跳过跨平台依赖安装
 *   --skip-embed-web-ui    跳过 Web UI 嵌入
 *   --skip-smoke-test      跳过冒烟测试
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..") // packages/opencode
const root = path.resolve(__dirname, "../../..") // projects/ellamaka

process.chdir(dir)

const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
const pkg = await Bun.file("./package.json").json()

// ========== 解析参数 ==========

const archArg = process.argv.find((a, i) => i > 0 && process.argv[i - 1] === "--arch")
const arch = archArg === "arm64" ? "arm64" : "x64"
const target = {
  os: "darwin",
  arch,
}

const skipInstall = process.argv.includes("--skip-install")
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")
const skipSmokeTest = process.argv.includes("--skip-smoke-test")

const binaryName = "ellamaka"
const distName = `opencode-${target.os}-${target.arch}`

// ========== Step 1: 生成 models snapshot ==========

console.log("\n[1/6] Generating models snapshot...")

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())

await Bun.write(
  path.join(dir, "src/provider/models-snapshot.js"),
  `// @ts-nocheck\n// Auto-generated - do not edit\nexport const snapshot = ${modelsData}\n`,
)
await Bun.write(
  path.join(dir, "src/provider/models-snapshot.d.ts"),
  `// Auto-generated - do not edit\nexport declare const snapshot: Record<string, unknown>\n`,
)
console.log("  ✓ Generated models-snapshot.js")

// ========== Step 2: 加载 migrations ==========

console.log("\n[2/6] Loading migrations...")

const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`  ✓ Loaded ${migrations.length} migrations`)

// ========== Step 3: 编译 Web UI（可选） ==========

console.log("\n[3/6] Building Web UI...")

const createEmbeddedWebUIBundle = async () => {
  const appDir = path.join(root, "packages/app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()
if (skipEmbedWebUi) {
  console.log("  ⚠ Skipped Web UI embedding")
} else {
  console.log("  ✓ Built Web UI bundle")
}

// ========== Step 4: 安装跨平台依赖 ==========

console.log("\n[4/6] Installing cross-platform dependencies...")

if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
  console.log("  ✓ Installed dependencies")
} else {
  console.log("  ⚠ Skipped dependency installation")
}

// ========== Step 5: 编译二进制 ==========

console.log("\n[5/6] Compiling binary...")

const plugin = createSolidTransformPlugin()

await $`rm -rf dist/${distName}`
await $`mkdir -p dist/${distName}/bin`

const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const rootModulesPath = path.resolve(root, "node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootModulesPath)
const workerPath = "./src/cli/cmd/tui/worker.ts"

const bunfsRoot = "/$bunfs/root/"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

const version = pkg.version || "1.3.13"

const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [plugin],
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: `bun-${target.os}-${target.arch}` as "bun-darwin-arm64" | "bun-darwin-x64",
    outfile: `dist/${distName}/bin/${binaryName}`,
    execArgv: [`--user-agent=opencode/${version}`, "--use-system-ca", "--"],
    windows: {},
  },
  files: {
    ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath, ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : [])],
  define: {
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_MIGRATIONS: JSON.stringify(migrations),
    OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: "'ellamaka-main'",
    OPENCODE_LIBC: "",
  },
})

if (!result.success) {
  console.error("  ✗ Build failed:")
  for (const error of result.logs) {
    console.error(`    ${error.message}`)
  }
  process.exit(1)
}

console.log(`  ✓ Compiled: dist/${distName}/bin/${binaryName} (${target.arch})`)
console.log(`    Size: ${(await Bun.file(`dist/${distName}/bin/${binaryName}`).stat()).size / 1024 / 1024} MB`)

// ========== Step 6: Smoke test ==========

console.log("\n[6/6] Running smoke test...")

if (!skipSmokeTest && target.os === process.platform && target.arch === process.arch) {
  try {
    const output = await $`dist/${distName}/bin/${binaryName} --version`.text()
    console.log(`  ✓ Smoke test passed: ${output.trim()}`)
  } catch (e) {
    console.error("  ✗ Smoke test failed:", e)
    process.exit(1)
  }
} else {
  console.log("  ⚠ Skipped smoke test (not current platform)")
}

// ========== 输出 package.json ==========

await Bun.file(`dist/${distName}/package.json`).write(
  JSON.stringify(
    {
      name: distName,
      version,
      os: [target.os],
      cpu: [target.arch],
    },
    null,
    2,
  ),
)

console.log("\n✅ Build complete!")
console.log(`   Output: packages/opencode/dist/${distName}/bin/${binaryName}`)
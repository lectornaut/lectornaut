import * as esbuild from "esbuild"
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.join(__dirname, "src")
const OUT_DIR = path.resolve(__dirname, "..", "functions-deploy")
const WATCH = process.argv.includes("--watch")

const pkg = JSON.parse(
  await readFile(path.join(__dirname, "package.json"), "utf8")
)

async function findFiles(dir, predicate) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await findFiles(full, predicate)))
    } else if (predicate(entry.name)) {
      found.push(full)
    }
  }
  return found
}

async function writeDeployPackageJson() {
  // Deploy package.json has only what Cloud Build needs at install time.
  // Workspace deps are bundled by esbuild and don't appear here.
  const deployPkg = {
    name: pkg.name,
    version: pkg.version,
    private: pkg.private,
    type: pkg.type,
    main: "index.js",
    engines: pkg.engines,
    dependencies: pkg.dependencies,
    // TODO: Cloud Build npm-installs from this manifest with no lockfile, so
    // transitives drift between deploys. @firebase/database-compat@2.1.5
    // (2026-07-30) hard-requires its new @firebase/app peer, which the GCF
    // builder doesn't install → every container exits at load. Pin to the
    // pnpm-locked version; drop once upstream ships a fixed release.
    // ponytail: single override; if another transitive drifts, ship a real
    // package-lock.json (npm ci) instead of piling more pins here.
    overrides: {
      "@firebase/database-compat": "2.1.4",
    },
  }
  await writeFile(
    path.join(OUT_DIR, "package.json"),
    JSON.stringify(deployPkg, null, 2) + "\n"
  )
}

async function copyMjmlTemplates() {
  const files = await findFiles(SRC_DIR, (name) => name.endsWith(".mjml"))
  for (const src of files) {
    const dest = path.join(OUT_DIR, path.relative(SRC_DIR, src))
    await mkdir(path.dirname(dest), { recursive: true })
    await cp(src, dest)
  }
  return files.length
}

// Dotprompt files are loaded by Genkit at runtime from `promptDir`, which
// `genkitClient.ts` points at the deploy directory's `prompts/`. We copy
// the `functions/prompts/` tree there so the bundled image is self-
// contained — same shape as the .mjml copy above.
async function copyPromptFiles() {
  const PROMPTS_SRC = path.join(__dirname, "prompts")
  let files = []
  try {
    files = await findFiles(PROMPTS_SRC, (name) => name.endsWith(".prompt"))
  } catch (err) {
    if (err.code === "ENOENT") return 0
    throw err
  }
  for (const src of files) {
    const dest = path.join(OUT_DIR, "prompts", path.relative(PROMPTS_SRC, src))
    await mkdir(path.dirname(dest), { recursive: true })
    await cp(src, dest)
  }
  return files.length
}

const esbuildOptions = {
  entryPoints: [path.join(SRC_DIR, "index.ts")],
  outfile: path.join(OUT_DIR, "index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Externalize real npm deps so Cloud Build installs them.
  // Workspace deps (e.g. @lectornaut/shared) are intentionally bundled.
  external: Object.keys(pkg.dependencies),
  sourcemap: true,
  logLevel: "info",
  // ESM bundles often need require() back for legacy CJS deps.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
}

console.log(`→ Cleaning ${path.relative(process.cwd(), OUT_DIR)}`)
await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

console.log("→ Writing deploy package.json")
await writeDeployPackageJson()

const mjmlCount = await copyMjmlTemplates()
console.log(`→ Copied ${mjmlCount} .mjml templates`)

const promptCount = await copyPromptFiles()
console.log(`→ Copied ${promptCount} .prompt files`)

// Symlink node_modules so Firebase CLI's local "analyze functions" step can
// resolve external deps (firebase-functions etc.) when it imports the bundle.
// firebase.json's `ignore: ["node_modules"]` strips this from the upload, so
// it's local-analysis-only — Cloud Build re-installs from the deploy package.json.
console.log("→ Linking node_modules for local analysis")
await symlink(
  "../functions/node_modules",
  path.join(OUT_DIR, "node_modules"),
  "dir"
)

if (WATCH) {
  const ctx = await esbuild.context(esbuildOptions)
  await ctx.watch()
  console.log("→ esbuild watching for changes (Ctrl+C to stop)")
} else {
  await esbuild.build(esbuildOptions)
  console.log(`✓ Bundle written to ${path.relative(process.cwd(), OUT_DIR)}/`)
}

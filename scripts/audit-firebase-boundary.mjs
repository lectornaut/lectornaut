import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const srcDir = path.join(root, "src")
const allowedFiles = new Set([
  "src/composables/useDeviceSessions.ts",
  "src/utils/firebase/firebase-sync-engine.ts",
])
const sourceExtensions = new Set([".ts", ".vue"])
const forbiddenCallPattern =
  /\b(setDoc|updateDoc|deleteDoc|addDoc|runTransaction|writeBatch)\s*\(/g

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function toRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/")
}

const findings = []
const files = await collectSourceFiles(srcDir)

for (const file of files) {
  const relative = toRelative(file)
  if (allowedFiles.has(relative)) continue

  const text = await readFile(file, "utf8")
  const lines = text.split(/\r?\n/)

  lines.forEach((line, index) => {
    forbiddenCallPattern.lastIndex = 0
    const matches = [...line.matchAll(forbiddenCallPattern)]
    matches.forEach((match) => {
      findings.push({
        file: relative,
        line: index + 1,
        primitive: match[1],
      })
    })
  })
}

if (findings.length > 0) {
  console.error(
    "Direct client Firestore writes found. Use Cloud Functions for domain mutations, or the sync engine for explicit client-authoritative exceptions."
  )
  findings.forEach((finding) => {
    console.error(
      `- ${finding.file}:${finding.line} uses ${finding.primitive}()`
    )
  })
  process.exit(1)
}

console.log("Firebase boundary audit passed.")

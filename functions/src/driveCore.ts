/**
 * Pure Google Drive logic — search-input clamping, `files.list` query
 * building, file-row compaction, read planning (export vs media vs binary),
 * and content truncation. NO Firebase / Genkit imports so `node --test`
 * exercises it directly (docs/connections-google-drive.prompt.md). The
 * calendar normalization lives in connectionsCore.ts; Drive gets a sibling
 * module instead of doubling that file.
 *
 * Same doctrine as the calendar read path: clamp-don't-throw — a tool arg
 * violation must never abort the turn.
 */

// ===========================================================================
// Caps
// ===========================================================================

export const DRIVE_MAX_RESULTS_CAP = 25
export const DRIVE_DEFAULT_MAX_RESULTS = 10

/** Content-read truncation bounds (chars of exported/downloaded text). */
export const DRIVE_READ_MIN_CHARS = 1_000
export const DRIVE_READ_DEFAULT_CHARS = 16_000
export const DRIVE_READ_MAX_CHARS = 48_000

/**
 * Don't `alt=media`-download files beyond this size — we'd fetch megabytes
 * to keep a few thousand chars. Exports have no size guard: Google bounds
 * them (~10MB ceiling) and native Google files report no `size` anyway, so
 * exports are fetch-then-truncate by design.
 */
export const DRIVE_MEDIA_MAX_BYTES = 10_000_000

// ===========================================================================
// Search input → files.list query
// ===========================================================================

/** Model-facing mime filter vocabulary (maps to exact Drive mimeTypes). */
export const DRIVE_MIME_CLASSES = [
  "document",
  "spreadsheet",
  "presentation",
  "pdf",
  "folder",
] as const
export type DriveMimeClass = (typeof DRIVE_MIME_CLASSES)[number]

const MIME_BY_CLASS: Readonly<Record<DriveMimeClass, string>> = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
  pdf: "application/pdf",
  folder: "application/vnd.google-apps.folder",
}

export interface DriveSearchParams {
  query: string | null
  mimeClass: DriveMimeClass | null
  /** Valid ISO-8601, normalized; null when absent/invalid. */
  modifiedAfter: string | null
  /** Restrict to direct children of this folder (id pre-validated). */
  folderId: string | null
  maxResults: number
}

const toValidIso = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/** Clamp the model-supplied search input. Invalid fields degrade to absent. */
export function clampDriveSearchInput(input: {
  query?: string
  mimeClass?: string
  modifiedAfter?: string
  folderId?: string
  maxResults?: number
}): DriveSearchParams {
  const query =
    typeof input.query === "string" && input.query.trim().length > 0
      ? input.query.trim().slice(0, 200)
      : null
  const mimeClass =
    typeof input.mimeClass === "string" &&
    (DRIVE_MIME_CLASSES as readonly string[]).includes(input.mimeClass)
      ? (input.mimeClass as DriveMimeClass)
      : null
  const rawMax =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.floor(input.maxResults)
      : DRIVE_DEFAULT_MAX_RESULTS
  return {
    query,
    mimeClass,
    modifiedAfter: toValidIso(input.modifiedAfter),
    // Id-shape validated (accepts pasted folder URLs too) — and because the
    // charset excludes quotes, it can go into the query literal unescaped.
    folderId: extractDriveFileId(input.folderId),
    maxResults: Math.min(Math.max(rawMax, 1), DRIVE_MAX_RESULTS_CAP),
  }
}

/**
 * Escape a value for a single-quoted Drive query string literal. Backslash
 * first, then quotes — the model never writes raw `q`, so this is the only
 * place operator injection could slip in.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export interface DriveListQuery {
  q: string
  /**
   * null when the query searches `fullText` — the Drive API does not
   * support ordering on fullText queries (results come back by relevance);
   * sending `orderBy` there is an error.
   */
  orderBy: string | null
}

/** Build the `files.list` query from clamped params. */
export function buildDriveListQuery(params: DriveSearchParams): DriveListQuery {
  const clauses = ["trashed = false"]
  if (params.folderId) {
    clauses.push(`'${params.folderId}' in parents`)
  }
  if (params.mimeClass) {
    clauses.push(`mimeType = '${MIME_BY_CLASS[params.mimeClass]}'`)
  }
  if (params.modifiedAfter) {
    clauses.push(`modifiedTime > '${params.modifiedAfter}'`)
  }
  if (params.query) {
    const text = escapeDriveQueryValue(params.query)
    clauses.push(`(name contains '${text}' or fullText contains '${text}')`)
  }
  return {
    q: clauses.join(" and "),
    orderBy: params.query ? null : "modifiedTime desc",
  }
}

// ===========================================================================
// File id extraction (raw ids + pasted Drive URLs)
// ===========================================================================

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/
const URL_ID_PATTERNS = [
  // /file/d/{id}, /document/d/{id}, /spreadsheets/d/{id}, /presentation/d/{id}
  /\/d\/([A-Za-z0-9_-]{10,})/,
  // /drive/folders/{id}
  /\/folders\/([A-Za-z0-9_-]{10,})/,
  // open?id={id} (legacy share links)
  /[?&]id=([A-Za-z0-9_-]{10,})/,
]

/**
 * Accept a Drive file id verbatim OR pull it out of a pasted Drive URL
 * (models relay `webViewLink`s constantly). Null when neither shape matches.
 */
export function extractDriveFileId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (text.length === 0) return null
  if (DRIVE_ID_RE.test(text)) return text
  if (!text.includes("/") && !text.includes("?")) return null
  for (const pattern of URL_ID_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

// ===========================================================================
// files.list row compaction
// ===========================================================================

/**
 * Field mask every Drive metadata fetch requests (`files.list` wraps it in
 * `files(...)`). Lives beside `compactDriveFiles` because the two must
 * agree — a field the mask omits silently compacts to its fallback.
 */
export const DRIVE_FILE_FIELDS =
  "id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName)," +
  "shortcutDetails(targetId,targetMimeType)"

export interface CompactDriveFile {
  id: string
  name: string
  mimeType: string
  /** RFC3339, or null when Google omits it. */
  modifiedTime: string | null
  /** First owner's display name (shared-drive items have no owners). */
  owner: string | null
  link: string | null
  /** Bytes; null for native Google files (they report no size). */
  size: number | null
}

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut"

/**
 * Compact Drive file resources into the bounded shape persisted as tool
 * output. Shortcuts are surfaced AS THEIR TARGET (id + mimeType swapped in)
 * so a follow-up `readDriveFile` lands on readable content; malformed rows
 * degrade to skipped, never to a throw (calendar precedent).
 */
export function compactDriveFiles(
  items: unknown,
  max: number
): CompactDriveFile[] {
  if (!Array.isArray(items)) return []
  const out: CompactDriveFile[] = []
  for (const item of items) {
    if (out.length >= max) break
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    let id = asNonEmptyString(raw.id)
    let mimeType = asNonEmptyString(raw.mimeType) ?? "application/octet-stream"
    if (mimeType === DRIVE_SHORTCUT_MIME) {
      const details = (raw.shortcutDetails ?? null) as {
        targetId?: unknown
        targetMimeType?: unknown
      } | null
      const targetId = asNonEmptyString(details?.targetId)
      if (targetId) {
        id = targetId
        mimeType = asNonEmptyString(details?.targetMimeType) ?? mimeType
      }
    }
    if (!id) continue
    // Drive serializes `size` as a string of bytes.
    const sizeBytes =
      typeof raw.size === "string" ? Number(raw.size) : Number.NaN
    const owners = Array.isArray(raw.owners) ? raw.owners : []
    const firstOwner =
      typeof owners[0] === "object" && owners[0] !== null
        ? (owners[0] as { displayName?: unknown })
        : null
    out.push({
      id,
      name: asNonEmptyString(raw.name) ?? "(unnamed)",
      mimeType,
      modifiedTime: asNonEmptyString(raw.modifiedTime),
      owner: asNonEmptyString(firstOwner?.displayName),
      link: asNonEmptyString(raw.webViewLink),
      size: Number.isFinite(sizeBytes) ? sizeBytes : null,
    })
  }
  return out
}

// ===========================================================================
// Read planning — export vs alt=media vs not-readable
// ===========================================================================

export type DriveReadPlan =
  /** Native Google file with a text export. */
  | { kind: "export"; exportMime: string; note: string | null }
  /** Regular text-ish file — download bytes via `alt=media`. */
  | { kind: "media" }
  /** No text path; return metadata + this reason instead of content. */
  | { kind: "binary"; note: string }
  | { kind: "folder" }

const GOOGLE_APPS_PREFIX = "application/vnd.google-apps."

const MEDIA_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/rtf",
])

/** Decide how to read a file's content from its mimeType. */
export function planDriveRead(
  mimeType: string | null | undefined
): DriveReadPlan {
  const mime = typeof mimeType === "string" ? mimeType : ""
  if (mime.startsWith(GOOGLE_APPS_PREFIX)) {
    const kind = mime.slice(GOOGLE_APPS_PREFIX.length)
    switch (kind) {
      case "document":
        // Native markdown export (Drive API, GA 2024-07) — the house format.
        return { kind: "export", exportMime: "text/markdown", note: null }
      case "spreadsheet":
        return {
          kind: "export",
          exportMime: "text/csv",
          note: "CSV export covers the first sheet only.",
        }
      case "presentation":
        return { kind: "export", exportMime: "text/plain", note: null }
      case "folder":
        return { kind: "folder" }
      case "shortcut":
        return {
          kind: "binary",
          note:
            "This is a shortcut. Read its target instead (search results " +
            "already resolve shortcuts to their targets).",
        }
      default:
        return {
          kind: "binary",
          note: `This Google file type (${kind}) has no text export.`,
        }
    }
  }
  if (mime.startsWith("text/")) return { kind: "media" }
  if (
    MEDIA_MIME_EXACT.has(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  ) {
    return { kind: "media" }
  }
  if (mime === "application/pdf") {
    return {
      kind: "binary",
      note:
        "PDF content extraction isn't supported yet — share the link with " +
        "the user instead.",
    }
  }
  return {
    kind: "binary",
    note: "This file is binary — it has no readable text content.",
  }
}

// ===========================================================================
// Import planning (D3 — import-to-attachment, not model reading)
// ===========================================================================

export type DriveImportPlan =
  /** Native Google file with a text export — stored as that text file. */
  | { kind: "export"; exportMime: string; extension: string }
  /** Everything else (PDFs, images, archives, …) — raw bytes via alt=media. */
  | { kind: "media" }
  /** Not importable; `reason` is shown to the user. */
  | { kind: "skip"; reason: string }

/**
 * Decide how a file becomes a session ATTACHMENT. Unlike `planDriveRead`
 * (which classifies by MODEL-readability and calls PDFs a boundary), import
 * keeps raw bytes for anything non-native — the attachment/blob pipeline
 * already feeds PDFs and images to the model as media parts. Blocked-mime
 * and size gates are the caller's job (they need the final content type).
 */
export function planDriveImport(
  mimeType: string | null | undefined
): DriveImportPlan {
  const mime = typeof mimeType === "string" ? mimeType : ""
  if (mime.startsWith(GOOGLE_APPS_PREFIX)) {
    const kind = mime.slice(GOOGLE_APPS_PREFIX.length)
    switch (kind) {
      case "document":
        return { kind: "export", exportMime: "text/markdown", extension: ".md" }
      case "spreadsheet":
        return { kind: "export", exportMime: "text/csv", extension: ".csv" }
      case "presentation":
        return { kind: "export", exportMime: "text/plain", extension: ".txt" }
      case "folder":
        return {
          kind: "skip",
          reason: "Folders can't be imported — pick a file inside it.",
        }
      case "shortcut":
        // The import callable hops shortcuts to their target before
        // planning; reaching here means the hop failed.
        return {
          kind: "skip",
          reason: "This shortcut's target couldn't be resolved.",
        }
      default:
        return {
          kind: "skip",
          reason: `This Google file type (${kind}) has no importable content.`,
        }
    }
  }
  return { kind: "media" }
}

/** `name` + export extension, without doubling an existing extension. */
export function driveImportFileName(name: string, extension: string): string {
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`
}

// ===========================================================================
// Content truncation
// ===========================================================================

/** Clamp the model-requested char budget into the read bounds. */
export function clampDriveReadChars(value: unknown): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : DRIVE_READ_DEFAULT_CHARS
  return Math.min(Math.max(raw, DRIVE_READ_MIN_CHARS), DRIVE_READ_MAX_CHARS)
}

export interface TruncatedContent {
  content: string
  truncated: boolean
  /** Length of the full text BEFORE truncation (chars). */
  totalChars: number
}

/** Cut `text` at the char budget with an explicit truncation marker. */
export function truncateDriveContent(
  text: string,
  maxChars: number
): TruncatedContent {
  if (text.length <= maxChars) {
    return { content: text, truncated: false, totalChars: text.length }
  }
  return {
    content:
      text.slice(0, maxChars) +
      `\n\n[… truncated — ${text.length.toLocaleString("en-US")} chars total]`,
    truncated: true,
    totalChars: text.length,
  }
}

// ===========================================================================
// Drive write drafts (D2 — strict validation, card-faithful)
// ===========================================================================
//
// Same doctrine as the calendar write drafts (connectionsCore.ts): writes
// are validated STRICTLY and invalid input is returned as a (recoverable)
// problem list — the client confirmation card renders the model's raw
// `input`, so the executed payload must match what the user saw. The model
// repairs its args and retries; nothing here ever throws.

export const DRIVE_NAME_MAX = 300
export const DRIVE_CONTENT_MAX_CHARS = 200_000

/**
 * What `createDriveFile` produces: a Google Doc (markdown CONVERTED on
 * upload — the native import path) or a plain markdown file stored as-is.
 */
export const DRIVE_FILE_KINDS = ["document", "text"] as const
export type DriveFileKind = (typeof DRIVE_FILE_KINDS)[number]

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document"

export interface DriveWriteValidation {
  ok: boolean
  problems: string[]
  /** `files` resource metadata part of the multipart upload. */
  metadata: Record<string, unknown>
  /** Markdown bytes uploaded as the media part. */
  content: string
  /** Short human line for tool-output messages, e.g. `"Notes" (Google Doc)`. */
  describe: string
}

const trimmedDraftString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

/** Shared content rule: required, non-empty, bounded. Returns null on problem. */
function validateDriveContent(
  value: unknown,
  problems: string[]
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    problems.push("content (the file's markdown text) is required")
    return null
  }
  if (value.length > DRIVE_CONTENT_MAX_CHARS) {
    problems.push(
      `content is too long (max ${DRIVE_CONTENT_MAX_CHARS} characters)`
    )
    return null
  }
  return value
}

export interface DriveCreateInput {
  name?: string
  content?: string
  kind?: string
  folderId?: string
}

export function validateDriveCreateDraft(
  input: DriveCreateInput
): DriveWriteValidation {
  const problems: string[] = []
  const name = trimmedDraftString(input.name)
  if (!name) {
    problems.push("name (the file name) is required")
  } else if (name.length > DRIVE_NAME_MAX) {
    problems.push(`name is too long (max ${DRIVE_NAME_MAX} characters)`)
  }
  const content = validateDriveContent(input.content, problems)
  // Default is the Google Doc conversion — the card states the effective
  // kind either way, so the default is card-faithful.
  const kind: DriveFileKind | null =
    input.kind === undefined || input.kind === null
      ? "document"
      : (DRIVE_FILE_KINDS as readonly string[]).includes(input.kind)
        ? (input.kind as DriveFileKind)
        : null
  if (kind === null) {
    problems.push("kind must be 'document' (Google Doc) or 'text' (.md file)")
  }
  // STRICT (unlike the search tool's clamp): a folder the user can see on
  // the card must be the folder written to, so junk is a problem, not a
  // silent drop.
  let folderId: string | null = null
  if (input.folderId !== undefined && input.folderId !== null) {
    folderId = extractDriveFileId(input.folderId)
    if (!folderId) {
      problems.push(
        "folderId must be a Drive folder id (or folder URL) from a lookup"
      )
    }
  }
  if (problems.length > 0 || !name || !content || !kind) {
    return { ok: false, problems, metadata: {}, content: "", describe: "" }
  }
  return {
    ok: true,
    problems: [],
    metadata: {
      name,
      // Conversion target only for Docs; a plain markdown file keeps the
      // media part's own text/markdown type.
      ...(kind === "document" ? { mimeType: GOOGLE_DOC_MIME } : {}),
      ...(folderId ? { parents: [folderId] } : {}),
    },
    content,
    describe: `"${name}" (${kind === "document" ? "Google Doc" : "Markdown file"})`,
  }
}

export interface DriveUpdateInput {
  fileId?: string
  content?: string
  name?: string
}

export function validateDriveUpdateDraft(
  input: DriveUpdateInput
): DriveWriteValidation & { fileId: string } {
  const problems: string[] = []
  const fileId = extractDriveFileId(input.fileId)
  if (!fileId) {
    problems.push(
      "fileId is required (use the id from a googleDrive search result)"
    )
  }
  const content = validateDriveContent(input.content, problems)
  let name: string | null = null
  if (input.name !== undefined && input.name !== null) {
    name = trimmedDraftString(input.name)
    if (!name) {
      problems.push("name, when provided, must be a non-empty file name")
    } else if (name.length > DRIVE_NAME_MAX) {
      problems.push(`name is too long (max ${DRIVE_NAME_MAX} characters)`)
    }
  }
  if (problems.length > 0 || !fileId || !content) {
    return {
      ok: false,
      problems,
      metadata: {},
      content: "",
      describe: "",
      fileId: "",
    }
  }
  return {
    ok: true,
    problems: [],
    // Never a mimeType on update — the file keeps its type (uploading
    // markdown media into a Google Doc re-converts; into a plain file it
    // just replaces bytes).
    metadata: name ? { name } : {},
    content,
    describe: name ? `"${name}"` : `file ${fileId}`,
    fileId,
  }
}

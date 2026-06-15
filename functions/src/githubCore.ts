/**
 * Pure GitHub logic — repo/URL parsing, search-query assembly, response
 * compaction, API failure triage, and confirm-gated write-draft validation.
 * NO Firebase / Genkit / fetch imports so `node --test` exercises it directly
 * (mirrors connectionsCore.ts / botTurn.ts). The impure half (the tools that
 * fetch + resolve tokens) lives in `githubTools.ts`.
 */

// ===========================================================================
// Repo + target parsing
// ===========================================================================

export interface RepoRef {
  owner: string
  repo: string
}

const OWNER_REPO_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/

/**
 * Parse a repo reference from `owner/name` OR a pasted GitHub URL
 * (`https://github.com/owner/name`, optionally with trailing path). Returns
 * null on anything unrecognized — the caller turns that into narratable
 * output, never a throw.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const direct = trimmed.match(OWNER_REPO_RE)
  if (direct) return { owner: direct[1]!, repo: stripGitSuffix(direct[2]!) }
  const url = tryParseUrl(trimmed)
  if (url && /(^|\.)github\.com$/.test(url.hostname)) {
    const segments = url.pathname.split("/").filter(Boolean)
    if (segments.length >= 2) {
      return { owner: segments[0]!, repo: stripGitSuffix(segments[1]!) }
    }
  }
  return null
}

export interface FileTarget extends RepoRef {
  path: string
  ref: string | null
}

/**
 * Parse a file target. Accepts an explicit `{ repo, path, ref }` (assembled by
 * the caller) OR a pasted blob/tree URL
 * (`https://github.com/owner/name/blob/<ref>/<path>`), which carries its own
 * ref + path. Returns null when neither a repo nor a usable path resolves.
 */
export function parseFileTarget(
  repoInput: string,
  pathInput: string | undefined,
  refInput: string | undefined
): FileTarget | null {
  const url = tryParseUrl(repoInput.trim())
  if (url && /(^|\.)github\.com$/.test(url.hostname)) {
    const segments = url.pathname.split("/").filter(Boolean)
    // owner / repo / (blob|tree|raw) / ref / ...path — path is optional, so a
    // `tree/main` URL (4 segments) resolves to that ref's root directory.
    if (segments.length >= 4 && /^(blob|tree|raw)$/.test(segments[2]!)) {
      return {
        owner: segments[0]!,
        repo: stripGitSuffix(segments[1]!),
        ref: segments[3]!,
        path: segments.slice(4).join("/"),
      }
    }
  }
  const ref = parseRepoRef(repoInput)
  if (!ref) return null
  return {
    ...ref,
    path: normalizePath(pathInput ?? ""),
    ref: refInput && refInput.trim() ? refInput.trim() : null,
  }
}

const stripGitSuffix = (repo: string): string => repo.replace(/\.git$/, "")
const normalizePath = (path: string): string => path.trim().replace(/^\/+/, "")
function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// ===========================================================================
// Issue/PR search
// ===========================================================================

export const GITHUB_MAX_RESULTS_CAP = 25
export const GITHUB_DEFAULT_MAX_RESULTS = 10

export interface IssueSearchInput {
  query?: string
  repo?: string
  state?: string
  maxResults?: number
}

export interface IssueSearchParams {
  /** Assembled `q` for GET /search/issues. */
  q: string
  maxResults: number
}

/**
 * Build the `/search/issues` query, clamp-don't-throw. A bad `repo` is
 * dropped (the search just isn't scoped) rather than failing the call; an
 * empty query with no repo is reported by the caller (GitHub rejects a blank
 * `q`).
 */
export function buildIssueSearchParams(
  input: IssueSearchInput
): IssueSearchParams {
  const parts: string[] = []
  const text =
    typeof input.query === "string" ? input.query.trim().slice(0, 200) : ""
  if (text) parts.push(text)
  if (typeof input.repo === "string") {
    const ref = parseRepoRef(input.repo)
    if (ref) parts.push(`repo:${ref.owner}/${ref.repo}`)
  }
  const state =
    input.state === "open" || input.state === "closed" ? input.state : null
  if (state) parts.push(`state:${state}`)
  const rawMax =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.floor(input.maxResults)
      : GITHUB_DEFAULT_MAX_RESULTS
  return {
    q: parts.join(" "),
    maxResults: Math.min(Math.max(rawMax, 1), GITHUB_MAX_RESULTS_CAP),
  }
}

export interface CompactIssue {
  number: number
  title: string
  state: string
  isPullRequest: boolean
  repo: string | null
  author: string | null
  commentCount: number
  url: string | null
  updatedAt: string | null
}

/** Compact `/search/issues` items into the bounded shape persisted as tool
 * output. Malformed rows are skipped, never thrown. */
export function compactIssues(items: unknown, max: number): CompactIssue[] {
  if (!Array.isArray(items)) return []
  const out: CompactIssue[] = []
  for (const item of items) {
    if (out.length >= max) break
    const issue = compactIssue(item)
    if (issue) out.push(issue)
  }
  return out
}

function compactIssue(item: unknown): CompactIssue | null {
  if (typeof item !== "object" || item === null) return null
  const raw = item as Record<string, unknown>
  if (typeof raw.number !== "number") return null
  const htmlUrl = typeof raw.html_url === "string" ? raw.html_url : null
  return {
    number: raw.number,
    title:
      typeof raw.title === "string" && raw.title.length > 0
        ? raw.title
        : "(no title)",
    state: typeof raw.state === "string" ? raw.state : "unknown",
    // The search API flags PRs with a `pull_request` member.
    isPullRequest: typeof raw.pull_request === "object",
    repo: repoFromUrl(htmlUrl),
    author: pickLogin(raw.user),
    commentCount: typeof raw.comments === "number" ? raw.comments : 0,
    url: htmlUrl,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
  }
}

export interface IssueDetail extends CompactIssue {
  body: string | null
  comments: { author: string | null; body: string }[]
}

const ISSUE_BODY_MAX = 8000
const COMMENT_BODY_MAX = 2000
const MAX_COMMENTS = 20

/** Compact one issue/PR plus its comment thread. */
export function compactIssueDetail(
  issue: unknown,
  comments: unknown
): IssueDetail | null {
  const base = compactIssue(issue)
  if (!base) return null
  const raw = issue as Record<string, unknown>
  const body =
    typeof raw.body === "string" && raw.body.length > 0
      ? truncate(raw.body, ISSUE_BODY_MAX)
      : null
  const thread: IssueDetail["comments"] = []
  if (Array.isArray(comments)) {
    for (const c of comments) {
      if (thread.length >= MAX_COMMENTS) break
      if (typeof c !== "object" || c === null) continue
      const rawC = c as Record<string, unknown>
      if (typeof rawC.body !== "string" || rawC.body.length === 0) continue
      thread.push({
        author: pickLogin(rawC.user),
        body: truncate(rawC.body, COMMENT_BODY_MAX),
      })
    }
  }
  return { ...base, body, comments: thread }
}

// ===========================================================================
// File content
// ===========================================================================

export const GITHUB_FILE_MAX_CHARS = 48_000
/** Largest base64 blob we'll decode (the contents API caps at 1MB anyway). */
export const GITHUB_FILE_MAX_BYTES = 1_000_000
/** NUL sentinel for the binary sniff (escaped, never a literal NUL in source). */
const NUL = "\u0000"

export interface FileContentResult {
  ok: true
  kind: "file" | "dir"
  /** File text (truncated) or a newline-joined directory listing. */
  content: string | null
  /** Non-null note for binaries/oversized files the caller surfaces verbatim. */
  note: string | null
}

/**
 * Shape the GET /repos/{o}/{r}/contents response. A file returns decoded text
 * (or a "binary/too large" note); a directory returns a name listing. Binary
 * or oversized files yield `content: null` + a note, never a throw.
 */
export function shapeFileContents(body: unknown): FileContentResult | null {
  if (Array.isArray(body)) {
    const names: string[] = []
    for (const entry of body) {
      if (typeof entry !== "object" || entry === null) continue
      const raw = entry as Record<string, unknown>
      if (typeof raw.name === "string") {
        names.push(`${raw.type === "dir" ? "[dir] " : ""}${raw.name}`)
      }
    }
    return { ok: true, kind: "dir", content: names.join("\n"), note: null }
  }
  if (typeof body !== "object" || body === null) return null
  const raw = body as Record<string, unknown>
  if (raw.type !== "file") return null
  const size = typeof raw.size === "number" ? raw.size : 0
  if (size > GITHUB_FILE_MAX_BYTES) {
    return {
      ok: true,
      kind: "file",
      content: null,
      note: `File is too large to read inline (${size} bytes).`,
    }
  }
  if (raw.encoding !== "base64" || typeof raw.content !== "string") {
    return {
      ok: true,
      kind: "file",
      content: null,
      note: "File contents weren't returned in a readable form.",
    }
  }
  const decoded = Buffer.from(raw.content, "base64").toString("utf8")
  // Heuristic binary sniff: a NUL byte means it isn't text.
  if (decoded.includes(NUL)) {
    return {
      ok: true,
      kind: "file",
      content: null,
      note: "File looks binary, so its contents can't be shown.",
    }
  }
  return {
    ok: true,
    kind: "file",
    content: truncate(decoded, GITHUB_FILE_MAX_CHARS),
    note: null,
  }
}

// ===========================================================================
// API failure triage
// ===========================================================================

export interface GitHubErrorInfo {
  status: number
  /** `x-ratelimit-remaining` header, when present. */
  rateLimitRemaining: number | null
  /** The response body's `message` field, when present. */
  message: string | null
}

export type GitHubFailureKind =
  | "needs_reauth"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "transient"
  | "error"

export interface GitHubFailure {
  kind: GitHubFailureKind
  message: string
}

/**
 * Map a GitHub API failure to a model-facing message + a kind the caller acts
 * on (`needs_reauth` flips the binding; the rest are narratable only). Tuned
 * for the GitHub App model: a 404 usually means the app ISN'T INSTALLED on
 * that repo (the dominant first-run failure), and a 403 "Resource not
 * accessible by integration" means the app lacks a required permission —
 * both fixable on the install/config page, NOT by reconnecting.
 */
export function triageGitHubFailure(info: GitHubErrorInfo): GitHubFailure {
  const { status, message } = info
  const lower = (message ?? "").toLowerCase()
  if (status === 401) {
    return {
      kind: "needs_reauth",
      message:
        "Your GitHub connection was rejected (the access was revoked or " +
        "expired). Reconnect GitHub under Settings → Connections.",
    }
  }
  if (status === 403) {
    if (
      (info.rateLimitRemaining !== null && info.rateLimitRemaining <= 0) ||
      lower.includes("rate limit")
    ) {
      return {
        kind: "rate_limited",
        message: "GitHub's API rate limit was hit. Try again in a few minutes.",
      }
    }
    if (lower.includes("not accessible by integration")) {
      return {
        kind: "forbidden",
        message:
          "The GitHub App doesn't have the permission needed for this on " +
          "that repository. An admin must grant the app the right permission " +
          "at github.com/settings/installations.",
      }
    }
    return {
      kind: "forbidden",
      message:
        "The GitHub App can't do that on this repository" +
        (message ? ` (${message})` : "") +
        ".",
    }
  }
  if (status === 404) {
    return {
      kind: "not_found",
      message:
        "GitHub returned not-found. This usually means the GitHub App isn't " +
        "installed on that repository — install it at " +
        "github.com/settings/installations and select the repo — or the app " +
        "lacks the needed permission, or the repo is private and your " +
        "account can't see it.",
    }
  }
  if (status === 422) {
    return {
      kind: "invalid",
      message: `GitHub rejected the request${message ? ` (${message})` : ""}.`,
    }
  }
  if (status === 429 || status >= 500) {
    return {
      kind: "transient",
      message: "GitHub is unavailable right now. Try again shortly.",
    }
  }
  return {
    kind: "error",
    message: `GitHub request failed (${status})${message ? `: ${message}` : ""}.`,
  }
}

// ===========================================================================
// Write-draft validation (P2 — strict, card-faithful)
// ===========================================================================
//
// Like the calendar/drive write tools: validate STRICTLY and report problems
// back as a recoverable list (the confirm card renders the model's raw input,
// so the executed payload must match what the member approved). Never throws.

export interface GitHubWriteValidation<T> {
  ok: boolean
  problems: string[]
  payload: T
}

const ISSUE_TITLE_MAX = 256
const ISSUE_CREATE_BODY_MAX = 60_000
const COMMENT_MAX = 60_000

export interface IssueCreateInput {
  repo?: string
  title?: string
  body?: string
  labels?: unknown
}

export function validateIssueDraft(
  input: IssueCreateInput
): GitHubWriteValidation<{ repo: RepoRef; body: Record<string, unknown> }> {
  const problems: string[] = []
  const repo = input.repo ? parseRepoRef(input.repo) : null
  if (!repo) problems.push("repo is required as owner/name")
  const title = typeof input.title === "string" ? input.title.trim() : ""
  if (!title) problems.push("title is required")
  else if (title.length > ISSUE_TITLE_MAX) {
    problems.push(`title is too long (max ${ISSUE_TITLE_MAX})`)
  }
  const body = typeof input.body === "string" ? input.body : ""
  // Reject (don't silently truncate) — the confirm card renders the full
  // body, so an over-limit one must be fixed by the model, not shortened
  // behind the member's approval (matches validateCommentDraft).
  if (body.length > ISSUE_CREATE_BODY_MAX) {
    problems.push(`body is too long (max ${ISSUE_CREATE_BODY_MAX})`)
  }
  const labels = validateLabels(input.labels, problems)
  if (problems.length > 0 || !repo) return emptyValidation(problems)
  return {
    ok: true,
    problems: [],
    payload: {
      repo,
      body: {
        title,
        ...(body ? { body } : {}),
        ...(labels.length > 0 ? { labels } : {}),
      },
    },
  }
}

export interface CommentInput {
  repo?: string
  issueNumber?: number
  body?: string
}

export function validateCommentDraft(
  input: CommentInput
): GitHubWriteValidation<{
  repo: RepoRef
  issueNumber: number
  body: Record<string, unknown>
}> {
  const problems: string[] = []
  const repo = input.repo ? parseRepoRef(input.repo) : null
  if (!repo) problems.push("repo is required as owner/name")
  const issueNumber = positiveInt(input.issueNumber)
  if (!issueNumber)
    problems.push("issueNumber is required (issue or PR number)")
  const body = typeof input.body === "string" ? input.body.trim() : ""
  if (!body) problems.push("comment body is required")
  else if (body.length > COMMENT_MAX) {
    problems.push(`comment is too long (max ${COMMENT_MAX})`)
  }
  if (problems.length > 0 || !repo || !issueNumber)
    return emptyValidation(problems)
  return {
    ok: true,
    problems: [],
    payload: {
      repo,
      issueNumber,
      body: { body: body.slice(0, COMMENT_MAX) },
    },
  }
}

export interface IssueUpdateInput {
  repo?: string
  issueNumber?: number
  state?: string
  labels?: unknown
}

export function validateIssueUpdateDraft(
  input: IssueUpdateInput
): GitHubWriteValidation<{
  repo: RepoRef
  issueNumber: number
  body: Record<string, unknown>
}> {
  const problems: string[] = []
  const repo = input.repo ? parseRepoRef(input.repo) : null
  if (!repo) problems.push("repo is required as owner/name")
  const issueNumber = positiveInt(input.issueNumber)
  if (!issueNumber) problems.push("issueNumber is required")
  const payload: Record<string, unknown> = {}
  if (input.state !== undefined) {
    if (input.state === "open" || input.state === "closed") {
      payload.state = input.state
    } else {
      problems.push('state must be "open" or "closed"')
    }
  }
  const labels = validateLabels(input.labels, problems)
  if (labels.length > 0) payload.labels = labels
  if (Object.keys(payload).length === 0 && problems.length === 0) {
    problems.push("nothing to change — provide state and/or labels")
  }
  if (problems.length > 0 || !repo || !issueNumber)
    return emptyValidation(problems)
  return {
    ok: true,
    problems: [],
    payload: { repo, issueNumber, body: payload },
  }
}

// ===========================================================================
// Shared helpers
// ===========================================================================

const LABEL_MAX = 20

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null
}

function validateLabels(value: unknown, problems: string[]): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    problems.push("labels must be an array of strings")
    return []
  }
  const out: string[] = []
  for (const entry of value) {
    if (out.length >= LABEL_MAX) break
    if (typeof entry === "string" && entry.trim().length > 0) {
      out.push(entry.trim())
    }
  }
  return out
}

function emptyValidation(problems: string[]): GitHubWriteValidation<never> {
  return { ok: false, problems, payload: undefined as never }
}

function pickLogin(user: unknown): string | null {
  if (typeof user !== "object" || user === null) return null
  const login = (user as Record<string, unknown>).login
  return typeof login === "string" && login.length > 0 ? login : null
}

function repoFromUrl(htmlUrl: string | null): string | null {
  if (!htmlUrl) return null
  const url = tryParseUrl(htmlUrl)
  if (!url) return null
  const segments = url.pathname.split("/").filter(Boolean)
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`
}

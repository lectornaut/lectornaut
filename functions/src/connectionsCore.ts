/**
 * Pure connections logic — OAuth token-lifecycle decisions, Google token
 * endpoint response/failure shaping, and calendar tool input/output
 * normalization. NO Firebase / Genkit imports so `node --test` exercises it
 * directly (mirrors `botTurn.ts`). The impure halves live in
 * `connections.ts` (Firestore + fetch) and `connectionTools.ts` (Genkit).
 */

import { createHash } from "node:crypto"
// Package specifier, not `./domain.js` — see the re-export block below.
import type { ConnectionStatus } from "@lectornaut/shared/domain"

// ===========================================================================
// Token lifecycle
// ===========================================================================

/** Refresh when the access token is missing or expires within this window. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

/**
 * Stored as `accessTokenExpiresAtMs` for any token response without an
 * `expires_in` (classic GitHub OAuth, or a GitHub App with token expiration
 * disabled). A far-future epoch keeps `shouldRefreshAccessToken` returning
 * false forever so the token is served directly — never routed into a refresh
 * path that may not exist. NOT `Infinity`: must survive a Firestore round-trip.
 */
export const NON_EXPIRING_TOKEN_EXPIRY_MS = Number.MAX_SAFE_INTEGER

export function shouldRefreshAccessToken(
  expiresAtMs: number | null | undefined,
  nowMs: number
): boolean {
  if (typeof expiresAtMs !== "number" || !Number.isFinite(expiresAtMs)) {
    return true
  }
  return expiresAtMs - nowMs <= ACCESS_TOKEN_REFRESH_SKEW_MS
}

/**
 * Normalize an OAuth token endpoint's granted-scope string into an array.
 * Splits on commas AND whitespace because providers disagree: Google returns
 * space-separated, GitHub comma-separated. A single split rule covers both,
 * so a `repo,read:org` grant doesn't store as one garbage element (which
 * would make every scope check fail).
 */
export function parseScopeList(scope: string): string[] {
  return scope.split(/[,\s]+/).filter((s) => s.length > 0)
}

/**
 * Decode a JWT's payload WITHOUT signature verification. Acceptable here
 * only because the token arrives directly from Google's token endpoint over
 * TLS in a server-to-server exchange — we never accept an id_token from the
 * client. Returns null on any structural problem.
 */
export function decodeJwtClaims(
  idToken: string
): Record<string, unknown> | null {
  const parts = idToken.split(".")
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8")
    const claims: unknown = JSON.parse(json)
    return typeof claims === "object" &&
      claims !== null &&
      !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export interface ParsedTokenResponse {
  accessToken: string
  /** Absolute expiry (ms epoch), derived from `expires_in` (or the
   * non-expiring sentinel for providers that issue permanent tokens). */
  expiresAtMs: number
  /** Present only on first consent (or `prompt=consent`); keep the stored one otherwise. */
  refreshToken: string | null
  /** Granted scopes, normalized across the comma/space wire formats. */
  scopes: string[]
  /** From the `id_token` when `openid email` was requested (Google); null for
   * providers whose identity needs a separate userinfo call (GitHub). */
  email: string | null
}

/**
 * Defensively parse an OAuth 2.0 token endpoint success body (Google AND
 * GitHub — both speak the same response shape). Null = unusable (no access
 * token; e.g. GitHub returns `{ error: "bad_verification_code" }` on a bad
 * code, which has no `access_token`). Email is read from the `id_token` when
 * present (Google); GitHub returns none, so its binding identity is fetched
 * separately from the userinfo endpoint.
 *
 * Token lifetime is AUTO-DETECTED from `expires_in`: present+positive →
 * expiring (refresh when stale); absent → non-expiring (the far-future
 * sentinel, served forever). One rule covers classic GitHub OAuth (no
 * expires_in), GitHub Apps under EITHER token-expiration setting, and Google
 * (always expiring) — no per-provider flag.
 */
export function parseOauthTokenResponse(
  body: unknown,
  nowMs: number
): ParsedTokenResponse | null {
  if (typeof body !== "object" || body === null) return null
  const record = body as Record<string, unknown>
  const accessToken = record.access_token
  if (typeof accessToken !== "string" || accessToken.length === 0) return null
  const expiresIn =
    typeof record.expires_in === "number" &&
    Number.isFinite(record.expires_in) &&
    record.expires_in > 0
      ? record.expires_in
      : null
  const claims =
    typeof record.id_token === "string"
      ? decodeJwtClaims(record.id_token)
      : null
  const email =
    claims && typeof claims.email === "string" && claims.email.length > 0
      ? claims.email
      : null
  return {
    accessToken,
    expiresAtMs:
      expiresIn !== null
        ? nowMs + expiresIn * 1000
        : NON_EXPIRING_TOKEN_EXPIRY_MS,
    refreshToken:
      typeof record.refresh_token === "string" &&
      record.refresh_token.length > 0
        ? record.refresh_token
        : null,
    scopes: parseScopeList(
      typeof record.scope === "string" ? record.scope : ""
    ),
    email,
  }
}

export type GoogleTokenFailureKind =
  /** The grant is dead (revoked / expired refresh token) — flip the binding to needs_reauth. */
  | "invalid_grant"
  /** Server-side hiccup (5xx / 429) — retryable, do NOT touch the binding. */
  | "transient"
  /** Config / request problem (bad client id, malformed code, …). */
  | "rejected"

/**
 * Token-endpoint error codes that mean the GRANT is dead (refresh token
 * revoked/expired) → flip the binding to needs_reauth. Google: `invalid_grant`;
 * GitHub App: `bad_refresh_token`. NOT `bad_verification_code` — that's a bad
 * one-time authorization code (retry the connect), not a dead binding.
 */
export function isDeadGrantError(error: string | null | undefined): boolean {
  return error === "invalid_grant" || error === "bad_refresh_token"
}

export function classifyGoogleTokenFailure(
  status: number,
  body: unknown
): GoogleTokenFailureKind {
  const error =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).error
      : undefined
  if (isDeadGrantError(typeof error === "string" ? error : null)) {
    return "invalid_grant"
  }
  if (status === 429 || status >= 500) return "transient"
  return "rejected"
}

/**
 * The `error` field of a token-endpoint body, if present. GitHub returns
 * HTTP 200 with `{ error: "bad_verification_code" }` on a bad code (no
 * `access_token`), so a 2xx exchange can still be a logical failure — the
 * caller checks this when parsing yields no token.
 */
export function extractOauthError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as Record<string, unknown>).error
  return typeof error === "string" && error.length > 0 ? error : null
}

// ===========================================================================
// Redirect URI allowlist (exchange `redirect_uri` validation)
// ===========================================================================
//
// The exchange's redirect_uri is client-supplied, so the server only accepts
// values it can vouch for: an RFC 8252 loopback host (desktop/Tauri) or an
// EXACT match against the web callback DERIVED from the request's own Origin
// (the web client always uses `${origin}/connections/callback`). Never an open
// https pattern. The OAuth provider's registered-redirect-URI list is the real
// boundary — a code only exists for a URI registered on our client — so this
// is belt-and-suspenders, no config needed.

export const LOOPBACK_REDIRECT_RE =
  /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}(\/[A-Za-z0-9/_-]*)?$/

export function isAllowedRedirectUri(
  uri: string,
  expectedWebCallback: string | null
): boolean {
  if (LOOPBACK_REDIRECT_RE.test(uri)) return true
  return expectedWebCallback !== null && uri === expectedWebCallback
}

// ===========================================================================
// Calendar tool input/output normalization
// ===========================================================================

export const CALENDAR_MAX_RESULTS_CAP = 25
export const CALENDAR_DEFAULT_MAX_RESULTS = 10
/** Default lookahead window when the model omits a time range. */
export const CALENDAR_DEFAULT_WINDOW_DAYS = 7

export interface CalendarListParams {
  timeMin: string
  timeMax: string
  query: string | null
  maxResults: number
}

const toValidIso = (value: string | undefined | null): string | null => {
  if (typeof value !== "string" || value.length === 0) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/**
 * Clamp the model-supplied input into a safe Google query. Invalid dates fall
 * back to the default window; a reversed range is swapped; `maxResults` is
 * bounded. Clamp-don't-throw: a tool arg violation must never abort the turn.
 */
export function clampCalendarListInput(
  input: {
    timeMin?: string
    timeMax?: string
    query?: string
    maxResults?: number
  },
  nowMs: number
): CalendarListParams {
  const defaultMin = new Date(nowMs).toISOString()
  const defaultMax = new Date(
    nowMs + CALENDAR_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
  let timeMin = toValidIso(input.timeMin) ?? defaultMin
  let timeMax = toValidIso(input.timeMax) ?? defaultMax
  if (Date.parse(timeMax) < Date.parse(timeMin)) {
    ;[timeMin, timeMax] = [timeMax, timeMin]
  }
  const query =
    typeof input.query === "string" && input.query.trim().length > 0
      ? input.query.trim().slice(0, 200)
      : null
  const rawMax =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.floor(input.maxResults)
      : CALENDAR_DEFAULT_MAX_RESULTS
  const maxResults = Math.min(Math.max(rawMax, 1), CALENDAR_MAX_RESULTS_CAP)
  return { timeMin, timeMax, query, maxResults }
}

export interface CompactCalendarEvent {
  id: string
  summary: string
  /** RFC3339 dateTime, or all-day date (YYYY-MM-DD). */
  start: string
  end: string
  allDay: boolean
  location: string | null
  attendeeCount: number
  link: string | null
  /**
   * Drive files attached to the event — the Calendar × Drive bridge: a
   * non-null `fileId` feeds `readDriveFile` directly ("prep me for this
   * meeting from the attached docs"). Non-Drive attachments keep their
   * title with `fileId: null`.
   */
  attachments: CalendarEventAttachment[]
}

export interface CalendarEventAttachment {
  fileId: string | null
  title: string
}

const CALENDAR_MAX_ATTACHMENTS = 10

function compactEventAttachments(value: unknown): CalendarEventAttachment[] {
  if (!Array.isArray(value)) return []
  const out: CalendarEventAttachment[] = []
  for (const entry of value) {
    if (out.length >= CALENDAR_MAX_ATTACHMENTS) break
    if (typeof entry !== "object" || entry === null) continue
    const raw = entry as Record<string, unknown>
    out.push({
      fileId:
        typeof raw.fileId === "string" && raw.fileId.length > 0
          ? raw.fileId
          : null,
      title:
        typeof raw.title === "string" && raw.title.length > 0
          ? raw.title
          : "(attachment)",
    })
  }
  return out
}

interface RawEventTime {
  dateTime?: unknown
  date?: unknown
}

/**
 * Compact Google's event resources into the bounded shape persisted as tool
 * output (the model's follow-up context). Cancelled rows are dropped;
 * malformed rows degrade to skipped, never to a throw.
 */
export function compactCalendarEvents(
  items: unknown,
  max: number
): CompactCalendarEvent[] {
  if (!Array.isArray(items)) return []
  const out: CompactCalendarEvent[] = []
  for (const item of items) {
    if (out.length >= max) break
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    if (raw.status === "cancelled") continue
    const start = pickEventTime(raw.start as RawEventTime | undefined)
    const end = pickEventTime(raw.end as RawEventTime | undefined)
    if (!start) continue
    out.push({
      id: typeof raw.id === "string" ? raw.id : "",
      summary:
        typeof raw.summary === "string" && raw.summary.length > 0
          ? raw.summary
          : "(no title)",
      start: start.value,
      end: end?.value ?? start.value,
      allDay: start.allDay,
      location:
        typeof raw.location === "string" && raw.location.length > 0
          ? raw.location
          : null,
      attendeeCount: Array.isArray(raw.attendees) ? raw.attendees.length : 0,
      link: typeof raw.htmlLink === "string" ? raw.htmlLink : null,
      attachments: compactEventAttachments(raw.attachments),
    })
  }
  return out
}

function pickEventTime(
  time: RawEventTime | undefined
): { value: string; allDay: boolean } | null {
  if (!time || typeof time !== "object") return null
  if (typeof time.dateTime === "string" && time.dateTime.length > 0) {
    return { value: time.dateTime, allDay: false }
  }
  if (typeof time.date === "string" && time.date.length > 0) {
    return { value: time.date, allDay: true }
  }
  return null
}

// ===========================================================================
// Team-wide kill switch (admin disables a connection for everyone)
// ===========================================================================

/**
 * Whether a connection doc's data says the app is team-disabled
 * (`status: "disabled"` — the Owner/Admin kill switch). Centralizes the
 * default: a missing doc or field reads as ACTIVE. Every server gate
 * (tool registration, token minting, new connects) keys on this one
 * predicate so they can never disagree.
 */
export function isConnectionDisabled(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  return (
    (data as { status?: unknown }).status ===
    ("disabled" satisfies ConnectionStatus)
  )
}

// ===========================================================================
// Workflow audience (who a run is FOR, and whose connected account it reads)
// ===========================================================================
//
// One rule: a personal account's data only ever flows back to its owner.
//   - `shared` workflows run once, identity-less — no personal account.
//   - `personal` workflows run once PER opted-in member, with that member's
//     own bindings, into that member's own private session.
// Opt-in is self-only (the callable writes the caller's uid) and lives in
// `workflows/{id}/subscribers/{uid}` — readable by that member and team
// admins only, so the workflow doc (member-readable) never lists who opted
// in. An opt-in is pinned to what the member approved: `approvedRev` (the
// workflow's `consentRev`, bumped by a prompt edit) and `fingerprint` (the
// agent's config + the connected-app tools a run can reach). A change to
// either pauses the opt-in until the member re-approves — an admin can't
// widen what a member agreed to after the fact.

export const WORKFLOW_AUDIENCES = ["shared", "personal"] as const
export type WorkflowAudience = (typeof WORKFLOW_AUDIENCES)[number]

/** Max opted-in members per workflow (each one is a run per trigger). */
export const MAX_WORKFLOW_SUBSCRIBERS = 100
/** Consecutive failed runs before a member's opt-in is paused. */
export const SUBSCRIBER_FAILURE_LIMIT = 3

export interface WorkflowAudienceFields {
  audience: WorkflowAudience
  consentRev: number
}

/** What a run can reach, as approved at opt-in. */
export interface WorkflowFingerprint {
  /** Hash of the agent's stored spec (instructions + tool toggles). */
  agent: string
  /** Enabled connected-app tool keys. */
  tools: string[]
}

/** Why an opt-in stopped running without the member turning it off. */
export type SubscriberPause = "tools" | "failures"

/** `workflows/{id}/subscribers/{uid}` — one member's opt-in. */
export interface WorkflowSubscriber {
  uid: string
  approvedRev: number
  fingerprint: WorkflowFingerprint
  paused?: SubscriberPause | null
  /** "Notify me" preference; absent = on. */
  notify?: boolean
  failures?: number
  /** The member's ongoing chat for this workflow; each run continues it. */
  sessionId?: string
}

/**
 * Members a personal workflow runs for: opted in at the CURRENT revision and
 * not paused. (The fingerprint is compared live in the worker, where the
 * agent and tool docs are read.)
 */
export function runRecipients(
  wf: WorkflowAudienceFields,
  subscribers: readonly WorkflowSubscriber[]
): string[] {
  if (wf.audience !== "personal") return []
  return subscribers
    .filter(
      (s) =>
        isEligibleActsAsUid(s.uid) &&
        s.approvedRev === wf.consentRev &&
        !s.paused
    )
    .map((s) => s.uid)
}

/** JSON with object keys sorted, so equal values always hash equally. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function buildWorkflowFingerprint(
  agentSpec: unknown,
  connectionToolKeys: readonly string[]
): WorkflowFingerprint {
  return {
    agent: createHash("sha256")
      .update(stableStringify(agentSpec ?? null))
      .digest("hex"),
    tools: [...new Set(connectionToolKeys)].sort(),
  }
}

/**
 * Whether a run can now do something the member didn't approve: the agent's
 * config changed at all, or a connected-app tool was ADDED. Losing a tool
 * only narrows the run, so it never pauses anyone.
 */
export function fingerprintWidened(
  approved: WorkflowFingerprint,
  live: WorkflowFingerprint
): boolean {
  return (
    approved.agent !== live.agent ||
    live.tools.some((tool) => !approved.tools.includes(tool))
  )
}

/**
 * Deterministic run id for one (workflow, trigger occurrence, member), so a
 * retried fan-out re-creates the same docs instead of duplicate runs.
 * `occurrence` is the scheduled tick or the trigger event id.
 */
export function workflowRunId(
  workflowId: string,
  occurrence: string | number,
  forUid?: string
): string {
  return [workflowId, occurrence, ...(forUid ? [forUid] : [])]
    .join("_")
    .replace(/[^\w-]/g, "-")
}

/**
 * A member's failure streak after a run: an error extends it, a success
 * clears it, anything else (blocked on budget, skipped) leaves it alone.
 * `pause` is true on the run that reaches the limit.
 */
export function nextFailureStreak(
  failures: number | undefined,
  status: string
): { failures: number; pause: boolean } {
  const next =
    status === "error"
      ? (failures ?? 0) + 1
      : status === "success"
        ? 0
        : (failures ?? 0)
  return {
    failures: next,
    pause: status === "error" && next >= SUBSCRIBER_FAILURE_LIMIT,
  }
}

/**
 * Whether a stored uid may power a headless run: non-empty and not a
 * built-in agent sentinel (`_`-prefixed — synthesized principals, never
 * humans with OAuth grants). The run executor additionally verifies LIVE
 * team membership, so a member who left stops getting runs immediately.
 */
export function isEligibleActsAsUid(uid: unknown): uid is string {
  return typeof uid === "string" && uid.length > 0 && !uid.startsWith("_")
}

// ===========================================================================
// Confirmation interpretation (P2 — the restart channel's approval metadata)
// ===========================================================================

export type ConfirmationDecision = "pending" | "approved" | "declined"

/**
 * Interpret a restarted tool's `resumed` metadata. SECURITY-load-bearing:
 * Genkit's `restartTool` defaults `resumed` to `true` when metadata is
 * omitted, and `resumed` is also `true`-ish on assorted framework paths —
 * so ONLY an explicit, server-stamped `{ approved: true }` object counts as
 * approval, and ONLY `{ approved: false }` as a decline. Everything else
 * (bare booleans, empty objects, garbage) reads as `pending`, which makes
 * the handler re-interrupt — fail-closed.
 */
export function interpretResumedConfirmation(
  resumed: unknown
): ConfirmationDecision {
  if (!resumed || typeof resumed !== "object" || Array.isArray(resumed)) {
    return "pending"
  }
  const approved = (resumed as Record<string, unknown>).approved
  if (approved === true) return "approved"
  if (approved === false) return "declined"
  return "pending"
}

// ===========================================================================
// Calendar write drafts (P2 — strict validation, card-faithful)
// ===========================================================================
//
// Unlike the read tool's clamp-don't-throw normalization, write drafts are
// validated STRICTLY and invalid input is reported back as a (recoverable)
// problem list: the client confirmation card renders the model's raw
// `input`, so the executed payload must match what the user saw — silently
// "fixing" a time would make the card lie. The model repairs its args and
// retries; nothing here ever throws.

const ALL_DAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const CALENDAR_MAX_ATTENDEES = 20
const SUMMARY_MAX = 300
const LOCATION_MAX = 300
const DESCRIPTION_MAX = 2000

export interface CalendarWriteValidation {
  ok: boolean
  problems: string[]
  /** Google Events-API resource body (create: full; update: patch subset). */
  payload: Record<string, unknown>
  /** Short human line for tool-output messages, e.g. `"Standup" (… – …)`. */
  describe: string
}

interface CalendarTimeFields {
  start?: string
  end?: string
  allDay?: boolean
}

const trimmed = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

/** Next calendar day for Google's EXCLUSIVE all-day `end.date`. */
function nextDay(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`)
  return new Date(ms + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Validate the start/end/allDay trio and return the Google `start`/`end`
 * resource fields. Both bounds are REQUIRED for timed events (no silent
 * defaulting — see the module-level faithfulness note); all-day events take
 * `YYYY-MM-DD` with an optional same-or-later end date.
 */
function validateTimes(
  input: CalendarTimeFields,
  problems: string[]
): { start: unknown; end: unknown; describe: string } | null {
  const start = trimmed(input.start)
  const end = trimmed(input.end)
  if (input.allDay === true) {
    if (!start || !ALL_DAY_DATE_RE.test(start)) {
      problems.push("allDay events need start as a YYYY-MM-DD date")
      return null
    }
    const endDate = end ?? start
    if (!ALL_DAY_DATE_RE.test(endDate) || endDate < start) {
      problems.push("allDay end must be a YYYY-MM-DD date on/after start")
      return null
    }
    return {
      start: { date: start },
      // Google's all-day `end.date` is exclusive — the day AFTER the last day.
      end: { date: nextDay(endDate) },
      describe: end && end !== start ? `${start} – ${end}` : start,
    }
  }
  const startMs = start ? Date.parse(start) : Number.NaN
  const endMs = end ? Date.parse(end) : Number.NaN
  if (!Number.isFinite(startMs)) {
    problems.push("start must be a valid ISO-8601 date-time")
  }
  if (!Number.isFinite(endMs)) {
    problems.push("end must be a valid ISO-8601 date-time (it is required)")
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (endMs <= startMs) {
    problems.push("end must be after start")
    return null
  }
  const startIso = new Date(startMs).toISOString()
  const endIso = new Date(endMs).toISOString()
  return {
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    describe: `${startIso} – ${endIso}`,
  }
}

function validateText(
  value: unknown,
  field: string,
  max: number,
  problems: string[]
): string | null {
  const text = trimmed(value)
  if (text === null) return null
  if (text.length > max) {
    problems.push(`${field} is too long (max ${max} characters)`)
    return null
  }
  return text
}

function validateAttendees(value: unknown, problems: string[]): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    problems.push("attendees must be an array of email addresses")
    return []
  }
  const emails: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== "string" || !EMAIL_RE.test(entry.trim())) {
      problems.push(`attendee "${String(entry)}" is not a valid email address`)
      continue
    }
    const email = entry.trim()
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    emails.push(email)
  }
  if (emails.length > CALENDAR_MAX_ATTENDEES) {
    problems.push(`too many attendees (max ${CALENDAR_MAX_ATTENDEES})`)
    return []
  }
  return emails
}

export interface CalendarCreateInput extends CalendarTimeFields {
  summary?: string
  description?: string
  location?: string
  attendees?: unknown
}

export function validateCalendarEventDraft(
  input: CalendarCreateInput
): CalendarWriteValidation {
  const problems: string[] = []
  const summary = validateText(input.summary, "summary", SUMMARY_MAX, problems)
  if (!summary) problems.push("summary (event title) is required")
  const times = validateTimes(input, problems)
  const description = validateText(
    input.description,
    "description",
    DESCRIPTION_MAX,
    problems
  )
  const location = validateText(
    input.location,
    "location",
    LOCATION_MAX,
    problems
  )
  const attendees = validateAttendees(input.attendees, problems)
  if (problems.length > 0 || !summary || !times) {
    return { ok: false, problems, payload: {}, describe: "" }
  }
  return {
    ok: true,
    problems: [],
    payload: {
      summary,
      start: times.start,
      end: times.end,
      ...(description ? { description } : {}),
      ...(location ? { location } : {}),
      ...(attendees.length > 0
        ? { attendees: attendees.map((email) => ({ email })) }
        : {}),
    },
    describe: `"${summary}" (${times.describe})`,
  }
}

export interface CalendarUpdateInput extends CalendarCreateInput {
  eventId?: string
}

export function validateCalendarEventPatch(
  input: CalendarUpdateInput
): CalendarWriteValidation & { eventId: string } {
  const problems: string[] = []
  const eventId = trimmed(input.eventId)
  if (!eventId || eventId.length > 1024 || /\s/.test(eventId)) {
    problems.push("eventId is required (use the id from a calendar lookup)")
  }

  const payload: Record<string, unknown> = {}
  const summary = validateText(input.summary, "summary", SUMMARY_MAX, problems)
  if (summary) payload.summary = summary
  const description = validateText(
    input.description,
    "description",
    DESCRIPTION_MAX,
    problems
  )
  if (description) payload.description = description
  const location = validateText(
    input.location,
    "location",
    LOCATION_MAX,
    problems
  )
  if (location) payload.location = location
  const attendees = validateAttendees(input.attendees, problems)
  if (attendees.length > 0) {
    payload.attendees = attendees.map((email) => ({ email }))
  }

  // Timing is all-or-nothing on a patch: a lone `start` could silently
  // invert against the stored `end`, so both bounds travel together.
  let describe = ""
  if (
    input.start !== undefined ||
    input.end !== undefined ||
    input.allDay !== undefined
  ) {
    const times = validateTimes(input, problems)
    if (times) {
      payload.start = times.start
      payload.end = times.end
      describe = times.describe
    }
  }

  if (Object.keys(payload).length === 0 && problems.length === 0) {
    problems.push(
      "nothing to change — provide at least one field (summary, start+end, description, location, attendees)"
    )
  }
  if (problems.length > 0) {
    return { ok: false, problems, payload: {}, describe: "", eventId: "" }
  }
  return {
    ok: true,
    problems: [],
    payload,
    describe: summary
      ? `"${summary}"${describe ? ` (${describe})` : ""}`
      : describe || `event ${eventId}`,
    eventId: eventId!,
  }
}

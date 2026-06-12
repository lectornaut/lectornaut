/**
 * Pure connections logic — OAuth token-lifecycle decisions, Google token
 * endpoint response/failure shaping, and calendar tool input/output
 * normalization. NO Firebase / Genkit imports so `node --test` exercises it
 * directly (mirrors `botTurn.ts`). The impure halves live in
 * `connections.ts` (Firestore + fetch) and `connectionTools.ts` (Genkit).
 */

// Package specifier, not `./domain.js` — see the re-export block below.
import type { ConnectionStatus } from "@lectornaut/shared/domain"

// ===========================================================================
// Token lifecycle
// ===========================================================================

/** Refresh when the access token is missing or expires within this window. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

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
  /** Absolute expiry (ms epoch), derived from `expires_in`. */
  expiresAtMs: number
  /** Present only on first consent (or `prompt=consent`); keep the stored one otherwise. */
  refreshToken: string | null
  /** Space-separated granted scopes (may differ from requested). */
  scope: string
  /** From the `id_token` when `openid email` was requested. */
  email: string | null
}

/** Defensively parse Google's token endpoint success body. Null = unusable. */
export function parseGoogleTokenResponse(
  body: unknown,
  nowMs: number
): ParsedTokenResponse | null {
  if (typeof body !== "object" || body === null) return null
  const record = body as Record<string, unknown>
  const accessToken = record.access_token
  if (typeof accessToken !== "string" || accessToken.length === 0) return null
  const expiresIn =
    typeof record.expires_in === "number" && Number.isFinite(record.expires_in)
      ? record.expires_in
      : 0
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
    expiresAtMs: nowMs + Math.max(0, expiresIn) * 1000,
    refreshToken:
      typeof record.refresh_token === "string" &&
      record.refresh_token.length > 0
        ? record.refresh_token
        : null,
    scope: typeof record.scope === "string" ? record.scope : "",
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

export function classifyGoogleTokenFailure(
  status: number,
  body: unknown
): GoogleTokenFailureKind {
  const error =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).error
      : undefined
  if (error === "invalid_grant") return "invalid_grant"
  if (status === 429 || status >= 500) return "transient"
  return "rejected"
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
// OAuth scope vocabulary + checks (P2 — write tools)
// ===========================================================================
//
// The scope constants + hierarchy + `hasGrantedScope` live in the shared
// domain contract (both the server gate here AND the client's
// `needsScopeUpgrade` hint must agree on what a broader grant satisfies, or
// a `calendar` grant would nag "reconnect" forever while writes succeed).
// Re-exported so existing `./connectionsCore.js` imports keep working.
//
// Imported from the workspace PACKAGE specifier, not the usual `./domain.js`
// shim: this module is loaded directly by `node --test` (type-stripping),
// which can't rewrite a relative `./domain.js` to `domain.ts` but DOES honor
// `@lectornaut/shared`'s exports map (→ source `.ts`). esbuild resolves it
// for the deploy bundle just the same.
export {
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_FULL_SCOPE,
  hasGrantedScope,
} from "@lectornaut/shared/domain"

// ===========================================================================
// Team-wide kill switch (admin disables a connection for everyone)
// ===========================================================================

/**
 * Whether a connection doc's data says the app is team-disabled
 * (`status: "disabled"` — the Owner/Admin kill switch). Centralizes the
 * default: a missing doc, missing field, or unexpected shape reads as
 * ACTIVE, so pre-kill-switch docs keep working unchanged. Every server gate
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
// Headless run identity (P3 — workflow "runs with {member}'s connections")
// ===========================================================================

/**
 * Consent rule for SETTING a workflow's `actsAsUid`: only your OWN uid —
 * declaring "this workflow runs with my connected accounts" requires being
 * the account owner, which makes consent implicit and unforgeable (an admin
 * can never point a workflow at another member's Google account). Returns
 * the rejection message, or null when allowed. `null`/`undefined` always
 * passes: CLEARING the binding is open to anyone who can edit the workflow —
 * revocation must never be harder than the grant.
 */
export function actsAsUidViolation(
  callerUid: string,
  requested: string | null | undefined
): string | null {
  if (requested === null || requested === undefined) return null
  if (requested === callerUid) return null
  return "A workflow can only run with your own connected accounts."
}

/**
 * Whether a STORED `actsAsUid` is even eligible to thread into a headless
 * run: a non-empty uid that isn't a built-in agent sentinel (`_`-prefixed —
 * synthesized principals, never humans with OAuth grants). Defense in depth
 * behind the write-time self-only rule; the run executor additionally
 * verifies LIVE team membership before threading, so a member who left the
 * team stops powering runs immediately.
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

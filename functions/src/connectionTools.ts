/**
 * Connection-backed chat tools (docs/connections-feature.prompt.md).
 *
 * Google Calendar: read lookup (P1) + confirm-gated create/update (P2).
 * Google Drive: search + content read (D1,
 * docs/connections-google-drive.prompt.md). All REST via global fetch (no
 * `googleapis` dep; a handful of endpoints don't earn a 100-module client
 * library).
 *
 * Registration is gated in `pickChatTools` on each app's published
 * integration doc being installed + enabled
 * (`enabledBuiltInTools.has(<app tool key>)` — ONE gate per app).
 * There is deliberately NO per-agent toggle (memory-tools precedent).
 *
 * Failure doctrine (load-bearing): every failure — no binding, dead grant,
 * quota, network — is RETURNED as `{ ok: false, message }` tool output. A
 * handler throw aborts the entire chat turn (see `transferToAgent`'s scar in
 * botBuiltinTools.ts), and a headless workflow run hitting this tool with no
 * binding is a NORMAL outcome, not an error.
 */

import * as logger from "firebase-functions/logger"
import { z } from "genkit/beta"
import type { BotActionContext } from "./botBuiltinTools.js"
import { resolveBindingAccessToken } from "./connections.js"
import {
  clampCalendarListInput,
  compactCalendarEvents,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  hasGrantedScope,
  interpretResumedConfirmation,
  validateCalendarEventDraft,
  validateCalendarEventPatch,
  type CompactCalendarEvent,
} from "./connectionsCore.js"
import {
  GOOGLE_CALENDAR_TOOL_KEY,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_READ_FILE_TOOL_NAME,
  GOOGLE_DRIVE_TOOL_KEY,
  GOOGLE_DRIVE_WRITE_TOOL_NAMES,
  type ConnectionProvider,
} from "./domain.js"
import {
  buildDriveListQuery,
  clampDriveReadChars,
  clampDriveSearchInput,
  compactDriveFiles,
  DRIVE_FILE_FIELDS,
  DRIVE_MEDIA_MAX_BYTES,
  extractDriveFileId,
  planDriveRead,
  truncateDriveContent,
  validateDriveCreateDraft,
  validateDriveUpdateDraft,
  type CompactDriveFile,
} from "./driveCore.js"
import { ai } from "./genkitClient.js"

const CALENDAR_EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events"

const calendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  /** RFC3339 dateTime, or YYYY-MM-DD when `allDay`. */
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  attendeeCount: z.number(),
  link: z.string().nullable(),
  /** Attached files; a non-null `fileId` is readable via readDriveFile. */
  attachments: z.array(
    z.object({ fileId: z.string().nullable(), title: z.string() })
  ),
})

const googleCalendarOutputSchema = z.object({
  /** `false` = the lookup couldn't run; `message` explains what to tell the user. */
  ok: z.boolean(),
  /** Summary when `ok`; a plain-language explanation the model should relay otherwise. */
  message: z.string(),
  events: z.array(calendarEventSchema),
  /** ISO-8601 timestamp of when the lookup ran. */
  retrievedAt: z.string(),
})

// Inputs stay deliberately loose (plain optional strings, no `.datetime()`):
// Genkit validates args PRE-handler and a violation is turn-fatal, so the
// handler clamps instead (`clampCalendarListInput` — invalid dates fall back
// to the default window, maxResults is bounded).
const googleCalendarInputSchema = z.object({
  timeMin: z
    .string()
    .optional()
    .describe(
      "Start of the time range, ISO-8601 (e.g. '2026-06-12T00:00:00Z'). " +
        "Defaults to now."
    ),
  timeMax: z
    .string()
    .optional()
    .describe(
      "End of the time range, ISO-8601. Defaults to 7 days after timeMin."
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Free-text filter matched against event titles, descriptions, " +
        "locations and attendees. Omit to list everything in the range."
    ),
  maxResults: z
    .number()
    .optional()
    .describe("How many events to return (1-25, default 10)."),
})

const failure = (message: string) => ({
  ok: false,
  message,
  events: [],
  retrievedAt: new Date().toISOString(),
})

/** Pull Google's `error.message`/`error.status` out of an API error body. */
function googleApiErrorDetail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error !== "object" || error === null) return null
  const record = error as { message?: unknown; status?: unknown }
  const message = typeof record.message === "string" ? record.message : null
  const status = typeof record.status === "string" ? record.status : null
  if (message && status) return `${status}: ${message}`
  return message ?? status
}

/**
 * Per-app nouns for the shared failure copy below — the triage logic is
 * identical across Google APIs; only the names differ.
 */
export interface ConnectionAppCopy {
  /** Display name, e.g. "Google Calendar". */
  app: string
  /** Cloud API to enable in the console, e.g. "Google Calendar API". */
  api: string
  /** Permission noun in consent copy, e.g. "calendar" → "calendar access". */
  scopeNoun: string
}

const CALENDAR_COPY: ConnectionAppCopy = {
  app: "Google Calendar",
  api: "Google Calendar API",
  scopeNoun: "calendar",
}

const DRIVE_COPY: ConnectionAppCopy = {
  app: "Google Drive",
  api: "Google Drive API",
  scopeNoun: "Drive",
}

/**
 * Triage a Google API 401/403 into the THREE distinct real-world causes —
 * each has a different fix, and collapsing them into one "reconnect" message
 * sends humans down the wrong path (it sent us down one):
 *   - the API was never ENABLED on the Google Cloud project
 *     (admin/console fix — reconnecting changes nothing);
 *   - the grant lacks the scope (granular consent let the user
 *     uncheck it — reconnect AND tick the permission);
 *   - the token/grant is genuinely dead (reconnect).
 */
function googleAuthRejectionMessage(
  status: number,
  body: unknown,
  copy: ConnectionAppCopy
): string {
  const detail = googleApiErrorDetail(body)
  logger.warn(`[connections] ${copy.api} rejected the call`, {
    status,
    detail,
  })
  if (
    detail &&
    (detail.includes("has not been used in project") ||
      detail.includes("SERVICE_DISABLED") ||
      detail.includes("accessNotConfigured"))
  ) {
    return (
      `${copy.app} is unavailable for a server-side reason: the ` +
      `${copy.api} is not enabled on this app's Google Cloud project. An ` +
      "administrator must enable it in the Google Cloud console (APIs & " +
      `Services → ${copy.api}). Reconnecting will not help.`
    )
  }
  if (
    detail &&
    (detail.includes("insufficient authentication scopes") ||
      detail.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
  ) {
    return (
      `The user's Google grant doesn't include ${copy.scopeNoun} access — ` +
      `the ${copy.scopeNoun} permission was likely unchecked on the consent ` +
      "screen. Ask them to reconnect under Settings → Connections and " +
      `approve ${copy.scopeNoun} access.`
    )
  }
  return (
    `${copy.app} rejected the connection's authorization` +
    (detail ? ` (${detail})` : "") +
    ". Ask the user to reconnect it under Settings → Connections."
  )
}

/** Shared model-facing copy for binding/token failures (read + write tools). */
export function bindingFailureMessage(
  reason:
    | "not_connected"
    | "needs_reauth"
    | "config"
    | "transient"
    | "disabled",
  copy: ConnectionAppCopy
): string {
  switch (reason) {
    case "not_connected":
      return (
        `The user hasn't connected their ${copy.app} account yet. ` +
        "Ask them to connect it under Settings → Connections, then try " +
        "again."
      )
    case "needs_reauth":
      return (
        `The user's ${copy.app} connection has expired and needs ` +
        "re-authorization. Ask them to reconnect it under Settings → " +
        "Connections."
      )
    case "config":
      return (
        `${copy.app} is unavailable: the server's OAuth ` +
        "client isn't configured."
      )
    case "transient":
      return `Couldn't reach ${copy.app} just now. Try again shortly.`
    case "disabled":
      // Kill switch (mid-turn flip — normally the tool isn't even
      // registered). Honest copy: reconnecting wouldn't help, only an
      // Owner/Admin re-enabling the app does.
      return (
        `${copy.app} has been disabled for this team by an admin. ` +
        "Don't suggest reconnecting — a team owner or admin must re-enable " +
        "the app under Settings → Connections first."
      )
  }
}

export const googleCalendarTool = ai.defineTool(
  {
    name: GOOGLE_CALENDAR_TOOL_KEY,
    description:
      "Look up events on the user's connected Google Calendar. Call this " +
      "for any question about their schedule, meetings, events, or " +
      'availability — e.g. "what\'s on my calendar Friday", "when is my ' +
      'next 1:1", "am I free tomorrow afternoon". Read-only: it lists ' +
      "events, it never creates or changes them. Events may carry Drive " +
      "attachments — pass an attachment's fileId to readDriveFile to read " +
      "the document (e.g. for meeting prep). If the result says the user " +
      "hasn't connected their calendar, relay that and point them to " +
      "Settings → Connections.",
    inputSchema: googleCalendarInputSchema,
    outputSchema: googleCalendarOutputSchema,
  },
  async (input, { context }) => {
    const ctx = context as BotActionContext | undefined
    const teamId = ctx?.teamId
    const uid = ctx?.auth?.uid
    if (!teamId) {
      return failure(
        "Calendar lookup is unavailable in this context (no team bound to " +
          "the conversation)."
      )
    }

    const token = await resolveBindingAccessToken(
      teamId,
      "google-calendar",
      // Interactive turns act as the chatting user. Headless workflow runs
      // carry uid: "" and fall back to the run's pre-validated
      // `connectionsActsAsUid` (P3 — "runs with {member}'s connected
      // accounts"); when neither is set, the resolver reports not_connected
      // (never a "" doc path read).
      uid || ctx?.connectionsActsAsUid || undefined
    )
    if (!token.ok) {
      return failure(bindingFailureMessage(token.reason, CALENDAR_COPY))
    }

    const params = clampCalendarListInput(input, Date.now())
    const url = new URL(CALENDAR_EVENTS_ENDPOINT)
    url.searchParams.set("timeMin", params.timeMin)
    url.searchParams.set("timeMax", params.timeMax)
    url.searchParams.set("maxResults", String(params.maxResults))
    // Expand recurring events into instances and order chronologically —
    // the shape schedule questions need.
    url.searchParams.set("singleEvents", "true")
    url.searchParams.set("orderBy", "startTime")
    if (params.query) url.searchParams.set("q", params.query)

    let status = 0
    let body: unknown = null
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      })
      status = response.status
      body = await response.json().catch(() => null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failure(`Calendar request failed before returning (${message}).`)
    }

    if (status === 401 || status === 403) {
      return failure(googleAuthRejectionMessage(status, body, CALENDAR_COPY))
    }
    if (status < 200 || status >= 300) {
      const detail = googleApiErrorDetail(body)
      return failure(
        `Google Calendar returned an error (HTTP ${status}` +
          `${detail ? `: ${detail}` : ""}).`
      )
    }

    const items =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).items
        : null
    const events = compactCalendarEvents(items, params.maxResults)
    const range = `${params.timeMin} – ${params.timeMax}`
    return {
      ok: true,
      message:
        events.length === 0
          ? `No events found between ${range}.`
          : `${events.length} event(s) between ${range}.`,
      events,
      retrievedAt: new Date().toISOString(),
    }
  }
)

// ===========================================================================
// Calendar WRITE tools (P2) — confirm-gated via the interrupt/restart channel
// ===========================================================================
//
// Both tools follow the same three-state handler, keyed on the RESTART
// metadata (`interpretResumedConfirmation`):
//
//   pending  → first invocation (or any non-explicit resume): validate the
//              draft, verify the binding could even execute it (token +
//              granted scope), then `interrupt()` — the chat pauses and the
//              client renders an Approve / Cancel card from the tool's raw
//              `input` (which is why validation is STRICT, never clamping:
//              the card must show exactly what would execute).
//   approved → the resume flow stamped `{ approved: true }` server-side
//              (respondToBotInterruptFlow, from the authenticated member's
//              click). Execute the REST write and return the result.
//   declined → `{ approved: false }`. Return a narratable cancellation.
//
// SECURITY: approval ONLY arrives via Genkit's restart metadata, which the
// resume flow constructs from the ORIGINAL stored interrupt part — the model
// cannot fabricate it (its only channels are tool args + text), and the
// client cannot alter the draft between confirm and execute. Genkit defaults
// missing restart metadata to `true`, which `interpretResumedConfirmation`
// deliberately reads as `pending` — fail-closed (the tool re-interrupts).
//
// Registration (pickChatTools) additionally requires `allowInterrupts`, so
// headless workflow runs never see these tools at all.

/** Resume-flow dispatch + pickChatTools registration both key on this set. */
export const CALENDAR_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "createCalendarEvent",
  "updateCalendarEvent",
])

/**
 * Discriminates the three terminal states. The client renders each
 * differently — `failed` gets an error badge, `declined` a neutral note —
 * which a bare `ok: false` couldn't distinguish (a deliberate Cancel must
 * not look like a Google API error).
 */
type CalendarWriteOutcome = "written" | "declined" | "failed"

interface CalendarWriteResult {
  ok: boolean
  outcome: CalendarWriteOutcome
  message: string
  event: CompactCalendarEvent | null
  retrievedAt: string
}

const writeFailure = (
  message: string,
  outcome: "declined" | "failed" = "failed"
): CalendarWriteResult => ({
  ok: false,
  outcome,
  message,
  event: null,
  retrievedAt: new Date().toISOString(),
})

const calendarWriteOutputSchema = z.object({
  /** `false` = nothing was written; `message` explains why (incl. decline). */
  ok: z.boolean(),
  /**
   * Terminal state. `declined` (user cancelled) is distinct from `failed`
   * (validation/binding/API problem) so the client can render them
   * differently — only `failed` is an error.
   */
  outcome: z.enum(["written", "declined", "failed"]),
  /**
   * Outcome summary for the MODEL to relay (not shown verbatim to the user
   * — the client card uses its own i18n copy keyed off `outcome`).
   */
  message: z.string(),
  /** The created/updated event (compact), null when `ok` is false. */
  event: calendarEventSchema.nullable(),
  retrievedAt: z.string(),
})

const writeTimeFields = {
  start: z
    .string()
    .optional()
    .describe(
      "Event start. Timed events: ISO-8601 date-time (e.g. " +
        "'2026-06-12T15:00:00Z'). All-day events (allDay: true): a " +
        "YYYY-MM-DD date."
    ),
  end: z
    .string()
    .optional()
    .describe(
      "Event end. REQUIRED for timed events and must be after start. " +
        "All-day events: optional last day (YYYY-MM-DD, inclusive)."
    ),
  allDay: z
    .boolean()
    .optional()
    .describe("True for an all-day event (start/end become YYYY-MM-DD dates)."),
  description: z.string().optional().describe("Optional event notes/agenda."),
  location: z.string().optional().describe("Optional location text."),
  attendees: z
    .array(z.string())
    .optional()
    .describe(
      "Optional attendee email addresses (max 20). No invitation emails " +
        "are sent."
    ),
}

const createCalendarEventInputSchema = z.object({
  summary: z
    .string()
    .optional()
    .describe("Event title (required, ≤300 chars)."),
  ...writeTimeFields,
})

const updateCalendarEventInputSchema = z.object({
  eventId: z
    .string()
    .optional()
    .describe(
      "Id of the event to change — exactly as returned by the " +
        "googleCalendar lookup tool (required)."
    ),
  summary: z.string().optional().describe("New event title (≤300 chars)."),
  ...writeTimeFields,
})

export type ConnectionToolRunContext = Parameters<
  Parameters<typeof ai.defineTool>[1]
>[1]

/**
 * Shared pending/approved/declined skeleton for EVERY connection write tool
 * (calendar P2, Drive D2, …). `execute` runs ONLY on an explicit
 * server-stamped approval and receives a fresh access token whose grant
 * passed the `requiredScope` check. Generic over the tool's result shape —
 * `fail` builds the tool-specific failure payload.
 */
export async function runConfirmedConnectionWrite<T>(opts: {
  ctx: ConnectionToolRunContext
  provider: ConnectionProvider
  copy: ConnectionAppCopy
  /**
   * Scope the binding must have GRANTED for this write — or `null` when the
   * provider gates writes by something other than OAuth scopes (GitHub App
   * permissions; an insufficient permission surfaces as a 403 at the API).
   */
  requiredScope: string | null
  missingScopeMessage: string
  /** Interrupt metadata tag the client card branches on. */
  confirmKind: string
  /** Pure-validation outcome: non-empty means the input failed validation. */
  problems: string[]
  cannotMessage: string
  declineMessage: string
  unavailableMessage: string
  fail: (message: string, outcome?: "declined" | "failed") => T
  execute: (accessToken: string) => Promise<T>
}): Promise<T> {
  const { ctx } = opts
  const actionContext = ctx.context as BotActionContext | undefined
  const teamId = actionContext?.teamId
  const uid = actionContext?.auth?.uid
  if (!teamId) {
    return opts.fail(opts.unavailableMessage)
  }
  if (opts.problems.length > 0) {
    return opts.fail(
      `${opts.cannotMessage}: ${opts.problems.join("; ")}. Fix the ` +
        "arguments and call the tool again."
    )
  }

  // Evaluate the decision FIRST. A decline must short-circuit before any
  // token work — otherwise a Cancel clicked after the access token expired
  // (or the grant was revoked) would be swallowed by a binding failure and
  // reported to the user as an error instead of the cancellation they asked
  // for. It also spares a pointless Google refresh round-trip on every
  // decline.
  const decision = interpretResumedConfirmation(ctx.resumed)
  if (decision === "declined") {
    return opts.fail(opts.declineMessage, "declined")
  }

  // Token + scope preflight for the two states that still need a live
  // binding: `pending` (never pose a confirmation that's doomed to fail) and
  // `approved` (the grant may have been revoked while the card sat open).
  // Deliberately `auth.uid` ONLY — never `connectionsActsAsUid`: writes are
  // confirm-gated by a PRESENT human, and headless runs (the only context
  // that carries actsAs) don't even register these tools. Defense in depth:
  // if one ever ran headlessly anyway, it would resolve no binding and
  // fail-soft rather than write through an absent member's account.
  const token = await resolveBindingAccessToken(
    teamId,
    opts.provider,
    uid || undefined
  )
  if (!token.ok) {
    return opts.fail(bindingFailureMessage(token.reason, opts.copy))
  }
  if (
    opts.requiredScope !== null &&
    !hasGrantedScope(token.grantedScopes, opts.requiredScope)
  ) {
    return opts.fail(opts.missingScopeMessage)
  }

  if (decision === "pending") {
    // Pause for the human. `interrupt()` throws Genkit's interrupt signal;
    // the resume flow restarts this tool with `{ approved }` stamped from
    // the member's authenticated Approve/Cancel click.
    ctx.interrupt({ confirm: opts.confirmKind })
  }
  return opts.execute(token.accessToken)
}

/** Calendar adapter over the generic skeleton (P2's original surface). */
function runConfirmedCalendarWrite(opts: {
  ctx: ConnectionToolRunContext
  problems: string[]
  execute: (accessToken: string) => Promise<CalendarWriteResult>
  declineMessage: string
  cannotMessage: string
}): Promise<CalendarWriteResult> {
  return runConfirmedConnectionWrite<CalendarWriteResult>({
    ...opts,
    provider: "google-calendar",
    copy: CALENDAR_COPY,
    requiredScope: GOOGLE_CALENDAR_EVENTS_SCOPE,
    missingScopeMessage:
      "The user's Google Calendar connection only allows reading events. " +
      "Ask them to reconnect it under Settings → Connections to grant " +
      "write access, then try again.",
    confirmKind: "calendarWrite",
    unavailableMessage:
      "Calendar writes are unavailable in this context (no team bound to " +
      "the conversation).",
    fail: writeFailure,
  })
}

/** POST/PATCH against the Calendar API with the read tool's status triage. */
async function executeCalendarWrite(opts: {
  url: string
  method: "POST" | "PATCH"
  accessToken: string
  payload: Record<string, unknown>
  successMessage: (event: CompactCalendarEvent | null) => string
}): Promise<CalendarWriteResult> {
  let status = 0
  let body: unknown = null
  try {
    const response = await fetch(opts.url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(opts.payload),
    })
    status = response.status
    body = await response.json().catch(() => null)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return writeFailure(
      `Calendar request failed before returning (${message}).`
    )
  }

  if (status === 401 || status === 403) {
    return writeFailure(googleAuthRejectionMessage(status, body, CALENDAR_COPY))
  }
  if (status < 200 || status >= 300) {
    const googleMessage =
      typeof body === "object" && body !== null
        ? ((body as { error?: { message?: unknown } }).error?.message ?? null)
        : null
    return writeFailure(
      `Google Calendar returned an error (HTTP ${status}` +
        `${typeof googleMessage === "string" ? `: ${googleMessage}` : ""}).`
    )
  }

  const event = compactCalendarEvents([body], 1)[0] ?? null
  return {
    ok: true,
    outcome: "written",
    message: opts.successMessage(event),
    event,
    retrievedAt: new Date().toISOString(),
  }
}

export const createCalendarEventTool = ai.defineTool(
  {
    name: "createCalendarEvent",
    description:
      "Create an event on the user's connected Google Calendar. Use this " +
      "when the user asks to schedule, book, or add something to their " +
      "calendar. Requires summary (title), start, and end (ISO-8601; or " +
      "allDay: true with YYYY-MM-DD dates). The user is shown the exact " +
      "event and must approve it before anything is written — calling this " +
      "tool only PROPOSES the event. Do not call it again after the user " +
      "declines unless they ask you to. No invitation emails are sent to " +
      "attendees.",
    inputSchema: createCalendarEventInputSchema,
    outputSchema: calendarWriteOutputSchema,
  },
  async (input, ctx) => {
    const draft = validateCalendarEventDraft(input)
    return runConfirmedCalendarWrite({
      ctx,
      problems: draft.ok ? [] : draft.problems,
      declineMessage:
        "The user declined creating this event. Nothing was written. Do " +
        "not retry unless they ask again.",
      cannotMessage: "Can't propose this event yet",
      execute: (accessToken) =>
        executeCalendarWrite({
          url: CALENDAR_EVENTS_ENDPOINT,
          method: "POST",
          accessToken,
          payload: draft.payload,
          successMessage: () => `Created ${draft.describe} on the calendar.`,
        }),
    })
  }
)

export const updateCalendarEventTool = ai.defineTool(
  {
    name: "updateCalendarEvent",
    description:
      "Update an existing event on the user's connected Google Calendar " +
      "(title, times, description, location, or attendees). Pass the " +
      "eventId from a googleCalendar lookup plus only the fields to " +
      "change; when changing times, pass BOTH start and end. The user is " +
      "shown the exact change and must approve it before anything is " +
      "written. Do not call it again after the user declines unless they " +
      "ask you to.",
    inputSchema: updateCalendarEventInputSchema,
    outputSchema: calendarWriteOutputSchema,
  },
  async (input, ctx) => {
    const patch = validateCalendarEventPatch(input)
    return runConfirmedCalendarWrite({
      ctx,
      problems: patch.ok ? [] : patch.problems,
      declineMessage:
        "The user declined this calendar change. Nothing was written. Do " +
        "not retry unless they ask again.",
      cannotMessage: "Can't propose this change yet",
      execute: (accessToken) =>
        executeCalendarWrite({
          url: `${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(patch.eventId)}`,
          method: "PATCH",
          accessToken,
          payload: patch.payload,
          successMessage: () => `Updated ${patch.describe} on the calendar.`,
        }),
    })
  }
)

// ===========================================================================
// Google Drive READ tools (D1) — docs/connections-google-drive.prompt.md
// ===========================================================================
//
// Same skeleton as the calendar read tool: binding resolved per chatting
// user (or a headless run's pre-validated `connectionsActsAsUid`) at call
// time, inputs clamped in the handler (never throw), every failure returned
// as narratable output. BOTH tools ride the ONE `googleDrive` install gate;
// `readDriveFile` has no integration doc of its own.

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files"

const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  /** RFC3339, or null when Google omits it. */
  modifiedTime: z.string().nullable(),
  owner: z.string().nullable(),
  link: z.string().nullable(),
  /** Bytes; null for native Google files (they store no size). */
  size: z.number().nullable(),
})

const googleDriveOutputSchema = z.object({
  /** `false` = the search couldn't run; `message` explains what to tell the user. */
  ok: z.boolean(),
  /** Summary when `ok`; a plain-language explanation the model should relay otherwise. */
  message: z.string(),
  files: z.array(driveFileSchema),
  retrievedAt: z.string(),
})

// Loose inputs, clamped in the handler (`clampDriveSearchInput`) — a
// pre-handler schema violation is turn-fatal, so even `mimeClass` is a plain
// string the clamp validates against the vocabulary.
const googleDriveInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Free text matched against file names and full content. Omit to " +
        "list recently modified files."
    ),
  mimeClass: z
    .string()
    .optional()
    .describe(
      "Filter by kind: 'document', 'spreadsheet', 'presentation', 'pdf' " +
        "or 'folder'. Omit for all kinds."
    ),
  modifiedAfter: z
    .string()
    .optional()
    .describe("Only files modified after this ISO-8601 timestamp."),
  folderId: z
    .string()
    .optional()
    .describe(
      "Restrict to files directly inside this folder (id or Drive URL " +
        "from an earlier result)."
    ),
  maxResults: z
    .number()
    .optional()
    .describe("How many files to return (1-25, default 10)."),
})

const driveFailure = (message: string) => ({
  ok: false,
  message,
  files: [],
  retrievedAt: new Date().toISOString(),
})

/**
 * Shared preflight: resolve the caller's Drive binding token. Interactive
 * turns act as the chatting user; headless runs fall back to the run's
 * pre-validated `connectionsActsAsUid` (P3) — identical to the calendar
 * read tool's identity rule.
 */
async function resolveDriveToken(
  ctx: BotActionContext | undefined
): Promise<{ ok: true; accessToken: string } | { ok: false; message: string }> {
  const teamId = ctx?.teamId
  if (!teamId) {
    return {
      ok: false,
      message:
        "Drive access is unavailable in this context (no team bound to " +
        "the conversation).",
    }
  }
  const token = await resolveBindingAccessToken(
    teamId,
    "google-drive",
    ctx?.auth?.uid || ctx?.connectionsActsAsUid || undefined
  )
  if (!token.ok) {
    return {
      ok: false,
      message: bindingFailureMessage(token.reason, DRIVE_COPY),
    }
  }
  return { ok: true, accessToken: token.accessToken }
}

export const googleDriveTool = ai.defineTool(
  {
    name: GOOGLE_DRIVE_TOOL_KEY,
    description:
      "Search files on the user's connected Google Drive (My Drive plus " +
      "shared drives). Call this for any question about their files, docs, " +
      'sheets, slides or folders — e.g. "find the Q3 roadmap doc", ' +
      '"what changed in the research folder this week". Returns file ' +
      "METADATA only — call readDriveFile with a result's id to read its " +
      "content. Read-only: it never creates or changes files. If the " +
      "result says the user hasn't connected Google Drive, relay that and " +
      "point them to Settings → Connections.",
    inputSchema: googleDriveInputSchema,
    outputSchema: googleDriveOutputSchema,
  },
  async (input, { context }) => {
    const ctx = context as BotActionContext | undefined
    const token = await resolveDriveToken(ctx)
    if (!token.ok) return driveFailure(token.message)

    const params = clampDriveSearchInput(input)
    const { q, orderBy } = buildDriveListQuery(params)
    const url = new URL(DRIVE_FILES_ENDPOINT)
    url.searchParams.set("q", q)
    url.searchParams.set("pageSize", String(params.maxResults))
    url.searchParams.set("fields", `files(${DRIVE_FILE_FIELDS})`)
    // Search the user's whole visible corpus: My Drive + shared drives.
    // `corpora=allDrives` requires both flags; Google may degrade very
    // large corpora to incomplete results, which is fine for a top-N tool.
    url.searchParams.set("corpora", "allDrives")
    url.searchParams.set("includeItemsFromAllDrives", "true")
    url.searchParams.set("supportsAllDrives", "true")
    // Omitted on fullText queries — the API rejects ordering there.
    if (orderBy) url.searchParams.set("orderBy", orderBy)

    let status = 0
    let body: unknown = null
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      })
      status = response.status
      body = await response.json().catch(() => null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return driveFailure(`Drive request failed before returning (${message}).`)
    }

    if (status === 401 || status === 403) {
      return driveFailure(googleAuthRejectionMessage(status, body, DRIVE_COPY))
    }
    if (status < 200 || status >= 300) {
      const detail = googleApiErrorDetail(body)
      return driveFailure(
        `Google Drive returned an error (HTTP ${status}` +
          `${detail ? `: ${detail}` : ""}).`
      )
    }

    const items =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).files
        : null
    const files = compactDriveFiles(items, params.maxResults)
    const what = params.query ? ` matching "${params.query}"` : ""
    return {
      ok: true,
      message:
        files.length === 0
          ? `No files found${what}.`
          : `${files.length} file(s)${what}. Use readDriveFile with a ` +
            "file's id to read its content.",
      files,
      retrievedAt: new Date().toISOString(),
    }
  }
)

const readDriveFileOutputSchema = z.object({
  /** `false` = the read couldn't run; `message` explains what to tell the user. */
  ok: z.boolean(),
  /**
   * Summary / boundary note when `ok` (e.g. binary files return metadata
   * with `content: null` and the reason here); failure explanation
   * otherwise.
   */
  message: z.string(),
  file: driveFileSchema.nullable(),
  /** Text content (Docs → markdown, Sheets → CSV); null when not readable. */
  content: z.string().nullable(),
  truncated: z.boolean(),
  /** Full content length before truncation (0 when no content). */
  totalChars: z.number(),
  retrievedAt: z.string(),
})

const readDriveFileInputSchema = z.object({
  fileId: z
    .string()
    .optional()
    .describe(
      "Drive file id — or a full Drive URL — from a googleDrive search " +
        "result (required)."
    ),
  maxChars: z
    .number()
    .optional()
    .describe(
      "Content budget in characters (1000-48000, default 16000). Longer " +
        "files are truncated with a marker."
    ),
})

const readFailure = (message: string) => ({
  ok: false,
  message,
  file: null,
  content: null,
  truncated: false,
  totalChars: 0,
  retrievedAt: new Date().toISOString(),
})

/** GET file metadata; returns the parsed body + HTTP status. */
async function fetchDriveFileMetadata(
  accessToken: string,
  fileId: string
): Promise<{ status: number; body: unknown } | { error: string }> {
  const url = new URL(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`)
  url.searchParams.set("fields", DRIVE_FILE_FIELDS)
  url.searchParams.set("supportsAllDrives", "true")
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export const readDriveFileTool = ai.defineTool(
  {
    name: GOOGLE_DRIVE_READ_FILE_TOOL_NAME,
    description:
      "Read the text content of a file on the user's connected Google " +
      "Drive. Google Docs come back as markdown, Sheets as CSV (first " +
      "sheet), Slides as plain text; text files are read directly. Pass " +
      "the fileId (or Drive URL) from a googleDrive search result. Long " +
      "content is truncated to the char budget; binaries like PDFs and " +
      "images return metadata and a link instead of content.",
    inputSchema: readDriveFileInputSchema,
    outputSchema: readDriveFileOutputSchema,
  },
  async (input, { context }) => {
    const fileId = extractDriveFileId(input.fileId)
    if (!fileId) {
      return readFailure(
        "fileId is required — pass the file's id (or its Drive URL) from a " +
          "googleDrive search result."
      )
    }
    const ctx = context as BotActionContext | undefined
    const token = await resolveDriveToken(ctx)
    if (!token.ok) return readFailure(token.message)

    const meta = await fetchDriveFileMetadata(token.accessToken, fileId)
    if ("error" in meta) {
      return readFailure(
        `Drive request failed before returning (${meta.error}).`
      )
    }
    if (meta.status === 404) {
      return readFailure(
        "Couldn't find that file on the user's Drive — re-check the id " +
          "with a googleDrive search."
      )
    }
    if (meta.status === 401 || meta.status === 403) {
      return readFailure(
        googleAuthRejectionMessage(meta.status, meta.body, DRIVE_COPY)
      )
    }
    if (meta.status < 200 || meta.status >= 300) {
      const detail = googleApiErrorDetail(meta.body)
      return readFailure(
        `Google Drive returned an error (HTTP ${meta.status}` +
          `${detail ? `: ${detail}` : ""}).`
      )
    }

    let file: CompactDriveFile | null =
      compactDriveFiles([meta.body], 1)[0] ?? null
    if (!file) {
      return readFailure("Google Drive returned an unreadable file record.")
    }
    // Shortcut hop: compaction swapped in the target id — fetch the
    // TARGET's metadata so name/size/link describe what we actually read.
    // A failed hop keeps the compact row; the content fetch then reports
    // its own error.
    if (file.id !== fileId) {
      const hop = await fetchDriveFileMetadata(token.accessToken, file.id)
      if (!("error" in hop) && hop.status >= 200 && hop.status < 300) {
        file = compactDriveFiles([hop.body], 1)[0] ?? file
      }
    }

    const retrievedAt = new Date().toISOString()
    const plan = planDriveRead(file.mimeType)
    if (plan.kind === "folder") {
      return {
        ok: true,
        message:
          "This is a folder, not a file. Call googleDrive with folderId: " +
          `'${file.id}' to list its contents.`,
        file,
        content: null,
        truncated: false,
        totalChars: 0,
        retrievedAt,
      }
    }
    if (plan.kind === "binary") {
      return {
        ok: true,
        message: plan.note,
        file,
        content: null,
        truncated: false,
        totalChars: 0,
        retrievedAt,
      }
    }
    if (
      plan.kind === "media" &&
      file.size !== null &&
      file.size > DRIVE_MEDIA_MAX_BYTES
    ) {
      return {
        ok: true,
        message:
          `This file is too large to read inline (${file.size} bytes). ` +
          "Share its link with the user instead.",
        file,
        content: null,
        truncated: false,
        totalChars: 0,
        retrievedAt,
      }
    }

    const contentUrl = new URL(
      plan.kind === "export"
        ? `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}/export`
        : `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}`
    )
    if (plan.kind === "export") {
      contentUrl.searchParams.set("mimeType", plan.exportMime)
    } else {
      contentUrl.searchParams.set("alt", "media")
      contentUrl.searchParams.set("supportsAllDrives", "true")
    }

    let status = 0
    let text = ""
    try {
      const response = await fetch(contentUrl, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      })
      status = response.status
      text = await response.text()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return readFailure(`Drive request failed before returning (${message}).`)
    }

    if (status === 401 || status === 403) {
      const body = ((): unknown => {
        try {
          return JSON.parse(text)
        } catch {
          return null
        }
      })()
      return readFailure(googleAuthRejectionMessage(status, body, DRIVE_COPY))
    }
    if (status < 200 || status >= 300) {
      return readFailure(`Google Drive returned an error (HTTP ${status}).`)
    }

    const budget = clampDriveReadChars(input.maxChars)
    const { content, truncated, totalChars } = truncateDriveContent(
      text,
      budget
    )
    const note = plan.kind === "export" && plan.note ? ` ${plan.note}` : ""
    return {
      ok: true,
      message:
        `Read "${file.name}"` +
        (truncated
          ? ` (truncated to ${budget} of ${totalChars} chars).`
          : ".") +
        note,
      file,
      content,
      truncated,
      totalChars,
      retrievedAt,
    }
  }
)

// ===========================================================================
// Google Drive WRITE tools (D2) — confirm-gated via the interrupt/restart
// channel, same mechanism as the calendar P2 writes
// (`runConfirmedConnectionWrite`). Strict drafts (driveCore validators),
// decline-before-preflight, `drive.file` grant gate pre-interrupt AND
// post-approval, never registered on headless runs (`allowInterrupts`).
// ===========================================================================

/** Resume-flow dispatch + pickChatTools registration both key on this set. */
export const DRIVE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  GOOGLE_DRIVE_WRITE_TOOL_NAMES
)

const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files"

type DriveWriteOutcome = "written" | "declined" | "failed"

interface DriveWriteResult {
  ok: boolean
  outcome: DriveWriteOutcome
  message: string
  file: CompactDriveFile | null
  retrievedAt: string
}

const driveWriteFailure = (
  message: string,
  outcome: "declined" | "failed" = "failed"
): DriveWriteResult => ({
  ok: false,
  outcome,
  message,
  file: null,
  retrievedAt: new Date().toISOString(),
})

const driveWriteOutputSchema = z.object({
  /** `false` = nothing was written; `message` explains why (incl. decline). */
  ok: z.boolean(),
  /**
   * Terminal state. `declined` (user cancelled) is distinct from `failed`
   * (validation/binding/API problem) so the client can render them
   * differently — only `failed` is an error.
   */
  outcome: z.enum(["written", "declined", "failed"]),
  /**
   * Outcome summary for the MODEL to relay (not shown verbatim to the user
   * — the client card uses its own i18n copy keyed off `outcome`).
   */
  message: z.string(),
  /** The created/updated file (compact), null when `ok` is false. */
  file: driveFileSchema.nullable(),
  retrievedAt: z.string(),
})

const createDriveFileInputSchema = z.object({
  name: z.string().optional().describe("File name (required, ≤300 chars)."),
  content: z
    .string()
    .optional()
    .describe("The file's full markdown content (required)."),
  kind: z
    .string()
    .optional()
    .describe(
      "'document' (default) converts the markdown into a Google Doc; " +
        "'text' stores it as a plain markdown file."
    ),
  folderId: z
    .string()
    .optional()
    .describe(
      "Destination folder id (or Drive URL) from a googleDrive lookup. " +
        "Omit to create in My Drive."
    ),
})

const updateDriveFileInputSchema = z.object({
  fileId: z
    .string()
    .optional()
    .describe(
      "Id (or Drive URL) of the file to update — from a googleDrive " +
        "search or an earlier createDriveFile result (required)."
    ),
  content: z
    .string()
    .optional()
    .describe(
      "Replacement markdown content (required — it replaces the whole " +
        "file)."
    ),
  name: z.string().optional().describe("Optional new file name."),
})

/** Build an RFC 2387 multipart/related body: metadata JSON + markdown media. */
function buildDriveMultipart(
  metadata: Record<string, unknown>,
  content: string
): { body: string; contentType: string } {
  const boundary = `lectornaut-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: text/markdown; charset=UTF-8\r\n\r\n" +
    `${content}\r\n` +
    `--${boundary}--`
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

/** POST/PATCH a multipart upload with the read tools' status triage. */
async function executeDriveWrite(opts: {
  url: string
  method: "POST" | "PATCH"
  accessToken: string
  metadata: Record<string, unknown>
  content: string
  successMessage: (file: CompactDriveFile | null) => string
}): Promise<DriveWriteResult> {
  const { body, contentType } = buildDriveMultipart(opts.metadata, opts.content)
  let status = 0
  let responseBody: unknown = null
  try {
    const response = await fetch(opts.url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": contentType,
      },
      body,
    })
    status = response.status
    responseBody = await response.json().catch(() => null)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return driveWriteFailure(
      `Drive request failed before returning (${message}).`
    )
  }

  if (status === 404) {
    // Under `drive.file`, files the app didn't create (and the user didn't
    // pick) are INVISIBLE — an update against one 404s rather than 403s.
    return driveWriteFailure(
      "Couldn't find that file to update — with the current Drive " +
        "permission the assistant can only edit files it created. Re-check " +
        "the id, or create a new file instead."
    )
  }
  if (status === 401 || status === 403) {
    const detail = googleApiErrorDetail(responseBody)
    // A file that's VISIBLE (drive.readonly) but not writable — someone
    // else's doc — is a per-file permission problem, not a connection
    // problem; the reconnect steer would be wrong.
    if (
      detail &&
      (detail.includes("insufficientFilePermissions") ||
        detail.includes("does not have sufficient permissions"))
    ) {
      return driveWriteFailure(
        "The user doesn't have edit access to that file (or it wasn't " +
          "created by this assistant). Suggest creating a new file instead."
      )
    }
    return driveWriteFailure(
      googleAuthRejectionMessage(status, responseBody, DRIVE_COPY)
    )
  }
  if (status < 200 || status >= 300) {
    const detail = googleApiErrorDetail(responseBody)
    return driveWriteFailure(
      `Google Drive returned an error (HTTP ${status}` +
        `${detail ? `: ${detail}` : ""}).`
    )
  }

  const file = compactDriveFiles([responseBody], 1)[0] ?? null
  return {
    ok: true,
    outcome: "written",
    message: opts.successMessage(file),
    file,
    retrievedAt: new Date().toISOString(),
  }
}

export const createDriveFileTool = ai.defineTool(
  {
    name: "createDriveFile" satisfies (typeof GOOGLE_DRIVE_WRITE_TOOL_NAMES)[number],
    description:
      "Create a file on the user's connected Google Drive from markdown " +
      "content. Use this when the user asks to save, export, or create a " +
      "doc in their Drive. Requires name and content; kind 'document' " +
      "(default) makes a Google Doc, 'text' a plain markdown file; " +
      "optional folderId targets a folder. The user is shown the exact " +
      "file and must approve it before anything is written — calling this " +
      "tool only PROPOSES it. Do not call it again after the user declines " +
      "unless they ask you to.",
    inputSchema: createDriveFileInputSchema,
    outputSchema: driveWriteOutputSchema,
  },
  async (input, ctx) => {
    const draft = validateDriveCreateDraft(input)
    return runConfirmedConnectionWrite<DriveWriteResult>({
      ctx,
      provider: "google-drive",
      copy: DRIVE_COPY,
      requiredScope: GOOGLE_DRIVE_FILE_SCOPE,
      missingScopeMessage:
        "The user's Google Drive connection doesn't include file-creation " +
        "access yet. Ask them to reconnect under Settings → Connections " +
        "and approve the Drive file access permission, then try again.",
      confirmKind: "driveWrite",
      problems: draft.ok ? [] : draft.problems,
      cannotMessage: "Can't propose this file yet",
      declineMessage:
        "The user declined creating this file. Nothing was written. Do " +
        "not retry unless they ask again.",
      unavailableMessage:
        "Drive writes are unavailable in this context (no team bound to " +
        "the conversation).",
      fail: driveWriteFailure,
      execute: (accessToken) => {
        const url = new URL(DRIVE_UPLOAD_ENDPOINT)
        url.searchParams.set("uploadType", "multipart")
        url.searchParams.set("supportsAllDrives", "true")
        url.searchParams.set("fields", DRIVE_FILE_FIELDS)
        return executeDriveWrite({
          url: url.toString(),
          method: "POST",
          accessToken,
          metadata: draft.metadata,
          content: draft.content,
          successMessage: () =>
            `Created ${draft.describe} in the user's Drive.`,
        })
      },
    })
  }
)

export const updateDriveFileTool = ai.defineTool(
  {
    name: "updateDriveFile" satisfies (typeof GOOGLE_DRIVE_WRITE_TOOL_NAMES)[number],
    description:
      "Replace the content of a file on the user's connected Google Drive " +
      "(optionally renaming it). Works on files this assistant created; " +
      "pass the fileId from an earlier createDriveFile or googleDrive " +
      "result plus the FULL new markdown content. The user is shown the " +
      "exact change and must approve it before anything is written. Do " +
      "not call it again after the user declines unless they ask you to.",
    inputSchema: updateDriveFileInputSchema,
    outputSchema: driveWriteOutputSchema,
  },
  async (input, ctx) => {
    const patch = validateDriveUpdateDraft(input)
    return runConfirmedConnectionWrite<DriveWriteResult>({
      ctx,
      provider: "google-drive",
      copy: DRIVE_COPY,
      requiredScope: GOOGLE_DRIVE_FILE_SCOPE,
      missingScopeMessage:
        "The user's Google Drive connection doesn't include file-editing " +
        "access yet. Ask them to reconnect under Settings → Connections " +
        "and approve the Drive file access permission, then try again.",
      confirmKind: "driveWrite",
      problems: patch.ok ? [] : patch.problems,
      cannotMessage: "Can't propose this change yet",
      declineMessage:
        "The user declined this file change. Nothing was written. Do not " +
        "retry unless they ask again.",
      unavailableMessage:
        "Drive writes are unavailable in this context (no team bound to " +
        "the conversation).",
      fail: driveWriteFailure,
      execute: (accessToken) => {
        const url = new URL(
          `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(patch.fileId)}`
        )
        url.searchParams.set("uploadType", "multipart")
        url.searchParams.set("supportsAllDrives", "true")
        url.searchParams.set("fields", DRIVE_FILE_FIELDS)
        return executeDriveWrite({
          url: url.toString(),
          method: "PATCH",
          accessToken,
          metadata: patch.metadata,
          content: patch.content,
          successMessage: () =>
            `Updated ${patch.describe} in the user's Drive.`,
        })
      },
    })
  }
)

/**
 * Gmail connection chat tools (docs/connections-feature.prompt.md).
 *
 * Read-only P1, both headless-eligible: `googleGmail` (inbox search — list
 * ids, then parallel metadata fetches; Gmail has no list-with-headers call)
 * + `readGmailMessage` (full MIME fetch → text body + attachment names).
 * No write tools — `gmail.send`/`gmail.modify` are separate restricted
 * scopes a future confirm-gated phase must earn.
 *
 * Registration is gated in `pickChatTools` on the published `googleGmail`
 * integration doc (`enabledBuiltInTools.has(GOOGLE_GMAIL_TOOL_KEY)`).
 *
 * Failure doctrine (load-bearing): every failure is RETURNED as tool output,
 * never thrown — a throw aborts the whole turn. All REST via global fetch.
 */

import { z } from "genkit/beta"
import type { BotActionContext } from "./botBuiltinTools.js"
import { resolveBindingAccessToken } from "./connections.js"
import {
  bindingFailureMessage,
  googleApiErrorDetail,
  googleAuthRejectionMessage,
  runConfirmedConnectionWrite,
  type ConnectionAppCopy,
} from "./connectionTools.js"
import {
  GOOGLE_GMAIL_READ_MESSAGE_TOOL_NAME,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_GMAIL_TOOL_KEY,
  GOOGLE_GMAIL_WRITE_TOOL_NAMES,
} from "./domain.js"
// Generic text-budget helpers despite the Drive naming — same clamp +
// truncation contract every content-read tool shares.
import { clampDriveReadChars, truncateDriveContent } from "./driveCore.js"
import { ai } from "./genkitClient.js"
import {
  buildGmailRawMessage,
  clampGmailSearchInput,
  compactGmailMessage,
  compactGmailMessages,
  extractGmailBody,
  gmailHeader,
  validateGmailSendDraft,
  type CompactGmailMessage,
  type GmailSendDraft,
} from "./gmailCore.js"

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

const GMAIL_COPY: ConnectionAppCopy = {
  app: "Gmail",
  api: "Gmail API",
  scopeNoun: "email",
}

// ─── Shared schemas + plumbing ───────────────────────────────────────────────

const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  subject: z.string().nullable(),
  /** ISO-8601 receive time. */
  date: z.string().nullable(),
  /** Gmail's short body preview. */
  snippet: z.string().nullable(),
  unread: z.boolean(),
  link: z.string(),
})

/**
 * Resolve the caller's Gmail binding token. Interactive turns act as the
 * chatting user; headless runs fall back to the run's pre-validated
 * `connectionsActsAsUid` — identical to the drive read tools' identity rule.
 */
async function resolveGmailToken(
  ctx: BotActionContext | undefined
): Promise<{ ok: true; accessToken: string } | { ok: false; message: string }> {
  const teamId = ctx?.teamId
  if (!teamId) {
    return {
      ok: false,
      message:
        "Gmail access is unavailable in this context (no team bound to " +
        "the conversation).",
    }
  }
  const token = await resolveBindingAccessToken(
    teamId,
    "google-gmail",
    ctx?.auth?.uid || ctx?.connectionsActsAsUid || undefined
  )
  if (!token.ok) {
    return {
      ok: false,
      message: bindingFailureMessage(token.reason, GMAIL_COPY),
    }
  }
  return { ok: true, accessToken: token.accessToken }
}

/** Call a Gmail endpoint; returns parsed body + status, or a network error. */
async function gmailFetch(
  url: URL,
  accessToken: string,
  init?: { method: "POST"; payload: Record<string, unknown> }
): Promise<{ status: number; body: unknown } | { error: string }> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init ? { "Content-Type": "application/json" } : {}),
      },
      ...(init ? { body: JSON.stringify(init.payload) } : {}),
    })
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

// ─── googleGmail (search) ────────────────────────────────────────────────────

const googleGmailOutputSchema = z.object({
  /** `false` = the search couldn't run; `message` explains what to tell the user. */
  ok: z.boolean(),
  /** Summary when `ok`; a plain-language explanation the model should relay otherwise. */
  message: z.string(),
  emails: z.array(gmailMessageSchema),
  retrievedAt: z.string(),
})

// Loose inputs, clamped in the handler — a pre-handler schema violation is
// turn-fatal (calendar/drive precedent).
const googleGmailInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Gmail search query — plain words plus Gmail operators like " +
        "'from:ana@example.com', 'to:', 'subject:', 'is:unread', " +
        "'has:attachment', 'label:', 'newer_than:7d'. Omit to list the " +
        "most recent mail."
    ),
  maxResults: z
    .number()
    .optional()
    .describe("How many messages to return (1-25, default 10)."),
})

const searchFailure = (message: string) => ({
  ok: false,
  message,
  emails: [],
  retrievedAt: new Date().toISOString(),
})

export const googleGmailTool = ai.defineTool(
  {
    name: GOOGLE_GMAIL_TOOL_KEY,
    description:
      "Search the user's connected Gmail inbox. Call this for any question " +
      'about their email — e.g. "any mail from Ana this week", "unread ' +
      'messages about the contract", "find the invoice from Stripe". ' +
      "Returns sender/subject/date plus a short snippet, newest first — " +
      "call readGmailMessage with a result's id to read the full body. " +
      "Read-only: it never sends, modifies or deletes mail. If the result " +
      "says the user hasn't connected Gmail, relay that and point them to " +
      "Settings → Connections.",
    inputSchema: googleGmailInputSchema,
    outputSchema: googleGmailOutputSchema,
  },
  async (input, { context }) => {
    const ctx = context as BotActionContext | undefined
    const token = await resolveGmailToken(ctx)
    if (!token.ok) return searchFailure(token.message)

    const params = clampGmailSearchInput(input)
    const listUrl = new URL(`${GMAIL_API}/messages`)
    listUrl.searchParams.set("maxResults", String(params.maxResults))
    if (params.query) listUrl.searchParams.set("q", params.query)

    const list = await gmailFetch(listUrl, token.accessToken)
    if ("error" in list) {
      return searchFailure(
        `Gmail request failed before returning (${list.error}).`
      )
    }
    if (list.status === 401 || list.status === 403) {
      return searchFailure(
        googleAuthRejectionMessage(list.status, list.body, GMAIL_COPY)
      )
    }
    if (list.status < 200 || list.status >= 300) {
      const detail = googleApiErrorDetail(list.body)
      return searchFailure(
        `Gmail returned an error (HTTP ${list.status}` +
          `${detail ? `: ${detail}` : ""}).`
      )
    }

    // The list call returns ids only — hydrate headers with parallel
    // metadata fetches (≤25; Gmail has no batch-with-headers list shape).
    const ids = (
      Array.isArray((list.body as Record<string, unknown> | null)?.messages)
        ? ((list.body as Record<string, unknown>).messages as unknown[])
        : []
    )
      .map((entry) =>
        typeof (entry as { id?: unknown })?.id === "string"
          ? ((entry as { id: string }).id ?? null)
          : null
      )
      .filter((id): id is string => id !== null)

    const metas = await Promise.all(
      ids.map(async (id) => {
        const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`)
        url.searchParams.set("format", "metadata")
        for (const header of ["From", "To", "Subject"]) {
          url.searchParams.append("metadataHeaders", header)
        }
        const result = await gmailFetch(url, token.accessToken)
        return "error" in result || result.status < 200 || result.status >= 300
          ? null
          : result.body
      })
    )
    const emails = compactGmailMessages(
      metas.filter((body) => body !== null),
      params.maxResults
    )

    const what = params.query ? ` matching "${params.query}"` : ""
    return {
      ok: true,
      message:
        emails.length === 0
          ? `No messages found${what}.`
          : `${emails.length} message(s)${what}, newest first. Use ` +
            "readGmailMessage with a message's id to read its full body.",
      emails,
      retrievedAt: new Date().toISOString(),
    }
  }
)

// ─── readGmailMessage (content fetch) ────────────────────────────────────────

const gmailAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string().nullable(),
  /** Bytes; null when Gmail omits it. */
  size: z.number().nullable(),
})

const readGmailMessageOutputSchema = z.object({
  /** `false` = the read couldn't run; `message` explains what to tell the user. */
  ok: z.boolean(),
  /** Summary / boundary note when `ok`; failure explanation otherwise. */
  message: z.string(),
  email: gmailMessageSchema.nullable(),
  /** Decoded body text (plain part preferred, stripped HTML fallback). */
  content: z.string().nullable(),
  truncated: z.boolean(),
  /** Full content length before truncation (0 when no content). */
  totalChars: z.number(),
  /** Attached files by name — attachment contents are not readable. */
  attachments: z.array(gmailAttachmentSchema),
  retrievedAt: z.string(),
})

const readGmailMessageInputSchema = z.object({
  messageId: z
    .string()
    .optional()
    .describe("Message id from a googleGmail search result (required)."),
  maxChars: z
    .number()
    .optional()
    .describe(
      "Content budget in characters (1000-48000, default 16000). Longer " +
        "bodies are truncated with a marker."
    ),
})

const readFailure = (message: string) => ({
  ok: false,
  message,
  email: null,
  content: null,
  truncated: false,
  totalChars: 0,
  attachments: [],
  retrievedAt: new Date().toISOString(),
})

export const readGmailMessageTool = ai.defineTool(
  {
    name: GOOGLE_GMAIL_READ_MESSAGE_TOOL_NAME,
    description:
      "Read the full body of one email on the user's connected Gmail. Pass " +
      "the messageId from a googleGmail search result. Returns the message " +
      "text (HTML mail is converted to plain text) plus attachment " +
      "filenames — attachment contents can't be read. Long bodies are " +
      "truncated to the char budget.",
    inputSchema: readGmailMessageInputSchema,
    outputSchema: readGmailMessageOutputSchema,
  },
  async (input, { context }) => {
    const messageId =
      typeof input.messageId === "string" && input.messageId.trim().length > 0
        ? input.messageId.trim()
        : null
    if (!messageId) {
      return readFailure(
        "messageId is required — pass the message's id from a googleGmail " +
          "search result."
      )
    }
    const ctx = context as BotActionContext | undefined
    const token = await resolveGmailToken(ctx)
    if (!token.ok) return readFailure(token.message)

    const url = new URL(
      `${GMAIL_API}/messages/${encodeURIComponent(messageId)}`
    )
    url.searchParams.set("format", "full")
    const result = await gmailFetch(url, token.accessToken)
    if ("error" in result) {
      return readFailure(
        `Gmail request failed before returning (${result.error}).`
      )
    }
    if (result.status === 404) {
      return readFailure(
        "Couldn't find that message on the user's Gmail — re-check the id " +
          "with a googleGmail search."
      )
    }
    if (result.status === 401 || result.status === 403) {
      return readFailure(
        googleAuthRejectionMessage(result.status, result.body, GMAIL_COPY)
      )
    }
    if (result.status < 200 || result.status >= 300) {
      const detail = googleApiErrorDetail(result.body)
      return readFailure(
        `Gmail returned an error (HTTP ${result.status}` +
          `${detail ? `: ${detail}` : ""}).`
      )
    }

    const email: CompactGmailMessage | null = compactGmailMessage(result.body)
    if (!email) {
      return readFailure("Gmail returned an unreadable message record.")
    }
    const payload = (result.body as Record<string, unknown>).payload
    const body = extractGmailBody(payload)
    const retrievedAt = new Date().toISOString()
    if (body.content === null) {
      return {
        ok: true,
        message:
          "This message has no readable text body" +
          (body.attachments.length > 0
            ? ` — it carries ${body.attachments.length} attachment(s), ` +
              "listed by name."
            : "."),
        email,
        content: null,
        truncated: false,
        totalChars: 0,
        attachments: body.attachments,
        retrievedAt,
      }
    }

    const budget = clampDriveReadChars(input.maxChars)
    const { content, truncated, totalChars } = truncateDriveContent(
      body.content,
      budget
    )
    return {
      ok: true,
      message:
        `Read "${email.subject ?? "(no subject)"}"` +
        (truncated
          ? ` (truncated to ${budget} of ${totalChars} chars).`
          : ".") +
        (body.attachments.length > 0
          ? ` ${body.attachments.length} attachment(s) listed by name.`
          : ""),
      email,
      content,
      truncated,
      totalChars,
      attachments: body.attachments,
      retrievedAt,
    }
  }
)

// ===========================================================================
// Gmail WRITE tool — confirm-gated send via the interrupt/restart channel,
// same mechanism as the calendar/drive/GitHub writes
// (`runConfirmedConnectionWrite`). Strict draft (gmailCore validator, incl.
// the header-injection CR/LF guard), decline-before-preflight, `gmail.send`
// grant gate pre-interrupt AND post-approval, never registered on headless
// runs (`allowInterrupts`). ONE verb: send — a reply is a send threaded via
// `replyToMessageId` (the handler resolves Message-ID/References/subject
// from the original, so the model can't misthread it).
// ===========================================================================

type GmailSendOutcome = "written" | "declined" | "failed"

interface GmailSendResult {
  ok: boolean
  outcome: GmailSendOutcome
  message: string
  email: CompactGmailMessage | null
  retrievedAt: string
}

const sendFailure = (
  message: string,
  outcome: "declined" | "failed" = "failed"
): GmailSendResult => ({
  ok: false,
  outcome,
  message,
  email: null,
  retrievedAt: new Date().toISOString(),
})

const sendGmailMessageOutputSchema = z.object({
  /** `false` = nothing was sent; `message` explains why (incl. decline). */
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
  /** The sent message (compact; headers are sparse on send responses). */
  email: gmailMessageSchema.nullable(),
  retrievedAt: z.string(),
})

const sendGmailMessageInputSchema = z.object({
  to: z
    .array(z.string())
    .optional()
    .describe(
      "Recipient email addresses (required, 1-10). Bare addresses or " +
        "'Name <addr>' form, one per entry."
    ),
  cc: z
    .array(z.string())
    .optional()
    .describe("Optional Cc addresses (max 10)."),
  subject: z
    .string()
    .optional()
    .describe(
      "Subject line (required for new mail, ≤300 chars). Omit when " +
        "replying to keep 'Re: <original subject>'."
    ),
  body: z
    .string()
    .optional()
    .describe("Plain-text message body (required, ≤50000 chars)."),
  replyToMessageId: z
    .string()
    .optional()
    .describe(
      "To reply within an existing conversation: the Gmail message id " +
        "(from a googleGmail search) being replied to. The send is " +
        "threaded into that conversation. Omit for fresh mail."
    ),
})

/** "Re: "-prefix the original subject (idempotently) for derived replies. */
function replySubject(original: string | null): string {
  if (!original) return "Re:"
  return /^re:/i.test(original) ? original : `Re: ${original}`
}

/**
 * Resolve threading for a reply: the original's RFC Message-ID (for
 * In-Reply-To/References), its thread, and a derived subject. A reply that
 * can't resolve its original FAILS rather than silently sending unthreaded
 * mail — the member approved a reply, not a new conversation.
 */
async function resolveReplyContext(
  accessToken: string,
  replyToMessageId: string
): Promise<
  | {
      ok: true
      threadId: string | null
      inReplyTo: string | null
      references: string | null
      derivedSubject: string
    }
  | { ok: false; message: string }
> {
  const url = new URL(
    `${GMAIL_API}/messages/${encodeURIComponent(replyToMessageId)}`
  )
  url.searchParams.set("format", "metadata")
  for (const header of ["Message-ID", "Subject", "References"]) {
    url.searchParams.append("metadataHeaders", header)
  }
  const result = await gmailFetch(url, accessToken)
  if ("error" in result) {
    return {
      ok: false,
      message: `Gmail request failed before returning (${result.error}).`,
    }
  }
  if (result.status === 404) {
    return {
      ok: false,
      message:
        "Couldn't find the message being replied to — re-check " +
        "replyToMessageId with a googleGmail search.",
    }
  }
  if (result.status < 200 || result.status >= 300) {
    const detail = googleApiErrorDetail(result.body)
    return {
      ok: false,
      message:
        `Couldn't load the message being replied to (HTTP ${result.status}` +
        `${detail ? `: ${detail}` : ""}).`,
    }
  }
  const record = result.body as Record<string, unknown>
  const payload =
    typeof record.payload === "object" && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : null
  const messageIdHeader = gmailHeader(payload?.headers, "Message-ID")
  const originalReferences = gmailHeader(payload?.headers, "References")
  return {
    ok: true,
    threadId: typeof record.threadId === "string" ? record.threadId : null,
    inReplyTo: messageIdHeader,
    references:
      [originalReferences, messageIdHeader].filter(Boolean).join(" ") || null,
    derivedSubject: replySubject(gmailHeader(payload?.headers, "Subject")),
  }
}

async function executeGmailSend(
  accessToken: string,
  draft: GmailSendDraft
): Promise<GmailSendResult> {
  let threadId: string | null = null
  let inReplyTo: string | null = null
  let references: string | null = null
  let subject = draft.subject ?? ""
  if (draft.replyToMessageId) {
    const reply = await resolveReplyContext(accessToken, draft.replyToMessageId)
    if (!reply.ok) return sendFailure(reply.message)
    threadId = reply.threadId
    inReplyTo = reply.inReplyTo
    references = reply.references
    if (!draft.subject) subject = reply.derivedSubject
  }

  const raw = buildGmailRawMessage({
    to: draft.to,
    cc: draft.cc,
    subject,
    body: draft.body,
    inReplyTo,
    references,
  })
  const result = await gmailFetch(
    new URL(`${GMAIL_API}/messages/send`),
    accessToken,
    { method: "POST", payload: { raw, ...(threadId ? { threadId } : {}) } }
  )
  if ("error" in result) {
    return sendFailure(
      `Gmail request failed before returning (${result.error}).`
    )
  }
  if (result.status === 401 || result.status === 403) {
    return sendFailure(
      googleAuthRejectionMessage(result.status, result.body, GMAIL_COPY)
    )
  }
  if (result.status < 200 || result.status >= 300) {
    const detail = googleApiErrorDetail(result.body)
    return sendFailure(
      `Gmail returned an error (HTTP ${result.status}` +
        `${detail ? `: ${detail}` : ""}).`
    )
  }

  return {
    ok: true,
    outcome: "written",
    message: `Sent ${draft.describe}.`,
    email: compactGmailMessage(result.body),
    retrievedAt: new Date().toISOString(),
  }
}

export const sendGmailMessageTool = ai.defineTool(
  {
    name: "sendGmailMessage" satisfies (typeof GOOGLE_GMAIL_WRITE_TOOL_NAMES)[number],
    description:
      "Send an email from the user's connected Gmail account. Use this " +
      "when the user asks to send, email, or reply to someone. Requires " +
      "to (recipients) and body; subject is required for new mail. To " +
      "reply within an existing conversation, pass replyToMessageId from a " +
      "googleGmail search — threading and the 'Re:' subject are handled " +
      "automatically. Plain text only; attachments can't be sent. The user " +
      "is shown the exact email and must approve it before anything is " +
      "sent — calling this tool only PROPOSES it. Do not call it again " +
      "after the user declines unless they ask you to.",
    inputSchema: sendGmailMessageInputSchema,
    outputSchema: sendGmailMessageOutputSchema,
  },
  async (input, ctx) => {
    const validation = validateGmailSendDraft(input)
    return runConfirmedConnectionWrite<GmailSendResult>({
      ctx,
      provider: "google-gmail",
      copy: GMAIL_COPY,
      requiredScope: GOOGLE_GMAIL_SEND_SCOPE,
      missingScopeMessage:
        "The user's Gmail connection only allows reading mail. Ask them " +
        "to reconnect under Settings → Connections and approve the send " +
        "permission, then try again.",
      confirmKind: "gmailSend",
      problems: validation.ok ? [] : validation.problems,
      cannotMessage: "Can't propose this email yet",
      declineMessage:
        "The user declined sending this email. Nothing was sent. Do not " +
        "retry unless they ask again.",
      unavailableMessage:
        "Gmail sends are unavailable in this context (no team bound to " +
        "the conversation).",
      fail: sendFailure,
      execute: (accessToken) =>
        validation.ok
          ? executeGmailSend(accessToken, validation.draft)
          : Promise.resolve(sendFailure("Draft validation failed.")),
    })
  }
)

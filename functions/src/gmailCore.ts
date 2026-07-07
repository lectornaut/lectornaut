/**
 * Pure Gmail logic — search-input clamping, message-row compaction (header
 * extraction), MIME body walking (base64url decode, plain-over-HTML
 * preference, tag stripping) and attachment listing. NO Firebase / Genkit
 * imports so `node --test` exercises it directly — same doctrine as
 * driveCore.ts / githubCore.ts: clamp-don't-throw, a tool arg violation must
 * never abort the turn.
 */

// ===========================================================================
// Caps
// ===========================================================================

export const GMAIL_MAX_RESULTS_CAP = 25
export const GMAIL_DEFAULT_MAX_RESULTS = 10

// ===========================================================================
// Search-input clamping
// ===========================================================================

export interface GmailSearchParams {
  /** Raw Gmail query string (`from:`, `subject:`, `is:unread`, …) or null. */
  query: string | null
  maxResults: number
}

export function clampGmailSearchInput(input: {
  query?: unknown
  maxResults?: unknown
}): GmailSearchParams {
  const query =
    typeof input.query === "string" && input.query.trim().length > 0
      ? input.query.trim()
      : null
  const raw =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.floor(input.maxResults)
      : GMAIL_DEFAULT_MAX_RESULTS
  return {
    query,
    maxResults: Math.min(Math.max(raw, 1), GMAIL_MAX_RESULTS_CAP),
  }
}

// ===========================================================================
// Message compaction (headers → row)
// ===========================================================================

export interface CompactGmailMessage {
  id: string
  threadId: string
  from: string | null
  to: string | null
  subject: string | null
  /** ISO-8601, from Gmail's epoch-ms `internalDate`; null when absent. */
  date: string | null
  /** Gmail's own short preview of the body (entity-decoded). */
  snippet: string | null
  unread: boolean
  /** Best-effort web permalink (default signed-in account). */
  link: string
}

interface GmailHeaderRecord {
  name?: unknown
  value?: unknown
}

/** Case-insensitive lookup in a Gmail `headers` name/value array. */
export function gmailHeader(headers: unknown, name: string): string | null {
  if (!Array.isArray(headers)) return null
  const wanted = name.toLowerCase()
  for (const entry of headers as GmailHeaderRecord[]) {
    if (
      typeof entry?.name === "string" &&
      entry.name.toLowerCase() === wanted &&
      typeof entry.value === "string" &&
      entry.value.length > 0
    ) {
      return entry.value
    }
  }
  return null
}

/**
 * Compact one Gmail message resource (format=metadata or format=full) into
 * the model-facing row. Null for records missing an id — Gmail always sends
 * one, so a hole means an error body slipped through.
 */
export function compactGmailMessage(body: unknown): CompactGmailMessage | null {
  if (typeof body !== "object" || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.id !== "string" || record.id.length === 0) return null
  const payload =
    typeof record.payload === "object" && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : null
  const headers = payload?.headers
  const internalMs =
    typeof record.internalDate === "string"
      ? Number.parseInt(record.internalDate, 10)
      : NaN
  const labelIds = Array.isArray(record.labelIds) ? record.labelIds : []
  return {
    id: record.id,
    threadId: typeof record.threadId === "string" ? record.threadId : record.id,
    from: gmailHeader(headers, "From"),
    to: gmailHeader(headers, "To"),
    subject: gmailHeader(headers, "Subject"),
    date: Number.isFinite(internalMs)
      ? new Date(internalMs).toISOString()
      : null,
    snippet:
      typeof record.snippet === "string" && record.snippet.length > 0
        ? decodeHtmlEntities(record.snippet)
        : null,
    unread: labelIds.includes("UNREAD"),
    link: `https://mail.google.com/mail/#all/${record.id}`,
  }
}

export function compactGmailMessages(
  items: readonly unknown[],
  cap: number
): CompactGmailMessage[] {
  const rows: CompactGmailMessage[] = []
  for (const item of items) {
    const row = compactGmailMessage(item)
    if (row) rows.push(row)
    if (rows.length >= cap) break
  }
  return rows
}

// ===========================================================================
// Body extraction (format=full MIME tree)
// ===========================================================================

export interface GmailAttachment {
  filename: string
  mimeType: string | null
  /** Bytes; null when Gmail omits it. */
  size: number | null
}

export interface GmailBodyResult {
  /** Decoded text — plain part preferred, stripped HTML fallback; null when
   * the message carries no readable text part. */
  content: string | null
  attachments: GmailAttachment[]
}

interface GmailPartRecord {
  mimeType?: unknown
  filename?: unknown
  body?: { data?: unknown; size?: unknown }
  parts?: unknown
}

/** Gmail body data is URL-safe base64 (unpadded) — Node decodes it natively. */
export function decodeGmailBodyData(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8")
}

/**
 * Walk the message payload: collect `text/plain` and `text/html` leaf parts
 * plus attachment rows (any part with a filename). Multipart alternatives
 * mean both text flavors usually exist — plain wins, HTML is stripped only
 * when no plain part came back.
 */
export function extractGmailBody(payload: unknown): GmailBodyResult {
  const plain: string[] = []
  const html: string[] = []
  const attachments: GmailAttachment[] = []

  const visit = (part: unknown): void => {
    if (typeof part !== "object" || part === null) return
    const record = part as GmailPartRecord
    const mimeType =
      typeof record.mimeType === "string" ? record.mimeType : null
    const filename =
      typeof record.filename === "string" && record.filename.length > 0
        ? record.filename
        : null
    const data =
      typeof record.body?.data === "string" && record.body.data.length > 0
        ? record.body.data
        : null
    if (filename) {
      attachments.push({
        filename,
        mimeType,
        size:
          typeof record.body?.size === "number" &&
          Number.isFinite(record.body.size)
            ? record.body.size
            : null,
      })
    } else if (data && mimeType === "text/plain") {
      plain.push(decodeGmailBodyData(data))
    } else if (data && mimeType === "text/html") {
      html.push(decodeGmailBodyData(data))
    }
    if (Array.isArray(record.parts)) record.parts.forEach(visit)
  }
  visit(payload)

  const content =
    plain.length > 0
      ? plain.join("\n").trim()
      : html.length > 0
        ? stripHtml(html.join("\n"))
        : null
  return { content: content || null, attachments }
}

// ===========================================================================
// HTML → text (fallback for HTML-only messages)
// ===========================================================================

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (match, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10))
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
      return NAMED_ENTITIES[named] ?? match
    }
  )
}

/**
 * Minimal HTML-to-text for email bodies: drop style/script/head blocks, turn
 * block-level closers and <br> into newlines, strip the remaining tags,
 * decode entities, collapse runs of blank lines. Deliberately not a real
 * HTML parser — marketing-mail soup only has to come out readable, not
 * faithful.
 */
export function stripHtml(htmlText: string): string {
  return decodeHtmlEntities(
    htmlText
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ===========================================================================
// Send-draft validation (confirm-gated write)
// ===========================================================================
// STRICT, never clamping — the confirm card renders the raw tool input, so
// what the member approves must be exactly what executes (calendar/drive
// write-validator doctrine).

export const GMAIL_SEND_MAX_RECIPIENTS = 10
export const GMAIL_SEND_MAX_SUBJECT_CHARS = 300
export const GMAIL_SEND_MAX_BODY_CHARS = 50_000

export interface GmailSendDraft {
  to: string[]
  cc: string[]
  /** Null only when replying — the reply derives "Re: <original>". */
  subject: string | null
  body: string
  /** Gmail message id being replied to; null for fresh mail. */
  replyToMessageId: string | null
  /** Short human-readable summary for success copy. */
  describe: string
}

export type GmailSendValidation =
  { ok: true; draft: GmailSendDraft } | { ok: false; problems: string[] }

/**
 * One address per array entry — bare (`ana@example.com`) or display-name
 * (`Ana <ana@example.com>`) form, as the search tool's `from` field returns.
 * CR/LF/NUL are rejected outright: recipients and subject become RFC 2822
 * HEADERS, and a newline smuggled through a model argument would inject
 * arbitrary headers (Bcc) behind the confirm card's back.
 */
function recipientProblem(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${field} entries must be non-empty strings`
  }
  if (/[\r\n\0]/.test(value)) return `${field} entries must be single-line`
  if (value.length > 320) return `${field} entries must be ≤320 chars`
  const addr = value.match(/<([^<>]+)>\s*$/)?.[1] ?? value
  if (!addr.includes("@")) {
    return `${field} entry "${value.trim()}" is not an email address`
  }
  return null
}

function collectRecipients(
  value: unknown,
  field: string,
  required: boolean,
  problems: string[]
): string[] {
  if (value === undefined || value === null) {
    if (required) problems.push(`${field} is required`)
    return []
  }
  if (!Array.isArray(value)) {
    problems.push(`${field} must be an array of email addresses`)
    return []
  }
  if (required && value.length === 0) problems.push(`${field} is required`)
  if (value.length > GMAIL_SEND_MAX_RECIPIENTS) {
    problems.push(
      `${field} allows at most ${GMAIL_SEND_MAX_RECIPIENTS} recipients`
    )
    return []
  }
  const out: string[] = []
  for (const entry of value) {
    const problem = recipientProblem(entry, field)
    if (problem) {
      problems.push(problem)
      continue
    }
    out.push((entry as string).trim())
  }
  return out
}

export function validateGmailSendDraft(input: {
  to?: unknown
  cc?: unknown
  subject?: unknown
  body?: unknown
  replyToMessageId?: unknown
}): GmailSendValidation {
  const problems: string[] = []

  const replyToMessageId =
    typeof input.replyToMessageId === "string" &&
    input.replyToMessageId.trim().length > 0
      ? input.replyToMessageId.trim()
      : null

  const to = collectRecipients(input.to, "to", true, problems)
  const cc = collectRecipients(input.cc, "cc", false, problems)

  let subject: string | null = null
  if (typeof input.subject === "string" && input.subject.trim().length > 0) {
    subject = input.subject.trim()
    if (/[\r\n\0]/.test(subject)) {
      problems.push("subject must be single-line")
    } else if (subject.length > GMAIL_SEND_MAX_SUBJECT_CHARS) {
      problems.push(`subject must be ≤${GMAIL_SEND_MAX_SUBJECT_CHARS} chars`)
    }
  } else if (!replyToMessageId) {
    // Replies derive "Re: <original subject>"; fresh mail must carry one.
    problems.push("subject is required (unless replying)")
  }

  const body = typeof input.body === "string" ? input.body : ""
  if (body.trim().length === 0) problems.push("body is required")
  if (body.length > GMAIL_SEND_MAX_BODY_CHARS) {
    problems.push(`body must be ≤${GMAIL_SEND_MAX_BODY_CHARS} chars`)
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    draft: {
      to,
      cc,
      subject,
      body,
      replyToMessageId,
      describe: `"${subject ?? "reply"}" to ${to.join(", ")}`,
    },
  }
}

// ===========================================================================
// RFC 2822 assembly (Gmail `messages.send` takes base64url raw bytes)
// ===========================================================================

/** RFC 2047 B-encoding for non-ASCII header text; ASCII passes through. */
export function encodeMimeHeaderText(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`
}

/**
 * Assemble the raw message and base64url-encode it for `messages.send`.
 * `From` is deliberately omitted — Gmail stamps the authenticated account,
 * so the binding's identity can't be spoofed by tool arguments. The body is
 * base64 transfer-encoded (folded at 76 cols), which sidesteps every
 * dot-stuffing/line-length pitfall of raw 8-bit text.
 */
export function buildGmailRawMessage(message: {
  to: string[]
  cc: string[]
  subject: string
  body: string
  inReplyTo?: string | null
  references?: string | null
}): string {
  const headers = [
    `To: ${message.to.join(", ")}`,
    ...(message.cc.length > 0 ? [`Cc: ${message.cc.join(", ")}`] : []),
    `Subject: ${encodeMimeHeaderText(message.subject)}`,
    ...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
    ...(message.references ? [`References: ${message.references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ]
  const encodedBody =
    Buffer.from(message.body, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  const raw = `${headers.join("\r\n")}\r\n\r\n${encodedBody}`
  return Buffer.from(raw, "utf8").toString("base64url")
}

/**
 * Multimodal media parts for chat turns.
 *
 * Builds Genkit `media` Parts (base64 `data:` URLs) from files in Firebase
 * Storage so the model can actually see image/PDF attachments. Used by:
 *   - `botContext.ts` — image/PDF attachments of attached context nodes.
 *   - (Phase 2) chat-session uploads selected for a turn.
 *
 * Why base64 `data:` URLs (not `gs://`/`https`): it's the ONLY form accepted
 * across all three installed providers — Gemini, Anthropic/Claude, and
 * OpenAI/gpt-5. `https`/`gs://` each fail on at least one provider, and PDFs
 * are base64-only everywhere. The cost: the bytes ride in-band on the turn
 * (no caching) and base64 inflates ~33%, so callers must gate by size/count.
 *
 * Pure Storage + string assembly — no Genkit registry side effects, so it's
 * safe to import from anywhere (no `ai` instance import, unlike
 * `genkitClient.ts`).
 */

import * as logger from "firebase-functions/logger"
import type { Part } from "genkit/beta"

import { admin, db } from "./firebase.js"
import { botSessionAttachmentsCollectionPath } from "./nodeAttachments.js"

/**
 * Content types we turn into media parts — the universal-safe intersection
 * accepted by Gemini + Claude + OpenAI as base64. Deliberately conservative:
 * `image/gif` is dropped (not reliably accepted by Gemini) and SVG is excluded
 * (script-injection risk; also blocked at upload). Unsupported types fall back
 * to the existing text-metadata bullet — no regression.
 */
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const PDF_CONTENT_TYPE = "application/pdf"

/**
 * Per-file caps. Images stay under Anthropic's ~5MB-per-image base64 ceiling
 * (3.5MB raw ≈ 4.7MB base64). PDFs get more headroom but stay within Gemini's
 * ~20MB total-inline request budget.
 */
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024
const MAX_PDF_BYTES = 8 * 1024 * 1024

export function isSupportedMediaContentType(
  mime: string | null | undefined
): boolean {
  if (!mime) return false
  return SUPPORTED_IMAGE_TYPES.has(mime) || mime === PDF_CONTENT_TYPE
}

function mediaSizeCap(contentType: string): number {
  return contentType === PDF_CONTENT_TYPE ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
}

/**
 * Download a Storage object and build a Genkit media `Part` as a base64
 * `data:` URL. Returns `null` (with a log) when the type is unsupported, the
 * file is over its size cap, or the download fails. Best-effort by design —
 * never throws, so a single bad attachment can't break the turn.
 */
export async function buildMediaPartFromStorage(opts: {
  storagePath: string
  contentType: string | null
  size: number | null
}): Promise<Part | null> {
  const { storagePath, contentType, size } = opts
  if (!contentType || !isSupportedMediaContentType(contentType)) return null

  const cap = mediaSizeCap(contentType)
  if (typeof size === "number" && size > cap) {
    logger.debug(
      `[botMedia] skip oversized media path=${storagePath} type=${contentType} size=${size} cap=${cap}`
    )
    return null
  }

  try {
    const [buffer] = await admin.storage().bucket().file(storagePath).download()
    // Re-check post-download in case the metadata `size` was missing/stale.
    if (buffer.byteLength > cap) {
      logger.debug(
        `[botMedia] skip oversized media (post-download) path=${storagePath} bytes=${buffer.byteLength} cap=${cap}`
      )
      return null
    }
    const base64 = buffer.toString("base64")
    const part: Part = {
      media: { url: `data:${contentType};base64,${base64}`, contentType },
    }
    return part
  } catch (err) {
    logger.warn("[botMedia] media download failed", {
      err: String(err),
      storagePath,
    })
    return null
  }
}

/**
 * Max chat-session uploads turned into media parts on a single turn. Bounds
 * request size + token cost; the per-turn selection on the client should keep
 * this well under the cap in practice.
 */
const MAX_SESSION_MEDIA_PARTS_PER_TURN = 6

/**
 * Resolve the chat-session attachment ids the user selected for this turn into
 * labeled media parts (text label + media) for the user prompt. Best-effort:
 * missing/unsupported/oversized/failed entries are skipped. Returns `[]` when
 * media is disabled, there's no session yet, or nothing was selected.
 */
export async function loadSessionAttachmentMediaParts(opts: {
  teamId: string
  workspaceId: string
  sessionId: string | null
  attachmentIds: readonly string[]
  includeMedia: boolean
}): Promise<Part[]> {
  if (
    !opts.includeMedia ||
    !opts.sessionId ||
    opts.attachmentIds.length === 0
  ) {
    return []
  }

  const collectionPath = botSessionAttachmentsCollectionPath(
    opts.teamId,
    opts.workspaceId,
    opts.sessionId
  )

  const parts: Part[] = []
  let count = 0
  for (const attachmentId of opts.attachmentIds) {
    if (count >= MAX_SESSION_MEDIA_PARTS_PER_TURN) break
    try {
      const snap = await db.doc(`${collectionPath}/${attachmentId}`).get()
      if (!snap.exists) continue
      const data = snap.data() ?? {}
      const storagePath =
        typeof data.storagePath === "string" ? data.storagePath : null
      if (!storagePath) continue
      const contentType =
        typeof data.mimeType === "string" ? data.mimeType : null
      const size = typeof data.size === "number" ? data.size : null
      const name =
        typeof data.displayName === "string" && data.displayName
          ? data.displayName
          : "file"

      const media = await buildMediaPartFromStorage({
        storagePath,
        contentType,
        size,
      })
      if (!media) continue
      parts.push({ text: `[Uploaded file "${name}"]` })
      parts.push(media)
      count += 1
    } catch (err) {
      logger.warn("[botMedia] session attachment load failed", {
        err: String(err),
        attachmentId,
      })
    }
  }
  return parts
}

import * as logger from "firebase-functions/logger"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { ServerClient } from "postmark"
import { EMAIL_FROM, EMAIL_OPTS } from "./runtimeConfig.js"
import { postmarkApiKey } from "./secrets.js"
import { EmailData } from "./types.js"

/**
 * COST OPTIMIZATION: Lazy singleton Postmark client.
 * Created once per warm instance instead of per invocation.
 * The ServerClient reuses HTTP connections across calls.
 */
let _postmarkClient: ServerClient | null = null
let _renderEmail:
  | ((templateName: string, data: Record<string, unknown>) => Promise<string>)
  | null = null
let _renderEmailLoader: Promise<void> | null = null

async function ensureEmailRendererLoaded(): Promise<void> {
  if (_renderEmail) {
    return
  }

  if (!_renderEmailLoader) {
    _renderEmailLoader = import("./emails/renderEmail.js").then((module) => {
      _renderEmail = module.renderEmail
    })
  }

  await _renderEmailLoader

  if (!_renderEmail) {
    throw new Error(
      "Email renderer module loaded but renderEmail export is missing"
    )
  }
}

function getPostmarkClient(): ServerClient {
  const key = postmarkApiKey.value()
  if (!key) {
    logger.error("POSTMARK_API_KEY is empty or not found")
    throw new Error("Missing POSTMARK_API_KEY")
  }

  if (!_postmarkClient) {
    _postmarkClient = new ServerClient(key)
  }

  return _postmarkClient
}

/**
 * Internal helper to send emails using Postmark
 */
export async function sendEmailInternal(data: EmailData) {
  const { email, subject, body, template, data: templateData } = data

  if (!email) {
    throw new Error("Email is required")
  }

  let htmlBody = body

  // If template is provided, render it
  if (template && templateData) {
    try {
      await ensureEmailRendererLoaded()
      // Local binding for type narrowing — ensureEmailRendererLoaded guarantees non-null
      const render = _renderEmail!
      htmlBody = await render(template, templateData)
    } catch (error) {
      logger.error(`Error rendering email template ${template}`, error)
      throw new Error(`Error rendering email template: ${error}`, {
        cause: error,
      })
    }
  }

  if (!htmlBody) {
    throw new Error("Either body or template and data must be provided")
  }

  const client = getPostmarkClient()

  try {
    const response = await client.sendEmail({
      From: EMAIL_FROM,
      To: email,
      Subject: subject,
      HtmlBody: htmlBody,
      MessageStream: "outbound",
    })
    logger.info(`[EMAIL] Postmark send accepted`, {
      to: email,
      subject,
      messageID: response?.MessageID,
      submittedAt: response?.SubmittedAt,
    })
    return { success: true }
  } catch (error) {
    logger.error("Error sending email", error)
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Error sending email: ${detail}`, { cause: error })
  }
}

/**
 * Callable function to send emails
 */
export const sendEmail = onCall(
  { ...EMAIL_OPTS, secrets: [postmarkApiKey], enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      )
    }

    try {
      return await sendEmailInternal(request.data)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes("Email is required") ||
        message.includes("Either body or template")
      ) {
        throw new HttpsError("invalid-argument", message)
      }
      throw new HttpsError("internal", message)
    }
  }
)

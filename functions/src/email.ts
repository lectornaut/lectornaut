import * as logger from "firebase-functions/logger"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { ServerClient } from "postmark"
import { renderEmail } from "./emails/renderEmail.js"
import { postmarkApiKey } from "./secrets.js"
import { EmailData } from "./types.js"

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
      htmlBody = renderEmail(template, templateData)
    } catch (error) {
      logger.error(`Error rendering email template ${template}`, error)
      throw new Error(`Error rendering email template: ${error}`)
    }
  }

  if (!htmlBody) {
    throw new Error("Either body or template and data must be provided")
  }

  const key = postmarkApiKey.value()
  if (!key) {
    logger.error("POSTMARK_API_KEY is empty or not found")
    throw new Error("Missing POSTMARK_API_KEY")
  }

  const client = new ServerClient(key)

  try {
    await client.sendEmail({
      From: "hello@lectornaut.com",
      To: email,
      Subject: subject,
      HtmlBody: htmlBody,
      MessageStream: "outbound",
    })
    return { success: true }
  } catch (error) {
    logger.error("Error sending email", error)
    throw new Error("Error sending email")
  }
}

/**
 * Callable function to send emails
 */
export const sendEmail = onCall(
  { secrets: [postmarkApiKey] },
  async (request) => {
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

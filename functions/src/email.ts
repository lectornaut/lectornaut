import * as logger from "firebase-functions/logger"
import { defineSecret } from "firebase-functions/params"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { ServerClient } from "postmark"
import { renderEmail } from "./emails/renderEmail.js"

const postmarkApiKey = defineSecret("POSTMARK_API_KEY")

export const sendEmail = onCall(
  { secrets: [postmarkApiKey] },
  async (request) => {
    const { email, subject, body, template, data } = request.data

    if (!email) {
      throw new HttpsError(
        "invalid-argument",
        "The function must be called with an email."
      )
    }

    let htmlBody = body

    // If template is provided, render it
    if (template && data) {
      try {
        htmlBody = renderEmail(template, data)
      } catch (error) {
        logger.error(`Error rendering email template ${template}`, error)
        throw new HttpsError(
          "internal",
          `Error rendering email template: ${error}`
        )
      }
    }

    if (!htmlBody) {
      throw new HttpsError(
        "invalid-argument",
        "The function must be called with either a body or a template and data."
      )
    }

    const client = new ServerClient(postmarkApiKey.value())

    try {
      await client.sendEmail({
        From: "hello@lectornaut.com",
        To: email,
        Subject: subject,
        HtmlBody: htmlBody,
        MessageStream: "outbound",
      })
      logger.info(`Email sent to ${email}`)
      return { success: true }
    } catch (error) {
      logger.error("Error sending email", error)
      throw new HttpsError("internal", "Error sending email")
    }
  }
)

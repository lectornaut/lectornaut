import admin from "firebase-admin"
import * as logger from "firebase-functions/logger"
import { sendEmailInternal } from "./email.js"
import {
  NotificationData,
  NotificationPreferences,
  NotificationType,
  NotificationTypeConfig,
} from "./types.js"

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

/**
 * Payload for sending a notification through all configured channels
 */
export interface NotificationPayload {
  /** Target user's UID */
  userId: string
  /** Target user's email (required for email channel) */
  userEmail?: string
  /** Type of notification - determines which channels are used */
  type: NotificationType
  /** Notification title */
  title: string
  /** Notification description/body */
  description: string
  /** URL to navigate to when notification is clicked */
  url: string
  /** Optional source entity information */
  source?: {
    entityType: string
    entityId: string
  }
  /** Optional email-specific data (overrides for email channel) */
  emailData?: {
    /** Custom email subject (defaults to title) */
    subject?: string
    /** Custom template name (defaults to notification type) */
    template?: string
    /** Additional template data */
    templateData?: Record<string, unknown>
  }
}

/**
 * Check user's notification preferences
 */
async function getUserPreferences(
  userId: string
): Promise<NotificationPreferences | null> {
  try {
    const prefsSnap = await db
      .doc(`users/${userId}/notificationPreferences/default`)
      .get()
    return (prefsSnap.data() as NotificationPreferences) || null
  } catch (error) {
    logger.error(`Error fetching notification preferences for ${userId}`, error)
    return null
  }
}

/**
 * Create an in-app notification for a user
 */
async function createInAppNotification(
  userId: string,
  notification: Omit<NotificationData, "createdAt" | "status" | "read">
): Promise<boolean> {
  try {
    await db.collection(`users/${userId}/notifications`).add({
      ...notification,
      status: "inbox",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return true
  } catch (error) {
    logger.error(`Error creating in-app notification for ${userId}`, error)
    return false
  }
}

/**
 * Send an email notification to a user
 */
async function sendEmailNotification(
  email: string,
  payload: NotificationPayload
): Promise<boolean> {
  try {
    const template = payload.emailData?.template || payload.type
    const subject = payload.emailData?.subject || payload.title

    // Build template data from payload and any overrides
    const templateData: Record<string, unknown> = {
      title: payload.title,
      description: payload.description,
      ctaUrl: `https://lectornaut.com${payload.url}`,
      ...payload.emailData?.templateData,
    }

    await sendEmailInternal({
      email,
      subject,
      template,
      data: templateData,
    })
    return true
  } catch (error) {
    logger.error(`Error sending email notification to ${email}`, error)
    return false
  }
}

/**
 * Send a notification through all configured channels.
 *
 * This is the main entry point for sending notifications. It will:
 * 1. Check the notification type's channel configuration
 * 2. Check user preferences to see if notifications are enabled
 * 3. Send to in-app and/or email channels as configured
 *
 * @param payload - The notification payload
 * @returns Object indicating success/failure for each channel
 */
export async function sendNotification(payload: NotificationPayload): Promise<{
  inApp: boolean
  email: boolean
}> {
  const { userId, userEmail, type } = payload
  const channelConfig = NotificationTypeConfig[type]

  const result = {
    inApp: false,
    email: false,
  }

  // Get user preferences
  const prefs = await getUserPreferences(userId)

  // Check global disable
  if (prefs?.enabled === false) {
    logger.info(`Notifications globally disabled for user ${userId}`)
    return result
  }

  // Check if this type is muted
  if (prefs?.mutedTypes?.includes(type)) {
    logger.info(`Notification type ${type} muted for user ${userId}`)
    return result
  }

  // Send to in-app channel
  if (channelConfig.inApp) {
    result.inApp = await createInAppNotification(userId, {
      type: payload.type,
      title: payload.title,
      description: payload.description,
      url: payload.url,
      source: payload.source,
    })
  }

  // Send to email channel
  if (channelConfig.email && userEmail) {
    result.email = await sendEmailNotification(userEmail, payload)
  } else if (channelConfig.email && !userEmail) {
    logger.warn(
      `Email channel configured for ${type} but no email provided for user ${userId}`
    )
  }

  return result
}

/**
 * Send a notification to multiple users.
 * Useful for team-wide notifications.
 */
export async function sendNotificationToMany(
  payloads: NotificationPayload[]
): Promise<void> {
  await Promise.all(payloads.map((payload) => sendNotification(payload)))
}

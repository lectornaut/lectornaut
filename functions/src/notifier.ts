import * as logger from "firebase-functions/logger"
import { COST_BUDGET } from "./costBudget.js"
import { sendEmailInternal } from "./email.js"
import { db } from "./firebase.js"
import {
  NotificationData,
  NotificationPayload,
  NotificationPreferences,
  NotificationTypeConfig,
} from "./types.js"

/**
 * COST OPTIMIZATION: Per-instance TTL cache for notification preferences.
 * Within the same warm function instance, repeated reads for the same user
 * are served from cache. This is especially valuable during fan-out
 * (e.g., notifying all admins triggers N calls to getUserPreferences).
 *
 * Cache is invalidated after PREFERENCE_CACHE_TTL_MS (default: 60s).
 * Correctness: stale preferences for up to 60s is acceptable —
 * a user who just muted notifications might get one more notification.
 */
interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const preferencesCache = new Map<
  string,
  CacheEntry<NotificationPreferences | null>
>()

function getCachedPreferences(
  userId: string
): NotificationPreferences | null | undefined {
  const entry = preferencesCache.get(userId)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    preferencesCache.delete(userId)
    return undefined
  }
  return entry.value
}

function setCachedPreferences(
  userId: string,
  prefs: NotificationPreferences | null
): void {
  preferencesCache.set(userId, {
    value: prefs,
    expiresAt: Date.now() + COST_BUDGET.PREFERENCE_CACHE_TTL_MS,
  })

  // Prevent unbounded cache growth (shouldn't happen in practice
  // since function instances handle limited concurrent requests)
  if (preferencesCache.size > 1000) {
    // Evict oldest entries
    const now = Date.now()
    for (const [key, entry] of preferencesCache) {
      if (now > entry.expiresAt) {
        preferencesCache.delete(key)
      }
    }
  }
}

/**
 * Check user's notification preferences (with caching)
 */
async function getUserPreferences(
  userId: string
): Promise<NotificationPreferences | null> {
  // Check cache first
  const cached = getCachedPreferences(userId)
  if (cached !== undefined) {
    return cached
  }

  try {
    const prefsSnap = await db
      .doc(`users/${userId}/notificationPreferences/default`)
      .get()
    const prefs = (prefsSnap.data() as NotificationPreferences) || null
    setCachedPreferences(userId, prefs)
    return prefs
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
    const { admin } = await import("./firebase.js")
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

  // Get user preferences (cached within instance)
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
 *
 * COST OPTIMIZATION: Preferences are cached per-instance,
 * so multiple sendNotification calls within the same request/instance
 * don't re-read the same user's preferences from Firestore.
 */
export async function sendNotificationToMany(
  payloads: NotificationPayload[]
): Promise<void> {
  // Cap fan-out to prevent runaway costs
  const capped = payloads.slice(0, COST_BUDGET.NOTIFICATION_FANOUT_MAX)
  if (payloads.length > COST_BUDGET.NOTIFICATION_FANOUT_MAX) {
    logger.warn(
      `[notifier] Fan-out capped at ${COST_BUDGET.NOTIFICATION_FANOUT_MAX}, ` +
        `${payloads.length - COST_BUDGET.NOTIFICATION_FANOUT_MAX} notifications dropped`
    )
  }
  await Promise.all(capped.map((payload) => sendNotification(payload)))
}

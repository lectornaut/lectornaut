import * as logger from "firebase-functions/logger"
import { COST_BUDGET } from "./costBudget.js"
import { sendEmailInternal } from "./email.js"
import { admin, db } from "./firebase.js"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  MembershipRoleLabels,
  NotificationData,
  NotificationPayload,
  NotificationSettings,
  NotificationTypeConfig,
  normalizeMembershipRole,
} from "./types.js"

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const settingsCache = new Map<string, CacheEntry<NotificationSettings>>()

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback

const normalizeNotificationSettings = (
  value: unknown
): NotificationSettings => {
  if (!isObjectRecord(value)) {
    return {
      categories: { ...DEFAULT_NOTIFICATION_SETTINGS.categories },
      frequency: DEFAULT_NOTIFICATION_SETTINGS.frequency,
      channels: { ...DEFAULT_NOTIFICATION_SETTINGS.channels },
    }
  }

  const categories = isObjectRecord(value.categories) ? value.categories : {}
  const channels = isObjectRecord(value.channels) ? value.channels : {}
  const frequency = value.frequency

  return {
    categories: {
      communication: normalizeBoolean(
        categories.communication,
        DEFAULT_NOTIFICATION_SETTINGS.categories.communication
      ),
      marketing: normalizeBoolean(
        categories.marketing,
        DEFAULT_NOTIFICATION_SETTINGS.categories.marketing
      ),
      // Security notifications are always enabled.
      security: true,
    },
    frequency:
      frequency === "immediate" ||
      frequency === "daily" ||
      frequency === "weekly" ||
      frequency === "none"
        ? frequency
        : DEFAULT_NOTIFICATION_SETTINGS.frequency,
    channels: {
      email: normalizeBoolean(
        channels.email,
        DEFAULT_NOTIFICATION_SETTINGS.channels.email
      ),
      inApp: normalizeBoolean(
        channels.inApp,
        DEFAULT_NOTIFICATION_SETTINGS.channels.inApp
      ),
      native: normalizeBoolean(
        channels.native,
        DEFAULT_NOTIFICATION_SETTINGS.channels.native
      ),
    },
  }
}

const getCachedSettings = (
  userId: string
): NotificationSettings | undefined => {
  const cached = settingsCache.get(userId)
  if (!cached) return undefined

  if (Date.now() > cached.expiresAt) {
    settingsCache.delete(userId)
    return undefined
  }

  return cached.value
}

const setCachedSettings = (userId: string, settings: NotificationSettings) => {
  settingsCache.set(userId, {
    value: settings,
    expiresAt: Date.now() + COST_BUDGET.PREFERENCE_CACHE_TTL_MS,
  })

  if (settingsCache.size > 1000) {
    const now = Date.now()
    for (const [key, entry] of settingsCache) {
      if (now > entry.expiresAt) {
        settingsCache.delete(key)
      }
    }
  }
}

const getUserNotificationSettings = async (
  userId: string
): Promise<NotificationSettings> => {
  const cached = getCachedSettings(userId)
  if (cached) return cached

  try {
    const settingsSnap = await db
      .doc(`users/${userId}/settings/notifications`)
      .get()
    const settings = normalizeNotificationSettings(settingsSnap.data())
    setCachedSettings(userId, settings)
    return settings
  } catch (error) {
    logger.error(`Error fetching notification settings for ${userId}`, error)
    return {
      categories: { ...DEFAULT_NOTIFICATION_SETTINGS.categories },
      frequency: DEFAULT_NOTIFICATION_SETTINGS.frequency,
      channels: { ...DEFAULT_NOTIFICATION_SETTINGS.channels },
    }
  }
}

const createInAppNotification = async (
  userId: string,
  notification: Omit<NotificationData, "createdAt" | "status" | "read">
): Promise<boolean> => {
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

const sendEmailNotification = async (
  email: string,
  payload: NotificationPayload
): Promise<boolean> => {
  try {
    const template = payload.emailData?.template || payload.type
    const subject = payload.emailData?.subject || payload.title

    const templateData: Record<string, unknown> = {
      title: payload.title,
      description: payload.description,
      ctaUrl: `https://lectornaut.com${payload.url}`,
      ...payload.emailData?.templateData,
    }

    if (template === "invitation.received") {
      const role = normalizeMembershipRole(templateData.role)
      templateData.role = role
      templateData.roleLabel = MembershipRoleLabels[role]
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

export async function sendNotification(payload: NotificationPayload): Promise<{
  inApp: boolean
  email: boolean
  native: boolean
}> {
  const { userId, userEmail, type } = payload
  const channelConfig = NotificationTypeConfig[type]
  const isSecurityNotification = channelConfig.category === "security"

  const result = {
    inApp: false,
    email: false,
    native: false,
  }

  const settings = await getUserNotificationSettings(userId)

  logger.info(`[NOTIF] Settings for user`, {
    userId,
    type,
    settings,
    channelConfig,
    isSecurityNotification,
  })

  if (!isSecurityNotification && !settings.categories[channelConfig.category]) {
    logger.info(
      `Notification category ${channelConfig.category} disabled for user ${userId}`
    )
    return result
  }

  if (!isSecurityNotification && settings.frequency === "none") {
    logger.info(`Notification frequency set to none for user ${userId}`)
    return result
  }

  const immediateExternalDelivery =
    isSecurityNotification || settings.frequency === "immediate"

  const shouldSendInApp =
    channelConfig.inApp &&
    (isSecurityNotification || settings.channels.inApp) &&
    (isSecurityNotification || settings.frequency !== "none")

  const shouldSendEmail =
    channelConfig.email && settings.channels.email && immediateExternalDelivery

  const shouldSendNative =
    channelConfig.native &&
    (isSecurityNotification || settings.channels.native) &&
    immediateExternalDelivery

  logger.info(`[NOTIF] Routing decisions`, {
    userId,
    type,
    shouldSendInApp,
    shouldSendEmail,
    shouldSendNative,
    immediateExternalDelivery,
  })

  if (shouldSendInApp) {
    result.inApp = await createInAppNotification(userId, {
      type: payload.type,
      title: payload.title,
      description: payload.description,
      url: payload.url,
      source: payload.source,
    })
  }

  if (shouldSendEmail && userEmail) {
    logger.info(`[NOTIF] Calling sendEmailNotification`, {
      userId,
      type,
      userEmail,
    })
    result.email = await sendEmailNotification(userEmail, payload)
    logger.info(`[NOTIF] sendEmailNotification returned`, {
      userId,
      type,
      ok: result.email,
    })
  } else if (shouldSendEmail && !userEmail) {
    logger.warn(
      `Email channel configured for ${type} but no email provided for user ${userId}`
    )
  } else {
    logger.info(`[NOTIF] Email send skipped`, {
      userId,
      type,
      shouldSendEmail,
      hasEmail: !!userEmail,
    })
  }

  // Native desktop notifications are delivered client-side.
  // This flag signals to the client whether a native notification should fire.
  result.native = shouldSendNative

  return result
}

export async function sendNotificationToMany(
  payloads: NotificationPayload[]
): Promise<void> {
  const capped = payloads.slice(0, COST_BUDGET.NOTIFICATION_FANOUT_MAX)
  if (payloads.length > COST_BUDGET.NOTIFICATION_FANOUT_MAX) {
    logger.warn(
      `Fan-out capped at ${COST_BUDGET.NOTIFICATION_FANOUT_MAX} notifications (requested ${payloads.length})`
    )
  }

  const results = await Promise.allSettled(
    capped.map((payload) => sendNotification(payload))
  )

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )

  if (failures.length > 0) {
    logger.error("Notification fan-out completed with failures", {
      requested: payloads.length,
      attempted: capped.length,
      failed: failures.length,
      errors: failures.map((failure) =>
        failure.reason instanceof Error
          ? failure.reason.message
          : String(failure.reason)
      ),
    })
  }
}

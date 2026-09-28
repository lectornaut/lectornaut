import { FieldValue, Timestamp } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { COST_BUDGET } from "./costBudget.js"
import { sendEmailInternal } from "./email.js"
import { db } from "./firebase.js"
import {
  planNotificationDelivery,
  type NotificationChannel,
} from "./notificationPolicy.js"
import { SCHEDULED_OPTS } from "./runtimeConfig.js"
import { postmarkApiKey } from "./secrets.js"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  MembershipRoleLabels,
  NotificationData,
  NotificationPayload,
  NotificationSettings,
  NotificationTypeConfig,
  normalizeMembershipRole,
  type NotificationType,
} from "./types.js"

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
      security: normalizeBoolean(
        categories.security,
        DEFAULT_NOTIFICATION_SETTINGS.categories.security
      ),
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

const getUserNotificationSettings = async (
  userId: string
): Promise<NotificationSettings | null> => {
  try {
    const settingsSnap = await db
      .doc(`users/${userId}/settings/notifications`)
      .get()
    return normalizeNotificationSettings(settingsSnap.data())
  } catch (error) {
    logger.error(`Error fetching notification settings for ${userId}`, error)
    return null
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
      createdAt: FieldValue.serverTimestamp(),
    })
    return true
  } catch (error) {
    logger.error(`Error creating in-app notification for ${userId}`, error)
    return false
  }
}

/**
 * Per-user feed the desktop app's main window listens to and turns into OS
 * notifications (`useNativeNotificationDelivery`). Client read-only; docs are
 * swept by a Firestore TTL policy on `expireAt`.
 */
export const NATIVE_NOTIFICATIONS_COLLECTION = "nativeNotifications"
const NATIVE_NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const createNativeNotification = async (
  userId: string,
  notification: {
    type: NotificationType | "notification.digest"
    title: string
    description: string
    url: string
  }
): Promise<boolean> => {
  try {
    await db
      .collection(`users/${userId}/${NATIVE_NOTIFICATIONS_COLLECTION}`)
      .add({
        ...notification,
        createdAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + NATIVE_NOTIFICATION_TTL_MS),
      })
    return true
  } catch (error) {
    logger.error(`Error creating native notification for ${userId}`, error)
    return false
  }
}

/**
 * Server-only queue of email/native deliveries held back by a `daily` or
 * `weekly` frequency. Drained by `flushNotificationDigests`; clients never
 * touch it (rules catch-all denies).
 */
export const NOTIFICATION_DIGEST_QUEUE_COLLECTION = "notificationDigestQueue"

type DigestFrequency = "daily" | "weekly"

interface DigestQueueItem {
  userId: string
  userEmail: string | null
  frequency: DigestFrequency
  inApp: boolean
  email: boolean
  native: boolean
  payload: NotificationPayload
}

function normalizeDigestQueueItem(
  value: Record<string, unknown>
): DigestQueueItem | null {
  const payloadValue = isObjectRecord(value.payload) ? value.payload : value
  const userId = value.userId
  const frequency = value.frequency
  const type = payloadValue.type
  const title = payloadValue.title
  const description = payloadValue.description
  const url = payloadValue.url

  if (
    typeof userId !== "string" ||
    (frequency !== "daily" && frequency !== "weekly") ||
    typeof type !== "string" ||
    !(type in NotificationTypeConfig) ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof url !== "string"
  ) {
    return null
  }

  const userEmail =
    typeof value.userEmail === "string"
      ? value.userEmail
      : typeof payloadValue.userEmail === "string"
        ? payloadValue.userEmail
        : null

  return {
    userId,
    userEmail,
    frequency,
    inApp: normalizeBoolean(value.inApp, false),
    email: normalizeBoolean(value.email, false),
    native: normalizeBoolean(value.native, false),
    payload: {
      userId,
      userEmail: userEmail ?? undefined,
      type: type as NotificationType,
      title,
      description,
      url,
      ...(isObjectRecord(payloadValue.source)
        ? { source: payloadValue.source as NotificationPayload["source"] }
        : {}),
      ...(isObjectRecord(payloadValue.emailData)
        ? {
            emailData:
              payloadValue.emailData as NotificationPayload["emailData"],
          }
        : {}),
    },
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

/**
 * Server-only Firestore collection holding queued `NotificationPayload`s.
 * Written by paths that must not pay delivery latency inline — today the
 * `beforeUserCreated` blocking function, whose 7-second platform cap can't
 * absorb a slow Postmark call (a blocking-function timeout fails the user's
 * sign-up itself). `onNotificationOutboxCreated` in `triggers.ts` delivers
 * each doc via `sendNotification` under a normal trigger budget and deletes
 * it on success. Clients never touch this collection (rules catch-all
 * denies), so no rules/index changes ride along.
 */
export const NOTIFICATION_OUTBOX_COLLECTION = "notificationOutbox"

/**
 * Queue a notification for asynchronous delivery instead of sending it
 * inline. Cheap and fast (one document write) — safe inside blocking
 * functions. Delivery semantics (settings gating, channel routing) are
 * unchanged: the outbox trigger just calls `sendNotification` later.
 */
export async function enqueueNotification(
  payload: NotificationPayload
): Promise<void> {
  await db.collection(NOTIFICATION_OUTBOX_COLLECTION).add({
    payload,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export async function sendNotification(
  payload: NotificationPayload,
  options: { onlyChannels?: readonly NotificationChannel[] } = {}
): Promise<{
  inApp: boolean
  email: boolean
  native: boolean
  digest: boolean
  suppressed: boolean
}> {
  const settings = await getUserNotificationSettings(payload.userId)
  if (!settings) {
    return {
      inApp: false,
      email: false,
      native: false,
      digest: false,
      suppressed: false,
    }
  }
  return deliverNotification(payload, settings, options)
}

async function deliverNotification(
  payload: NotificationPayload,
  settings: NotificationSettings,
  options: { onlyChannels?: readonly NotificationChannel[] } = {}
): Promise<{
  inApp: boolean
  email: boolean
  native: boolean
  digest: boolean
  suppressed: boolean
}> {
  const { userId, userEmail, type } = payload
  const channelConfig = NotificationTypeConfig[type]
  const plan = planNotificationDelivery(
    channelConfig,
    settings,
    options.onlyChannels
  )
  const result = {
    inApp: false,
    email: false,
    native: false,
    digest: false,
    suppressed: plan.mode === "disabled",
  }

  logger.info(`[NOTIF] Settings for user`, {
    userId,
    type,
    settings,
    channelConfig,
    plan,
  })

  if (plan.mode === "disabled") {
    logger.info(`Notification suppressed by settings for user ${userId}`, {
      type,
      category: channelConfig.category,
    })
    return result
  }

  if (plan.mode === "immediate" && plan.channels.inApp) {
    result.inApp = await createInAppNotification(userId, {
      type: payload.type,
      title: payload.title,
      description: payload.description,
      url: payload.url,
      source: payload.source,
    })
  }

  if (plan.mode === "immediate" && plan.channels.email && userEmail) {
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
  } else if (plan.channels.email && !userEmail) {
    logger.warn(
      `Email channel configured for ${type} but no email provided for user ${userId}`
    )
  } else {
    logger.info(`[NOTIF] Email send skipped`, {
      userId,
      type,
      shouldSendEmail: plan.mode === "immediate" && plan.channels.email,
      hasEmail: !!userEmail,
    })
  }

  if (plan.mode === "immediate" && plan.channels.native) {
    result.native = await createNativeNotification(userId, {
      type: payload.type,
      title: payload.title,
      description: payload.description,
      url: payload.url,
    })
  }

  if (plan.mode === "digest") {
    const digestEmail = plan.channels.email && !!userEmail
    const shouldQueueDigest =
      plan.channels.inApp || digestEmail || plan.channels.native

    if (!shouldQueueDigest) return result

    try {
      const item: DigestQueueItem = {
        userId,
        userEmail: userEmail ?? null,
        frequency: plan.frequency,
        inApp:
          channelConfig.inApp &&
          (!options.onlyChannels || options.onlyChannels.includes("inApp")),
        email:
          channelConfig.email &&
          !!userEmail &&
          (!options.onlyChannels || options.onlyChannels.includes("email")),
        native:
          channelConfig.native &&
          (!options.onlyChannels || options.onlyChannels.includes("native")),
        payload,
      }
      await db.collection(NOTIFICATION_DIGEST_QUEUE_COLLECTION).add({
        ...item,
        createdAt: FieldValue.serverTimestamp(),
      })
      result.digest = true
    } catch (error) {
      logger.error(`Error queueing notification digest for ${userId}`, error)
    }
  }

  return result
}

const DIGEST_PAGE_SIZE = 400
const DIGEST_EMAIL_ITEM_LIMIT = 20

async function deliverUserDigest(
  userId: string,
  items: DigestQueueItem[],
  settings: NotificationSettings,
  frequency: DigestFrequency
): Promise<void> {
  const live = items.filter((item) => {
    const config = NotificationTypeConfig[item.payload.type]
    return settings.categories[config.category]
  })
  if (live.length === 0 || settings.frequency === "none") return

  const emailItems = live.filter(
    (item) =>
      item.email &&
      NotificationTypeConfig[item.payload.type].email &&
      settings.channels.email &&
      item.userEmail
  )
  const inAppItems = live.filter(
    (item) =>
      item.inApp &&
      NotificationTypeConfig[item.payload.type].inApp &&
      settings.channels.inApp
  )
  const nativeItems = live.filter(
    (item) =>
      item.native &&
      NotificationTypeConfig[item.payload.type].native &&
      settings.channels.native
  )
  const period = frequency === "daily" ? "today" : "this week"

  if (inAppItems.length > 0) {
    const count = inAppItems.length
    await createInAppNotification(userId, {
      type: "notification.digest",
      title: `${count} new notification${count === 1 ? "" : "s"} ${period}`,
      description: inAppItems
        .slice(0, 3)
        .map((item) => item.payload.title)
        .join(" · "),
      url: "/start",
    })
  }

  if (emailItems.length > 0) {
    const count = emailItems.length
    try {
      await sendEmailInternal({
        email: emailItems[0].userEmail!,
        subject: `Your ${frequency} Lectornaut digest`,
        template: "notification.digest",
        data: {
          title: `${count} new notification${count === 1 ? "" : "s"} ${period}`,
          description: `Here's what happened on Lectornaut ${period}.`,
          items: emailItems.slice(0, DIGEST_EMAIL_ITEM_LIMIT).map((item) => ({
            title: item.payload.title,
            description: item.payload.description,
            ctaUrl: `https://lectornaut.com${item.payload.url}`,
          })),
          remaining: Math.max(0, count - DIGEST_EMAIL_ITEM_LIMIT),
          ctaUrl: "https://lectornaut.com/start",
        },
      })
    } catch (error) {
      logger.error(`Error sending digest email for ${userId}`, error)
    }
  }

  if (nativeItems.length > 0) {
    const count = nativeItems.length
    const [first] = nativeItems
    await createNativeNotification(
      userId,
      count === 1
        ? {
            type: first.payload.type,
            title: first.payload.title,
            description: first.payload.description,
            url: first.payload.url,
          }
        : {
            type: "notification.digest",
            title: `${count} new notifications ${period}`,
            description: nativeItems
              .slice(0, 3)
              .map((item) => item.payload.title)
              .join(" · "),
            url: "/start",
          }
    )
  }
}

async function flushPendingNotificationDigests(weeklyDue: boolean) {
  const byUser = new Map<
    string,
    { items: DigestQueueItem[]; refs: FirebaseFirestore.DocumentReference[] }
  >()
  const invalidRefs: FirebaseFirestore.DocumentReference[] = []
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined

  for (;;) {
    let q = db
      .collection(NOTIFICATION_DIGEST_QUEUE_COLLECTION)
      .limit(DIGEST_PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break

    for (const docSnap of snap.docs) {
      const item = normalizeDigestQueueItem(docSnap.data())
      if (!item) {
        logger.error("Invalid notification digest queue item", {
          id: docSnap.id,
        })
        invalidRefs.push(docSnap.ref)
        continue
      }
      const entry = byUser.get(item.userId) ?? { items: [], refs: [] }
      entry.items.push(item)
      entry.refs.push(docSnap.ref)
      byUser.set(item.userId, entry)
    }

    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < DIGEST_PAGE_SIZE) break
  }

  if (invalidRefs.length > 0) {
    const writer = db.bulkWriter()
    invalidRefs.forEach((ref) => void writer.delete(ref))
    await writer.close()
  }

  let delivered = 0
  for (const [userId, { items, refs }] of byUser) {
    try {
      const settings = await getUserNotificationSettings(userId)
      if (!settings) continue
      if (settings.frequency === "weekly" && !weeklyDue) continue

      if (settings.frequency === "daily" || settings.frequency === "weekly") {
        await deliverUserDigest(userId, items, settings, settings.frequency)
      } else if (settings.frequency === "immediate") {
        for (const item of items) {
          const onlyChannels: NotificationChannel[] = []
          if (item.inApp) onlyChannels.push("inApp")
          if (item.email) onlyChannels.push("email")
          if (item.native) onlyChannels.push("native")
          if (onlyChannels.length > 0) {
            await deliverNotification(item.payload, settings, { onlyChannels })
          }
        }
      }
      delivered += 1
    } catch (error) {
      logger.error(`Error delivering notification digest for ${userId}`, error)
      continue
    }

    const writer = db.bulkWriter()
    refs.forEach((ref) => void writer.delete(ref))
    await writer.close()
  }

  logger.info("[NOTIF] Flushed notification digests", {
    users: byUser.size,
    delivered,
  })
}

/**
 * Delivers queued `daily` digests every day at 09:00 UTC, and `weekly`
 * digests on Mondays at the same time. Pending items are re-routed by their
 * owners' current notification preferences before delivery.
 */
export const flushNotificationDigests = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "UTC",
    secrets: [postmarkApiKey],
    ...SCHEDULED_OPTS,
  },
  async () => {
    await flushPendingNotificationDigests(new Date().getUTCDay() === 1)
  }
)

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

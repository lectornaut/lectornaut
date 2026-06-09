import {
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
} from "@lectornaut/shared/domain"
import { z } from "zod"

/**
 * Notification schemas — consolidates `src/types/notification.ts` (the
 * individual notification entity) and `src/types/notifications.ts` (the
 * user's notification *settings* doc).
 *
 * The enum *members* live in `@lectornaut/shared/domain` (the cross-platform
 * single source of truth); these schemas derive their `z.enum`s from those
 * arrays so the client validator and the server union can never drift.
 *
 * Intentional quirk: `INotification.createdAt` is a plain JS `Date`, not a
 * Firestore `Timestamp`. Notifications are local ephemeral state that may
 * never round-trip through Firestore, so `z.date()` is the right primitive
 * here — NOT `timestampSchema`.
 */

// ─── Individual notification entity ──────────────────────────────────────────

export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES)

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES)

export const notificationSourceSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
})

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  description: z.string(),
  url: z.string(),
  status: notificationStatusSchema,
  read: z.boolean(),
  createdAt: z.date(),
  source: notificationSourceSchema.optional(),
})

// ─── User's notification settings doc ────────────────────────────────────────

export const notificationFrequencySchema = z.enum(NOTIFICATION_FREQUENCIES)

export const notificationCategorySettingsSchema = z.object({
  communication: z.boolean(),
  marketing: z.boolean(),
  security: z.boolean(),
})

export const notificationChannelSettingsSchema = z.object({
  email: z.boolean(),
  inApp: z.boolean(),
  native: z.boolean(),
})

export const userNotificationSettingsSchema = z.object({
  categories: notificationCategorySettingsSchema,
  frequency: notificationFrequencySchema,
  channels: notificationChannelSettingsSchema,
})

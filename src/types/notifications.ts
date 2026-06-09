import type {
  notificationCategorySettingsSchema,
  notificationChannelSettingsSchema,
  notificationFrequencySchema,
  userNotificationSettingsSchema,
} from "@/schemas/notifications"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_FREQUENCIES,
} from "@lectornaut/shared/domain"
import type { z } from "zod"

/**
 * User notification settings — re-exported `z.infer` types from
 * `src/schemas/notifications.ts`, plus the runtime constants and
 * normalization helpers that depend on the type values.
 *
 * The helpers (`normalizeNotificationSettings`, `cloneNotificationSettings`,
 * `areNotificationSettingsEqual`) stay here because they are used by stores
 * and composables to hydrate/validate settings before they reach the Zod
 * layer. Over time some of these could be simplified by leaning on
 * `parseSafe(userNotificationSettingsSchema, …)` instead.
 */

// `DEFAULT_NOTIFICATION_SETTINGS` + `NOTIFICATION_FREQUENCIES` now live in
// `@lectornaut/shared/domain` (one source for client + server); re-exported
// here so existing `@/types/notifications` importers are unaffected.
export { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_FREQUENCIES }

export type NotificationFrequency = z.infer<typeof notificationFrequencySchema>

export type NotificationCategorySettings = z.infer<
  typeof notificationCategorySettingsSchema
>

export type NotificationChannelSettings = z.infer<
  typeof notificationChannelSettingsSchema
>

export type UserNotificationSettings = z.infer<
  typeof userNotificationSettingsSchema
>

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback

export const normalizeNotificationFrequency = (
  value: unknown
): NotificationFrequency =>
  typeof value === "string" &&
  (NOTIFICATION_FREQUENCIES as readonly string[]).includes(value)
    ? (value as NotificationFrequency)
    : DEFAULT_NOTIFICATION_SETTINGS.frequency

export const cloneNotificationSettings = (
  value: UserNotificationSettings
): UserNotificationSettings => ({
  categories: {
    communication: value.categories.communication,
    marketing: value.categories.marketing,
    security: value.categories.security,
  },
  frequency: value.frequency,
  channels: {
    email: value.channels.email,
    inApp: value.channels.inApp,
    native: value.channels.native,
  },
})

export const normalizeNotificationSettings = (
  input: unknown
): UserNotificationSettings => {
  if (!isObjectRecord(input)) {
    return cloneNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
  }

  const categories = isObjectRecord(input.categories) ? input.categories : {}
  const channels = isObjectRecord(input.channels) ? input.channels : {}

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
    frequency: normalizeNotificationFrequency(input.frequency),
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

export const areNotificationSettingsEqual = (
  left: UserNotificationSettings,
  right: UserNotificationSettings
): boolean =>
  left.frequency === right.frequency &&
  left.categories.communication === right.categories.communication &&
  left.categories.marketing === right.categories.marketing &&
  left.categories.security === right.categories.security &&
  left.channels.email === right.channels.email &&
  left.channels.inApp === right.channels.inApp &&
  left.channels.native === right.channels.native

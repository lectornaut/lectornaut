export const NOTIFICATION_FREQUENCIES = [
  "immediate",
  "daily",
  "weekly",
  "none",
] as const

export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number]

export interface NotificationCategorySettings {
  communication: boolean
  marketing: boolean
  security: boolean
}

export interface NotificationChannelSettings {
  email: boolean
  inApp: boolean
  native: boolean
}

export interface UserNotificationSettings {
  categories: NotificationCategorySettings
  frequency: NotificationFrequency
  channels: NotificationChannelSettings
}

export const DEFAULT_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  categories: {
    communication: true,
    marketing: true,
    security: true,
  },
  frequency: "immediate",
  channels: {
    email: true,
    inApp: true,
    native: true,
  },
}

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

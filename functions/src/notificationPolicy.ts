import type { ChannelConfig, NotificationSettings } from "./types.js"

export type NotificationChannel = "inApp" | "email" | "native"

export type NotificationDeliveryPlan =
  | {
      mode: "disabled"
      frequency: null
      channels: Record<NotificationChannel, boolean>
    }
  | {
      mode: "immediate"
      frequency: null
      channels: Record<NotificationChannel, boolean>
    }
  | {
      mode: "digest"
      frequency: "daily" | "weekly"
      channels: Record<NotificationChannel, boolean>
    }

export function planNotificationDelivery(
  config: ChannelConfig,
  settings: NotificationSettings,
  onlyChannels?: readonly NotificationChannel[]
): NotificationDeliveryPlan {
  const disabled = (): NotificationDeliveryPlan => ({
    mode: "disabled",
    frequency: null,
    channels: { inApp: false, email: false, native: false },
  })

  if (!settings.categories[config.category] || settings.frequency === "none") {
    return disabled()
  }

  const channels: Record<NotificationChannel, boolean> = {
    inApp:
      config.inApp &&
      settings.channels.inApp &&
      (!onlyChannels || onlyChannels.includes("inApp")),
    email:
      config.email &&
      settings.channels.email &&
      (!onlyChannels || onlyChannels.includes("email")),
    native:
      config.native &&
      settings.channels.native &&
      (!onlyChannels || onlyChannels.includes("native")),
  }

  if (!channels.inApp && !channels.email && !channels.native) {
    return disabled()
  }

  if (settings.frequency === "immediate") {
    return { mode: "immediate", frequency: null, channels }
  }

  return {
    mode: "digest",
    frequency: settings.frequency,
    channels,
  }
}

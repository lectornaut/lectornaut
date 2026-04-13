import type {
  notificationSchema,
  notificationStatusSchema,
  notificationTypeSchema,
} from "@/schemas/notifications"
import type { z } from "zod"

/**
 * Notification entity type aliases — re-exported from
 * `src/schemas/notifications.ts`.
 *
 * Important: `INotification.createdAt` is `Date`, NOT a Firestore `Timestamp`.
 * This is a deliberate quirk — notifications are local ephemeral state.
 */

export type INotificationStatus = z.infer<typeof notificationStatusSchema>
export type INotificationType = z.infer<typeof notificationTypeSchema>
export type INotification = z.infer<typeof notificationSchema>

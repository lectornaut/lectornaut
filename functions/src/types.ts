import admin from "firebase-admin"

// Notification Channel Types
export type NotificationChannel = "in-app" | "email"

export interface ChannelConfig {
  inApp: boolean
  email: boolean
}

export type NotificationStatus = "inbox" | "saved" | "done"
export type NotificationType =
  | "user.welcome"
  | "invitation.received"
  | "invitation.declined"
  | "member.joined"
  | "member.removed"

// Default channel configuration for each notification type
export const NotificationTypeConfig: Record<NotificationType, ChannelConfig> = {
  "user.welcome": { inApp: true, email: true },
  "invitation.received": { inApp: true, email: true },
  "invitation.declined": { inApp: true, email: true },
  "member.joined": { inApp: true, email: true },
  "member.removed": { inApp: true, email: true },
}

export interface NotificationData {
  type: NotificationType
  title: string
  description: string
  url: string
  status: NotificationStatus
  read: boolean
  source?: {
    entityType: string
    entityId: string
  }
  createdAt: admin.firestore.FieldValue
}

export interface NotificationPreferences {
  enabled: boolean
  mutedTypes: string[]
}

export interface EmailData {
  email: string
  subject: string
  body?: string
  template?: string
  data?: Record<string, unknown>
}
export interface InvitationData {
  teamId: string
  teamName: string
  inviterName: string
  inviterEmail: string
  email: string
  role: string
  status: "pending" | "declined"
  code: string
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue
  resentAt?: admin.firestore.Timestamp | admin.firestore.FieldValue
}

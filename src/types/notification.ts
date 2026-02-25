export type INotificationStatus = "inbox" | "saved" | "done"

export type INotificationType =
  | "user.welcome"
  | "invitation.received"
  | "invitation.declined"
  | "member.joined"
  | "member.removed"

export interface INotification {
  readonly id: string
  type: INotificationType
  title: string
  description: string
  url: string
  status: INotificationStatus
  read: boolean
  createdAt: Date
  source?: {
    entityType: string
    entityId: string
  }
}

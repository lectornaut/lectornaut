import type { Timestamp } from "firebase/firestore"

export type ProjectChannelStatus = "active" | "paused" | "disabled"
export type ProjectChannelType = "webhook" | "email" | "slack" | "custom"

export interface ProjectChannel {
  id: string
  projectId: string
  name: string
  type: ProjectChannelType
  endpoint: string
  secret?: string
  status: ProjectChannelStatus
  failureCount: number
  createdAt: Timestamp | Date | null
  updatedAt: Timestamp | Date | null
  lastDeliveryAt?: Timestamp | Date | null
}

export type ProjectDeliveryStatus = "success" | "failed" | "pending"

export interface ProjectDelivery {
  id: string
  projectId: string
  channelId: string
  payloadSummary: string
  status: ProjectDeliveryStatus
  responseCode: number | null
  durationMs: number | null
  error?: string | null
  loggedAt: Timestamp | Date | null
}

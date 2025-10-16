import type { FieldValue, Timestamp } from "firebase/firestore"
import type { UUIDTypes } from "uuid"

export interface ITodo {
  id: UUIDTypes
  title: string
  completed: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ITeam {
  id: UUIDTypes
  name: string
  members: Array<string>
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ProjectChannelType =
  | "webhook"
  | "http"
  | "email"
  | "slack"
  | (string & {})

export interface ProjectChannel {
  id: string
  projectId: string
  name: string
  type: ProjectChannelType
  description?: string
  secret?: string | null
  isDisabled?: boolean
  metadata?: Record<string, unknown>
  createdAt: Timestamp
  updatedAt: Timestamp
  lastDeliveryAt?: Timestamp
}

export type ProjectChannelMutationPayload = Omit<
  ProjectChannel,
  "id" | "createdAt" | "updatedAt"
> & {
  createdAt?: Timestamp | FieldValue
  updatedAt?: Timestamp | FieldValue
}

export type ProjectDeliveryStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | (string & {})

export interface ProjectDelivery {
  id: string
  channelId: string
  projectId: string
  status: ProjectDeliveryStatus
  createdAt: Timestamp
  updatedAt: Timestamp
  responseCode?: number
  durationMs?: number
  summary?: string
  errorMessage?: string
  request?: Record<string, unknown>
  response?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ProjectDeliveryStats {
  total: number
  success: number
  failed: number
  pending: number
  successRate: number
  averageDurationMs: number | null
  lastFailureAt?: Timestamp | null
}

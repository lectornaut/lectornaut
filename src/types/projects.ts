export type ProjectDeliveryStatus =
  | "success"
  | "failed"
  | "pending"
  | "processing"
  | "queued"
  | "retrying"
  | "throttled"
  | "skipped"

export interface ProjectDeliveryError {
  message: string
  code?: string
  stack?: string
  occurredAt?: string
  detail?: string
}

export interface ProjectDeliveryLog {
  id: string
  channelId: string
  status: ProjectDeliveryStatus
  attempt: number
  destination: string
  triggeredAt: string
  completedAt?: string | null
  responseTimeMs?: number | null
  sizeBytes?: number
  requestPayload: unknown
  transformedPayload?: unknown
  responsePayload?: unknown
  error?: ProjectDeliveryError | null
  test?: boolean
}

export interface ProjectChannelStats {
  successRate?: number
  avgResponseMs?: number
  lastError?: {
    deliveryId?: string
    message: string
    at?: string
    code?: string
  }
}

export interface ProjectChannel {
  id: string
  name: string
  description?: string
  target?: string
  stats?: ProjectChannelStats
}

export interface ProjectChannelSummary {
  channelId: string
  channelName: string
  successRate: number
  averageResponseMs: number
  totalDeliveries: number
  successCount: number
  failureCount: number
  lastError?: ProjectDeliveryError & { deliveryId?: string }
}

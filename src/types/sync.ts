export type SyncMutationType = "set" | "update" | "delete"

export type SyncOperationStatus = "pending" | "sent" | "acked" | "rejected"

export interface SyncBaseVersion {
  field: string
  value: number | string | null
}

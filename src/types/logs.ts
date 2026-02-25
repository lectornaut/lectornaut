import { Timestamp } from "firebase/firestore"

export type LogResourceType = "team" | "workspace" | "content" | "membership"

export interface ILogActor {
  userId: string
  email?: string | null
  role?: string | null
}

export interface ILogResource {
  type: LogResourceType
  id: string
  parentId?: string | null
}

export interface ILogContext {
  ip?: string
  userAgent?: string
  authType?: "password" | "sso" | "api"
}

export interface ILogChanges {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  fields?: string[]
}

export interface ILogEntry {
  readonly id: string
  timestamp: Timestamp
  teamId: string
  workspaceId?: string
  actor: ILogActor
  action: string
  resource: ILogResource
  context?: ILogContext
  changes?: ILogChanges
}

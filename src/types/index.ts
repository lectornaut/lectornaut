import { Timestamp } from "firebase/firestore"
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

export const FIRESTORE_PROJECTS_COLLECTION = "projects"
export const FIRESTORE_CHANNELS_COLLECTION = "channels"
export const FIRESTORE_CHANNEL_LOGS_COLLECTION = "logs"

export const CHANNEL_NAME_MAX_LENGTH = 120
export const CHANNEL_DESCRIPTION_MAX_LENGTH = 2000
export const CHANNEL_SECRET_HASH_LENGTH = 64
export const CHANNEL_LOG_MESSAGE_MAX_LENGTH = 8000
export const CHANNEL_LOG_IO_MAX_LENGTH = 20000

export enum ChannelKind {
  Webhook = "webhook",
  Api = "api",
  Automation = "automation",
}

export enum ChannelStatus {
  Draft = "draft",
  Active = "active",
  Disabled = "disabled",
  Archived = "archived",
}

export enum ChannelLogSeverity {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
  Fatal = "fatal",
}

export enum ChannelLogDirection {
  Incoming = "incoming",
  Outgoing = "outgoing",
  System = "system",
}

export interface ChannelStats {
  totalLogs: number
  totalTokens: number
  lastLogAt: Timestamp | null
  lastErrorAt: Timestamp | null
}

export interface Channel {
  id: string
  projectId: string
  ownerId: string
  name: string
  description: string | null
  kind: ChannelKind
  status: ChannelStatus
  signingSecretHash: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
  stats: ChannelStats
}

export interface ChannelLog {
  id: string
  channelId: string
  projectId: string
  ownerId: string
  severity: ChannelLogSeverity
  direction: ChannelLogDirection
  message: string
  input: string | null
  output: string | null
  createdAt: Timestamp
}

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

export type ProjectChannelStatus = "active" | "paused" | "error"

export interface ProjectChannel {
  id: string
  name: string
  targetUrl: string
  status: ProjectChannelStatus
  secret: string
  transformation: string
  createdAt: Date
  updatedAt: Date
  lastEventAt: Date | null
  totalEvents: number
  successRate: number
}

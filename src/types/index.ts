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

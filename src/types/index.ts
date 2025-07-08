import { Timestamp } from "firebase/firestore"
import type { UUIDTypes } from "uuid"

export interface ITodo {
  id: UUIDTypes
  title: string
  completed: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

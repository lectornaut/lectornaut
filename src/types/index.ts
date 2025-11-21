import { Timestamp } from "firebase/firestore"

export interface ITodo {
  id: string
  title: string
  completed: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ITeam {
  id: string
  name: string
  members: Array<string>
  createdAt: Timestamp
  updatedAt: Timestamp
}

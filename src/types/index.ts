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
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  currentTeamId: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IMembership {
  id: string // same as userId
  userId: string
  teamId: string
  role: "owner" | "member"
  user: IUser // Snapshot of user data
  team: ITeam // Snapshot of team data
  createdAt: Timestamp
  updatedAt: Timestamp
}

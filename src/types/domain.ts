import { Timestamp } from "firebase/firestore"

export interface ITeam {
  readonly id: string
  name: string
  photoURL?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IWorkspace {
  readonly id: string
  readonly teamId: string
  name: string
  description?: string | null
  photoURL?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IUser {
  readonly uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  currentTeamId: string | null
  currentWorkspaceId: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

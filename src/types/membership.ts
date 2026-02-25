import type { ITeam, IUser } from "@/types/domain"
import { Timestamp } from "firebase/firestore"

export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "guest"] as const

export type IMembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export function isMembershipRole(value: unknown): value is IMembershipRole {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_ROLES as readonly string[]).includes(value)
  )
}

export interface IMembership {
  readonly userId: string
  readonly teamId: string
  role: IMembershipRole
  user: IUser
  team: ITeam
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IMembershipDocData {
  userId: string
  teamId: string
  role: IMembershipRole
  user: Partial<IUser>
  team: Partial<ITeam>
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

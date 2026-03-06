import type { ITeam, IUserProfile } from "@/types/domain"
import { Timestamp } from "firebase/firestore"

export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "guest"] as const

export type IMembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export function isMembershipRole(value: unknown): value is IMembershipRole {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_ROLES as readonly string[]).includes(value)
  )
}

export interface IMembershipRecord {
  readonly userId: string
  readonly teamId: string
  role: IMembershipRole
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type IMembershipUserSnapshot = Pick<
  IUserProfile,
  | "uid"
  | "email"
  | "displayName"
  | "photoURL"
  | "username"
  | "isPublic"
  | "createdAt"
  | "updatedAt"
>

export type IMembershipTeamSnapshot = Pick<
  ITeam,
  | "id"
  | "name"
  | "photoURL"
  | "username"
  | "isPublic"
  | "createdAt"
  | "updatedAt"
>

export interface IMembership extends IMembershipRecord {
  user: IMembershipUserSnapshot
  team: IMembershipTeamSnapshot
}

export interface IMembershipDocData {
  readonly userId: string
  readonly teamId: string
  role: IMembershipRole
  user: Partial<IMembershipUserSnapshot>
  team: Partial<IMembershipTeamSnapshot>
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

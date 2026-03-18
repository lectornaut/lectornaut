import type { ITeam, IUserProfile } from "@/types/domain"
import { Timestamp } from "firebase/firestore"

// Re-export role primitives from the shared module so existing imports
// like `import { IMembershipRole } from "@/types/membership"` keep working.
export {
  isMembershipRole,
  MEMBERSHIP_ROLES,
  type IMembershipRole,
} from "@shared/permissions"

import type { IMembershipRole } from "@shared/permissions"

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

import { Timestamp } from "firebase/firestore"

export type BillingPlanKey =
  | "personal"
  | "professional"
  | "business"
  | "enterprise"
export type BillingInterval = "month" | "year"

export interface ITeamBilling {
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripeScheduleId: string | null
  planKey: BillingPlanKey | null
  interval: BillingInterval | null
  priceId: string | null
  quantity: number | null
  status: string | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  lastInvoiceId: string | null
  lastInvoiceStatus: string | null
  lastStripeEventId: string | null
  lastStripeEventCreated: number | null
  isEntitled: boolean
  updatedAt?: Timestamp
}

export interface ITeam {
  readonly id: string
  name: string
  photoURL?: string | null
  username?: string | null
  isPublic?: boolean
  billing?: Partial<ITeamBilling> | null
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

export interface IUserProfile {
  readonly uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  username: string | null
  isPublic: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type IUser = IUserProfile

export interface IUserPreferences {
  currentTeamId: string | null
  onboarding: boolean
  updatedAt?: Timestamp
}

export interface IMembershipPreferences {
  currentWorkspaceId: string | null
  updatedAt?: Timestamp
}

export interface IUsernameClaim {
  entityType: "user" | "team"
  entityId: string
  createdAt?: Timestamp
}

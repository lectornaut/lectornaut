import { Timestamp } from "firebase/firestore"

// ============================================================================
// Domain Types
// ============================================================================

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
  photoURL?: string | null
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

export type IMembershipRole = "owner" | "admin" | "member"

export interface IMembership {
  userId: string
  teamId: string
  role: IMembershipRole
  user: IUser // Snapshot of user data
  team: ITeam // Snapshot of team data
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ============================================================================
// Optimistic Update Types
// ============================================================================

/**
 * Generic interface for entities with an ID
 */
export interface IEntity {
  id: string
}

/**
 * Options for Firestore operations with optimistic updates
 */
export interface IOptimisticOptions {
  /** Whether to show success toast notification */
  showSuccessToast?: boolean
  /** Whether to show error toast notification */
  showErrorToast?: boolean
  /** Custom success message */
  successMessage?: string
  /** Custom error message */
  errorMessage?: string
}

/**
 * State for tracking pending operations in a store
 */
export interface IPendingState {
  /** Set of IDs for operations currently in-flight */
  pendingIds: Set<string>
}

/**
 * Result of an optimistic operation
 */
export interface IOptimisticResult<T = void> {
  success: boolean
  data?: T
  error?: Error
}

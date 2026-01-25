/**
 * Centralized Permission System
 *
 * Single source of truth for role-based access control across the application.
 * This module defines the permission rules for teams, workspaces, and members.
 *
 * Role Hierarchy (lowest to highest):
 * - guest: Read-only access
 * - member: Can manage workspaces
 * - admin: Can manage team members (invite, remove, change roles)
 * - owner: Full control including team settings
 *
 * Permission Model: Standard CRUD (Create, Read, Update, Delete)
 */

import type { IMembershipRole } from "@/types"

/**
 * Role hierarchy for permission inheritance.
 * Higher index = more permissions.
 *
 * Hierarchy: guest → member → admin → owner
 */
export const ROLE_HIERARCHY: readonly IMembershipRole[] = [
  "guest",
  "member",
  "admin",
  "owner",
] as const

/**
 * Check if a role has at least the minimum required role level.
 * Uses role hierarchy for inheritance (e.g., owner has all member permissions).
 */
export function hasMinimumRole(
  userRole: IMembershipRole | null | undefined,
  minimumRole: IMembershipRole
): boolean {
  if (!userRole) return false
  const userIndex = ROLE_HIERARCHY.indexOf(userRole)
  const minIndex = ROLE_HIERARCHY.indexOf(minimumRole)
  return userIndex >= minIndex
}

/**
 * Check if a role exactly matches the specified role (no inheritance).
 */
export function hasExactRole(
  userRole: IMembershipRole | null | undefined,
  exactRole: IMembershipRole
): boolean {
  return userRole === exactRole
}

/**
 * CRUD Permission definitions - single source of truth.
 *
 * Each domain (team, workspace, member) defines the minimum role required
 * for each CRUD action. The permission check uses role hierarchy, so higher
 * roles automatically inherit lower role permissions.
 */
export const PERMISSIONS = {
  /**
   * Team permissions (CRUD)
   * - Only owners can create/update/delete team settings
   * - All members can read team info
   */
  team: {
    create: "owner" as IMembershipRole,
    read: "guest" as IMembershipRole,
    update: "owner" as IMembershipRole,
    delete: "owner" as IMembershipRole,
  },

  /**
   * Workspace permissions (CRUD)
   * - Members and above can create/update/delete workspaces
   * - Guests can only read workspaces
   */
  workspace: {
    create: "member" as IMembershipRole,
    read: "guest" as IMembershipRole,
    update: "member" as IMembershipRole,
    delete: "member" as IMembershipRole,
  },

  /**
   * Member management permissions (CRUD)
   * - Admins and owners can create/update/delete members
   * - All roles can read team member list
   */
  member: {
    create: "admin" as IMembershipRole,
    read: "guest" as IMembershipRole,
    update: "admin" as IMembershipRole,
    delete: "admin" as IMembershipRole,
  },
} as const

// Type helpers for type-safe permission checks
export type PermissionDomain = keyof typeof PERMISSIONS
export type CrudAction = "create" | "read" | "update" | "delete"
export type TeamAction = keyof (typeof PERMISSIONS)["team"]
export type WorkspaceAction = keyof (typeof PERMISSIONS)["workspace"]
export type MemberAction = keyof (typeof PERMISSIONS)["member"]

/**
 * Generic permission check for any domain.
 */
export function canPerform(
  userRole: IMembershipRole | null | undefined,
  domain: PermissionDomain,
  action: CrudAction
): boolean {
  return hasMinimumRole(userRole, PERMISSIONS[domain][action])
}

/**
 * Type-safe permission check for team actions.
 */
export function canPerformTeamAction(
  userRole: IMembershipRole | null | undefined,
  action: TeamAction
): boolean {
  return hasMinimumRole(userRole, PERMISSIONS.team[action])
}

/**
 * Type-safe permission check for workspace actions.
 */
export function canPerformWorkspaceAction(
  userRole: IMembershipRole | null | undefined,
  action: WorkspaceAction
): boolean {
  return hasMinimumRole(userRole, PERMISSIONS.workspace[action])
}

/**
 * Type-safe permission check for member management actions.
 */
export function canPerformMemberAction(
  userRole: IMembershipRole | null | undefined,
  action: MemberAction
): boolean {
  return hasMinimumRole(userRole, PERMISSIONS.member[action])
}

/**
 * Helper computed properties for common permission checks.
 * These can be used directly in components for cleaner code.
 */
export function createPermissionHelpers(
  getCurrentRole: () => IMembershipRole | null | undefined
) {
  return {
    // Role checks
    isOwner: () => hasExactRole(getCurrentRole(), "owner"),
    isAdmin: () => hasExactRole(getCurrentRole(), "admin"),
    isMember: () => hasExactRole(getCurrentRole(), "member"),
    isGuest: () => hasExactRole(getCurrentRole(), "guest"),

    // Team CRUD
    canCreateTeam: () => canPerformTeamAction(getCurrentRole(), "create"),
    canReadTeam: () => canPerformTeamAction(getCurrentRole(), "read"),
    canUpdateTeam: () => canPerformTeamAction(getCurrentRole(), "update"),
    canDeleteTeam: () => canPerformTeamAction(getCurrentRole(), "delete"),

    // Workspace CRUD
    canCreateWorkspace: () =>
      canPerformWorkspaceAction(getCurrentRole(), "create"),
    canReadWorkspace: () => canPerformWorkspaceAction(getCurrentRole(), "read"),
    canUpdateWorkspace: () =>
      canPerformWorkspaceAction(getCurrentRole(), "update"),
    canDeleteWorkspace: () =>
      canPerformWorkspaceAction(getCurrentRole(), "delete"),

    // Member CRUD
    canCreateMember: () => canPerformMemberAction(getCurrentRole(), "create"),
    canReadMember: () => canPerformMemberAction(getCurrentRole(), "read"),
    canUpdateMember: () => canPerformMemberAction(getCurrentRole(), "update"),
    canDeleteMember: () => canPerformMemberAction(getCurrentRole(), "delete"),
  }
}

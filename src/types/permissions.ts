/**
 * Centralized Permission System (Capability-Based)
 *
 * This module defines the capability-based permission rules.
 * Permissions are derived from the context (scope) and the user's role in that context.
 *
 * Scopes:
 * - Global: Actions that don't depend on a team (e.g., create team)
 * - Team: Actions within a specific team (e.g., edit team, invite members)
 * - Workspace: Actions within a specific workspace (e.g., create workspace)
 */

import type { IMembershipRole } from "@/types/membership"

// ============================================================================
// Core Types
// ============================================================================

export type Scope = "global" | "team" | "workspace"

export const Capabilities = {
  // Global Scope
  CREATE_TEAM: "create_team",

  // Team Scope
  EDIT_TEAM: "edit_team",
  DELETE_TEAM: "delete_team",
  INVITE_MEMBER: "invite_member",
  UPDATE_MEMBER_ROLE: "update_member_role",
  REMOVE_MEMBER: "remove_member",
  READ_TEAM: "read_team", // Usually implicit, but good to have
  MANAGE_BILLING: "manage_billing",

  // Workspace Scope
  CREATE_WORKSPACE: "create_workspace",
  EDIT_WORKSPACE: "edit_workspace",
  DELETE_WORKSPACE: "delete_workspace",
  READ_WORKSPACE: "read_workspace",
  MANAGE_WORKSPACE_CONTENT: "manage_workspace_content",
} as const

export type Capability = (typeof Capabilities)[keyof typeof Capabilities]

// ============================================================================
// Role & Permission Definitions
// ============================================================================

/**
 * Defines which roles have which capabilities in a specific scope.
 * Global actions are usually allowed for everyone (authenticated),
 * so they might not need a specific role mapping, but we structure it primarily for Team/Workspace scopes.
 */
const TEAM_SCOPED_PERMISSIONS: Readonly<
  Record<IMembershipRole, ReadonlySet<Capability>>
> = {
  owner: new Set([
    Capabilities.EDIT_TEAM,
    Capabilities.DELETE_TEAM,
    Capabilities.INVITE_MEMBER,
    Capabilities.UPDATE_MEMBER_ROLE,
    Capabilities.REMOVE_MEMBER,
    Capabilities.READ_TEAM,
    Capabilities.CREATE_WORKSPACE,
    Capabilities.EDIT_WORKSPACE,
    Capabilities.DELETE_WORKSPACE,
    Capabilities.READ_WORKSPACE,
    Capabilities.MANAGE_BILLING,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
  ]),
  admin: new Set([
    Capabilities.INVITE_MEMBER,
    Capabilities.UPDATE_MEMBER_ROLE,
    Capabilities.REMOVE_MEMBER,
    Capabilities.READ_TEAM,
    Capabilities.CREATE_WORKSPACE,
    Capabilities.EDIT_WORKSPACE,
    Capabilities.DELETE_WORKSPACE,
    Capabilities.READ_WORKSPACE,
    Capabilities.MANAGE_BILLING,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
  ]),
  member: new Set([
    Capabilities.READ_TEAM,
    Capabilities.READ_WORKSPACE,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
  ]),
  guest: new Set([Capabilities.READ_TEAM, Capabilities.READ_WORKSPACE]),
}

// ============================================================================
// Permission Resolver
// ============================================================================

export interface PermissionContext {
  scope: Scope
  // Required for 'team' and 'workspace' scopes
  teamRole?: IMembershipRole | null
}

/**
 * Check if a user has a specific capability.
 *
 * @param user The user object (mostly to check if authenticated)
 * @param action The capability to check
 * @param context Context providing scope and role information
 */
export function can(
  user: { uid?: string } | null | undefined,
  action: Capability,
  context: PermissionContext
): boolean {
  if (!user) return false

  // 1. Global Scope
  if (context.scope === "global") {
    switch (action) {
      case Capabilities.CREATE_TEAM:
        return true // Any authenticated user can create a team
      default:
        return false
    }
  }

  // 2. Team & Workspace Scopes (Depend on Team Role)
  if (context.scope === "team" || context.scope === "workspace") {
    // If no role is provided (e.g. user not in team), they usually have no access,
    // unless the action implies public access (not the case here yet).
    if (!context.teamRole) return false

    const allowedCapabilities = TEAM_SCOPED_PERMISSIONS[context.teamRole]
    return allowedCapabilities ? allowedCapabilities.has(action) : false
  }

  return false
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a specific role allows an action (mostly for UI checks where we only know the role).
 * Assumes the action is for the scope where this role applies (Team/Workspace).
 */
export function roleCan(
  role: IMembershipRole | null | undefined,
  action: Capability
): boolean {
  if (!role) return false
  return TEAM_SCOPED_PERMISSIONS[role]?.has(action) ?? false
}

/**
 * Helper to check exact role match (sometimes needed for specific business logic like "only owners can be last owner").
 */
export function hasExactRole(
  userRole: IMembershipRole | null | undefined,
  exactRole: IMembershipRole
): boolean {
  return userRole === exactRole
}

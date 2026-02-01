/**
 * Centralized Permission System (Capability-Based)
 *
 * This module defines the capability-based permission rules for the backend.
 * It mirrors the frontend logic to ensure consistency.
 */

// We don't have access to frontend types directly if they are not in a shared package.
// We'll define minimal types or import if shared.
// Looking at functions/src/types.ts might help, or we redefine.
// Assuming we need to redefine IMembershipRole for now as it's simple.

export type IMembershipRole = "owner" | "admin" | "member" | "guest"

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
  READ_TEAM: "read_team",

  // Workspace Scope
  CREATE_WORKSPACE: "create_workspace",
  EDIT_WORKSPACE: "edit_workspace",
  DELETE_WORKSPACE: "delete_workspace",
  READ_WORKSPACE: "read_workspace",
} as const

export type Capability = (typeof Capabilities)[keyof typeof Capabilities]

// ============================================================================
// Role & Permission Definitions
// ============================================================================

const TEAM_SCOPED_PERMISSIONS: Record<IMembershipRole, Set<Capability>> = {
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
  ]),
  member: new Set([Capabilities.READ_TEAM, Capabilities.READ_WORKSPACE]),
  guest: new Set([Capabilities.READ_TEAM, Capabilities.READ_WORKSPACE]),
}

// ============================================================================
// Permission Resolver
// ============================================================================

export interface PermissionContext {
  scope: Scope
  teamRole?: IMembershipRole | null
}

/**
 * Check if a user (or role) has a specific capability.
 * context.teamRole is required for team/workspace scopes.
 */
export function can(
  _userId: string | null | undefined, // Not strictly used for role check, but kept for signature consistency
  action: Capability,
  context: PermissionContext
): boolean {
  // 1. Global Scope
  if (context.scope === "global") {
    switch (action) {
      case Capabilities.CREATE_TEAM:
        return !!_userId // Authenticated users can create teams
      default:
        return false
    }
  }

  // 2. Team & Workspace Scopes
  if (context.scope === "team" || context.scope === "workspace") {
    if (!context.teamRole) return false
    const allowedCapabilities = TEAM_SCOPED_PERMISSIONS[context.teamRole]
    return allowedCapabilities ? allowedCapabilities.has(action) : false
  }

  return false
}

// Helpers for role-only checks (often used in backend triggers where we have the role data)
export function roleCan(
  role: IMembershipRole | null | undefined,
  action: Capability
): boolean {
  if (!role) return false
  return TEAM_SCOPED_PERMISSIONS[role]?.has(action) ?? false
}

import {
  Capabilities,
  Capability,
  IMembershipRole,
  PermissionContext,
} from "./types.js"

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

// ============================================================================
// Core Types
// ============================================================================

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
    Capabilities.MANAGE_BILLING,
    Capabilities.READ_AUDIT_LOGS,
    Capabilities.CREATE_WORKSPACE,
    Capabilities.EDIT_WORKSPACE,
    Capabilities.DELETE_WORKSPACE,
    Capabilities.READ_WORKSPACE,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
  ]),
  admin: new Set([
    Capabilities.EDIT_TEAM,
    Capabilities.INVITE_MEMBER,
    Capabilities.UPDATE_MEMBER_ROLE,
    Capabilities.REMOVE_MEMBER,
    Capabilities.READ_TEAM,
    Capabilities.MANAGE_BILLING,
    Capabilities.READ_AUDIT_LOGS,
    Capabilities.CREATE_WORKSPACE,
    Capabilities.EDIT_WORKSPACE,
    Capabilities.DELETE_WORKSPACE,
    Capabilities.READ_WORKSPACE,
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

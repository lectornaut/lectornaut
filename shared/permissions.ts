/**
 * Shared Permission System (Capability-Based)
 *
 * This is the single source of truth for roles, capabilities, and permission
 * logic. Both the client (src/) and Cloud Functions (functions/) consume this
 * file — keep it free of platform-specific imports (no Firebase, no Vue, etc.).
 *
 * Client: imported via the `@shared/*` Vite/TS alias.
 * Functions: copied into `functions/src/shared/` at build time.
 */

// ============================================================================
// Roles
// ============================================================================

export const MEMBERSHIP_ROLES = ["owner", "admin", "member", "guest"] as const

export type IMembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export const MembershipRoles = {
  OWNER: "owner" as IMembershipRole,
  ADMIN: "admin" as IMembershipRole,
  MEMBER: "member" as IMembershipRole,
  GUEST: "guest" as IMembershipRole,
} as const

export function isMembershipRole(value: unknown): value is IMembershipRole {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_ROLES as readonly string[]).includes(value)
  )
}

export function normalizeMembershipRole(
  value: unknown,
  fallback: IMembershipRole = MembershipRoles.MEMBER
): IMembershipRole {
  return isMembershipRole(value) ? value : fallback
}

export const MembershipRoleLabels: Record<IMembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
}

export const RoleGroups = {
  /** Owners and admins — users with administrative capabilities */
  ADMINS: [MembershipRoles.OWNER, MembershipRoles.ADMIN],
  /** All full members (excludes guests) */
  MEMBERS: [
    MembershipRoles.OWNER,
    MembershipRoles.ADMIN,
    MembershipRoles.MEMBER,
  ],
  /** Everyone including guests */
  ALL: [
    MembershipRoles.OWNER,
    MembershipRoles.ADMIN,
    MembershipRoles.MEMBER,
    MembershipRoles.GUEST,
  ],
} as const

/**
 * Role precedence — higher rank means more privilege. The single source of
 * truth for *comparing* two roles, used by `effectiveRole` to combine a team
 * role with a per-workspace override. Keep aligned with `MEMBERSHIP_ROLES`.
 */
const ROLE_RANK: Record<IMembershipRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
  guest: 0,
}

/**
 * Combine a team role with an optional per-workspace role override using
 * **elevate-only** semantics: the effective role is whichever of the two is
 * more privileged. A per-workspace grant can RAISE a member's access inside a
 * single workspace but never lower it — so a team admin can't be accidentally
 * demoted out of a workspace, and an override only ever adds power.
 *
 * Returns the team role unchanged when no override is set (the overwhelmingly
 * common case), so every existing team-only call site is unaffected. When the
 * caller has no team role but does have an override (e.g. a future
 * workspace-only guest), the override stands on its own.
 */
export function effectiveRole(
  teamRole: IMembershipRole | null | undefined,
  workspaceRole?: IMembershipRole | null
): IMembershipRole | null {
  if (!workspaceRole) return teamRole ?? null
  if (!teamRole) return workspaceRole
  return ROLE_RANK[workspaceRole] > ROLE_RANK[teamRole]
    ? workspaceRole
    : teamRole
}

// ============================================================================
// Capabilities
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
  /**
   * View the team's settings sections (AI config, members, workspaces,
   * teams, plans, overview). Granted to full members (owner/admin/member)
   * but NOT guests. Governs *visibility* only — admin/owner-only mutations
   * within those pages remain gated by their own specific capabilities.
   */
  VIEW_TEAM_SETTINGS: "view_team_settings",
  MANAGE_BILLING: "manage_billing",
  READ_AUDIT_LOGS: "read_audit_logs",
  /**
   * Read and manage every bot chat session in the team's workspaces,
   * regardless of ownership or visibility. Owner/admin-only — gives
   * access to the Sessions tab in Settings (rename / archive / delete
   * across the whole workspace).
   */
  MANAGE_BOT_SESSIONS: "manage_bot_sessions",

  // Security Scope
  MANAGE_SECURITY: "manage_security",

  // Workspace Scope
  CREATE_WORKSPACE: "create_workspace",
  EDIT_WORKSPACE: "edit_workspace",
  DELETE_WORKSPACE: "delete_workspace",
  READ_WORKSPACE: "read_workspace",
  MANAGE_WORKSPACE_CONTENT: "manage_workspace_content",
  /**
   * Bulk-purge workspace documents — archive or permanently delete every
   * code / write document at once from the Storage settings tab.
   *
   * Deliberately distinct from MANAGE_WORKSPACE_CONTENT: that capability is
   * granted to members for everyday create/edit/delete of individual
   * documents, whereas mass destruction across the whole workspace is an
   * owner/admin-only operation.
   */
  MANAGE_WORKSPACE_STORAGE: "manage_workspace_storage",
} as const

export type Capability = (typeof Capabilities)[keyof typeof Capabilities]

// ============================================================================
// Role → Capability Mapping
// ============================================================================

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
    Capabilities.VIEW_TEAM_SETTINGS,
    Capabilities.READ_AUDIT_LOGS,
    Capabilities.MANAGE_BOT_SESSIONS,
    Capabilities.MANAGE_BILLING,
    Capabilities.MANAGE_SECURITY,
    Capabilities.CREATE_WORKSPACE,
    Capabilities.EDIT_WORKSPACE,
    Capabilities.DELETE_WORKSPACE,
    Capabilities.READ_WORKSPACE,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
    Capabilities.MANAGE_WORKSPACE_STORAGE,
  ]),
  admin: new Set([
    Capabilities.EDIT_TEAM,
    Capabilities.INVITE_MEMBER,
    Capabilities.UPDATE_MEMBER_ROLE,
    Capabilities.REMOVE_MEMBER,
    Capabilities.READ_TEAM,
    Capabilities.VIEW_TEAM_SETTINGS,
    Capabilities.READ_AUDIT_LOGS,
    Capabilities.MANAGE_BOT_SESSIONS,
    Capabilities.MANAGE_BILLING,
    Capabilities.MANAGE_SECURITY,
    Capabilities.CREATE_WORKSPACE,
    Capabilities.EDIT_WORKSPACE,
    Capabilities.DELETE_WORKSPACE,
    Capabilities.READ_WORKSPACE,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
    Capabilities.MANAGE_WORKSPACE_STORAGE,
  ]),
  member: new Set([
    Capabilities.READ_TEAM,
    Capabilities.VIEW_TEAM_SETTINGS,
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
  teamRole?: IMembershipRole | null
  /**
   * The caller's role *within a specific workspace*, if a per-workspace
   * override grant exists. Only consulted for `scope: "workspace"`, where it
   * is combined with `teamRole` via `effectiveRole` (elevate-only). Ignored
   * for `team`/`global` scopes. Omit (or pass `null`) when there is no
   * override — the resolver then falls back to the plain team role, so
   * existing call sites that pass only `teamRole` keep their exact behavior.
   */
  workspaceRole?: IMembershipRole | null
}

/**
 * Check if a user has a specific capability.
 *
 * @param user — On the client pass `{ uid }`, in functions pass the userId string.
 *               Only used to verify the caller is authenticated.
 * @param action — The capability to check.
 * @param context — Scope and (for team/workspace scopes) the user's team role.
 */
export function can(
  user: { uid?: string } | string | null | undefined,
  action: Capability,
  context: PermissionContext
): boolean {
  const uid = typeof user === "string" ? user : user?.uid
  if (!uid) return false

  // Global scope
  if (context.scope === "global") {
    switch (action) {
      case Capabilities.CREATE_TEAM:
        return true
      default:
        return false
    }
  }

  // Team & Workspace scopes
  if (context.scope === "team" || context.scope === "workspace") {
    // Workspace scope may elevate the team role via a per-workspace override
    // (elevate-only). Team scope ignores any override entirely.
    const role =
      context.scope === "workspace"
        ? effectiveRole(context.teamRole, context.workspaceRole)
        : context.teamRole
    if (!role) return false
    const allowed = TEAM_SCOPED_PERMISSIONS[role]
    return allowed ? allowed.has(action) : false
  }

  return false
}

/**
 * Check if a role allows an action (no user object needed).
 * Useful when you already have the role and just need a capability check.
 */
export function roleCan(
  role: IMembershipRole | null | undefined,
  action: Capability
): boolean {
  if (!role) return false
  return TEAM_SCOPED_PERMISSIONS[role]?.has(action) ?? false
}

/**
 * Check exact role match (e.g. "only owners can transfer ownership").
 */
export function hasExactRole(
  userRole: IMembershipRole | null | undefined,
  exactRole: IMembershipRole
): boolean {
  return userRole === exactRole
}

/**
 * Owner ∨ admin predicate — the single source of truth for the "team admin"
 * role gate shared by the client (settings affordances) and Cloud Functions
 * (mutation guards). Derived from `RoleGroups.ADMINS` so the role set is
 * defined exactly once.
 */
export function isAdminRole(role: IMembershipRole | null | undefined): boolean {
  return (
    !!role && (RoleGroups.ADMINS as readonly IMembershipRole[]).includes(role)
  )
}

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

// ============================================================================
// Capability → Scope Policy
// ============================================================================

/**
 * The scopes a capability is evaluated at, IN ORDER. The order is load-bearing:
 * `resolveAuthorization` walks the list and short-circuits on the first scope
 * that grants, resolving workspace **participation** (the override read that
 * enforces exclusion and folds in group elevation) only when it reaches a
 * `"workspace"` entry.
 *
 * That laziness is what makes `["team", "workspace"]` correct for entity edits:
 * a team admin EXCLUDED from a workspace passes at `"team"` and never trips the
 * exclusion, while a plain member falls through to `"workspace"`, where the
 * override can elevate them in — or exclusion can deny them. `["workspace"]`
 * forces the participation read for every actor: the right policy for content
 * edits, where an excluded member must be denied and a group-elevated guest
 * allowed.
 *
 * `READ_WORKSPACE` and `MANAGE_WORKSPACE_STORAGE` are `["team"]`, not
 * `["workspace"]`: their call sites consult the team role ONLY (they pass no
 * workspaceRole), so they neither enforce exclusion nor honour per-workspace
 * elevation today. Promoting them to `"workspace"` would be a deliberate
 * semantic change, not a refactor — keep this map faithful to current behaviour.
 */
export const CAPABILITY_SCOPES: Readonly<Record<Capability, readonly Scope[]>> =
  {
    [Capabilities.CREATE_TEAM]: ["global"],

    [Capabilities.EDIT_TEAM]: ["team"],
    [Capabilities.DELETE_TEAM]: ["team"],
    [Capabilities.INVITE_MEMBER]: ["team"],
    [Capabilities.UPDATE_MEMBER_ROLE]: ["team"],
    [Capabilities.REMOVE_MEMBER]: ["team"],
    [Capabilities.READ_TEAM]: ["team"],
    [Capabilities.VIEW_TEAM_SETTINGS]: ["team"],
    [Capabilities.MANAGE_BILLING]: ["team"],
    [Capabilities.READ_AUDIT_LOGS]: ["team"],
    [Capabilities.MANAGE_BOT_SESSIONS]: ["team"],
    [Capabilities.MANAGE_SECURITY]: ["team"],

    [Capabilities.CREATE_WORKSPACE]: ["team"],
    [Capabilities.EDIT_WORKSPACE]: ["team", "workspace"],
    [Capabilities.DELETE_WORKSPACE]: ["team", "workspace"],
    [Capabilities.READ_WORKSPACE]: ["team"],
    [Capabilities.MANAGE_WORKSPACE_CONTENT]: ["workspace"],
    [Capabilities.MANAGE_WORKSPACE_STORAGE]: ["team"],
  }

/** The ordered scopes a capability is checked at. See {@link CAPABILITY_SCOPES}. */
export function scopesFor(capability: Capability): readonly Scope[] {
  return CAPABILITY_SCOPES[capability] ?? ["team"]
}

// ============================================================================
// Authorization Decision (scope walk)
// ============================================================================

/**
 * A principal's resolved standing within one workspace — the data the scope
 * walk consumes in place of a control-flow throw.
 *
 *  - `{ excluded: true }`        — explicitly removed; workspace scopes deny.
 *  - `{ excluded: false, role }` — present; `role` is the per-workspace override
 *                                  role (the max of the direct grant and any
 *                                  group elevation), or `null` when no grant.
 */
export type Participation =
  { excluded: true } | { excluded: false; role: IMembershipRole | null }

/**
 * Why a denied {@link AuthDecision} was denied — lets a hard-deny caller raise a
 * message specific to the cause (explicitly excluded vs. not a team member vs.
 * simply under-ranked) instead of one generic string. Absent when `allowed`.
 */
export type DeniedReason =
  "not-team-member" | "excluded" | "insufficient-capability"

/**
 * The outcome of {@link resolveAuthorization}: facts, not control flow. A caller
 * that wants a hard denial raises its own error from `allowed`; a soft gate (the
 * bot tool surface) reads `allowed` directly.
 */
export interface AuthDecision {
  /** Whether the capability is granted at any scope. */
  allowed: boolean
  /** The principal's team role (synthesised for built-in agents), or null. */
  teamRole: IMembershipRole | null
  /** The role under the granting scope, else the most elevated role evaluated. */
  effectiveRole: IMembershipRole | null
  /** The scope that granted, or null when denied. */
  grantedScope: Scope | null
  /** Workspace participation, resolved iff the walk reached a workspace scope. */
  participation: Participation | null
  /** Why the decision was denied; absent when `allowed`. */
  deniedReason?: DeniedReason
}

/** The I/O the scope walk needs, supplied as values + a lazy thunk. */
export interface AuthorizationInputs {
  /** The principal's team role, resolved eagerly (every scope needs it). */
  teamRole: IMembershipRole | null
  /**
   * The principal's workspace participation, resolved LAZILY — called at most
   * once, and only when the walk reaches a `"workspace"` scope. The laziness is
   * what lets a team admin short-circuit at `"team"` without ever reading (and
   * being denied by) an exclusion that does not apply to their entity-level
   * right.
   */
  resolveParticipation: () => Participation | Promise<Participation>
}

/**
 * Decide whether `principal` may exercise `capability`, walking the capability's
 * ordered scopes (see {@link CAPABILITY_SCOPES}) and short-circuiting on the
 * first grant. Pure: every Firestore read is supplied via {@link
 * AuthorizationInputs}, so this is unit-testable without a backend. Returns an
 * {@link AuthDecision} — it never throws for a denial.
 */
export async function resolveAuthorization(
  principal: { uid?: string } | string | null | undefined,
  capability: Capability,
  inputs: AuthorizationInputs
): Promise<AuthDecision> {
  const teamRole = inputs.teamRole
  let participation: Participation | null = null
  let bestEffective: IMembershipRole | null = teamRole ?? null
  let sawExcluded = false

  for (const scope of scopesFor(capability)) {
    if (scope === "workspace") {
      // Resolve participation lazily, once. Reaching here at all means an
      // earlier scope (if any) did not already grant.
      // Elevate-only: a per-workspace grant RAISES a team member's access; it
      // never confers membership on a non-member. Every server gate requires
      // membership as the base (requireTeamRole / getMembershipRole), so a null
      // team role gets no standalone workspace grant — and we skip the override
      // read entirely, denying a non-member as not-a-member rather than reading
      // (and reporting) an "excluded" state. (A deliberate future
      // "workspace-only" principal would relax this.)
      if (teamRole == null) continue
      if (!participation) participation = await inputs.resolveParticipation()
      if (participation.excluded) {
        sawExcluded = true
        continue
      }
      const workspaceRole = participation.role
      const folded = effectiveRole(teamRole, workspaceRole)
      bestEffective = folded
      if (
        can(principal, capability, {
          scope: "workspace",
          teamRole,
          workspaceRole,
        })
      ) {
        return {
          allowed: true,
          teamRole: teamRole ?? null,
          effectiveRole: folded,
          grantedScope: "workspace",
          participation,
        }
      }
    } else if (can(principal, capability, { scope, teamRole })) {
      return {
        allowed: true,
        teamRole: teamRole ?? null,
        effectiveRole: scope === "global" ? null : (teamRole ?? null),
        grantedScope: scope,
        participation,
      }
    }
  }

  // Most-specific cause first: an explicit exclusion the walk hit, then a
  // principal with no role at all (not a team member, no workspace grant),
  // else a present-but-under-ranked role.
  const deniedReason: DeniedReason = sawExcluded
    ? "excluded"
    : teamRole == null && bestEffective == null
      ? "not-team-member"
      : "insufficient-capability"

  return {
    allowed: false,
    teamRole: teamRole ?? null,
    effectiveRole: bestEffective,
    grantedScope: null,
    participation,
    deniedReason,
  }
}

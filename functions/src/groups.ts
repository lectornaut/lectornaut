import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { deleteStorageObjectIfExists, logEvent } from "./audit.js"
import { getMembershipRole } from "./bot.js"
import { admin, db } from "./firebase.js"
import {
  Capabilities,
  can,
  isAdminRole,
  isMembershipRole,
} from "./permissions.js"
import { CALLABLE_OPTS, DESTRUCTIVE_CALLABLE_OPTS } from "./runtimeConfig.js"
import type { IMembershipRole } from "./types.js"
import {
  listGrantingWorkspaceIdsForGroup,
  recomputeGroupRoleForMembersInWorkspace,
} from "./workspaceRoles.js"

/**
 * Groups — reusable named bundles of team members that grant an elevate-only,
 * per-workspace role.
 *
 * A group is a PURE set of human members: `{ id, teamId, name, description?,
 * memberIds[], createdAt, updatedAt, createdByUid }`. NO role lives on the group. The role
 * is assigned on the (group, workspace) pair, stored at
 *   teams/{teamId}/workspaces/{workspaceId}/groupGrants/{groupId} = { groupId, role }
 * and folded into a member's effective workspace role (elevate-only, max over
 * groups + the direct override) by `workspaceRoles.ts`. A group never changes a
 * member's team-wide role.
 *
 * All writes are functions-only (firestore.rules denies client writes); the
 * authoritative recompute of the rules-facing `groupRole` denormalization is
 * driven by the `onGroup*Written` triggers, EXCEPT for group deletion (where
 * neither the group doc nor its grants survive for a trigger to read, so the
 * delete callable recomputes synchronously — see `deleteGroup`).
 */

const GROUP_NAME_MAX_LENGTH = 100
const GROUP_DESCRIPTION_MAX_LENGTH = 500
const GROUP_MEMBERS_MAX = 1000

function assertAuthenticated(
  request: CallableRequest
): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>
} {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }
  return value.trim()
}

function assertGroupName(value: unknown): string {
  const name = assertString(value, "name")
  if (name.length > GROUP_NAME_MAX_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `Group name must be at most ${GROUP_NAME_MAX_LENGTH} characters.`
    )
  }
  return name
}

/**
 * Normalize an optional group description, mirroring the workspace convention:
 *   - `null` (or an empty/whitespace string) → `null` (cleared)
 *   - a non-empty string → trimmed, capped at GROUP_DESCRIPTION_MAX_LENGTH
 *   - anything else (incl. `undefined`) → `undefined` ("leave unchanged")
 * On create, callers coerce the `undefined` case to `null` so a value is always
 * stored; on update, `undefined` means the field was omitted from the patch.
 */
function normalizeGroupDescription(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > GROUP_DESCRIPTION_MAX_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `Group description must be at most ${GROUP_DESCRIPTION_MAX_LENGTH} characters.`
    )
  }
  return trimmed
}

function assertMembershipRoleValue(
  value: unknown,
  field: string
): IMembershipRole {
  const role = assertString(value, field)
  if (!isMembershipRole(role)) {
    throw new HttpsError("invalid-argument", "Invalid role provided.")
  }
  return role
}

/**
 * The set of HUMAN member uids in the team. Groups are humans-only (no agents,
 * no nested groups), so provided `memberIds` are always resolved against this
 * set — silently dropping agents and stale ids. This also self-heals a group
 * whose member later leaves the team: the stale id falls off on the next edit.
 */
async function resolveTeamHumanMemberIds(teamId: string): Promise<Set<string>> {
  const snap = await db
    .collection(`teams/${teamId}/memberships`)
    .select("kind")
    .get()
  return new Set(
    snap.docs.filter((d) => d.data()?.kind !== "agent").map((d) => d.id)
  )
}

/** Validate + sanitize an incoming `memberIds` array against the team's humans. */
async function sanitizeMemberIds(
  teamId: string,
  raw: unknown
): Promise<string[]> {
  if (!Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "memberIds must be an array.")
  }
  if (raw.length > GROUP_MEMBERS_MAX) {
    throw new HttpsError(
      "invalid-argument",
      `A group can hold at most ${GROUP_MEMBERS_MAX} members.`
    )
  }
  const requested = new Set(
    raw.filter((id): id is string => typeof id === "string" && id.length > 0)
  )
  if (requested.size === 0) return []
  const humans = await resolveTeamHumanMemberIds(teamId)
  return [...requested].filter((id) => humans.has(id))
}

/**
 * Resolve the caller's team role and assert they may manage groups
 * (owner/admin — the same gate as managing members). Returns the role so the
 * caller can owner-gate `owner` grants + stamp the audit actor.
 */
async function requireGroupAdmin(
  teamId: string,
  uid: string
): Promise<IMembershipRole> {
  const role = await getMembershipRole(teamId, uid)
  if (!isAdminRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to manage groups."
    )
  }
  return role
}

// =============================================================================
// Group CRUD
// =============================================================================

export const createGroup = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const name = assertGroupName(request.data?.name)
  // Always store a value on create (string or null), mirroring createWorkspace.
  const description =
    normalizeGroupDescription(request.data?.description) ?? null
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const actorRole = await requireGroupAdmin(teamId, actorId)
  const memberIds = await sanitizeMemberIds(teamId, request.data?.memberIds)

  const groupRef = db.collection(`teams/${teamId}/groups`).doc()
  await groupRef.set({
    id: groupRef.id,
    teamId,
    name,
    description,
    memberIds,
    createdByUid: actorId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // A brand-new group has no workspace grants yet, so there is no `groupRole`
  // denorm to recompute.

  const logRef = await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role: actorRole },
    action: "group.create",
    resource: { type: "group", id: groupRef.id, parentId: teamId },
    changes: {
      fields: ["name", "description", "memberIds"],
      after: { name, description, memberCount: memberIds.length },
    },
  })

  return { teamId, groupId: groupRef.id, created: true, logId: logRef.id }
})

export const updateGroup = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const groupId = assertString(request.data?.groupId, "groupId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const nameProvided = request.data?.name !== undefined
  const descriptionProvided = request.data?.description !== undefined
  const membersProvided = request.data?.memberIds !== undefined
  const photoProvided = request.data?.photoURL !== undefined
  if (
    !nameProvided &&
    !descriptionProvided &&
    !membersProvided &&
    !photoProvided
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Provide a name, description, memberIds, and/or photoURL to update."
    )
  }

  const actorRole = await requireGroupAdmin(teamId, actorId)
  const name = nameProvided ? assertGroupName(request.data?.name) : undefined
  // `null` clears the description; a string sets it; anything else is "unchanged".
  const description = normalizeGroupDescription(request.data?.description)
  const memberIds = membersProvided
    ? await sanitizeMemberIds(teamId, request.data?.memberIds)
    : undefined
  // `null` clears the avatar; a string sets it; anything else is "unchanged".
  const photoURL =
    request.data?.photoURL === null
      ? null
      : typeof request.data?.photoURL === "string"
        ? request.data.photoURL.trim() || null
        : undefined

  const groupRef = db.doc(`teams/${teamId}/groups/${groupId}`)
  const groupSnap = await groupRef.get()
  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Group not found.")
  }
  const before = groupSnap.data() ?? {}
  const beforeMemberIds: string[] = Array.isArray(before.memberIds)
    ? before.memberIds
    : []

  const patch: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }
  const fields: string[] = []
  if (name !== undefined && name !== before.name) {
    patch.name = name
    fields.push("name")
  }
  if (
    description !== undefined &&
    description !== (before.description ?? null)
  ) {
    patch.description = description
    fields.push("description")
  }
  if (memberIds !== undefined) {
    patch.memberIds = memberIds
    fields.push("memberIds")
  }
  if (photoURL !== undefined && photoURL !== (before.photoURL ?? null)) {
    patch.photoURL = photoURL
    fields.push("photoURL")
  }

  if (fields.length === 0) {
    return { teamId, groupId, updated: false }
  }

  await groupRef.update(patch)

  // The `onGroupWritten` trigger recomputes the `groupRole` denorm for the
  // members whose membership changed (added ∪ removed) across every workspace
  // that grants this group. The group doc + its grants survive the write, so
  // the trigger has everything it needs — no synchronous recompute here.

  const logRef = await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role: actorRole },
    action: "group.update",
    resource: { type: "group", id: groupId, parentId: teamId },
    changes: {
      fields,
      before: {
        name: before.name ?? null,
        description: before.description ?? null,
        memberCount: beforeMemberIds.length,
      },
      after: {
        name: name !== undefined ? name : (before.name ?? null),
        description:
          description !== undefined
            ? description
            : (before.description ?? null),
        memberCount:
          memberIds !== undefined ? memberIds.length : beforeMemberIds.length,
      },
    },
  })

  return { teamId, groupId, updated: true, logId: logRef.id }
})

export const deleteGroup = onCall(
  DESTRUCTIVE_CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const groupId = assertString(request.data?.groupId, "groupId")
    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined

    const actorRole = await requireGroupAdmin(teamId, actorId)

    const groupRef = db.doc(`teams/${teamId}/groups/${groupId}`)
    const groupSnap = await groupRef.get()
    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "Group not found.")
    }
    const groupData = groupSnap.data() ?? {}
    const memberIds: string[] = Array.isArray(groupData.memberIds)
      ? groupData.memberIds
      : []

    // Capture the workspaces that grant this group BEFORE we delete anything —
    // once both the group doc and its grants are gone, no trigger can reconstruct
    // who needs their `groupRole` denorm recomputed, so deletion owns that
    // cleanup synchronously and authoritatively.
    const grantingWorkspaceIds = await listGrantingWorkspaceIdsForGroup(
      teamId,
      groupId
    )

    const batch = db.batch()
    batch.delete(groupRef)
    for (const workspaceId of grantingWorkspaceIds) {
      batch.delete(
        db.doc(
          `teams/${teamId}/workspaces/${workspaceId}/groupGrants/${groupId}`
        )
      )
    }
    await batch.commit()

    // Best-effort avatar cleanup. Done here (admin SDK) so it covers every
    // deletion path, not just the UI; `ignoreNotFound` no-ops when the group
    // never had a photo. Mirrors `getGroupPhotoPath` on the client.
    await deleteStorageObjectIfExists(
      `images/teams/${teamId}/groups/${groupId}/profilePhoto`
    )

    // Recompute the denorm for the former members in each formerly-granting
    // workspace: with this group + its grant gone, each member's `groupRole` now
    // resolves from their REMAINING groups (or clears). Idempotent — the
    // `onGroup*Written` triggers also fire but find nothing to do.
    for (const workspaceId of grantingWorkspaceIds) {
      await recomputeGroupRoleForMembersInWorkspace(
        teamId,
        workspaceId,
        memberIds
      )
    }

    const logRef = await logEvent({
      teamId,
      actor: { userId: actorId, email: actorEmail, role: actorRole },
      action: "group.delete",
      resource: { type: "group", id: groupId, parentId: teamId },
      changes: {
        fields: ["name", "description", "memberIds"],
        before: {
          name: groupData.name ?? null,
          description: groupData.description ?? null,
          memberCount: memberIds.length,
        },
      },
    })

    return { teamId, groupId, deleted: true, logId: logRef.id }
  }
)

// =============================================================================
// Per-workspace group grants
// =============================================================================

export const assignWorkspaceGroupRole = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const groupId = assertString(request.data?.groupId, "groupId")

    // `role: null` clears the grant; a role sets it.
    const roleProvided = request.data?.role !== undefined
    if (!roleProvided) {
      throw new HttpsError(
        "invalid-argument",
        "Provide a role (or null to remove the grant)."
      )
    }
    const role: IMembershipRole | null =
      request.data?.role === null
        ? null
        : assertMembershipRoleValue(request.data?.role, "role")

    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined

    const actorRole = await getMembershipRole(teamId, actorId)
    // Granting a group a role in a workspace is a team-admin act (same gate as
    // assigning a member's per-workspace role).
    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to assign workspace group roles."
      )
    }
    // Granting `owner` — even scoped to one workspace — is owner-only, mirroring
    // assignWorkspaceRole / assignRoleToUser.
    if (role === "owner" && actorRole !== "owner") {
      throw new HttpsError(
        "permission-denied",
        "Only team owners can grant the owner role."
      )
    }

    const result = await db.runTransaction(async (transaction) => {
      const groupRef = db.doc(`teams/${teamId}/groups/${groupId}`)
      const groupSnap = await transaction.get(groupRef)
      if (!groupSnap.exists) {
        throw new HttpsError("not-found", "Group not found.")
      }

      const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
      const workspaceSnap = await transaction.get(workspaceRef)
      if (!workspaceSnap.exists) {
        throw new HttpsError("not-found", "Workspace not found.")
      }

      const grantRef = db.doc(
        `teams/${teamId}/workspaces/${workspaceId}/groupGrants/${groupId}`
      )
      const grantSnap = await transaction.get(grantRef)
      const beforeRole =
        grantSnap.exists && isMembershipRole(grantSnap.data()?.role)
          ? (grantSnap.data()?.role as IMembershipRole)
          : null

      if (role === beforeRole) {
        return {
          updated: false,
          beforeRole,
          logId: undefined as string | undefined,
        }
      }

      if (role === null) {
        transaction.delete(grantRef)
      } else {
        transaction.set(
          grantRef,
          {
            groupId,
            role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      }

      const logRef = await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorId, email: actorEmail, role: actorRole },
          action: "group.grant.update",
          resource: { type: "group", id: groupId, parentId: workspaceId },
          changes: {
            fields: ["role"],
            before: { role: beforeRole },
            after: { role },
          },
        },
        { transaction }
      )

      return { updated: true, beforeRole, logId: logRef.id }
    })

    // The `onGroupGrantWritten` trigger recomputes the `groupRole` denorm for
    // this group's members in this workspace (the group doc survives, so the
    // trigger can read its memberIds).

    return {
      teamId,
      workspaceId,
      groupId,
      role,
      updated: result.updated,
      logId: result.logId,
    }
  }
)

/**
 * List a workspace's group grants, keyed by groupId. Admin-gated; powers the
 * WorkspaceDialog "groups" area (only granted groups are shown, never the full
 * group catalog). Returns `[{ groupId, role }]`.
 */
export const listWorkspaceGroupRoles = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const actorId = request.auth.uid

    const actorRole = await getMembershipRole(teamId, actorId)
    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to view workspace group roles."
      )
    }

    const grantsSnap = await db
      .collection(`teams/${teamId}/workspaces/${workspaceId}/groupGrants`)
      .get()

    const grants = grantsSnap.docs
      .map((doc) => {
        const role = doc.data()?.role
        return isMembershipRole(role) ? { groupId: doc.id, role } : null
      })
      .filter(
        (g): g is { groupId: string; role: IMembershipRole } => g !== null
      )

    return { teamId, workspaceId, grants }
  }
)

/**
 * Per-group count of the workspaces that grant it a role — the "used in N
 * workspaces" blast-radius cue in Settings → Groups and the group dialog.
 * Admin-gated. Iterates the team's workspaces (bounded), so no collectionGroup
 * index is required.
 */
export const getTeamGroupUsage = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const actorId = request.auth.uid

  const actorRole = await getMembershipRole(teamId, actorId)
  if (
    !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
      scope: "team",
      teamRole: actorRole,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to view group usage."
    )
  }

  const wsSnap = await db
    .collection(`teams/${teamId}/workspaces`)
    .select()
    .get()

  const usage: Record<string, number> = {}
  await Promise.all(
    wsSnap.docs.map(async (ws) => {
      const grantsSnap = await db
        .collection(`teams/${teamId}/workspaces/${ws.id}/groupGrants`)
        .select()
        .get()
      for (const grant of grantsSnap.docs) {
        usage[grant.id] = (usage[grant.id] ?? 0) + 1
      }
    })
  )

  return { teamId, usage }
})

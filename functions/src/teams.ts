import { COST_BUDGET } from "./costBudget.js"
import { db } from "./firebase.js"
import { IMembershipRole, RoleGroups, TeamMember } from "./types.js"

// Firestore `in` clause supports up to 30 values
const FIRESTORE_IN_LIMIT = 30

/**
 * Get team members filtered by specific roles.
 *
 * COST OPTIMIZATION: Uses server-side `where("role", "in", roles)` filter
 * when roles.length <= 30 to avoid reading the entire membership collection.
 * Also uses `select()` field mask to fetch only needed fields.
 *
 * @param teamId - The team ID to query
 * @param roles - Array of roles to include (use RoleGroups for presets)
 * @param excludeUserId - Optional user ID to exclude from results
 */
export async function getTeamMembersByRoles(
  teamId: string,
  roles: readonly IMembershipRole[],
  excludeUserId?: string
): Promise<TeamMember[]> {
  let q: FirebaseFirestore.Query = db.collection(`teams/${teamId}/memberships`)

  // Server-side role filtering when possible (avoids reading all docs)
  if (roles.length > 0 && roles.length <= FIRESTORE_IN_LIMIT) {
    q = q.where("role", "in", [...roles])
  }

  // Field mask: only fetch the fields we actually need
  q = q.select("userId", "role", "user")

  // Safety limit to prevent runaway reads
  q = q.limit(COST_BUDGET.NOTIFICATION_FANOUT_MAX)

  const membersSnap = await q.get()

  return membersSnap.docs
    .map((doc) => {
      const data = doc.data()
      return {
        userId: data.userId,
        email: data.user?.email,
        role: data.role as IMembershipRole,
      }
    })
    .filter(
      (member) =>
        // If roles exceeded the `in` limit, filter client-side as fallback
        (roles.length > FIRESTORE_IN_LIMIT
          ? roles.includes(member.role)
          : true) &&
        (!excludeUserId || member.userId !== excludeUserId)
    )
}

/**
 * Convenience function to get team admins and owners.
 */
export async function getTeamAdminsAndOwners(
  teamId: string,
  excludeUserId?: string
): Promise<TeamMember[]> {
  return getTeamMembersByRoles(teamId, RoleGroups.ADMINS, excludeUserId)
}

/**
 * Get all team members (excluding guests).
 */
export async function getTeamMembers(
  teamId: string,
  excludeUserId?: string
): Promise<TeamMember[]> {
  return getTeamMembersByRoles(teamId, RoleGroups.MEMBERS, excludeUserId)
}

/**
 * Get all team members including guests.
 */
export async function getAllTeamMembers(
  teamId: string,
  excludeUserId?: string
): Promise<TeamMember[]> {
  return getTeamMembersByRoles(teamId, RoleGroups.ALL, excludeUserId)
}

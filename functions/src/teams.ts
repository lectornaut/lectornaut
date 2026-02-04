import admin from "firebase-admin"
import { IMembershipRole, RoleGroups, TeamMember } from "./types.js"

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp()
}

const db = admin.firestore()

/**
 * Get team members filtered by specific roles.
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
  const membersSnap = await db.collection(`teams/${teamId}/memberships`).get()

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
        roles.includes(member.role) &&
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

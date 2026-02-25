import { auth, firestore } from "@/modules/firebase"
import type { IMembershipRole } from "@/types/membership"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { Capabilities, roleCan } from "@/types/permissions"
import { doc, getDoc } from "firebase/firestore"

type CollabRole = "editor" | "viewer" | "none"

const MEMBERSHIP_ROLES: IMembershipRole[] = [
  "owner",
  "admin",
  "member",
  "guest",
]

export interface ContentAccessInput {
  contentId: string
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  userId?: string
}

function isMembershipRole(value: unknown): value is IMembershipRole {
  return (
    typeof value === "string" &&
    MEMBERSHIP_ROLES.includes(value as IMembershipRole)
  )
}

async function resolveRole(
  input: ContentAccessInput
): Promise<IMembershipRole | null> {
  const userId = input.userId ?? auth.currentUser?.uid
  if (!userId) {
    return null
  }

  // Fetch all three docs in parallel to reduce latency (3 round-trips → 1)
  const [contentSnap, workspaceMemberSnap, teamMemberSnap] = await Promise.all([
    getDoc(
      doc(
        firestore,
        "teams",
        input.teamId,
        "workspaces",
        input.workspaceId,
        input.scope,
        input.contentId
      )
    ),
    getDoc(
      doc(
        firestore,
        "teams",
        input.teamId,
        "workspaces",
        input.workspaceId,
        "memberships",
        userId
      )
    ),
    getDoc(doc(firestore, "teams", input.teamId, "memberships", userId)),
  ])

  if (!contentSnap.exists()) {
    return null
  }

  // Prefer workspace-level membership over team-level
  if (workspaceMemberSnap.exists()) {
    const workspaceRole = workspaceMemberSnap.data()?.role
    if (isMembershipRole(workspaceRole)) {
      return workspaceRole
    }
  }

  if (!teamMemberSnap.exists()) {
    return null
  }

  const teamRole = teamMemberSnap.data()?.role
  return isMembershipRole(teamRole) ? teamRole : null
}

export async function canViewContent(
  input: ContentAccessInput
): Promise<boolean> {
  const role = await resolveRole(input)
  return role ? roleCan(role, Capabilities.READ_WORKSPACE) : false
}

export async function canEditContent(
  input: ContentAccessInput
): Promise<boolean> {
  const role = await resolveRole(input)
  return role ? roleCan(role, Capabilities.MANAGE_WORKSPACE_CONTENT) : false
}

export async function getCollabRole(
  input: ContentAccessInput
): Promise<CollabRole> {
  const role = await resolveRole(input)
  if (!role) {
    return "none"
  }

  return roleCan(role, Capabilities.MANAGE_WORKSPACE_CONTENT)
    ? "editor"
    : "viewer"
}

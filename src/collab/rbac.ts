import { auth, firestore } from "@/modules/firebase"
import type { IMembershipRole } from "@/types"
import { Capabilities, roleCan } from "@/utils/permissions"
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

  const contentRef = doc(
    firestore,
    "teams",
    input.teamId,
    "workspaces",
    input.workspaceId,
    "nodes",
    input.contentId
  )
  const contentSnap = await getDoc(contentRef)
  if (!contentSnap.exists()) {
    return null
  }

  const workspaceMemberRef = doc(
    firestore,
    "teams",
    input.teamId,
    "workspaces",
    input.workspaceId,
    "memberships",
    userId
  )
  const workspaceMemberSnap = await getDoc(workspaceMemberRef)
  if (workspaceMemberSnap.exists()) {
    const workspaceRole = workspaceMemberSnap.data()?.role
    if (isMembershipRole(workspaceRole)) {
      return workspaceRole
    }
  }

  const teamMemberRef = doc(
    firestore,
    "teams",
    input.teamId,
    "memberships",
    userId
  )
  const teamMemberSnap = await getDoc(teamMemberRef)
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

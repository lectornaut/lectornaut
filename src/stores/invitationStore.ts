/**
 * Invitation Store - Team Invitation Management
 *
 * Handles:
 * - Sending invitations (creating docs in 'invitations' collection)
 * - Resending invitations (delete old, create new)
 * - Canceling/Deleting invitations
 * - Fetching invitations for a team
 * - Fetching invitations for the current user
 * - Accepting/Declining invitations
 *
 * Data Model:
 * collections/invitations/{invitationId}
 * {
 *   teamId: string
 *   teamName: string
 *   inviteeName: string
 *   inviteeEmail: string
 *   email: string
 *   role: string
 *   status: "pending" | "declined"
 *   code: string
 *   createdAt: Timestamp
 * }
 */

import { firestore, functions } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import type { IMembershipRole } from "@/types"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { defineStore, storeToRefs } from "pinia"
import { computed, unref, type MaybeRef } from "vue"
import { useCollection } from "vuefire"

export interface IInvitation {
  id?: string
  teamId: string
  teamName: string
  inviteeName: string
  inviteeEmail: string
  email: string
  role: IMembershipRole
  status: "pending" | "declined"
  code: string
  createdAt: Timestamp
}

export const useInvitationStore = defineStore("invitations", () => {
  const authStore = useAuthStore()
  const { currentUser, userProfile, currentTeamId } = storeToRefs(authStore)

  // ============================================================================
  // VueFire Reactive Bindings
  // ============================================================================

  // 1. Invitations for the current team (Visible to Admin/Owner)
  const teamInvitationsQuery = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null
    return query(
      collection(firestore, "invitations"),
      where("teamId", "==", teamId)
    )
  })

  const { data: teamInvitations, pending: isTeamInvitationsLoading } =
    useCollection<IInvitation>(teamInvitationsQuery)

  // 2. Invitations for the current user (Visible on Join Page / Dashboard)
  const userInvitationsQuery = computed(() => {
    if (!currentUser.value?.email) return null
    return query(
      collection(firestore, "invitations"),
      where("email", "==", currentUser.value.email)
    )
  })

  const { data: userInvitations, pending: isUserInvitationsLoading } =
    useCollection<IInvitation>(userInvitationsQuery)

  // ============================================================================
  // Helpers
  // ============================================================================

  const generateInvitationCode = () => {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Send a new invitation
   */
  async function sendInvitation(payload: {
    teamId: string
    teamName: string
    email: string
    role: IMembershipRole
  }): Promise<void> {
    const { teamId, teamName, email, role } = payload
    const user = currentUser.value
    const profile = userProfile.value

    if (!user || !profile) throw new Error("Not authenticated")

    // Check for existing pending invitation
    const q = query(
      collection(firestore, "invitations"),
      where("teamId", "==", teamId),
      where("email", "==", email),
      where("status", "==", "pending")
    )
    const snapshot = await getDocs(q)
    if (!snapshot.empty) {
      throw new Error("A pending invitation already exists for this user.")
    }

    const invitation: Omit<IInvitation, "id"> = {
      teamId,
      teamName,
      inviteeName: profile.displayName || user.email || "Unknown",
      inviteeEmail: user.email!,
      email,
      role,
      status: "pending",
      code: generateInvitationCode(),
      createdAt: serverTimestamp() as Timestamp,
    }

    await addDoc(collection(firestore, "invitations"), invitation)

    try {
      // Send email via Cloud Function
      const sendEmail = httpsCallable(functions, "sendEmail")
      const inviteUrl = `${window.location.origin}/join?code=${invitation.code}`

      await sendEmail({
        email: invitation.email,
        subject: `You've been invited to join ${teamName} on Lectornaut`,
        template: "invitation",
        data: {
          teamName: invitation.teamName,
          inviteeName: invitation.inviteeName,
          inviteeEmail: invitation.inviteeEmail,
          role: invitation.role,
          ctaUrl: inviteUrl,
        },
      }).catch((error) =>
        console.error("Failed to send invitation email:", error)
      )
    } catch (error) {
      console.error("Failed to send invitation email:", error)
      // We don't throw here because the invitation was successfully created in Firestore
      // The user can retry sending via "Resend" button if needed
    }
  }

  /**
   * Resend an invitation (invalidate old, create new)
   * This re-triggers the email extension
   */
  async function resendInvitation(invitation: IInvitation): Promise<void> {
    if (!invitation.id) return

    const { teamId, teamName, inviteeName, inviteeEmail, email, role } =
      invitation

    const newInvitationCode = generateInvitationCode()

    await runTransaction(firestore, async (transaction) => {
      // 1. Delete old invitation
      const oldRef = doc(firestore, "invitations", invitation.id!)
      transaction.delete(oldRef)

      // 2. Create new invitation with fresh details
      const newInvitation: Omit<IInvitation, "id"> = {
        teamId,
        teamName,
        inviteeName,
        inviteeEmail,
        email,
        role,
        status: "pending",
        code: newInvitationCode,
        createdAt: serverTimestamp() as Timestamp,
      }

      const newRef = doc(collection(firestore, "invitations"))
      transaction.set(newRef, newInvitation)
    })

    try {
      // Send email via Cloud Function
      const sendEmail = httpsCallable(functions, "sendEmail")
      const inviteUrl = `${window.location.origin}/join?code=${newInvitationCode}`

      await sendEmail({
        email: email,
        subject: `You've been invited to join ${teamName} on Lectornaut`,
        template: "invitation",
        data: {
          teamName,
          inviteeName,
          inviteeEmail,
          role: role,
          ctaUrl: inviteUrl,
        },
      }).catch((error) =>
        console.error("Failed to send invitation email:", error)
      )
    } catch (error) {
      console.error("Failed to send invitation email:", error)
    }
  }

  /**
   * Update the role of a pending invitation
   */
  async function updateInvitationRole(
    invitationId: string,
    role: IMembershipRole
  ): Promise<void> {
    const invRef = doc(firestore, "invitations", invitationId)
    await updateDoc(invRef, { role })
  }

  /**
   * Cancel/Delete an invitation
   */
  async function cancelInvitation(invitationId: string): Promise<void> {
    await deleteDoc(doc(firestore, "invitations", invitationId))
  }

  /**
   * Get invitation by code (for Join page)
   */
  async function getInvitationByCode(
    code: string
  ): Promise<IInvitation | null> {
    const q = query(
      collection(firestore, "invitations"),
      where("code", "==", code)
    )
    const snapshot = await getDocs(q)

    if (snapshot.empty) return null

    const docSnap = snapshot.docs[0]
    if (!docSnap) return null

    return { id: docSnap.id, ...docSnap.data() } as IInvitation
  }

  /**
   * Accept an invitation
   */
  async function acceptInvitation(invitation: IInvitation): Promise<void> {
    const user = currentUser.value
    if (!user) throw new Error("Not authenticated")
    if (invitation.status !== "pending") {
      throw new Error("Only pending invitations can be accepted.")
    }
    if (!invitation.id) throw new Error("Invalid invitation")

    const { teamId, id: invitationId, role } = invitation

    await runTransaction(firestore, async (transaction) => {
      // Double check invitation exists and is pending
      const invRef = doc(firestore, "invitations", invitationId!)
      const invSnap = await transaction.get(invRef)

      if (!invSnap.exists()) throw new Error("Invitation no longer exists")
      const invData = invSnap.data() as IInvitation
      if (invData.status !== "pending")
        throw new Error("Invitation is not pending")

      // Create membership
      const teamRef = doc(firestore, "teams", teamId)
      const teamSnap = await transaction.get(teamRef)
      if (!teamSnap.exists()) throw new Error("Team no longer exists")

      // Add membership
      const membershipRef = doc(firestore, "teams", teamId, "members", user.uid)

      transaction.set(membershipRef, {
        userId: user.uid,
        teamId,
        role,
        user: userProfile.value,
        team: teamSnap.data(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Delete invitation
      transaction.delete(invRef)

      // Update user profile currentTeamId if they don't have one
      if (!userProfile.value?.currentTeamId) {
        const userRef = doc(firestore, "users", user.uid)
        transaction.update(userRef, {
          currentTeamId: teamId,
          updatedAt: serverTimestamp(),
        })
      }
    })
  }

  /**
   * Decline an invitation
   */
  async function declineInvitation(invitationId: string): Promise<void> {
    // Check if document exists first? Or just try update
    const invRef = doc(firestore, "invitations", invitationId)
    await updateDoc(invRef, { status: "declined" })
  }

  return {
    teamInvitations,
    userInvitations,
    isTeamInvitationsLoading,
    isUserInvitationsLoading,
    sendInvitation,
    resendInvitation,
    updateInvitationRole,
    cancelInvitation,
    getInvitationByCode,
    acceptInvitation,
    declineInvitation,
  }
})

/**
 * Composable to fetch invitations for a specific team.
 * Intelligently reuses store data if the requested team is the current team.
 */
export function useTeamInvitations(
  teamId: MaybeRef<string | undefined | null>
) {
  const store = useInvitationStore()
  const authStore = useAuthStore()

  const targetId = computed(() => unref(teamId))
  const isCurrentTeam = computed(
    () => targetId.value && targetId.value === authStore.currentTeamId
  )

  // Local query: active only if NOT the current team
  const localQuery = computed(() => {
    if (!targetId.value || isCurrentTeam.value) return null
    return query(
      collection(firestore, "invitations"),
      where("teamId", "==", targetId.value)
    )
  })

  // We rely on vuefire's automatic unsubscription when the component unmounts
  // or when the query becomes null.
  const { data: localInvitations } = useCollection<IInvitation>(localQuery)

  return computed(() => {
    if (isCurrentTeam.value) {
      return store.teamInvitations || []
    }
    return localInvitations.value || []
  })
}

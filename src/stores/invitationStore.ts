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
 *   inviterName: string
 *   inviterEmail: string
 *   email: string
 *   role: string
 *   status: "pending" | "declined"
 *   code: string
 *   createdAt: Timestamp
 * }
 */

import {
  cancelInvitation as cancelInvitationFn,
  declineInvitation as declineInvitationFn,
  resendInvitation as resendInvitationFn,
  sendInvitation as sendInvitationFn,
  updateInvitationRole as updateInvitationRoleFn,
} from "@/composables/useFunctions"
import { firestore, functions } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IMembership, IMembershipRole } from "@/types"
import { getMembershipRef } from "@/utils/firebase-helpers"
import {
  cloneState,
  createPendingSet,
  generateOperationId,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import { can, Capabilities } from "@/utils/permissions"
import {
  collection,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, shallowRef, unref, type MaybeRef } from "vue"
import { useCollection } from "vuefire"

export interface IInvitation {
  id?: string
  teamId: string
  teamName: string
  inviterName: string
  inviterEmail: string
  email: string
  role: IMembershipRole
  status: "pending" | "declined"
  code: string
  createdAt: Timestamp
  resentAt?: Timestamp
}

export const useInvitationStore = defineStore("invitations", () => {
  const authStore = useAuthStore()
  const { currentUser, userProfile, currentTeamId } = storeToRefs(authStore)

  // ============================================================================
  // Optimistic State
  // ============================================================================

  /** Local invitations that can be optimistically updated */
  const optimisticInvitations = ref<IInvitation[]>([])

  /** Pending operation tracking */
  const pendingInvitationIds = shallowRef(createPendingSet())

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

  const { data: firestoreTeamInvitations, pending: isTeamInvitationsLoading } =
    useCollection<IInvitation>(teamInvitationsQuery)

  // 2. Invitations for the current user (Visible on Join Page / Dashboard)
  const userInvitationsQuery = computed(() => {
    if (!currentUser.value?.email) return null
    return query(
      collection(firestore, "invitations"),
      where("email", "==", currentUser.value.email)
    )
  })

  const { data: firestoreUserInvitations, pending: isUserInvitationsLoading } =
    useCollection<IInvitation>(userInvitationsQuery)

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** Merged team invitations (live + optimistic) */
  const teamInvitations = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return []

    const pending = pendingInvitationIds.value
    if (pending.size === 0) return firestoreTeamInvitations.value || []

    const result: IInvitation[] = []
    const firestoreData = firestoreTeamInvitations.value || []

    // Add Firestore data, replacing with optimistic if pending
    firestoreData.forEach((inv) => {
      if (inv.id && pending.has(inv.id)) {
        const optimistic = optimisticInvitations.value.find(
          (oi) => oi.id === inv.id
        )
        if (optimistic) {
          result.push(optimistic)
          return
        }
      }
      result.push(inv)
    })

    // Add new optimistic invitations that haven't hit Firestore yet
    optimisticInvitations.value.forEach((inv) => {
      if (
        inv.id &&
        pending.has(inv.id) &&
        inv.teamId === teamId &&
        !result.some((r) => r.id === inv.id)
      ) {
        result.push(inv)
      }
    })

    return result
  })

  /** Merged user invitations (live + optimistic) */
  const userInvitations = computed(() => {
    const email = currentUser.value?.email
    if (!email) return []

    const pending = pendingInvitationIds.value
    if (pending.size === 0) return firestoreUserInvitations.value || []

    const result: IInvitation[] = []
    const firestoreData = firestoreUserInvitations.value || []

    firestoreData.forEach((inv) => {
      if (inv.id && pending.has(inv.id)) {
        const optimistic = optimisticInvitations.value.find(
          (oi) => oi.id === inv.id
        )
        if (optimistic) {
          result.push(optimistic)
          return
        }
      }
      result.push(inv)
    })

    optimisticInvitations.value.forEach((inv) => {
      if (
        inv.id &&
        pending.has(inv.id) &&
        inv.email === email &&
        !result.some((r) => r.id === inv.id)
      ) {
        result.push(inv)
      }
    })

    return result
  })

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

    // Use current user's role from membership store if available
    // Note: We can only check permissions if they are already a member of the team
    const membershipStore = useMembershipStore()
    let membership = membershipStore.memberships.find(
      (m) => m.teamId === teamId
    )

    // Fallback: membership might not be synced yet right after team creation.
    if (!membership) {
      const membershipSnap = await getDoc(getMembershipRef(teamId, user.uid))
      if (membershipSnap.exists()) {
        membership = membershipSnap.data() as IMembership
      }
    }
    if (
      !membership ||
      !can(user, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: membership.role,
      })
    ) {
      throw new Error("You do not have permission to send invitations")
    }

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

    const opId = generateOperationId()
    const code = generateInvitationCode()
    const invitation: IInvitation = {
      id: opId, // temporary ID for optimistic tracking
      teamId,
      teamName,
      inviterName: profile.displayName || user.email || "Unknown",
      inviterEmail: user.email!,
      email,
      role,
      status: "pending",
      code,
      createdAt: Timestamp.now(),
    }

    const previousOptimistic = cloneState(optimisticInvitations.value)

    await withOptimisticUpdate(
      pendingInvitationIds.value,
      opId,
      () => {
        optimisticInvitations.value = [
          ...optimisticInvitations.value,
          invitation,
        ]
      },
      () => {
        optimisticInvitations.value = previousOptimistic
      },
      async () => {
        await sendInvitationFn({ teamId, email, role })
      }
    )
  }

  /**
   * Resend an invitation (invalidate old, create new)
   * This re-triggers the backend function via document creation
   */
  async function resendInvitation(invitation: IInvitation): Promise<void> {
    if (!invitation.id) return

    const membershipStore = useMembershipStore()
    const membership = membershipStore.memberships.find(
      (m) => m.teamId === invitation.teamId
    )
    if (
      !membership ||
      !can(currentUser.value, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: membership.role,
      })
    ) {
      throw new Error("You do not have permission to resend invitations")
    }

    const previousOptimistic = cloneState(optimisticInvitations.value)

    await withOptimisticUpdate(
      pendingInvitationIds.value,
      invitation.id,
      () => {
        optimisticInvitations.value = optimisticInvitations.value.map((inv) =>
          inv.id === invitation.id
            ? {
                ...inv,
                status: "pending",
                resentAt: Timestamp.now(),
              }
            : inv
        )
      },
      () => {
        optimisticInvitations.value = previousOptimistic
      },
      async () => {
        await resendInvitationFn({ invitationId: invitation.id! })
      }
    )
  }

  /**
   * Update the role of a pending invitation
   */
  async function updateInvitationRole(
    invitationId: string,
    role: IMembershipRole
  ): Promise<void> {
    // Need to fetch invitation to get teamId for permission check if not passed
    // But for optimistically we need to look it up or rely on caller context.
    // Optimistic store has the invite
    const invite = optimisticInvitations.value.find(
      (i) => i.id === invitationId
    )
    // Fallback to firestore check handled by rules, but we want UI feedback

    if (invite) {
      const membershipStore = useMembershipStore()
      const membership = membershipStore.memberships.find(
        (m) => m.teamId === invite.teamId
      )
      if (
        !membership ||
        !can(currentUser.value, Capabilities.UPDATE_MEMBER_ROLE, {
          scope: "team",
          teamRole: membership.role,
        })
      ) {
        throw new Error("You do not have permission to update invitations")
      }
    }
    const previousOptimistic = cloneState(optimisticInvitations.value)

    await withOptimisticUpdate(
      pendingInvitationIds.value,
      invitationId,
      () => {
        optimisticInvitations.value = optimisticInvitations.value.map((inv) =>
          inv.id === invitationId ? { ...inv, role } : inv
        )
      },
      () => {
        optimisticInvitations.value = previousOptimistic
      },
      async () => {
        await updateInvitationRoleFn({ invitationId, role })
      }
    )
  }

  /**
   * Cancel/Delete an invitation
   */
  async function cancelInvitation(invitationId: string): Promise<void> {
    const invite = optimisticInvitations.value.find(
      (i) => i.id === invitationId
    )
    if (invite) {
      const membershipStore = useMembershipStore()
      const membership = membershipStore.memberships.find(
        (m) => m.teamId === invite.teamId
      )
      if (
        !membership ||
        !can(currentUser.value, Capabilities.INVITE_MEMBER, {
          scope: "team",
          teamRole: membership.role,
        })
      ) {
        throw new Error("You do not have permission to cancel invitations")
      }
    }
    const previousOptimistic = cloneState(optimisticInvitations.value)

    await withOptimisticUpdate(
      pendingInvitationIds.value,
      invitationId,
      () => {
        optimisticInvitations.value = optimisticInvitations.value.filter(
          (inv) => inv.id !== invitationId
        )
      },
      () => {
        optimisticInvitations.value = previousOptimistic
      },
      async () => {
        await cancelInvitationFn({ invitationId })
      }
    )
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

    const { id: invitationId } = invitation
    const previousOptimistic = cloneState(optimisticInvitations.value)

    // Note: We only handle invitation removal optimistically here.
    // Membership addition happens in its own store if we wanted full coverage,
    // but the invitation leaving the list is the most important immediate feedback.
    await withOptimisticUpdate(
      pendingInvitationIds.value,
      invitationId,
      () => {
        optimisticInvitations.value = optimisticInvitations.value.filter(
          (inv) => inv.id !== invitationId
        )
      },
      () => {
        optimisticInvitations.value = previousOptimistic
      },
      async () => {
        const acceptInvitationFn = httpsCallable(functions, "acceptInvitation")
        await acceptInvitationFn({ invitationId })
      }
    )
  }

  /**
   * Decline an invitation
   */
  async function declineInvitation(invitationId: string): Promise<void> {
    const previousOptimistic = cloneState(optimisticInvitations.value)

    await withOptimisticUpdate(
      pendingInvitationIds.value,
      invitationId,
      () => {
        optimisticInvitations.value = optimisticInvitations.value.map((inv) =>
          inv.id === invitationId ? { ...inv, status: "declined" } : inv
        )
      },
      () => {
        optimisticInvitations.value = previousOptimistic
      },
      async () => {
        await declineInvitationFn({ invitationId })
      }
    )
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

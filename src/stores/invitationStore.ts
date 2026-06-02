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
import { queryClient } from "@/modules/queryClient"
import { parseSafe } from "@/schemas/_utils"
import { invitationSchema } from "@/schemas/invitation"
import { membershipSchema } from "@/schemas/membership"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import {
  isMembershipRole,
  type IMembership,
  type IMembershipRole,
} from "@/types/membership"
import { can, Capabilities, type Capability } from "@/types/permissions"
import { getMembershipRef } from "@/utils/firebase/firebase-helpers"
import { useFirestoreMutation } from "@/utils/firebase/firebase-mutation"
import { generateOperationId } from "@/utils/firebase/firebase-optimistic"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
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
import { computed, unref, type MaybeRef } from "vue"

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
  const membershipStore = useMembershipStore()
  const { currentUser, userProfile, currentTeamId } = storeToRefs(authStore)
  const { memberships } = storeToRefs(membershipStore)
  const acceptInvitationFn = httpsCallable<{ invitationId: string }, unknown>(
    functions,
    "acceptInvitation"
  )

  // ============================================================================
  // Optimistic mutation
  // ============================================================================

  // A single mutation drives every invitation write. Callers pass the affected
  // cache list keys + an optimistic transform + the Cloud Function call via
  // `runInvitationMutation`; the optimistic value is written straight into the
  // invitations cache and held until the server-applied snapshot reconciles it.
  const invitationMutation = useFirestoreMutation<
    {
      keys: FirestoreQueryKey[]
      apply: () => void
      rollback: () => void
      run: () => Promise<void>
    },
    void
  >({
    mutationFn: (vars) => vars.run(),
    optimistic: (vars) => ({
      keys: vars.keys,
      apply: vars.apply,
      rollback: vars.rollback,
    }),
    source: "invitation",
  })

  // ============================================================================
  // Realtime Firestore bindings (TanStack Query)
  // ============================================================================

  // 1. Invitations for the current team (Visible to Admin/Owner)
  const teamInvitationsQuery = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    const membership = memberships.value.find(
      (m) => m.teamId === teamId && m.userId === currentUser.value?.uid
    )
    if (
      !membership ||
      !can(currentUser.value, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: membership.role,
      })
    ) {
      return null
    }

    return query(
      collection(firestore, "invitations"),
      where("teamId", "==", teamId)
    )
  })

  const {
    data: firestoreTeamInvitations,
    isLoading: isTeamInvitationsLoading,
  } = useCollectionQuery<IInvitation>(() => {
    const activeQuery = teamInvitationsQuery.value
    const teamId = currentTeamId.value
    return activeQuery && teamId
      ? { query: activeQuery, path: "invitations", params: { teamId } }
      : null
  })

  // 2. Invitations for the current user (Visible on Join Page / Dashboard)
  const userInvitationsQuery = computed(() => {
    const email = currentUser.value?.email?.toLowerCase()
    if (!email) return null
    return query(
      collection(firestore, "invitations"),
      where("email", "==", email)
    )
  })

  const {
    data: firestoreUserInvitations,
    isLoading: isUserInvitationsLoading,
  } = useCollectionQuery<IInvitation>(() => {
    const activeQuery = userInvitationsQuery.value
    const email = currentUser.value?.email?.toLowerCase()
    return activeQuery && email
      ? { query: activeQuery, path: "invitations", params: { email } }
      : null
  })

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  // Both lists read straight from their realtime cache queries (already filtered
  // by teamId / email). Optimistic adds/updates/removes are written directly to
  // these cache entries by the mutations below — no separate optimistic overlay.

  /** Team invitations for the current team. */
  const teamInvitations = computed(() => {
    if (!currentTeamId.value) return []
    return firestoreTeamInvitations.value ?? []
  })

  /** Invitations addressed to the signed-in user. */
  const userInvitations = computed(() => {
    if (!currentUser.value?.email) return []
    return firestoreUserInvitations.value ?? []
  })

  const invitationsById = computed(() => {
    const index = new Map<string, IInvitation>()
    teamInvitations.value.forEach((invitation) => {
      if (invitation.id) index.set(invitation.id, invitation)
    })
    userInvitations.value.forEach((invitation) => {
      if (invitation.id) index.set(invitation.id, invitation)
    })
    return index
  })

  // ============================================================================
  // Helpers
  // ============================================================================

  const generateInvitationCode = () => {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  const findInvitationById = (invitationId: string) =>
    invitationsById.value.get(invitationId)

  async function resolveMembershipForTeam(
    teamId: string,
    options: { fallbackToFirestore?: boolean } = {}
  ): Promise<IMembership | null> {
    const existingMembership = memberships.value.find(
      (m) => m.teamId === teamId
    )
    if (existingMembership) return existingMembership

    if (!options.fallbackToFirestore || !currentUser.value) {
      return null
    }

    const membershipSnap = await getDoc(
      getMembershipRef(teamId, currentUser.value.uid)
    )
    if (!membershipSnap.exists()) return null
    // Stricter re-parse: the ref's converter validates against
    // membershipDocDataSchema (which allows partial snapshots), but the
    // caller wants a fully-resolved IMembership.
    return parseSafe(
      membershipSchema,
      membershipSnap.data(),
      `membership:${membershipSnap.ref.path}`
    )
  }

  const assertTeamCapability = (
    membership: IMembership | null,
    capability: Capability,
    errorMessage: string
  ): void => {
    if (
      !membership ||
      !can(currentUser.value, capability, {
        scope: "team",
        teamRole: membership.role,
      })
    ) {
      throw new Error(errorMessage)
    }
  }

  async function assertInvitationCapability(
    invitationId: string,
    capability: Capability,
    errorMessage: string
  ): Promise<void> {
    const invitation = findInvitationById(invitationId)
    if (!invitation) return

    const membership = await resolveMembershipForTeam(invitation.teamId)
    assertTeamCapability(membership, capability, errorMessage)
  }

  /**
   * Cache list keys that currently show `invitation`: the team-invitations query
   * (when the admin is viewing that team) and/or the user-invitations query
   * (when it's addressed to the signed-in user). Optimistic changes are applied
   * to whichever lists are present.
   */
  const invitationListKeys = (invitation: {
    teamId: string
    email: string
  }): FirestoreQueryKey[] => {
    const keys: FirestoreQueryKey[] = []
    if (currentTeamId.value === invitation.teamId) {
      keys.push(queryKeys.list("invitations", { teamId: invitation.teamId }))
    }
    const email = currentUser.value?.email?.toLowerCase()
    if (email && email === invitation.email.toLowerCase()) {
      keys.push(queryKeys.list("invitations", { email }))
    }
    return keys
  }

  /**
   * Apply `applyOptimistic` to each affected invitations cache list, run the
   * Cloud Function, and roll the cache back on failure. The hold inside
   * `useFirestoreMutation` keeps the optimistic value visible until the
   * server-applied snapshot reconciles it.
   */
  async function runInvitationMutation(
    keys: FirestoreQueryKey[],
    applyOptimistic: (invitations: IInvitation[]) => IInvitation[],
    mutation: () => Promise<void>
  ): Promise<void> {
    const snapshots = keys.map((key) => ({
      key,
      previous: queryClient.getQueryData<IInvitation[]>(key),
    }))

    await invitationMutation.mutateAsync({
      keys,
      apply: () => {
        for (const key of keys) {
          const current = queryClient.getQueryData<IInvitation[]>(key) ?? []
          queryClient.setQueryData(key, applyOptimistic(current))
        }
      },
      rollback: () => {
        for (const { key, previous } of snapshots) {
          queryClient.setQueryData(key, previous)
        }
      },
      run: mutation,
    })
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
    const normalizedEmail = email.trim().toLowerCase()
    if (!isMembershipRole(role)) {
      throw new Error("Invalid invitation role")
    }
    const user = currentUser.value
    const profile = userProfile.value

    if (!user || !profile) throw new Error("Not authenticated")

    // Fallback to Firestore lookup because membership sync can lag immediately
    // after team creation.
    const membership = await resolveMembershipForTeam(teamId, {
      fallbackToFirestore: true,
    })
    assertTeamCapability(
      membership,
      Capabilities.INVITE_MEMBER,
      "You do not have permission to send invitations"
    )
    if (!membership) {
      throw new Error("You do not have permission to send invitations")
    }
    if (role === "owner" && membership.role !== "owner") {
      throw new Error("Only team owners can invite owners")
    }

    // The server's `sendInvitation` callable already enforces the
    // "no duplicate pending invitation" rule (audit.ts:3214) with an
    // `.select().limit(1)` aggregate read. A client-side pre-check
    // would add a redundant round-trip *and* open a race window
    // where two simultaneous sends both pass locally and only the
    // server stops the duplicate — so trust the server here. The
    // thrown HttpsError surfaces an "already-exists" code that
    // `runInvitationMutation`'s wrapper toasts the same way.

    const opId = generateOperationId()
    const code = generateInvitationCode()
    const invitation: IInvitation = {
      id: opId, // temporary ID for optimistic tracking
      teamId,
      teamName,
      inviterName: profile.displayName || user.email || "Unknown",
      inviterEmail: user.email!,
      email: normalizedEmail,
      role,
      status: "pending",
      code,
      createdAt: Timestamp.now(),
    }

    await runInvitationMutation(
      invitationListKeys(invitation),
      (invitations) => [...invitations, invitation],
      async () => {
        await sendInvitationFn({ teamId, email: normalizedEmail, role })
      }
    )
  }

  /**
   * Resend an invitation (invalidate old, create new)
   * This re-triggers the backend function via document creation
   */
  async function resendInvitation(invitation: IInvitation): Promise<void> {
    if (!invitation.id) return

    const membership = await resolveMembershipForTeam(invitation.teamId)
    assertTeamCapability(
      membership,
      Capabilities.INVITE_MEMBER,
      "You do not have permission to resend invitations"
    )

    await runInvitationMutation(
      invitationListKeys(invitation),
      (invitations) =>
        invitations.map((inv) =>
          inv.id === invitation.id
            ? {
                ...inv,
                status: "pending",
                resentAt: Timestamp.now(),
              }
            : inv
        ),
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
    if (!isMembershipRole(role)) {
      throw new Error("Invalid invitation role")
    }

    await assertInvitationCapability(
      invitationId,
      Capabilities.UPDATE_MEMBER_ROLE,
      "You do not have permission to update invitations"
    )

    const invitation = findInvitationById(invitationId)
    if (!invitation) {
      throw new Error("Invitation not found")
    }

    const membership = await resolveMembershipForTeam(invitation.teamId)
    if (
      membership?.role !== "owner" &&
      (role === "owner" || invitation.role === "owner")
    ) {
      throw new Error("Only team owners can manage owner invitations")
    }

    await runInvitationMutation(
      invitationListKeys(invitation),
      (invitations) =>
        invitations.map((inv) =>
          inv.id === invitationId ? { ...inv, role } : inv
        ),
      async () => {
        await updateInvitationRoleFn({ invitationId, role })
      }
    )
  }

  /**
   * Cancel/Delete an invitation
   */
  async function cancelInvitation(invitationId: string): Promise<void> {
    await assertInvitationCapability(
      invitationId,
      Capabilities.INVITE_MEMBER,
      "You do not have permission to cancel invitations"
    )

    const invitation = findInvitationById(invitationId)
    await runInvitationMutation(
      invitation ? invitationListKeys(invitation) : [],
      (invitations) => invitations.filter((inv) => inv.id !== invitationId),
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
    const userEmail = currentUser.value?.email?.toLowerCase()
    if (!userEmail) return null

    const q = query(
      collection(firestore, "invitations"),
      where("code", "==", code),
      where("email", "==", userEmail)
    )
    const snapshot = await getDocs(q)

    if (snapshot.empty) return null

    const docSnap = snapshot.docs[0]
    if (!docSnap) return null

    // The `invitations` collection is queried with a raw `collection()` ref,
    // so no converter is attached at the ref level — validate here instead.
    return parseSafe(
      invitationSchema,
      { id: docSnap.id, ...docSnap.data() },
      `invitation:${docSnap.ref.path}`
    )
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

    // Note: We only handle invitation removal optimistically here.
    // Membership addition happens in its own store if we wanted full coverage,
    // but the invitation leaving the list is the most important immediate feedback.
    await runInvitationMutation(
      invitationListKeys(invitation),
      (invitations) => invitations.filter((inv) => inv.id !== invitationId),
      async () => {
        await acceptInvitationFn({ invitationId })
      }
    )
  }

  /**
   * Decline an invitation
   */
  async function declineInvitation(invitationId: string): Promise<void> {
    const invitation = findInvitationById(invitationId)
    await runInvitationMutation(
      invitation ? invitationListKeys(invitation) : [],
      (invitations) =>
        invitations.map((inv) =>
          inv.id === invitationId ? { ...inv, status: "declined" } : inv
        ),
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

  // The realtime listener is torn down automatically when this query goes
  // unused (gc) or its source becomes null.
  const { data: localInvitations } = useCollectionQuery<IInvitation>(() => {
    const activeQuery = localQuery.value
    const teamId = targetId.value
    return activeQuery && teamId
      ? { query: activeQuery, path: "invitations", params: { teamId } }
      : null
  })

  return computed(() => {
    if (isCurrentTeam.value) {
      return store.teamInvitations ?? []
    }
    return localInvitations.value ?? []
  })
}

/**
 * Auth Store - Authentication and User Profile Management
 *
 * Handles:
 * - Firebase authentication state (via VueFire)
 * - User account profile CRUD with optimistic updates
 * - User-scoped preferences (team selection, onboarding)
 * - Team-membership-scoped workspace selection
 *
 * Uses VueFire composables for reactive Firestore bindings
 */

import { SchemaValidationError } from "@/schemas/_utils"
import {
  membershipPreferencesHydrationSchema,
  userHydrationSchema,
  userPreferencesHydrationSchema,
} from "@/schemas/domain"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type {
  IMembershipPreferences,
  IUser,
  IUserPreferences,
  IUserProfile,
} from "@/types/domain"
import {
  getMembershipPreferencesRef,
  getUserPreferencesRef,
  getUserRef,
  updateUserInMemberships,
  uploadUserPhoto,
} from "@/utils/firebase/firebase-helpers"
import {
  clearHydrationCache,
  readHydrationCache,
  useLocalHydration,
  writeHydrationCache,
} from "@/utils/firebase/firebase-hydration"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/firebase/firebase-optimistic"
import {
  buildUpdatedAtBaseVersion,
  mutateSetDocument,
  mutateUpdateDocument,
  mutateWithCoordinator,
} from "@/utils/firebase/firebase-sync-engine"
import type { User } from "firebase/auth"
import { Timestamp } from "firebase/firestore"
import { defineStore } from "pinia"
import { toast } from "vue-sonner"
import { updateCurrentUserProfile, useCurrentUser, useDocument } from "vuefire"

const defaultUserPreferences = (): IUserPreferences => ({
  currentTeamId: null,
  onboarding: false,
})

const defaultMembershipPreferences = (): IMembershipPreferences => ({
  currentWorkspaceId: null,
})

const getMembershipPreferencesCacheKey = (teamId: string) =>
  `membershipPreferences:${teamId}`

export const useAuthStore = defineStore("auth", () => {
  const currentUser = useCurrentUser() as Ref<User | null>

  const userDocRef = computed(() =>
    currentUser.value ? getUserRef(currentUser.value.uid) : null
  )
  const userPreferencesDocRef = computed(() =>
    currentUser.value ? getUserPreferencesRef(currentUser.value.uid) : null
  )

  const _vuefireUserDoc = useDocument<IUser>(userDocRef)
  const firestoreUserProfile: ComputedRef<IUser | null | undefined> = computed(
    () => _vuefireUserDoc.data.value
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => _vuefireUserDoc.pending.value
  )

  const _vuefireUserPreferencesDoc = useDocument<IUserPreferences>(
    userPreferencesDocRef
  )
  const firestoreUserPreferences: ComputedRef<
    IUserPreferences | null | undefined
  > = computed(() => _vuefireUserPreferencesDoc.data.value)
  const isUserPreferencesLoading: ComputedRef<boolean> = computed(
    () => _vuefireUserPreferencesDoc.pending.value
  )

  const optimisticUserProfile = ref<IUser | null>(null)
  const optimisticUserPreferences = ref<IUserPreferences | null>(null)
  const optimisticMembershipPreferences = ref<IMembershipPreferences | null>(
    null
  )
  const resolvedMembershipPreferencesTeamId = ref<string | null>(null)

  const pendingUserIds = shallowRef(createPendingSet())

  const userProfile = computed({
    get: () => {
      if (
        currentUser.value &&
        pendingUserIds.value.has(currentUser.value.uid)
      ) {
        return optimisticUserProfile.value
      }
      return firestoreUserProfile.value ?? optimisticUserProfile.value
    },
    set: (value) => {
      optimisticUserProfile.value = value
    },
  })

  const userPreferences = computed({
    get: () => {
      if (
        currentUser.value &&
        pendingUserIds.value.has(currentUser.value.uid)
      ) {
        return (
          optimisticUserPreferences.value ??
          firestoreUserPreferences.value ??
          defaultUserPreferences()
        )
      }
      return (
        firestoreUserPreferences.value ??
        optimisticUserPreferences.value ??
        defaultUserPreferences()
      )
    },
    set: (value) => {
      optimisticUserPreferences.value = value
    },
  })

  const currentTeamId = computed(
    () => userPreferences.value?.currentTeamId ?? null
  )

  const membershipPreferencesDocRef = computed(() => {
    if (!currentUser.value?.uid || !currentTeamId.value) return null
    return getMembershipPreferencesRef(
      currentTeamId.value,
      currentUser.value.uid
    )
  })

  const _vuefireMembershipPreferencesDoc = useDocument<IMembershipPreferences>(
    membershipPreferencesDocRef,
    {
      reset: true,
    }
  )
  const firestoreMembershipPreferences: ComputedRef<
    IMembershipPreferences | null | undefined
  > = computed(() => _vuefireMembershipPreferencesDoc.data.value)
  const isMembershipPreferencesLoading: ComputedRef<boolean> = computed(
    () => _vuefireMembershipPreferencesDoc.pending.value
  )

  const membershipPreferences = computed({
    get: () => {
      return (
        optimisticMembershipPreferences.value ??
        firestoreMembershipPreferences.value ??
        defaultMembershipPreferences()
      )
    },
    set: (value) => {
      optimisticMembershipPreferences.value = value
    },
  })

  const hydrateMembershipPreferencesForTeam = (teamId: string | null) => {
    if (!teamId) {
      optimisticMembershipPreferences.value = null
      resolvedMembershipPreferencesTeamId.value = null
      return
    }

    // Membership preferences are team-scoped; hydrate the active team's
    // cached selection synchronously so team switches do not flash the app
    // shell spinner while VueFire rebinds the new document.
    const cacheKey = getMembershipPreferencesCacheKey(teamId)
    const cached = readHydrationCache<IMembershipPreferences>(cacheKey, {
      schema: membershipPreferencesHydrationSchema,
      context: `hydration:${cacheKey}`,
    })

    optimisticMembershipPreferences.value =
      cached ?? defaultMembershipPreferences()
    resolvedMembershipPreferencesTeamId.value = cached ? teamId : null
  }

  const persistMembershipPreferencesForTeam = (
    teamId: string | null,
    value: IMembershipPreferences | null
  ) => {
    if (!teamId) return

    writeHydrationCache(
      getMembershipPreferencesCacheKey(teamId),
      value ?? defaultMembershipPreferences()
    )
  }

  // Hydrate from localStorage for instant cold-start rendering. The hydration
  // schemas validate the cached entry and rehydrate Timestamp fields (which
  // JSON.stringify strips to plain { seconds, nanoseconds } objects).
  useLocalHydration(
    "userProfile",
    optimisticUserProfile,
    () => userProfile.value,
    { schema: userHydrationSchema }
  )
  useLocalHydration(
    "userPreferences",
    optimisticUserPreferences,
    () => userPreferences.value,
    { schema: userPreferencesHydrationSchema }
  )

  const currentWorkspaceId = computed(
    () => membershipPreferences.value?.currentWorkspaceId ?? null
  )
  const onboarding = computed(() => userPreferences.value?.onboarding ?? false)
  const hasResolvedCurrentWorkspaceSelection = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return true
    return resolvedMembershipPreferencesTeamId.value === teamId
  })

  const isLoading = computed(
    () =>
      (isFirestoreLoading.value || isUserPreferencesLoading.value) &&
      !optimisticUserProfile.value
  )

  const isUserPending = computed(
    () => (id: string) => pendingUserIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(() => pendingUserIds.value.size > 0)
  const isAuthenticated = computed(() => !!currentUser.value)

  watch(
    [currentUser, firestoreUserProfile, isFirestoreLoading],
    async ([user, profile, loading]) => {
      if (!user || loading) return

      if (!profile) {
        try {
          const userRef = getUserRef(user.uid)
          const now = Timestamp.now()
          const optimisticUser: IUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            username: null,
            isPublic: false,
            createdAt: now,
            updatedAt: now,
          }
          // Set optimistic state immediately (before async write)
          optimisticUserProfile.value = optimisticUser
          // The server stamps `createdAt`/`updatedAt` itself
          // (functions/src/sync.ts withServerManagedFields) and the write
          // validator rejects them in the client payload.
          const {
            createdAt: _c,
            updatedAt: _u,
            ...serverPayload
          } = optimisticUser
          // Route through sync engine so the write survives offline
          await mutateSetDocument(
            userRef,
            serverPayload as unknown as Record<string, unknown>,
            { source: "auth.createUserProfile" }
          )
        } catch (error) {
          if (error instanceof SchemaValidationError) {
            // The sync engine's write validator blocked an invalid payload.
            // This is a client-side programming error, not a server failure —
            // log the exact zod issues so the root cause is visible in dev.
            console.error(
              "[authStore] createUserProfile blocked by schema validator:",
              error.zodError.issues
            )
            toast.error(
              "Unable to create your profile. Please refresh and try again."
            )
          } else {
            console.error("[authStore] Failed to create user profile:", error)
            toast.error("Failed to create user profile. Please try again.")
          }
        }
      }
    },
    { immediate: true }
  )

  watch(
    firestoreUserProfile,
    (profile) => {
      if (
        profile &&
        currentUser.value &&
        !pendingUserIds.value.has(currentUser.value.uid)
      ) {
        optimisticUserProfile.value = profile
      }
    },
    { immediate: true }
  )

  watch(
    firestoreUserPreferences,
    (preferences) => {
      if (
        preferences &&
        currentUser.value &&
        !pendingUserIds.value.has(currentUser.value.uid)
      ) {
        optimisticUserPreferences.value = preferences
      }
    },
    { immediate: true }
  )

  watch(
    [
      currentTeamId,
      firestoreMembershipPreferences,
      isMembershipPreferencesLoading,
    ],
    ([teamId, preferences, loading]) => {
      if (!currentUser.value || !teamId || loading) {
        return
      }

      const nextPreferences = preferences ?? defaultMembershipPreferences()
      optimisticMembershipPreferences.value = nextPreferences
      resolvedMembershipPreferencesTeamId.value = teamId
      persistMembershipPreferencesForTeam(teamId, nextPreferences)
    },
    { immediate: true }
  )

  watch(
    currentTeamId,
    (teamId, previousTeamId) => {
      if (teamId === previousTeamId && previousTeamId !== undefined) return
      hydrateMembershipPreferencesForTeam(teamId)
    },
    { immediate: true }
  )

  function cleanup() {
    optimisticUserProfile.value = null
    optimisticUserPreferences.value = null
    optimisticMembershipPreferences.value = null
    resolvedMembershipPreferencesTeamId.value = null
    clearHydrationCache()
  }

  watch(currentUser, (user) => {
    if (!user) {
      cleanup()
    }
  })

  let currentTeamMutationChain: Promise<void> = Promise.resolve()

  const getUserUpdatedAtBaseVersion = (fallbackUpdatedAt: unknown) =>
    buildUpdatedAtBaseVersion(
      firestoreUserProfile.value?.updatedAt ?? fallbackUpdatedAt
    )

  const getUserPreferencesUpdatedAtBaseVersion = (fallbackUpdatedAt: unknown) =>
    buildUpdatedAtBaseVersion(
      firestoreUserPreferences.value?.updatedAt ?? fallbackUpdatedAt
    )

  function setCurrentTeamIdLocal(teamId: string | null): void {
    if (!currentUser.value) return

    optimisticUserPreferences.value = {
      ...(userPreferences.value ?? defaultUserPreferences()),
      currentTeamId: teamId,
    }
    hydrateMembershipPreferencesForTeam(teamId)
  }

  async function setCurrentTeamId(teamId: string | null): Promise<void> {
    currentTeamMutationChain = currentTeamMutationChain
      .catch(() => undefined)
      .then(async () => {
        if (!currentUser.value) return
        if (currentTeamId.value === teamId) return

        const previousUserPreferences = cloneState(userPreferences.value)

        await mutateWithCoordinator({
          id: currentUser.value.uid,
          source: "auth.setCurrentTeamId",
          pendingIds: pendingUserIds,
          applyLocal: () => {
            setCurrentTeamIdLocal(teamId)
          },
          rollbackLocal: () => {
            optimisticUserPreferences.value = previousUserPreferences
          },
          mutation: {
            source: "auth.setCurrentTeamId",
            targetPath: getUserPreferencesRef(currentUser.value.uid).path,
            type: "set",
            merge: true,
            data: {
              currentTeamId: teamId,
            },
            baseVersion: getUserPreferencesUpdatedAtBaseVersion(
              previousUserPreferences?.updatedAt
            ),
          },
        })
      })

    return currentTeamMutationChain
  }

  function setCurrentWorkspaceId(workspaceId: string | null): void {
    if (!currentUser.value) return

    optimisticMembershipPreferences.value = {
      ...(membershipPreferences.value ?? defaultMembershipPreferences()),
      currentWorkspaceId: workspaceId,
    }
    resolvedMembershipPreferencesTeamId.value = currentTeamId.value
    persistMembershipPreferencesForTeam(
      currentTeamId.value,
      optimisticMembershipPreferences.value
    )
  }

  async function updateUserProfile(
    updates: Partial<IUserProfile>
  ): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    const userId = currentUser.value.uid
    const { photoURL, ...userUpdates } = updates
    const userRef = getUserRef(userId)
    const normalizedPhotoURL =
      photoURL === "" || photoURL === null ? null : photoURL
    const previousUserProfile = cloneState(userProfile.value)

    const firestoreUpdates = {
      ...userUpdates,
      ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
    }

    await withOptimisticUpdate(
      pendingUserIds,
      userId,
      () => {
        optimisticUserProfile.value = {
          ...userProfile.value!,
          ...userUpdates,
          ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
        }
      },
      () => {
        optimisticUserProfile.value = previousUserProfile
      },
      async () => {
        const promises: Promise<unknown>[] = []

        if (photoURL !== undefined || userUpdates.displayName !== undefined) {
          const authPhotoURL =
            photoURL === "" || photoURL === null
              ? ""
              : (photoURL ?? currentUser.value!.photoURL ?? undefined)

          promises.push(
            updateCurrentUserProfile({
              displayName:
                userUpdates.displayName ||
                currentUser.value!.displayName ||
                undefined,
              photoURL: authPhotoURL,
            })
          )
        }

        if (Object.keys(userUpdates).length > 0 || photoURL !== undefined) {
          promises.push(
            mutateUpdateDocument(userRef, firestoreUpdates, {
              source: "auth.updateUserProfile",
              baseVersion: getUserUpdatedAtBaseVersion(
                previousUserProfile?.updatedAt
              ),
            })
          )
        }

        const membershipUpdates = {
          ...userUpdates,
          ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
        }
        if (Object.keys(membershipUpdates).length > 0) {
          promises.push(updateUserInMemberships(userId, membershipUpdates))
        }

        await Promise.all(promises)
      }
    )
  }

  async function uploadProfilePhoto(file: File): Promise<string> {
    if (!currentUser.value) throw new Error("Not authenticated")
    return uploadUserPhoto(currentUser.value.uid, file)
  }

  async function deleteAccount(): Promise<void> {
    if (!currentUser.value) return

    const membershipStore = useMembershipStore()
    const teamStore = useTeamStore()

    try {
      const allMemberships = await membershipStore.fetchUserMemberships()

      for (const membership of allMemberships) {
        if (membership.role === "owner") {
          const teamMembers = await membershipStore.getMembersForTeam(
            membership.teamId
          )
          const owners = teamMembers.filter((m) => m.role === "owner")

          if (
            owners.length === 1 &&
            owners[0]?.userId === currentUser.value.uid
          ) {
            await teamStore.deleteTeam(membership.teamId)
          } else {
            await membershipStore.removeMember(
              membership.teamId,
              currentUser.value.uid
            )
          }
        } else {
          await membershipStore.removeMember(
            membership.teamId,
            currentUser.value.uid
          )
        }
      }

      await currentUser.value.delete()
      cleanup()
    } catch (error) {
      console.error("[authStore] Error deleting account:", error)
      throw error
    }
  }

  return {
    currentUser,
    userProfile,
    userPreferences,
    onboarding,
    isLoading,

    pendingUserIds,

    isUserPending,
    hasAnyPendingOperation,
    isAuthenticated,
    isMembershipPreferencesLoading,
    hasResolvedCurrentWorkspaceSelection,
    currentTeamId,
    currentWorkspaceId,

    setCurrentTeamIdLocal,
    setCurrentTeamId,
    setCurrentWorkspaceId,
    updateUserProfile,
    uploadProfilePhoto,
    deleteAccount,

    cleanup,
  }
})

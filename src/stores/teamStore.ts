import { auth, firestore, storage } from "@/modules/firebase"
import type { IMembership, ITeam, IUser } from "@/types"
import { onAuthStateChanged, type User } from "firebase/auth"
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  type FieldValue,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
  updateDoc,
  where,
  type WriteBatch,
  writeBatch,
} from "firebase/firestore"
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage"
import { defineStore } from "pinia"
import { ref, watch } from "vue"
import { updateCurrentUserProfile } from "vuefire"

// Constants
const BATCH_SIZE = 450

// Helper to process Firestore batch operations in chunks
async function processInBatches<T>(
  items: T[],
  processFn: (item: T, batch: WriteBatch) => void
) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(firestore)
    chunk.forEach((item) => processFn(item, batch))
    await batch.commit()
  }
}

// Helper to get document references
const getMembershipRef = (teamId: string, userId: string) =>
  doc(firestore, "teams", teamId, "memberships", userId)

const getTeamRef = (teamId: string) => doc(firestore, "teams", teamId)

const getUserRef = (userId: string) => doc(firestore, "users", userId)

// Helper to check ownership count
const getOwnerCount = (members: IMembership[]) =>
  members.filter((m) => m.role === "owner").length

// Helper to validate member can be removed
function validateMemberRemoval(
  membershipData: IMembership,
  teamMembers: IMembership[]
) {
  if (teamMembers.length <= 1) {
    throw new Error(
      "Cannot remove the last member. Every team must have at least one member."
    )
  }
  if (membershipData.role === "owner" && getOwnerCount(teamMembers) <= 1) {
    throw new Error(
      "Cannot remove the last owner. Please assign another owner first."
    )
  }
}

// Helper to upload team photo
async function uploadTeamPhoto(teamId: string, file: File): Promise<string> {
  const fileRef = storageRef(storage, `teams/${teamId}/profilePhoto`)
  await uploadBytes(fileRef, file)
  return await getDownloadURL(fileRef)
}

// Helper to update all memberships with new data
async function updateMemberships(
  queryRef: ReturnType<typeof query>,
  updateFn: (membershipData: IMembership) => Record<string, unknown>
) {
  const membershipDocs = await getDocs(queryRef)
  await processInBatches(membershipDocs.docs, (docSnap, batch) => {
    const membershipData = docSnap.data() as IMembership
    batch.update(docSnap.ref, {
      ...updateFn(membershipData),
      updatedAt: serverTimestamp(),
    })
  })
}

export const useTeamStore = defineStore("teams", () => {
  // State
  const currentUser = ref<User | null>(null)
  const userProfile = ref<IUser | null>(null)
  const currentTeam = ref<ITeam | null>(null)
  const memberships = ref<IMembership[]>([])
  const teamMembers = ref<IMembership[]>([])
  const isLoading = ref(true)

  // Subscription cleanup functions
  let userUnsubscribe: (() => void) | null = null
  let membershipsUnsubscribe: (() => void) | null = null
  let teamMembersUnsubscribe: (() => void) | null = null

  // Cleanup helper
  function cleanup() {
    userProfile.value = null
    currentTeam.value = null
    memberships.value = []
    teamMembers.value = []
  }

  // Initialize Auth Listener
  onAuthStateChanged(auth, (user) => {
    currentUser.value = user
    if (!user) {
      cleanup()
      isLoading.value = false
    }
  })

  // Watch for currentUser changes to fetch user profile
  watch(
    currentUser,
    async (user) => {
      if (userUnsubscribe) {
        userUnsubscribe()
        userUnsubscribe = null
      }

      if (!user) return

      isLoading.value = true
      const userRef = getUserRef(user.uid)

      userUnsubscribe = onSnapshot(userRef, async (userSnap) => {
        if (userSnap.exists()) {
          userProfile.value = userSnap.data() as IUser
          // Only stop loading here if user has no team
          // Otherwise, the team watcher will handle stopping the loading state
          if (!userProfile.value.currentTeamId) {
            isLoading.value = false
          }
        } else {
          const newUser: IUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            currentTeamId: null,
            createdAt: serverTimestamp() as Timestamp,
            updatedAt: serverTimestamp() as Timestamp,
          }
          await setDoc(userRef, newUser)
          userProfile.value = newUser
          isLoading.value = false
        }
      })
    },
    { immediate: true }
  )

  // Watch for userProfile changes to fetch memberships
  watch(
    () => userProfile.value?.uid,
    (uid) => {
      if (membershipsUnsubscribe) {
        membershipsUnsubscribe()
        membershipsUnsubscribe = null
      }

      if (!uid) {
        memberships.value = []
        return
      }

      const membershipsQuery = query(
        collectionGroup(firestore, "memberships"),
        where("userId", "==", uid)
      )

      membershipsUnsubscribe = onSnapshot(membershipsQuery, (snapshot) => {
        memberships.value = snapshot.docs.map(
          (doc) => doc.data() as IMembership
        )
      })
    }
  )

  // Watch for currentTeamId changes to fetch current team data
  watch(
    () => userProfile.value?.currentTeamId,
    async (teamId) => {
      // If no team ID, clear and stop loading
      if (!teamId) {
        currentTeam.value = null
        isLoading.value = false
        return
      }

      // Try to get team from cached memberships first (optimistic)
      const cachedMembership = memberships.value.find(
        (m) => m.teamId === teamId
      )
      if (cachedMembership?.team) {
        currentTeam.value = cachedMembership.team
        isLoading.value = false
      }

      // Fetch fresh team data
      const teamSnap = await getDoc(getTeamRef(teamId))
      if (teamSnap.exists()) {
        currentTeam.value = teamSnap.data() as ITeam
      } else if (!cachedMembership?.team) {
        // Only clear if we didn't have cached data
        currentTeam.value = null
      }
      isLoading.value = false
    }
  )

  // Watch currentTeam to fetch its members
  watch(
    () => currentTeam.value?.id,
    (teamId) => {
      if (teamMembersUnsubscribe) {
        teamMembersUnsubscribe()
        teamMembersUnsubscribe = null
      }

      if (!teamId) {
        teamMembers.value = []
        return
      }

      const membersRef = collection(firestore, "teams", teamId, "memberships")
      teamMembersUnsubscribe = onSnapshot(membersRef, (snapshot) => {
        teamMembers.value = snapshot.docs.map(
          (doc) => doc.data() as IMembership
        )
      })
    }
  )

  // Actions
  async function createTeam(name: string, photoFile?: File) {
    if (!currentUser.value || !userProfile.value) return

    const teamRef = doc(collection(firestore, "teams"))
    const teamId = teamRef.id
    const timestamp = serverTimestamp()

    let photoURL: string | null = null
    if (photoFile) {
      try {
        photoURL = await uploadTeamPhoto(teamId, photoFile)
      } catch (error) {
        console.error("Error uploading team photo:", error)
      }
    }

    const newTeam: ITeam = {
      id: teamId,
      name,
      photoURL,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    const newMembership: IMembership = {
      id: currentUser.value.uid,
      userId: currentUser.value.uid,
      teamId,
      role: "owner",
      user: userProfile.value,
      team: newTeam,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    await runTransaction(firestore, async (transaction) => {
      transaction.set(teamRef, newTeam)
      transaction.set(
        getMembershipRef(teamId, currentUser.value!.uid),
        newMembership
      )
      transaction.update(getUserRef(currentUser.value!.uid), {
        currentTeamId: teamId,
        updatedAt: serverTimestamp(),
      })
    })

    // Optimistic update
    userProfile.value = { ...userProfile.value, currentTeamId: teamId } as IUser
    currentTeam.value = newTeam
  }

  async function switchTeam(teamId: string) {
    if (!currentUser.value) return

    // Optimistic update: immediately set team from cached membership
    const cachedMembership = memberships.value.find((m) => m.teamId === teamId)
    if (cachedMembership?.team) {
      currentTeam.value = cachedMembership.team
    }

    // Optimistic update for userProfile
    if (userProfile.value) {
      userProfile.value.currentTeamId = teamId
    }

    // Persist to Firestore (non-blocking for UI)
    await updateDoc(getUserRef(currentUser.value.uid), {
      currentTeamId: teamId,
      updatedAt: serverTimestamp(),
    })
  }

  async function inviteMember(
    email: string,
    role: IMembership["role"] = "member"
  ) {
    if (!currentUser.value || !currentTeam.value) return

    // Find user by email
    const usersQuery = query(
      collection(firestore, "users"),
      where("email", "==", email)
    )
    const querySnapshot = await getDocs(usersQuery)

    if (querySnapshot.empty) {
      throw new Error("User not found")
    }

    const userDoc = querySnapshot.docs[0]!
    const userData = userDoc.data() as IUser
    const userId = userDoc.id

    // Check if already a member
    const membershipRef = getMembershipRef(currentTeam.value.id, userId)
    const membershipSnap = await getDoc(membershipRef)

    if (membershipSnap.exists()) {
      throw new Error("User is already a member")
    }

    // Create membership
    const timestamp = serverTimestamp()
    const newMembership: IMembership = {
      id: userId,
      userId,
      teamId: currentTeam.value.id,
      role,
      user: userData,
      team: currentTeam.value,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    await setDoc(membershipRef, newMembership)
  }

  async function changeRole(userId: string, newRole: IMembership["role"]) {
    if (!currentTeam.value) return

    const membershipRef = getMembershipRef(currentTeam.value.id, userId)
    const membershipSnap = await getDoc(membershipRef)

    if (!membershipSnap.exists()) {
      throw new Error("Membership not found")
    }

    const currentMembership = membershipSnap.data() as IMembership

    // Prevent changing role if this is the last owner
    if (currentMembership.role === "owner" && newRole !== "owner") {
      if (getOwnerCount(teamMembers.value) <= 1) {
        throw new Error("Cannot change role: Team must have at least one owner")
      }
    }

    await updateDoc(membershipRef, {
      role: newRole,
      updatedAt: serverTimestamp(),
    })
  }

  async function removeMember(userId: string) {
    if (!currentTeam.value) return

    const membershipRef = getMembershipRef(currentTeam.value.id, userId)
    const membershipSnap = await getDoc(membershipRef)

    if (!membershipSnap.exists()) {
      throw new Error("Membership not found")
    }

    const membershipData = membershipSnap.data() as IMembership
    validateMemberRemoval(membershipData, teamMembers.value)

    // If removing current user, also update their currentTeamId
    if (userId === currentUser.value?.uid) {
      await updateDoc(getUserRef(userId), {
        currentTeamId: null,
        updatedAt: serverTimestamp(),
      })
    }

    await runTransaction(firestore, async (transaction) => {
      transaction.delete(membershipRef)
    })
  }

  async function updateTeam(
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ) {
    if (!currentUser.value) return

    const { name, photoFile } = updates
    const updateData: {
      name?: string
      photoURL?: string | null
      updatedAt: FieldValue
    } = {
      updatedAt: serverTimestamp(),
    }

    if (name) updateData.name = name

    if (photoFile !== undefined) {
      updateData.photoURL =
        photoFile === null ? null : await uploadTeamPhoto(teamId, photoFile)
    }

    await updateDoc(getTeamRef(teamId), updateData)

    // Update all memberships for this team
    const membershipsQuery = query(
      collectionGroup(firestore, "memberships"),
      where("teamId", "==", teamId)
    )

    await updateMemberships(membershipsQuery, (membershipData) => {
      const updatedTeam: Record<string, unknown> = {
        ...membershipData.team,
        ...updateData,
      }
      Object.keys(updatedTeam).forEach(
        (key) => updatedTeam[key] === undefined && delete updatedTeam[key]
      )
      return { team: updatedTeam }
    })

    // Optimistic updates
    if (currentTeam.value?.id === teamId) {
      if (name) currentTeam.value.name = name
      if (updateData.photoURL !== undefined)
        currentTeam.value.photoURL = updateData.photoURL
    }

    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (membership?.team) {
      if (name) membership.team.name = name
      if (updateData.photoURL !== undefined)
        membership.team.photoURL = updateData.photoURL
    }
  }

  async function deleteTeam(teamId: string) {
    if (!currentUser.value) return

    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || membership.role !== "owner") {
      throw new Error("Only team owners can delete the team")
    }

    // Find all memberships and users to update
    const membershipsQuery = query(
      collectionGroup(firestore, "memberships"),
      where("teamId", "==", teamId)
    )
    const usersQuery = query(
      collection(firestore, "users"),
      where("currentTeamId", "==", teamId)
    )

    const [membershipDocs, userDocs] = await Promise.all([
      getDocs(membershipsQuery),
      getDocs(usersQuery),
    ])

    // Delete team document
    await deleteDoc(getTeamRef(teamId))

    // Delete all memberships and update users in batches
    await Promise.all([
      processInBatches(membershipDocs.docs, (docSnap, batch) =>
        batch.delete(docSnap.ref)
      ),
      processInBatches(userDocs.docs, (docSnap, batch) =>
        batch.update(docSnap.ref, {
          currentTeamId: null,
          updatedAt: serverTimestamp(),
        })
      ),
    ])

    // Optimistic updates
    memberships.value = memberships.value.filter((m) => m.teamId !== teamId)
    if (currentTeam.value?.id === teamId) {
      currentTeam.value = null
      if (userProfile.value) {
        userProfile.value.currentTeamId = null
      }
    }
  }

  async function updateUserProfile(updates: Partial<IUser>) {
    if (!currentUser.value) return

    const { photoURL, ...userUpdates } = updates
    const userRef = getUserRef(currentUser.value.uid)

    // Normalize photoURL - convert empty string or null to null for Firestore
    const normalizedPhotoURL =
      photoURL === "" || photoURL === null ? null : photoURL

    // Update Auth Profile if needed
    if (photoURL !== undefined || userUpdates.displayName !== undefined) {
      // Firebase Auth requires empty string "" to clear photoURL, not null
      const authPhotoURL =
        photoURL === "" || photoURL === null
          ? ""
          : (photoURL ?? currentUser.value.photoURL ?? undefined)

      await updateCurrentUserProfile({
        displayName:
          userUpdates.displayName || currentUser.value.displayName || undefined,
        photoURL: authPhotoURL,
      })
    }

    // Update User Document
    if (Object.keys(userUpdates).length > 0 || photoURL !== undefined) {
      await updateDoc(userRef, {
        ...userUpdates,
        ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
        updatedAt: serverTimestamp(),
      })
    }

    // Update all memberships with new user data
    const membershipsQuery = query(
      collectionGroup(firestore, "memberships"),
      where("userId", "==", currentUser.value.uid)
    )

    await updateMemberships(membershipsQuery, (membershipData) => ({
      user: {
        ...membershipData.user,
        ...userUpdates,
        ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
      },
    }))

    // Optimistic update
    if (userProfile.value) {
      userProfile.value = {
        ...userProfile.value,
        ...userUpdates,
        ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
      }
    }
  }

  return {
    // State
    currentUser,
    userProfile,
    currentTeam,
    memberships,
    teamMembers,
    isLoading,
    // Actions
    createTeam,
    switchTeam,
    inviteMember,
    changeRole,
    removeMember,
    deleteTeam,
    updateTeam,
    updateUserProfile,
  }
})

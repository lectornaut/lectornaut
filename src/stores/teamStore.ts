import { auth, firestore, storage } from "@/modules/firebase"
import type { IMembership, ITeam, IUser } from "@/types"
import { onAuthStateChanged, type User } from "firebase/auth"
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  FieldValue,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  WriteBatch,
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

// Helper to process Firestore batch operations in chunks
async function processInBatches<T>(
  items: T[],
  processFn: (item: T, batch: WriteBatch) => void
) {
  const BATCH_SIZE = 450
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(firestore)
    chunk.forEach((item) => processFn(item, batch))
    await batch.commit()
  }
}

export const useTeamStore = defineStore("teams", () => {
  const currentUser = ref<User | null>(null)
  const userProfile = ref<IUser | null>(null)
  const currentTeam = ref<ITeam | null>(null)
  const memberships = ref<IMembership[]>([])
  const teamMembers = ref<IMembership[]>([])
  const isLoading = ref(true)

  // Initialize Auth Listener
  onAuthStateChanged(auth, (user) => {
    currentUser.value = user
    if (!user) {
      userProfile.value = null
      currentTeam.value = null
      memberships.value = []
      isLoading.value = false
    }
  })

  // Watch for currentUser changes to fetch user profile
  let userUnsubscribe: (() => void) | null = null
  let membershipsUnsubscribe: (() => void) | null = null
  let teamMembersUnsubscribe: (() => void) | null = null

  watch(
    currentUser,
    async (user) => {
      // Unsubscribe from previous user listener if exists
      if (userUnsubscribe) {
        userUnsubscribe()
        userUnsubscribe = null
      }

      if (user) {
        isLoading.value = true
        const userRef = doc(firestore, "users", user.uid)

        // Use onSnapshot for real-time updates
        userUnsubscribe = onSnapshot(userRef, async (userSnap) => {
          if (userSnap.exists()) {
            userProfile.value = userSnap.data() as IUser
          } else {
            // Create user profile if not exists
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
          }
          isLoading.value = false
        })
      }
    },
    { immediate: true }
  )

  // Watch for userProfile changes to fetch memberships and current team
  watch(
    () => userProfile.value?.uid,
    async (uid) => {
      // Unsubscribe from previous memberships listener
      if (membershipsUnsubscribe) {
        membershipsUnsubscribe()
        membershipsUnsubscribe = null
      }

      if (uid) {
        // Fetch all memberships for this user
        const membershipsQuery = query(
          collectionGroup(firestore, "memberships"),
          where("userId", "==", uid)
        )

        membershipsUnsubscribe = onSnapshot(membershipsQuery, (snapshot) => {
          memberships.value = snapshot.docs.map(
            (doc) => doc.data() as IMembership
          )
        })
      } else {
        memberships.value = []
      }
    }
  )

  // Watch for currentTeamId changes to fetch current team data
  watch(
    () => userProfile.value?.currentTeamId,
    async (teamId) => {
      if (teamId) {
        const teamRef = doc(firestore, "teams", teamId)
        const teamSnap = await getDoc(teamRef)
        if (teamSnap.exists()) {
          currentTeam.value = teamSnap.data() as ITeam
        }
      } else {
        currentTeam.value = null
      }
    }
  )

  // Watch currentTeam to fetch its members
  watch(
    () => currentTeam.value?.id,
    async (teamId) => {
      // Unsubscribe from previous team members listener
      if (teamMembersUnsubscribe) {
        teamMembersUnsubscribe()
        teamMembersUnsubscribe = null
      }

      if (teamId) {
        const membersRef = collection(firestore, "teams", teamId, "memberships")
        teamMembersUnsubscribe = onSnapshot(membersRef, (snapshot) => {
          teamMembers.value = snapshot.docs.map(
            (doc) => doc.data() as IMembership
          )
        })
      } else {
        teamMembers.value = []
      }
    }
  )

  const uploadTeamPhoto = async (teamId: string, file: File) => {
    const fileRef = storageRef(storage, `teams/${teamId}/profilePhoto`)
    await uploadBytes(fileRef, file)
    return await getDownloadURL(fileRef)
  }

  const createTeam = async (name: string, photoFile?: File) => {
    if (!currentUser.value || !userProfile.value) return

    const teamRef = doc(collection(firestore, "teams"))
    const teamId = teamRef.id
    const timestamp = serverTimestamp()

    let photoURL = null
    if (photoFile) {
      try {
        photoURL = await uploadTeamPhoto(teamId, photoFile)
      } catch (error) {
        console.error("Error uploading team photo:", error)
        // Continue creating team even if photo upload fails
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
      teamId: teamId,
      role: "owner",
      user: userProfile.value,
      team: newTeam,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        // Create Team
        transaction.set(teamRef, newTeam)

        // Create Membership
        const membershipRef = doc(
          firestore,
          "teams",
          teamId,
          "memberships",
          currentUser.value!.uid
        )
        transaction.set(membershipRef, newMembership)

        // Update User's current team
        const userRef = doc(firestore, "users", currentUser.value!.uid)
        transaction.update(userRef, {
          currentTeamId: teamId,
          updatedAt: serverTimestamp(),
        })
      })

      // Optimistic update
      userProfile.value = {
        ...userProfile.value,
        currentTeamId: teamId,
      } as IUser
      currentTeam.value = newTeam
    } catch (error) {
      console.error("Error creating team:", error)
      throw error
    }
  }

  const switchTeam = async (teamId: string) => {
    if (!currentUser.value) return

    try {
      const userRef = doc(firestore, "users", currentUser.value.uid)
      await updateDoc(userRef, {
        currentTeamId: teamId,
        updatedAt: serverTimestamp(),
      })

      // Optimistic update
      if (userProfile.value) {
        userProfile.value.currentTeamId = teamId
      }
    } catch (error) {
      console.error("Error switching team:", error)
      throw error
    }
  }

  const inviteMember = async (email: string, role: string = "member") => {
    if (!currentUser.value || !currentTeam.value) return

    try {
      // 1. Find user by email
      const usersRef = collection(firestore, "users")
      const q = query(usersRef, where("email", "==", email))
      const querySnapshot = await getDocs(q)

      if (querySnapshot.empty) {
        throw new Error("User not found")
      }

      const userDoc = querySnapshot.docs[0]
      if (!userDoc) {
        throw new Error("User document is undefined")
      }
      const userData = userDoc.data() as IUser
      const userId = userDoc.id

      // 2. Check if already a member
      const membershipRef = doc(
        firestore,
        "teams",
        currentTeam.value.id,
        "memberships",
        userId
      )
      const membershipSnap = await getDoc(membershipRef)

      if (membershipSnap.exists()) {
        throw new Error("User is already a member")
      }

      // 3. Create membership
      const timestamp = serverTimestamp()
      const newMembership: IMembership = {
        id: userId,
        userId: userId,
        teamId: currentTeam.value.id,
        role: role as IMembership["role"],
        user: userData,
        team: currentTeam.value,
        createdAt: timestamp as Timestamp,
        updatedAt: timestamp as Timestamp,
      }

      await setDoc(membershipRef, newMembership)
    } catch (error) {
      console.error("Error inviting member:", error)
      throw error
    }
  }

  const changeRole = async (userId: string, newRole: IMembership["role"]) => {
    if (!currentTeam.value) return

    try {
      const membershipRef = doc(
        firestore,
        "teams",
        currentTeam.value.id,
        "memberships",
        userId
      )
      const membershipSnap = await getDoc(membershipRef)

      if (!membershipSnap.exists()) {
        throw new Error("Membership not found")
      }

      const currentMembership = membershipSnap.data() as IMembership

      // Prevent changing role if this is the last owner
      if (currentMembership.role === "owner" && newRole !== "owner") {
        const ownerCount = teamMembers.value.filter(
          (m) => m.role === "owner"
        ).length
        if (ownerCount <= 1) {
          throw new Error(
            "Cannot change role: Team must have at least one owner"
          )
        }
      }

      await updateDoc(membershipRef, {
        role: newRole,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error("Error changing role:", error)
      throw error
    }
  }

  const removeMember = async (userId: string) => {
    if (!currentTeam.value) return

    try {
      const membershipRef = doc(
        firestore,
        "teams",
        currentTeam.value.id,
        "memberships",
        userId
      )
      const membershipSnap = await getDoc(membershipRef)

      if (!membershipSnap.exists()) {
        throw new Error("Membership not found")
      }

      const membershipToRemove = membershipSnap.data() as IMembership

      // Prevent removing the last member from the team
      if (teamMembers.value.length <= 1) {
        throw new Error(
          "Cannot remove the last member. Every team must have at least one member."
        )
      }

      // Prevent removing the last owner
      if (membershipToRemove.role === "owner") {
        const ownerCount = teamMembers.value.filter(
          (m) => m.role === "owner"
        ).length
        if (ownerCount <= 1) {
          throw new Error(
            "Cannot remove the last owner. Please assign another owner first."
          )
        }
      }

      // If removing current user, also update their currentTeamId
      if (userId === currentUser.value?.uid) {
        const userRef = doc(firestore, "users", userId)
        await updateDoc(userRef, {
          currentTeamId: null,
          updatedAt: serverTimestamp(),
        })
      }

      await runTransaction(firestore, async (transaction) => {
        transaction.delete(membershipRef)
      })
    } catch (error) {
      console.error("Error removing member:", error)
      throw error
    }
  }

  const updateTeam = async (
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ) => {
    if (!currentUser.value) return

    try {
      const teamRef = doc(firestore, "teams", teamId)
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
        if (photoFile === null) {
          updateData.photoURL = null
        } else {
          try {
            const photoURL = await uploadTeamPhoto(teamId, photoFile)
            updateData.photoURL = photoURL
          } catch (error) {
            console.error("Error uploading team photo:", error)
            throw error
          }
        }
      }

      await updateDoc(teamRef, updateData)

      // Update all memberships for this team to reflect the changes
      const membershipsQuery = query(
        collectionGroup(firestore, "memberships"),
        where("teamId", "==", teamId)
      )

      const membershipDocs = await getDocs(membershipsQuery)

      // Use chunked batch processing
      await processInBatches(membershipDocs.docs, (doc, batch) => {
        const membershipData = doc.data() as IMembership
        const updatedTeam: Record<string, unknown> = {
          ...membershipData.team,
          ...updateData,
        }
        // Remove undefined values
        Object.keys(updatedTeam).forEach(
          (key) => updatedTeam[key] === undefined && delete updatedTeam[key]
        )

        batch.update(doc.ref, {
          team: updatedTeam,
          updatedAt: serverTimestamp(),
        })
      })

      // Optimistic update if it's the current team
      if (currentTeam.value && currentTeam.value.id === teamId) {
        if (name) currentTeam.value.name = name
        if (updateData.photoURL !== undefined)
          currentTeam.value.photoURL = updateData.photoURL
      }

      // Optimistic update for memberships
      const membership = memberships.value.find((m) => m.teamId === teamId)
      if (membership && membership.team) {
        if (name) membership.team.name = name
        if (updateData.photoURL !== undefined)
          membership.team.photoURL = updateData.photoURL
      }
    } catch (error) {
      console.error("Error updating team:", error)
      throw error
    }
  }

  const deleteTeam = async (teamId: string) => {
    if (!currentUser.value) return

    try {
      // 1. Verify ownership (optional but good practice, though rules handle it)
      const membership = memberships.value.find((m) => m.teamId === teamId)
      if (!membership || membership.role !== "owner") {
        throw new Error("Only team owners can delete the team")
      }

      // 2. Find all memberships for this team to delete them
      const membershipsQuery = query(
        collectionGroup(firestore, "memberships"),
        where("teamId", "==", teamId)
      )
      const membershipDocs = await getDocs(membershipsQuery)

      // 3. Find all users who have this team as currentTeamId to update them
      const usersQuery = query(
        collection(firestore, "users"),
        where("currentTeamId", "==", teamId)
      )
      const userDocs = await getDocs(usersQuery)

      // Delete team document
      await deleteDoc(doc(firestore, "teams", teamId))

      // Delete all memberships in batches
      await processInBatches(membershipDocs.docs, (doc, batch) => {
        batch.delete(doc.ref)
      })

      // Update users in batches
      await processInBatches(userDocs.docs, (doc, batch) => {
        batch.update(doc.ref, {
          currentTeamId: null,
          updatedAt: serverTimestamp(),
        })
      })

      // Optimistic updates
      memberships.value = memberships.value.filter((m) => m.teamId !== teamId)
      if (currentTeam.value?.id === teamId) {
        currentTeam.value = null
        if (userProfile.value) {
          userProfile.value.currentTeamId = null
        }
      }
    } catch (error) {
      console.error("Error deleting team:", error)
      throw error
    }
  }

  const updateUserProfile = async (updates: Partial<IUser>) => {
    if (!currentUser.value) return

    const { photoURL, ...userUpdates } = updates
    const userRef = doc(firestore, "users", currentUser.value.uid)

    try {
      // 1. Update Auth Profile
      if (photoURL !== undefined || userUpdates.displayName !== undefined) {
        console.log("Updating auth profile", {
          photoURL,
          displayName: userUpdates.displayName,
        })
        try {
          await updateCurrentUserProfile({
            displayName:
              userUpdates.displayName ||
              currentUser.value.displayName ||
              undefined,
            photoURL:
              photoURL === "" || photoURL === null
                ? null
                : (photoURL ?? currentUser.value.photoURL ?? undefined),
          })
          console.log("Auth profile updated successfully")
        } catch (e) {
          console.error("Error updating auth profile", e)
          throw e
        }
      }

      // 2. Update User Document
      if (Object.keys(userUpdates).length > 0 || photoURL !== undefined) {
        await updateDoc(userRef, {
          ...userUpdates,
          ...(photoURL !== undefined
            ? { photoURL: photoURL === "" ? null : photoURL }
            : {}),
          updatedAt: serverTimestamp(),
        })
      }

      // 3. Update All Memberships
      // We need to find all memberships for this user and update the embedded user data
      const membershipsQuery = query(
        collectionGroup(firestore, "memberships"),
        where("userId", "==", currentUser.value.uid)
      )

      const membershipDocs = await getDocs(membershipsQuery)

      // Use chunked batch processing
      await processInBatches(membershipDocs.docs, (doc, batch) => {
        const membershipData = doc.data() as IMembership
        const updatedUser = {
          ...membershipData.user,
          ...userUpdates,
          ...(photoURL !== undefined
            ? { photoURL: photoURL === "" ? null : photoURL }
            : {}),
        }

        batch.update(doc.ref, {
          user: updatedUser,
          updatedAt: serverTimestamp(),
        })
      })

      // Optimistic update
      if (userProfile.value) {
        userProfile.value = {
          ...userProfile.value,
          ...userUpdates,
          ...(photoURL !== undefined
            ? { photoURL: photoURL === "" ? null : photoURL }
            : {}),
        }
      }
    } catch (error) {
      console.error("Error updating user profile:", error)
      throw error
    }
  }

  return {
    currentUser,
    userProfile,
    currentTeam,
    memberships,
    teamMembers,
    isLoading,
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

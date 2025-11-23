import { auth, firestore } from "@/modules/firebase"
import type { IMembership, ITeam, IUser } from "@/types"
import { onAuthStateChanged, updateProfile, type User } from "firebase/auth"
import {
  collection,
  collectionGroup,
  doc,
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
  writeBatch,
} from "firebase/firestore"
import { defineStore } from "pinia"
import { ref, watch } from "vue"

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
    userProfile,
    async (profile) => {
      if (profile) {
        // Fetch all memberships for this user
        const membershipsQuery = query(
          collectionGroup(firestore, "memberships"),
          where("userId", "==", profile.uid)
        )

        onSnapshot(membershipsQuery, (snapshot) => {
          memberships.value = snapshot.docs.map(
            (doc) => doc.data() as IMembership
          )
        })

        // Fetch current team if set
        if (profile.currentTeamId) {
          const teamRef = doc(firestore, "teams", profile.currentTeamId)
          const teamSnap = await getDoc(teamRef)
          if (teamSnap.exists()) {
            currentTeam.value = teamSnap.data() as ITeam
          }
        } else {
          currentTeam.value = null
        }
      }
    },
    { deep: true }
  )

  // Watch currentTeam to fetch its members
  watch(currentTeam, async (team) => {
    if (team) {
      const membersRef = collection(firestore, "teams", team.id, "memberships")
      onSnapshot(membersRef, (snapshot) => {
        teamMembers.value = snapshot.docs.map(
          (doc) => doc.data() as IMembership
        )
      })
    } else {
      teamMembers.value = []
    }
  })

  const createTeam = async (name: string) => {
    if (!currentUser.value || !userProfile.value) return

    const teamRef = doc(collection(firestore, "teams"))
    const teamId = teamRef.id
    const timestamp = serverTimestamp()

    const newTeam: ITeam = {
      id: teamId,
      name,
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

    const userRef = doc(firestore, "users", currentUser.value.uid)
    await updateDoc(userRef, {
      currentTeamId: teamId,
      updatedAt: serverTimestamp(),
    })

    // Optimistic update
    if (userProfile.value) {
      userProfile.value.currentTeamId = teamId
    }
  }

  const inviteMember = async (email: string, role: string = "member") => {
    if (!currentUser.value || !currentTeam.value) return

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
  }

  const changeRole = async (userId: string, newRole: IMembership["role"]) => {
    if (!currentTeam.value) return

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
        throw new Error("Cannot change role: Team must have at least one owner")
      }
    }

    await updateDoc(membershipRef, {
      role: newRole,
      updatedAt: serverTimestamp(),
    })
  }

  const removeMember = async (userId: string) => {
    if (!currentTeam.value) return

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
  }

  const updateTeamName = async (teamId: string, newName: string) => {
    if (!currentUser.value) return

    const teamRef = doc(firestore, "teams", teamId)

    // Verify ownership (optional but recommended, though rules should handle it)
    // For now, we'll trust the UI to only show this option to owners, and Firestore rules to enforce it.

    await updateDoc(teamRef, {
      name: newName,
      updatedAt: serverTimestamp(),
    })

    // Optimistic update if it's the current team
    if (currentTeam.value && currentTeam.value.id === teamId) {
      currentTeam.value.name = newName
    }

    // Optimistic update for memberships
    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (membership && membership.team) {
      membership.team.name = newName
    }
  }

  const updateUserProfile = async (updates: Partial<IUser>) => {
    if (!currentUser.value) return

    const { photoURL, ...userUpdates } = updates
    const userRef = doc(firestore, "users", currentUser.value.uid)

    // 1. Update Auth Profile
    if (photoURL !== undefined || userUpdates.displayName !== undefined) {
      console.log("Updating auth profile", {
        photoURL,
        displayName: userUpdates.displayName,
      })
      try {
        await updateProfile(currentUser.value, {
          displayName:
            userUpdates.displayName ||
            currentUser.value.displayName ||
            undefined,
          photoURL:
            photoURL === ""
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
    const batch = writeBatch(firestore)

    membershipDocs.docs.forEach((doc) => {
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

    await batch.commit()

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
    updateTeamName,
    updateUserProfile,
  }
})

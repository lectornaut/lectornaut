/**
 * Team Groups Store — the current team's groups (realtime) + CRUD.
 *
 * A group is a reusable, named bundle of human team members; it is role-less.
 * The role a group confers is a per-workspace grant (see `assignWorkspaceGroupRole`
 * + the WorkspaceDialog groups area), not stored here. This store owns the live
 * `groups` list and the admin CRUD callables; the per-workspace grants are read
 * on demand by the dialogs that need them.
 *
 * Reads are gated on a confirmed team membership (groups are member-readable, so
 * listing before membership resolves would hit a rules denial). Writes go
 * through Cloud Functions and surface in the list via the realtime listener.
 */

import {
  createGroup as createGroupFn,
  deleteGroup as deleteGroupFn,
  getTeamGroupUsage as getTeamGroupUsageFn,
  updateGroup as updateGroupFn,
} from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IGroup } from "@/types/domain"
import {
  deleteGroupPhotoFile,
  getTeamGroupsCollection,
  uploadGroupPhoto,
} from "@/utils/firebase/firebase-helpers"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import { defineStore, storeToRefs } from "pinia"

export const useTeamGroupsStore = defineStore("teamGroups", () => {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()

  const { currentUser, currentTeamId } = storeToRefs(authStore)
  const { memberships, canManageMembers } = storeToRefs(membershipStore)

  const hasCurrentTeamMembership = computed(() => {
    const teamId = currentTeamId.value
    return !!teamId && memberships.value.some((m) => m.teamId === teamId)
  })

  // ── Realtime read ───────────────────────────────────────────────────────────
  const groupsQuery = useCollectionQuery<IGroup>(() => {
    const teamId = currentTeamId.value
    if (!teamId || !currentUser.value || !hasCurrentTeamMembership.value) {
      return null
    }
    const collectionRef = getTeamGroupsCollection(teamId)
    return { query: collectionRef, path: collectionRef.path }
  })

  const groups = computed(() =>
    [...(groupsQuery.data.value ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  )
  const isLoading = computed(() => groupsQuery.isLoading.value)
  const groupById = computed(() => new Map(groups.value.map((g) => [g.id, g])))

  // ── "Used in N workspaces" blast-radius (on-demand aggregate) ────────────────
  const groupUsage = ref<Record<string, number>>({})

  async function refreshUsage(): Promise<void> {
    const teamId = currentTeamId.value
    if (!teamId || !canManageMembers.value) return
    try {
      const res = await getTeamGroupUsageFn({ teamId })
      groupUsage.value = res.data.usage ?? {}
    } catch (error) {
      console.error("[teamGroupsStore] Failed to load group usage", error)
    }
  }

  const usageForGroup = computed(
    () => (groupId: string) => groupUsage.value[groupId] ?? 0
  )

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function createGroup(
    name: string,
    memberIds: string[],
    description: string | null,
    photoFile?: File
  ): Promise<string | undefined> {
    const teamId = currentTeamId.value
    if (!teamId) return undefined
    if (!canManageMembers.value) {
      throw new Error("Only team owners and admins can manage groups")
    }
    const res = await createGroupFn({ teamId, name, description, memberIds })
    const groupId = res.data.groupId

    // The avatar needs the new group's id, so upload it after creation.
    // Best-effort — never fail creation over a photo.
    if (groupId && photoFile) {
      try {
        const photoURL = await uploadGroupPhoto(teamId, groupId, photoFile)
        await updateGroupFn({ teamId, groupId, photoURL })
      } catch (error) {
        console.error(
          "[teamGroupsStore] Failed to attach group photo after create",
          error
        )
      }
    }
    return groupId
  }

  async function updateGroup(
    groupId: string,
    patch: {
      name?: string
      description?: string | null
      memberIds?: string[]
      photoFile?: File | null
    }
  ): Promise<void> {
    const teamId = currentTeamId.value
    if (!teamId) return
    if (!canManageMembers.value) {
      throw new Error("Only team owners and admins can manage groups")
    }

    const { name, description, memberIds, photoFile } = patch
    // Upload first so the callable persists the resolved download URL.
    let photoURL: string | null | undefined =
      photoFile === null ? null : undefined
    if (photoFile instanceof File) {
      photoURL = await uploadGroupPhoto(teamId, groupId, photoFile)
    }

    await updateGroupFn({
      teamId,
      groupId,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(memberIds !== undefined ? { memberIds } : {}),
      ...(photoFile !== undefined ? { photoURL: photoURL ?? null } : {}),
    })

    // Clean up storage when the photo was explicitly removed.
    if (photoFile === null) {
      await deleteGroupPhotoFile(teamId, groupId)
    }
  }

  async function deleteGroup(groupId: string): Promise<void> {
    const teamId = currentTeamId.value
    if (!teamId) return
    if (!canManageMembers.value) {
      throw new Error("Only team owners and admins can manage groups")
    }
    await deleteGroupFn({ teamId, groupId })
    // Avatar cleanup is handled server-side by the deleteGroup callable.
    // Drop the deleted group's usage entry so the blast-radius cue is accurate
    // before the next refresh.
    if (groupUsage.value[groupId] !== undefined) {
      const next = { ...groupUsage.value }
      delete next[groupId]
      groupUsage.value = next
    }
  }

  // Read state lives in the query cache (cleared centrally on logout). Reset the
  // on-demand usage aggregate so it can't leak across users.
  function cleanup() {
    groupUsage.value = {}
  }

  return {
    // State
    groups,
    groupById,
    isLoading,
    groupUsage,

    // Computed
    usageForGroup,

    // Actions
    createGroup,
    updateGroup,
    deleteGroup,
    refreshUsage,

    // Lifecycle
    cleanup,
  }
})

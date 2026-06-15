<script lang="ts" setup>
import {
  assignWorkspaceGroupRole,
  assignWorkspaceRole,
  listWorkspaceGroupRoles,
  listWorkspaceMemberRoles,
} from "@/composables/useFunctions"
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { IconUsers2, IconUsers, IconX, IconUsersRound } from "@/data/icons"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamGroupsStore } from "@/stores/teamGroupsStore"
import type { IWorkspace } from "@/types/domain"
import { isUserMembership, type IMembership } from "@/types/membership"
import { effectiveRole, type IMembershipRole } from "@/types/permissions"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

const props = defineProps<{
  open?: boolean
  mode: "create" | "edit"
  workspace?: IWorkspace
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "success"): void
}>()

const { t } = useI18n()
const {
  createWorkspace,
  updateWorkspace,
  canCreateWorkspace,
  getCannotCreateWorkspaceReason,
  canUpdateWorkspace,
  getCannotUpdateWorkspaceReason,
} = useWorkspaceActions()

// Edit-mode permission is PER-WORKSPACE — it honors this workspace's elevate-only
// role override / group grant, not just the team role. (Create mode keeps using
// the team-level `canCreateWorkspace`.) Wrapped in computeds so the template's
// existing create/edit branching stays unchanged.
const canEditThisWorkspace = computed(() =>
  canUpdateWorkspace(props.workspace?.id)
)
const cannotEditThisWorkspaceReason = computed(() =>
  getCannotUpdateWorkspaceReason(props.workspace?.id)
)

const isOpen = ref(props.open || false)
const isLoading = ref(false)

// ── Per-workspace membership + roles ─────────────────────────────────────────
const membershipStore = useMembershipStore()
const { teamMembers, currentTeamId, isOwner, canManageMembers } =
  storeToRefs(membershipStore)
const currentAuthUser = useCurrentUser()

/** Per member uid: explicit per-workspace role override (`null`/absent = none). */
const workspaceRoleOverrides = ref<Record<string, IMembershipRole | null>>({})
/** Per member uid: `true` = excluded (non-member of this workspace). */
const workspaceExcluded = ref<Record<string, boolean>>({})
/**
 * Loaded baseline (edit mode) the staged refs are diffed against on Save; empty
 * in create mode (so every staged change reads as an addition).
 */
const baselineRoleOverrides = ref<Record<string, IMembershipRole | null>>({})
const baselineExcluded = ref<Record<string, boolean>>({})
const rolesLoading = ref(false)

const humanMembers = computed(() => teamMembers.value.filter(isUserMembership))
const canAssignWorkspaceRoles = canManageMembers

// ── Per-workspace group grants (elevate-only) ────────────────────────────────
const groupsStore = useTeamGroupsStore()
const { groups: teamGroups } = storeToRefs(groupsStore)

/** Per groupId: the role this workspace grants the group (`undefined` = none). */
const workspaceGroupGrants = ref<Record<string, IMembershipRole>>({})
/** Loaded baseline (edit mode), diffed against on Save; empty in create mode. */
const baselineGroupGrants = ref<Record<string, IMembershipRole>>({})
const groupRolesLoading = ref(false)

/** Groups that currently have a grant in this workspace, with their role. */
const grantedGroups = computed(() =>
  teamGroups.value
    .filter((g) => workspaceGroupGrants.value[g.id])
    .map((g) => ({ ...g, role: workspaceGroupGrants.value[g.id] }))
)

/**
 * A member's group-derived role here = the max role over every GRANTED group
 * they belong to, plus the contributing group's name (for the "via" tag). Null
 * when no granted group elevates them.
 */
const groupDerivedFor = (
  userId: string
): { role: IMembershipRole | null; via: string } => {
  let best: IMembershipRole | null = null
  let via = ""
  for (const g of grantedGroups.value) {
    if (!g.memberIds.includes(userId)) continue
    // effectiveRole is elevate-only — keep the strictly-more-privileged grant.
    if (effectiveRole(best, g.role) === g.role && g.role !== best) {
      best = g.role
      via = g.name
    }
  }
  return { role: best, via }
}

/**
 * The group name to show as a "via {group}" provenance tag on a member row —
 * only when a group raises the member ABOVE their own direct/team role (so an
 * admin isn't confused that the direct control reads lower than reality).
 */
const groupProvenance = (
  member: IMembership
): { role: IMembershipRole; group: string } | null => {
  const { role, via } = groupDerivedFor(member.userId)
  if (!role) return null
  const direct = memberRoleValue(member)
  // Only when the group STRICTLY raises them above their direct/team role — an
  // equal-rank group grant changes nothing the admin needs to be warned about.
  return role !== direct && effectiveRole(direct, role) === role
    ? { role, group: via }
    : null
}

/** Group-derived provenance per member uid, for the "{role} via {group}" tag. */
const groupProvenanceByUser = computed(() => {
  const map = new Map<string, { role: IMembershipRole; group: string }>()
  for (const member of humanMembers.value) {
    const prov = groupProvenance(member)
    if (prov) map.set(member.userId, prov)
  }
  return map
})

const loadWorkspaceGroupGrants = async (workspaceId: string) => {
  const teamId = currentTeamId.value
  if (!teamId) return
  groupRolesLoading.value = true
  try {
    const { data } = await listWorkspaceGroupRoles({ teamId, workspaceId })
    const next: Record<string, IMembershipRole> = {}
    for (const grant of data.grants) next[grant.groupId] = grant.role
    workspaceGroupGrants.value = next
    baselineGroupGrants.value = { ...next }
  } catch (error) {
    console.error("[WorkspaceDialog] Failed to load group access", error)
    toast.error(t("components.workspaceDialog.groups.loadError"))
  } finally {
    groupRolesLoading.value = false
  }
}

/**
 * Stage a group's per-workspace role locally (no write) — `null` clears it. All
 * staged changes commit on Save (`handleSubmit` → `applyStagedWorkspaceGroupGrants`),
 * so Cancel discards them.
 */
const stageGroupGrant = (groupId: string, role: IMembershipRole | null) => {
  const next = { ...workspaceGroupGrants.value }
  if (role === null) delete next[groupId]
  else next[groupId] = role
  workspaceGroupGrants.value = next
}

const handleGroupRoleChange = (groupId: string, value: string) =>
  stageGroupGrant(groupId, value as IMembershipRole)

/** Access switch: on = grant (seeded at `member`), off = revoke. */
const handleGroupGrantToggle = (groupId: string, granted: boolean) =>
  stageGroupGrant(groupId, granted ? "member" : null)

// Roles offered for an explicit grant. Owner is owner-only, mirroring the
// team-role rules. Per-workspace roles are elevate-only, so a `guest` grant is
// inert (it can't lower a member) — offered for parity, but never reduces access.
const assignableRoles = computed<IMembershipRole[]>(() =>
  isOwner.value
    ? ["guest", "member", "admin", "owner"]
    : ["guest", "member", "admin"]
)

const memberLabel = (member: IMembership) =>
  member.user?.displayName || member.user?.email || member.userId

// ── Users ────────────────────────────────────────────────────────────────────

/** Participation: a member is in the workspace unless explicitly excluded. */
const isWorkspaceMember = (userId: string) =>
  workspaceExcluded.value[userId] !== true

/** Role select value for a member: their explicit override, else their team role. */
const memberRoleValue = (member: IMembership): IMembershipRole =>
  workspaceRoleOverrides.value[member.userId] ?? member.role

/** The signed-in user. */
const isSelf = (userId: string) => currentAuthUser.value?.uid === userId

/**
 * Effective owner of this workspace = team owner OR an owner override.
 * `effectiveRole` is elevate-only, so either path makes them an owner here.
 */
const isWorkspaceOwner = (member: IMembership) =>
  member.role === "owner" ||
  workspaceRoleOverrides.value[member.userId] === "owner"

/**
 * Participation cannot be removed for yourself or an owner — excluding either
 * is an unrecoverable self-/owner-lockout, rejected server-side in
 * `assignWorkspaceRole`. Lock the checkbox so the UI never stages it.
 */
const isParticipationLocked = (member: IMembership) =>
  isSelf(member.userId) || isWorkspaceOwner(member)

/** i18n key explaining why a locked participation checkbox is disabled. */
const participationLockReason = (member: IMembership): string =>
  isSelf(member.userId)
    ? "components.workspaceDialog.roles.selfLocked"
    : "components.workspaceDialog.roles.ownerLocked"

const loadWorkspaceRoles = async (workspaceId: string) => {
  const teamId = currentTeamId.value
  if (!teamId) return
  rolesLoading.value = true
  try {
    const { data } = await listWorkspaceMemberRoles({ teamId, workspaceId })
    const nextRoles: Record<string, IMembershipRole | null> = {}
    const nextExcluded: Record<string, boolean> = {}
    for (const entry of data.roles) {
      if (entry.role != null) nextRoles[entry.userId] = entry.role
      if (entry.excluded) nextExcluded[entry.userId] = true
    }
    workspaceRoleOverrides.value = nextRoles
    workspaceExcluded.value = nextExcluded
    baselineRoleOverrides.value = { ...nextRoles }
    baselineExcluded.value = { ...nextExcluded }
  } catch (error) {
    console.error("[WorkspaceDialog] Failed to load workspace roles", error)
    toast.error(t("components.workspaceDialog.roles.loadError"))
  } finally {
    rolesLoading.value = false
  }
}

/**
 * Stage a member patch (role and/or excluded) locally — no write. Committed on
 * Save (`handleSubmit` → `applyStagedWorkspaceRoles`); Cancel discards.
 */
const stageUserOverride = (
  userId: string,
  changes: { role?: IMembershipRole | null; excluded?: boolean }
) => {
  if (changes.role !== undefined) {
    workspaceRoleOverrides.value = {
      ...workspaceRoleOverrides.value,
      [userId]: changes.role,
    }
  }
  if (changes.excluded !== undefined) {
    workspaceExcluded.value = {
      ...workspaceExcluded.value,
      [userId]: changes.excluded,
    }
  }
}

/** Participation checkbox: checked = member (role active); unchecked = non-member. */
const handleMemberToggle = (member: IMembership, isMember: boolean) => {
  const changes: { role?: IMembershipRole | null; excluded?: boolean } = {
    excluded: !isMember,
  }
  // First inclusion with no prior override: seed an explicit role so the select
  // reflects a concrete grant rather than the (display-only) team role.
  if (isMember && workspaceRoleOverrides.value[member.userId] == null) {
    changes.role = memberRoleValue(member)
  }
  stageUserOverride(member.userId, changes)
}

/** Role select change (only active while the member participates). */
const handleUserRoleChange = (userId: string, value: string) => {
  stageUserOverride(userId, { role: value as IMembershipRole })
}

/**
 * Commit staged member role/exclusion changes by DIFFING the staged refs against
 * the loaded baseline — only changed members are written (and only the fields
 * that changed). In create mode the baseline is empty, so every staged member is
 * an addition.
 */
const applyStagedWorkspaceRoles = async (workspaceId: string) => {
  const teamId = currentTeamId.value
  if (!teamId) return

  const uids = new Set([
    ...Object.keys(workspaceRoleOverrides.value),
    ...Object.keys(workspaceExcluded.value),
    ...Object.keys(baselineRoleOverrides.value),
    ...Object.keys(baselineExcluded.value),
  ])
  await Promise.all(
    [...uids].map(async (userId) => {
      const role = workspaceRoleOverrides.value[userId] ?? null
      const excluded = workspaceExcluded.value[userId] === true
      const prevRole = baselineRoleOverrides.value[userId] ?? null
      const prevExcluded = baselineExcluded.value[userId] === true

      const changes: { role?: IMembershipRole | null; excluded?: boolean } = {}
      if (role !== prevRole) changes.role = role
      if (excluded !== prevExcluded) changes.excluded = excluded
      if (Object.keys(changes).length === 0) return
      try {
        await assignWorkspaceRole({ teamId, workspaceId, userId, ...changes })
      } catch (error) {
        console.error("[WorkspaceDialog] Failed to apply workspace role", error)
        toast.error(t("components.workspaceDialog.roles.assignError"))
      }
    })
  )
}

/**
 * Commit staged group grants by DIFFING against the loaded baseline: newly
 * granted / changed groups get their role, and groups dropped from the staged
 * set are revoked (`role: null`). Empty baseline in create mode ⇒ all additions.
 */
const applyStagedWorkspaceGroupGrants = async (workspaceId: string) => {
  const teamId = currentTeamId.value
  if (!teamId) return

  const groupIds = new Set([
    ...Object.keys(workspaceGroupGrants.value),
    ...Object.keys(baselineGroupGrants.value),
  ])
  await Promise.all(
    [...groupIds].map(async (groupId) => {
      const role = workspaceGroupGrants.value[groupId] ?? null
      const prev = baselineGroupGrants.value[groupId] ?? null
      if (role === prev) return
      try {
        await assignWorkspaceGroupRole({ teamId, workspaceId, groupId, role })
      } catch (error) {
        console.error("[WorkspaceDialog] Failed to apply group grant", error)
        toast.error(t("components.workspaceDialog.groups.assignError"))
      }
    })
  )
}

// Form State
const workspaceName = ref("")
const workspaceDescription = ref("")

// Photo Upload State
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)
const revokeBlobUrl = () => {
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
}

const workspacePhotoUpload = usePhotoUpload({
  canUpload: () =>
    (props.mode === "create" && canCreateWorkspace.value) ||
    (props.mode === "edit" && canEditThisWorkspace.value),
  onUpload: async (_id, file) => {
    revokeBlobUrl()
    photoFile.value = file
    photoPreview.value = URL.createObjectURL(file)
  },
})

const triggerWorkspacePhotoSelection = () => {
  if (
    (props.mode === "create" && !canCreateWorkspace.value) ||
    (props.mode === "edit" && !canEditThisWorkspace.value)
  ) {
    return
  }
  workspacePhotoUpload.triggerUpload(props.workspace?.id || "draft-workspace")
}

const removePhoto = () => {
  revokeBlobUrl()
  photoFile.value = null
  photoPreview.value = null
}

const resetForm = () => {
  revokeBlobUrl()
  workspaceName.value = ""
  workspaceDescription.value = ""
  photoFile.value = null
  photoPreview.value = null
  workspaceRoleOverrides.value = {}
  workspaceExcluded.value = {}
  baselineRoleOverrides.value = {}
  baselineExcluded.value = {}
  workspaceGroupGrants.value = {}
  baselineGroupGrants.value = {}
}

// Sync internal open state with prop
watch(
  () => props.open,
  (val) => {
    isOpen.value = val ?? false
  }
)

watch(isOpen, (val) => {
  emit("update:open", val)
  if (!val) {
    resetForm()
  } else {
    // Initialize form when opened
    if (props.mode === "edit" && props.workspace) {
      workspaceName.value = props.workspace.name
      workspaceDescription.value = props.workspace.description || ""
      photoPreview.value = props.workspace.photoURL || null
      void loadWorkspaceRoles(props.workspace.id)
      void loadWorkspaceGroupGrants(props.workspace.id)
    }
  }
})

const handleSubmit = async () => {
  if (!workspaceName.value.trim()) return

  if (props.mode === "create" && !canCreateWorkspace.value) {
    toast.error(t(getCannotCreateWorkspaceReason.value || ""))
    return
  }

  isLoading.value = true
  try {
    if (props.mode === "create") {
      const newWorkspaceId = await createWorkspace(
        workspaceName.value,
        workspaceDescription.value || undefined,
        photoFile.value || undefined
      )
      // Apply any roles + group grants staged in the dialog against the
      // freshly-created id.
      if (newWorkspaceId) {
        await Promise.all([
          applyStagedWorkspaceRoles(newWorkspaceId),
          applyStagedWorkspaceGroupGrants(newWorkspaceId),
        ])
      }
    } else if (props.mode === "edit" && props.workspace) {
      // If photoFile is set, we upload it.
      // If photoPreview is null but we had a photo, it means we removed it.
      let filePayload: File | null | undefined = undefined
      if (photoFile.value) {
        filePayload = photoFile.value
      } else if (
        props.workspace.photoURL &&
        !photoPreview.value &&
        !photoFile.value
      ) {
        filePayload = null // Signal to remove photo
      }

      await updateWorkspace(props.workspace.id, {
        name: workspaceName.value,
        description: workspaceDescription.value || null,
        photoFile: filePayload,
      })
      // Commit staged member + group access changes (diffed against baseline).
      await Promise.all([
        applyStagedWorkspaceRoles(props.workspace.id),
        applyStagedWorkspaceGroupGrants(props.workspace.id),
      ])
    }

    emit("success")
    isOpen.value = false
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogTrigger as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogContent class="w-2xl max-w-fit">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === "create"
              ? t("components.workspaceDialog.createTitle")
              : t("components.workspaceDialog.editTitle")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? t("components.workspaceDialog.createDescription")
              : t("components.workspaceDialog.editDescription")
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Workspace Profile Picture -->
        <Field class="grid gap-2">
          <div class="flex flex-col items-center gap-2">
            <FieldLabel class="text-secondary-foreground text-xs">
              {{ t("components.workspaceDialog.photoLabel") }}
            </FieldLabel>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <div
                      :class="[
                        'bg-secondary rounded-full p-3',
                        {
                          'cursor-not-allowed opacity-50':
                            (!canCreateWorkspace && mode === 'create') ||
                            (!canEditThisWorkspace && mode === 'edit'),
                        },
                      ]"
                    >
                      <AppAvatar
                        class="size-16"
                        :class="{
                          'cursor-pointer':
                            (canCreateWorkspace && mode === 'create') ||
                            (canEditThisWorkspace && mode === 'edit'),
                        }"
                        :src="photoPreview"
                        :name="workspaceName"
                        @click="triggerWorkspacePhotoSelection"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    v-if="
                      (!canCreateWorkspace && mode === 'create') ||
                      (!canEditThisWorkspace && mode === 'edit')
                    "
                  >
                    {{
                      mode === "create"
                        ? t(getCannotCreateWorkspaceReason || "")
                        : t(cannotEditThisWorkspaceReason || "")
                    }}
                  </TooltipContent>
                  <TooltipContent v-else>
                    {{ t("components.workspaceDialog.uploadPhoto") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip
                  v-if="
                    photoPreview &&
                    ((canCreateWorkspace && mode === 'create') ||
                      (canEditThisWorkspace && mode === 'edit'))
                  "
                >
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute top-1 right-1 size-4 opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon"
                      @click.stop="removePhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.workspaceDialog.removePhoto") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </Field>

        <!-- Workspace Name -->
        <Field class="grid gap-2">
          <FieldLabel class="text-secondary-foreground text-xs" for="name">
            {{ t("components.workspaceDialog.nameLabel") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Input
                    id="name"
                    v-model="workspaceName"
                    :placeholder="
                      t('components.workspaceDialog.namePlaceholder')
                    "
                    :disabled="
                      (!canCreateWorkspace && mode === 'create') ||
                      (!canEditThisWorkspace && mode === 'edit')
                    "
                    @keyup.enter="handleSubmit"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                v-if="
                  (!canCreateWorkspace && mode === 'create') ||
                  (!canEditThisWorkspace && mode === 'edit')
                "
              >
                {{
                  mode === "create"
                    ? t(getCannotCreateWorkspaceReason || "")
                    : t(cannotEditThisWorkspaceReason || "")
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!-- Workspace Description -->
        <Field class="grid gap-2">
          <FieldLabel
            class="text-secondary-foreground text-xs"
            for="description"
          >
            {{ t("components.workspaceDialog.descriptionLabel") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Textarea
                    id="description"
                    v-model="workspaceDescription"
                    :placeholder="
                      t('components.workspaceDialog.descriptionPlaceholder')
                    "
                    :disabled="
                      (!canCreateWorkspace && mode === 'create') ||
                      (!canEditThisWorkspace && mode === 'edit')
                    "
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                v-if="
                  (!canCreateWorkspace && mode === 'create') ||
                  (!canEditThisWorkspace && mode === 'edit')
                "
              >
                {{
                  mode === "create"
                    ? t(getCannotCreateWorkspaceReason || "")
                    : t(cannotEditThisWorkspaceReason || "")
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!-- Per-workspace access (members + groups), elevate-only -->
        <Field v-if="canAssignWorkspaceRoles" class="grid gap-2">
          <Tabs default-value="members">
            <TabsList class="m-0 h-auto! gap-2 bg-transparent p-0">
              <TabsTrigger
                value="members"
                class="text-secondary-foreground data-[state=inactive]:text-secondary-foreground/50 h-auto p-0 text-xs data-[state=active]:shadow-none!"
              >
                {{ t("components.workspaceDialog.roles.label") }}
              </TabsTrigger>
              <TabsTrigger
                value="groups"
                class="text-secondary-foreground data-[state=inactive]:text-secondary-foreground/50 h-auto p-0 text-xs data-[state=active]:shadow-none!"
              >
                {{ t("components.workspaceDialog.groups.label") }}
              </TabsTrigger>
            </TabsList>

            <!-- Member access -->
            <TabsContent value="members" class="bg-secondary rounded-2xl p-3">
              <LoadingState v-if="rolesLoading" />
              <template v-else>
                <Empty
                  v-if="humanMembers.length === 0"
                  class="border border-dashed p-6"
                >
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconUsers />
                    </EmptyMedia>
                    <EmptyTitle>
                      {{ t("components.workspaceDialog.roles.empty") }}
                    </EmptyTitle>
                  </EmptyHeader>
                </Empty>
                <ItemGroup v-else>
                  <Item
                    v-for="member in humanMembers"
                    :key="member.userId"
                    size="sm"
                    class="p-0"
                  >
                    <ItemMedia>
                      <AppAvatar
                        :src="member.user?.photoURL"
                        :name="memberLabel(member)"
                      />
                    </ItemMedia>
                    <ItemContent class="truncate">
                      <ItemTitle>
                        <span class="truncate">{{ memberLabel(member) }}</span>
                        <span
                          v-if="currentAuthUser?.uid === member.userId"
                          class="text-muted-foreground"
                        >
                          ({{ t("components.workspaceDialog.roles.you") }})
                        </span>
                      </ItemTitle>
                      <ItemDescription
                        v-if="
                          member.user?.email &&
                          member.user.email !== memberLabel(member)
                        "
                        class="text-xs"
                      >
                        {{ member.user.email }}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Select
                        v-if="isWorkspaceMember(member.userId)"
                        :model-value="memberRoleValue(member)"
                        :disabled="isLoading"
                        @update:model-value="
                          (value) =>
                            handleUserRoleChange(member.userId, value as string)
                        "
                      >
                        <Button variant="outline" as-child>
                          <SelectTrigger>
                            <SelectValue />
                            <TooltipProvider
                              v-if="
                                isWorkspaceMember(member.userId) &&
                                groupProvenanceByUser.get(member.userId)
                              "
                            >
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <InputGroupButton size="icon-xs">
                                    <IconUsersRound />
                                  </InputGroupButton>
                                </TooltipTrigger>
                                <!-- Group provenance — only meaningful while the member has
                       access, so it hides with the role select when off. -->
                                <TooltipContent>
                                  {{
                                    t("components.workspaceDialog.roles.via", {
                                      role: t(
                                        `settings.members.roles.${groupProvenanceByUser.get(member.userId)!.role}`
                                      ),
                                      group: groupProvenanceByUser.get(
                                        member.userId
                                      )!.group,
                                    })
                                  }}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </SelectTrigger>
                        </Button>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem
                              v-for="role in assignableRoles"
                              :key="role"
                              :value="role"
                            >
                              {{ t(`settings.members.roles.${role}`) }}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <TooltipProvider>
                        <!-- Workspace access toggle. Off = excluded (no access),
                         which hides the role select + provenance tag. -->
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button
                              variant="outline"
                              size="icon"
                              :disabled="isLoading"
                            >
                              <Checkbox
                                :model-value="isWorkspaceMember(member.userId)"
                                :disabled="
                                  isLoading || isParticipationLocked(member)
                                "
                                class="rounded-full border-none opacity-100! disabled:opacity-25! data-[state=checked]:bg-transparent"
                                @update:model-value="
                                  (value) =>
                                    handleMemberToggle(member, value === true)
                                "
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent v-if="isParticipationLocked(member)">
                            {{ t(participationLockReason(member)) }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </template>
            </TabsContent>

            <!-- Group access -->
            <TabsContent value="groups" class="bg-secondary rounded-2xl p-3">
              <LoadingState v-if="groupRolesLoading" />
              <template v-else>
                <Empty
                  v-if="teamGroups.length === 0"
                  class="border border-dashed p-6"
                >
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconUsers2 />
                    </EmptyMedia>
                    <EmptyTitle>
                      {{ t("components.workspaceDialog.groups.empty") }}
                    </EmptyTitle>
                  </EmptyHeader>
                </Empty>
                <ItemGroup v-else>
                  <Item
                    v-for="group in teamGroups"
                    :key="group.id"
                    size="sm"
                    class="p-0"
                  >
                    <ItemMedia>
                      <AppAvatar :src="group.photoURL" :name="group.name" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        <span class="truncate">{{ group.name }}</span>
                      </ItemTitle>
                      <ItemDescription class="text-xs">
                        {{
                          t("settings.groups.memberCount", {
                            count: group.memberIds.length,
                          })
                        }}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <!-- Role select only matters while access is granted, so
                             it hides when the switch is off. -->
                      <Select
                        v-if="workspaceGroupGrants[group.id]"
                        :model-value="workspaceGroupGrants[group.id]"
                        :disabled="isLoading"
                        @update:model-value="
                          (value) =>
                            handleGroupRoleChange(group.id, value as string)
                        "
                      >
                        <Button variant="outline" as-child>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </Button>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem
                              v-for="role in assignableRoles"
                              :key="role"
                              :value="role"
                            >
                              {{ t(`settings.members.roles.${role}`) }}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <!-- Access grant toggle. Off = no access (hides role). -->
                      <Button
                        variant="outline"
                        size="icon"
                        :disabled="isLoading"
                      >
                        <Checkbox
                          :model-value="!!workspaceGroupGrants[group.id]"
                          :disabled="isLoading"
                          class="rounded-full border-none opacity-100! disabled:opacity-25! data-[state=checked]:bg-transparent"
                          @update:model-value="
                            (value) =>
                              handleGroupGrantToggle(group.id, value === true)
                          "
                        />
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </template>
            </TabsContent>
          </Tabs>
        </Field>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isLoading">
            {{ t("common.actions.cancel") }}
            <Kbd>Esc</Kbd>
          </Button>
        </DialogClose>
        <Button
          data-dialog-action
          :disabled="isLoading || (!canEditThisWorkspace && mode === 'edit')"
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{
            mode === "create"
              ? t("components.workspaceDialog.createTitle")
              : t("components.workspaceDialog.saveChanges")
          }}
          <Kbd>↩</Kbd>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconAtSign,
  IconBan,
  IconCheck,
  IconCircle,
  IconCircleDashed,
  IconForward,
  IconPlus,
  IconTrash,
  IconX,
} from "@/data/icons"
import { defaultTeamRole } from "@/helpers/defaults"
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/helpers/username"
import { getInitials } from "@/helpers/utilities"
import { checkUsernameAvailability } from "@/queries/username"
import {
  useInvitationStore,
  useTeamInvitations,
  type IInvitation,
} from "@/stores/invitationStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ITeam } from "@/types/domain"
import {
  isMembershipRole,
  type IMembership,
  type IMembershipRole,
} from "@/types/membership"
import { Capabilities, roleCan } from "@/types/permissions"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

/** Member pending invite or already on team */
interface PendingMember {
  email: string
  role: IMembershipRole
  id?: string
  originalRole?: IMembershipRole
}

/** Result of a single invite attempt */
interface InviteResult {
  email: string
  success: boolean
  error?: Error
}

const props = defineProps<{
  open?: boolean
  mode: "create" | "invite" | "edit"
  team?: ITeam
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "success"): void
}>()

const { t } = useI18n()

// Local Invitation Query (moved up for permissions)
const targetTeamId = computed(() => {
  if (props.mode === "create") return null
  return props.team?.id
})

const {
  createTeam,
  updateTeam,
  canUpdateTeam,
  getCannotUpdateTeamReason,
  canInviteMembers,
  getCannotInviteMembersReason,
} = useTeamActions(targetTeamId)

const membershipStore = useMembershipStore()
const invitationStore = useInvitationStore()
const user = useCurrentUser()

// State
const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const teamName = ref("")
const teamUsername = ref("")
const teamIsPublic = ref(false)
const inviteEmail = ref("")
const inviteRole = ref<IMembershipRole>(defaultTeamRole)
const members = ref<PendingMember[]>([])
const removedMemberIds = ref<string[]>([])
const originalMemberRoles = ref<Record<string, IMembershipRole>>({})
const isCheckingTeamUsername = ref(false)
const teamUsernameAvailable = ref<boolean | null>(null)
const teamUsernameError = ref<string | null>(null)

const teamInvitations = useTeamInvitations(targetTeamId)

// Computed
const activeMembers = computed(() => {
  return members.value.filter((m) => !!m.id)
})

const stagedInvites = computed(() => {
  return members.value.filter((m) => !m.id)
})

const userRole = computed(() => {
  if (props.mode === "create") return "owner"
  if (!props.team) return null
  const membership = membershipStore.memberships.find(
    (m) => m.teamId === props.team?.id
  )
  return membership?.role ?? null
})

const isPrivileged = computed(() => {
  return roleCan(userRole.value, Capabilities.INVITE_MEMBER)
})

const canManageOwnerRoles = computed(
  () => props.mode === "create" || userRole.value === "owner"
)
const ownerRoleManagementReason = computed(() =>
  t("components.teamDialog.errors.ownerRoleRequiresOwner")
)

const canShowTeamInvitations = computed(() => {
  return (
    (props.mode === "edit" || props.mode === "invite") && isPrivileged.value
  )
})

const visibleTeamInvitations = computed(() => {
  if (!canShowTeamInvitations.value) return []

  if (props.mode === "invite") {
    return teamInvitations.value.filter((invite) => invite.status === "pending")
  }

  return teamInvitations.value
})

const currentTeamUsername = computed(() => props.team?.username ?? "")
const currentTeamIsPublic = computed(() => props.team?.isPublic ?? false)
const hasTeamUsername = computed(() => {
  const usernameInput = teamUsername.value.trim()
  return usernameInput.length >= USERNAME_MIN_LENGTH
})
const hasValidTeamUsername = computed(() => {
  if (!teamUsername.value.trim()) return false
  return validateUsername(teamUsername.value).valid
})

// Photo Upload State
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)

/** Revoke blob URL to prevent memory leaks */
const revokeBlobUrl = () => {
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
}

const teamPhotoUpload = usePhotoUpload({
  canUpload: () => canUpdateTeam.value || props.mode === "create",
  onUpload: async (_id, file) => {
    revokeBlobUrl()
    photoFile.value = file
    photoPreview.value = URL.createObjectURL(file)
  },
})

const triggerTeamPhotoSelection = () => {
  if (!canUpdateTeam.value && props.mode !== "create") return
  teamPhotoUpload.triggerUpload(props.team?.id || "draft-team")
}

const removePhoto = () => {
  revokeBlobUrl()
  photoFile.value = null
  photoPreview.value = null
}

const resetForm = () => {
  revokeBlobUrl()
  teamName.value = ""
  teamUsername.value = ""
  teamIsPublic.value = false
  inviteEmail.value = ""
  inviteRole.value = defaultTeamRole
  members.value = []
  removedMemberIds.value = []
  originalMemberRoles.value = {}
  photoFile.value = null
  photoPreview.value = null
  teamUsernameAvailable.value = null
  teamUsernameError.value = null
  isCheckingTeamUsername.value = false
}

const checkTeamUsername = async () => {
  const usernameInput = teamUsername.value.trim()

  if (!usernameInput) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }

  if (
    props.mode === "edit" &&
    usernamesMatch(usernameInput, currentTeamUsername.value)
  ) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }

  const validation = validateUsername(usernameInput)
  if (!validation.valid) {
    teamUsernameAvailable.value = false
    teamUsernameError.value = validation.error
    return
  }

  teamUsernameError.value = null
  isCheckingTeamUsername.value = true

  try {
    teamUsernameAvailable.value = await checkUsernameAvailability(usernameInput)
    if (!teamUsernameAvailable.value) {
      teamUsernameError.value = t("components.teamDialog.errors.usernameTaken")
    }
  } finally {
    isCheckingTeamUsername.value = false
  }
}

const debouncedCheckTeamUsername = useDebounceFn(checkTeamUsername, 500)

const handleTeamUsernameInput = () => {
  if (!teamUsername.value.trim()) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }
  debouncedCheckTeamUsername()
}

const toggleTeamIsPublic = (value: boolean) => {
  if (value && !hasValidTeamUsername.value) {
    toast.error(t("components.teamDialog.errors.publicTeamRequiresUsername"))
    return
  }

  teamIsPublic.value = value
}

// Sync internal open state with prop
watch(
  () => props.open,
  (val) => {
    isOpen.value = val ?? false
  }
)

watch(hasValidTeamUsername, (isValid) => {
  if (!isValid && teamIsPublic.value) {
    teamIsPublic.value = false
  }
})

watch(isOpen, async (val) => {
  emit("update:open", val)
  if (!val) {
    resetForm()
  } else {
    // Initialize form when opened
    if (props.mode === "edit" && props.team) {
      isLoading.value = true
      try {
        teamName.value = props.team.name
        teamUsername.value = props.team.username ?? ""
        teamIsPublic.value = props.team.isPublic ?? false
        photoPreview.value = props.team.photoURL || null
        // Load existing team members from membershipStore for the specific team
        const teamMembers = await membershipStore.getMembersForTeam(
          props.team.id
        )
        if (teamMembers && teamMembers.length > 0) {
          originalMemberRoles.value = Object.fromEntries(
            teamMembers.map((membership) => [
              membership.userId,
              membership.role,
            ])
          )
          members.value = teamMembers.map((membership: IMembership) => ({
            email: membership.user.email!,
            role: membership.role,
            id: membership.userId,
            originalRole: membership.role,
          }))
        }
      } finally {
        isLoading.value = false
      }
    } else if (props.mode === "create") {
      teamUsername.value = ""
      teamIsPublic.value = false
    }
  }
})

// Helpers

/** Validate email format */
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

/**
 * Invite members via invitationStore.
 */
const inviteMembers = async (
  teamId: string,
  team: ITeam,
  membersToInvite: PendingMember[]
): Promise<InviteResult[]> => {
  const results = await Promise.all(
    membersToInvite.map(async (member): Promise<InviteResult> => {
      if (!isMembershipRole(member.role)) {
        return {
          email: member.email,
          success: false,
          error: new Error("Invalid invitation role."),
        }
      }

      try {
        await invitationStore.sendInvitation({
          teamId,
          teamName: team.name,
          email: member.email,
          role: member.role,
        })
        return { email: member.email, success: true }
      } catch (error) {
        console.error(`Failed to invite ${member.email}:`, error)
        return { email: member.email, success: false, error: error as Error }
      }
    })
  )
  return results
}

/** Show appropriate toast based on invite results */
const showInviteResultToast = (results: InviteResult[]) => {
  const succeeded = results.filter((r) => r.success).length
  const failed = results.length - succeeded

  if (failed === 0) {
    toast.success(
      t("components.teamDialog.toasts.invitedAll", { count: succeeded })
    )
  } else if (succeeded === 0) {
    toast.error(t("components.teamDialog.toasts.inviteFailed"))
  } else {
    toast.warning(
      t("components.teamDialog.toasts.invitePartial", { succeeded, failed })
    )
  }
}

// Resend Invitation State
const resendingIds = ref<Set<string>>(new Set())

const isResending = (id: string) => resendingIds.value.has(id)

const handleResendInvitation = async (invite: IInvitation) => {
  if (!invite.id) return

  resendingIds.value.add(invite.id)
  try {
    await invitationStore.resendInvitation(invite)
    toast.success(t("components.teamDialog.toasts.inviteResent"))
  } catch (error) {
    console.error("Failed to resend invitation:", error)
    toast.error(t("components.teamDialog.toasts.resendFailed"))
  } finally {
    // The old invite is deleted, so we don't strictly need to remove it from the set if the component re-renders quickly,
    // but good practice to clean up.
    // Note: Since the ID changes, the button essentially disappears/is replaced by the new invite row.
    resendingIds.value.delete(invite.id)
  }
}

const handleInvitationRoleChange = async (
  invitationId: string,
  value: unknown
) => {
  if (!isMembershipRole(value)) {
    toast.error(t("components.teamDialog.errors.invalidInvitationRole"))
    return
  }
  const invitation = visibleTeamInvitations.value.find(
    (invite) => invite.id === invitationId
  )
  if (
    !canManageOwnerRoles.value &&
    (value === "owner" || invitation?.role === "owner")
  ) {
    toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
    return
  }
  await invitationStore.updateInvitationRole(invitationId, value)
}

// Actions

const addMember = (e?: Event) => {
  e?.preventDefault()

  const email = inviteEmail.value.trim()
  if (!email) return

  // Validate email format
  if (!isValidEmail(email)) {
    toast.error(t("components.teamDialog.errors.invalidEmail"))
    return
  }

  // Check if email already exists
  if (members.value.some((m) => m.email === email)) {
    toast.error(t("components.teamDialog.errors.emailAlreadyAdded"))
    return
  }

  // Check if email is current user's email
  if (user.value?.email === email) {
    toast.error(t("components.teamDialog.errors.cannotInviteSelf"))
    return
  }

  if (!canManageOwnerRoles.value && inviteRole.value === "owner") {
    toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
    return
  }

  members.value.push({
    email: email,
    role: inviteRole.value,
  })
  inviteEmail.value = ""
  inviteRole.value = defaultTeamRole
}

const removeMember = (email: string, id?: string) => {
  const existingMember = members.value.find((member) =>
    id ? member.id === id : member.email === email
  )
  if (
    existingMember &&
    !canManageOwnerRoles.value &&
    (existingMember.role === "owner" || existingMember.originalRole === "owner")
  ) {
    toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
    return
  }

  if (id) {
    removedMemberIds.value.push(id)
  }
  members.value = members.value.filter((m) => m.email !== email)
}

const isOwnerRoleManagedMember = (member: PendingMember) =>
  member.role === "owner" || member.originalRole === "owner"

const isMemberRoleUpdateDisabled = (member: PendingMember) =>
  !canManageOwnerRoles.value && isOwnerRoleManagedMember(member)

const isMemberRemovalDisabled = (member: PendingMember) =>
  !canManageOwnerRoles.value && isOwnerRoleManagedMember(member)

const isAddMemberBlockedByOwnerPolicy = computed(
  () => !canManageOwnerRoles.value && inviteRole.value === "owner"
)

const addMemberDisabledReason = computed(() => {
  if (!canInviteMembers.value && props.mode !== "create") {
    return t(getCannotInviteMembersReason.value || "")
  }
  if (isAddMemberBlockedByOwnerPolicy.value) {
    return ownerRoleManagementReason.value
  }
  return null
})

const handleSubmit = async () => {
  if (props.mode !== "invite" && !teamName.value.trim()) return

  isLoading.value = true
  try {
    if (props.mode === "create") {
      const trimmedUsername = teamUsername.value.trim()
      let usernamePayload: string | undefined = undefined
      let isPublicPayload: boolean | undefined = undefined

      if (!trimmedUsername) {
        teamUsernameAvailable.value = null
        teamUsernameError.value = null
      } else {
        const validation = validateUsername(trimmedUsername)
        if (!validation.valid || !validation.normalized) {
          teamUsernameAvailable.value = false
          teamUsernameError.value = validation.error || null
          toast.error(t("components.teamDialog.errors.invalidUsername"), {
            description: validation.error || undefined,
          })
          return
        }

        const isAvailable = await checkUsernameAvailability(
          validation.normalized
        )
        teamUsernameAvailable.value = isAvailable
        teamUsernameError.value = isAvailable
          ? null
          : t("components.teamDialog.errors.usernameTaken")
        if (!isAvailable) {
          toast.error(t("components.teamDialog.errors.usernameTaken"))
          return
        }

        usernamePayload = validation.normalized
      }

      if (teamIsPublic.value && !usernamePayload) {
        toast.error(
          t("components.teamDialog.errors.publicTeamRequiresUsername")
        )
        return
      }

      if (teamIsPublic.value) {
        isPublicPayload = true
      }

      // 1. Create Team (useTeamActions handles success toast)
      const newTeamId = await createTeam(teamName.value, {
        photoFile: photoFile.value || undefined,
        username: usernamePayload,
        isPublic: isPublicPayload,
      })

      // 2. Invite Members to New Team
      if (newTeamId && members.value.length > 0) {
        // Construct minimal team object for invitations
        // We cast to ITeam because we know inviteMembers only needs name and id for sending invites
        const newTeam = {
          id: newTeamId,
          name: teamName.value,
        } as ITeam

        const results = await inviteMembers(newTeam.id, newTeam, members.value)
        if (results.some((r) => !r.success)) {
          showInviteResultToast(results)
        }
      }
    } else if (props.mode === "edit" && props.team) {
      // 1. Update Team (useTeamActions handles success toast)
      let filePayload: File | null | undefined = undefined
      if (photoFile.value) {
        filePayload = photoFile.value
      } else if (
        props.team.photoURL &&
        !photoPreview.value &&
        !photoFile.value
      ) {
        filePayload = null // Signal to remove photo
      }

      const trimmedUsername = teamUsername.value.trim()
      let usernamePayload: string | null | undefined = undefined
      let isPublicPayload: boolean | undefined = undefined

      if (!trimmedUsername) {
        if (currentTeamUsername.value) {
          usernamePayload = null
        }
      } else {
        const validation = validateUsername(trimmedUsername)
        if (!validation.valid || !validation.normalized) {
          toast.error(t("components.teamDialog.errors.invalidUsername"), {
            description: validation.error || undefined,
          })
          return
        }

        if (
          teamUsernameAvailable.value === false &&
          !usernamesMatch(validation.normalized, currentTeamUsername.value)
        ) {
          toast.error(t("components.teamDialog.errors.usernameTaken"))
          return
        }

        if (!usernamesMatch(validation.normalized, currentTeamUsername.value)) {
          usernamePayload = validation.normalized
        }
      }

      if (teamIsPublic.value && !trimmedUsername) {
        toast.error(
          t("components.teamDialog.errors.publicTeamRequiresUsername")
        )
        return
      }

      if (teamIsPublic.value !== currentTeamIsPublic.value) {
        isPublicPayload = teamIsPublic.value
      }

      // Keep behavior aligned with user profiles: clearing handle turns off public visibility.
      if (
        usernamePayload === null &&
        isPublicPayload === undefined &&
        currentTeamIsPublic.value
      ) {
        isPublicPayload = false
      }

      await updateTeam(props.team.id, {
        name: teamName.value,
        photoFile: filePayload,
        username: usernamePayload,
        isPublic: isPublicPayload,
      })

      // 2. Process Member Changes
      const membersToUpdate = members.value.filter(
        (m) => m.id && m.role !== m.originalRole
      )
      const newMembers = members.value.filter((m) => !m.id)
      const isRemovingOwners = removedMemberIds.value.some(
        (id) => originalMemberRoles.value[id] === "owner"
      )
      const isChangingOwnerRoles = membersToUpdate.some(
        (member) => member.role === "owner" || member.originalRole === "owner"
      )
      const isInvitingOwners = newMembers.some(
        (member) => member.role === "owner"
      )

      if (
        !canManageOwnerRoles.value &&
        (isRemovingOwners || isChangingOwnerRoles || isInvitingOwners)
      ) {
        toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
        return
      }

      // Remove deleted members
      if (removedMemberIds.value.length > 0) {
        await membershipStore.removeMembers(
          props.team.id,
          removedMemberIds.value
        )
      }

      // Update existing member roles if changed
      if (membersToUpdate.length > 0) {
        const updatePromises = membersToUpdate.map((member) =>
          membershipStore.changeRole(props.team!.id, member.id!, member.role)
        )
        await Promise.all(updatePromises)
      }

      // Invite new members (those without an id)
      if (newMembers.length > 0) {
        const results = await inviteMembers(
          props.team.id,
          props.team,
          newMembers
        )
        if (results.some((r) => !r.success)) {
          showInviteResultToast(results)
        }
      }
    } else if (props.mode === "invite") {
      // Invite Mode
      const targetTeam = props.team
      if (!targetTeam) throw new Error(t("components.teamDialog.errors.noTeam"))
      if (
        !canManageOwnerRoles.value &&
        members.value.some((member) => member.role === "owner")
      ) {
        toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
        return
      }

      if (members.value.length > 0) {
        const results = await inviteMembers(
          targetTeam.id,
          targetTeam,
          members.value
        )
        showInviteResultToast(results)
      }
    }

    emit("success")
    isOpen.value = false
  } catch (error) {
    console.error(error)
    toast.error(
      props.mode === "create"
        ? t("components.teamDialog.errors.failedToCreate")
        : props.mode === "edit"
          ? t("components.teamDialog.errors.failedToUpdate")
          : t("components.teamDialog.errors.failedToInvite"),
      {
        description: (error as Error).message,
      }
    )
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
    <DialogContent class="w-md max-w-fit">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === "create"
              ? t("components.teamDialog.title.create")
              : mode === "edit"
                ? t("components.teamDialog.title.edit")
                : t("components.teamDialog.title.invite")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? t("components.teamDialog.description.create")
              : mode === "edit"
                ? t("components.teamDialog.description.edit")
                : t("components.teamDialog.description.invite")
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Team Profile Picture (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <div class="flex flex-col items-center gap-2">
            <FieldLabel class="text-secondary-foreground text-xs">
              {{ t("components.teamDialog.labels.teamPhoto") }}
            </FieldLabel>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <div
                      :class="{
                        'cursor-not-allowed opacity-50':
                          !canUpdateTeam && mode === 'edit',
                      }"
                    >
                      <Avatar
                        class="size-16"
                        :class="{
                          'cursor-pointer': canUpdateTeam || mode === 'create',
                        }"
                        @click="triggerTeamPhotoSelection"
                      >
                        <AvatarImage
                          class="size-16"
                          :src="photoPreview!"
                          referrerpolicy="no-referrer"
                        />
                        <AvatarFallback class="size-16">
                          {{ getInitials(teamName) }}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent v-if="!canUpdateTeam && mode === 'edit'">
                    {{ t(getCannotUpdateTeamReason || "") }}
                  </TooltipContent>
                  <TooltipContent v-else>
                    {{ t("components.teamDialog.tooltips.uploadPhoto") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip
                  v-if="photoPreview && (canUpdateTeam || mode === 'create')"
                >
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-4 opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon"
                      @click.stop="removePhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.teamDialog.tooltips.removePhoto") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p>
              {{
                photoPreview
                  ? t("components.teamDialog.labels.clickToChange")
                  : t("components.teamDialog.labels.clickToUpload")
              }}
            </p>
          </div>
        </Field>

        <!-- Team Name (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <FieldLabel class="text-secondary-foreground text-xs" for="name">
            {{ t("components.teamDialog.labels.teamName") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Input
                    id="name"
                    v-model="teamName"
                    :placeholder="
                      $t('components.teamDialog.placeholders.teamName')
                    "
                    :disabled="!canUpdateTeam && mode === 'edit'"
                    @keyup.enter="handleSubmit"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canUpdateTeam && mode === 'edit'">
                {{ t(getCannotUpdateTeamReason || "") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!-- Team Public Profile (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <FieldLabel
            class="text-secondary-foreground text-xs"
            for="team-username"
          >
            {{ t("components.teamDialog.labels.publicHandle") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <InputGroup>
                    <InputGroupInput
                      id="team-username"
                      v-model="teamUsername"
                      :placeholder="
                        $t('components.teamDialog.placeholders.publicHandle')
                      "
                      :maxlength="USERNAME_MAX_LENGTH"
                      :disabled="!canUpdateTeam && mode === 'edit'"
                      @input="handleTeamUsernameInput"
                    />
                    <InputGroupAddon align="inline-end">
                      <TooltipProvider>
                        <Tooltip v-if="isCheckingTeamUsername">
                          <TooltipTrigger as-child>
                            <Spinner />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t("settings.account.username.checking") }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip v-else-if="teamUsernameAvailable === true">
                          <TooltipTrigger as-child>
                            <IconCheck class="text-green-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t("settings.account.username.available") }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip v-else-if="teamUsernameAvailable === false">
                          <TooltipTrigger as-child>
                            <IconX class="text-red-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ teamUsernameError }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip v-else>
                          <TooltipTrigger as-child>
                            <IconAtSign />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t("settings.account.username.checkPrompt") }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canUpdateTeam && mode === 'edit'">
                {{ t(getCannotUpdateTeamReason || "") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <p v-if="teamUsernameError" class="text-xs text-red-500">
            {{ teamUsernameError }}
          </p>
        </Field>

        <Field
          v-if="mode === 'create' || mode === 'edit'"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel
              for="team-is-public"
              class="text-secondary-foreground text-xs"
            >
              {{ t("components.teamDialog.labels.publicTeam") }}
            </FieldLabel>
            <FieldDescription class="text-xs">
              {{
                teamIsPublic
                  ? t("components.teamDialog.tooltips.publicTeamUrl", {
                      url: `/${teamUsername.trim()}`,
                    })
                  : t("components.teamDialog.tooltips.turnOnPublicTeam")
              }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <span>
                  <Switch
                    id="team-is-public"
                    :model-value="teamIsPublic"
                    :disabled="
                      !hasValidTeamUsername ||
                      (!canUpdateTeam && mode === 'edit')
                    "
                    @update:model-value="toggleTeamIsPublic"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  !canUpdateTeam && mode === "edit"
                    ? t(getCannotUpdateTeamReason || "")
                    : !hasTeamUsername
                      ? t("components.teamDialog.tooltips.requiresHandle")
                      : teamIsPublic
                        ? t("components.teamDialog.tooltips.publicTeamUrl", {
                            url: `/${teamUsername.trim()}`,
                          })
                        : t("components.teamDialog.tooltips.turnOnPublicTeam")
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!-- 1. MEMBERS SECTION (Active) -->
        <Field v-if="mode === 'edit'" class="grid gap-2">
          <FieldLabel class="text-secondary-foreground text-xs">
            {{ t("components.teamDialog.labels.members") }}
          </FieldLabel>
          <ButtonGroup
            v-for="member in activeMembers"
            :key="member.id"
            class="grow"
          >
            <ButtonGroup class="grow">
              <InputGroup>
                <InputGroupInput :model-value="member.email" disabled />
              </InputGroup>
            </ButtonGroup>
            <ButtonGroup>
              <ButtonGroup>
                <TooltipProvider v-if="isMemberRoleUpdateDisabled(member)">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <div>
                        <Select v-model="member.role" disabled>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="owner">{{
                                t("components.teamDialog.roles.owner")
                              }}</SelectItem>
                              <SelectItem value="admin">{{
                                t("components.teamDialog.roles.admin")
                              }}</SelectItem>
                              <SelectItem value="member">{{
                                t("components.teamDialog.roles.member")
                              }}</SelectItem>
                              <SelectItem value="guest">{{
                                t("components.teamDialog.roles.guest")
                              }}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ ownerRoleManagementReason }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Select v-else v-model="member.role">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        value="owner"
                        :disabled="!canManageOwnerRoles"
                        >{{
                          t("components.teamDialog.roles.owner")
                        }}</SelectItem
                      >
                      <SelectItem value="admin">{{
                        t("components.teamDialog.roles.admin")
                      }}</SelectItem>
                      <SelectItem value="member">{{
                        t("components.teamDialog.roles.member")
                      }}</SelectItem>
                      <SelectItem value="guest">{{
                        t("components.teamDialog.roles.guest")
                      }}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </ButtonGroup>
              <ButtonGroup>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon"
                        :disabled="isMemberRemovalDisabled(member)"
                        @click="removeMember(member.email, member.id)"
                      >
                        <IconTrash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        isMemberRemovalDisabled(member)
                          ? ownerRoleManagementReason
                          : t("components.teamDialog.tooltips.removeMember")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
          </ButtonGroup>
          <p v-if="activeMembers.length === 0">
            {{ t("components.teamDialog.labels.noActiveMembers") }}
          </p>
        </Field>

        <!-- 2. INVITATIONS SECTION -->
        <!-- Invite -->
        <Field class="grid gap-2">
          <!-- 2a. Invite Input + Staged List -->
          <FieldLabel class="text-secondary-foreground text-xs">
            {{ t("components.teamDialog.labels.invite") }}
          </FieldLabel>
          <!-- Input Form -->
          <ButtonGroup class="grow">
            <ButtonGroup class="grow">
              <InputGroup>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <div class="w-full">
                        <InputGroupInput
                          id="invite"
                          v-model="inviteEmail"
                          :placeholder="
                            $t('components.teamDialog.placeholders.email')
                          "
                          type="email"
                          :disabled="!canInviteMembers && mode !== 'create'"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      v-if="!canInviteMembers && mode !== 'create'"
                    >
                      {{ t(getCannotInviteMembersReason || "") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </InputGroup>
            </ButtonGroup>
            <ButtonGroup>
              <ButtonGroup>
                <Select
                  v-model="inviteRole"
                  :disabled="!canInviteMembers && mode !== 'create'"
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        value="owner"
                        :disabled="!canManageOwnerRoles"
                        >{{
                          t("components.teamDialog.roles.owner")
                        }}</SelectItem
                      >
                      <SelectItem value="admin">{{
                        t("components.teamDialog.roles.admin")
                      }}</SelectItem>
                      <SelectItem value="member">{{
                        t("components.teamDialog.roles.member")
                      }}</SelectItem>
                      <SelectItem value="guest">{{
                        t("components.teamDialog.roles.guest")
                      }}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </ButtonGroup>
              <ButtonGroup>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon"
                        :disabled="
                          (!canInviteMembers && mode !== 'create') ||
                          isAddMemberBlockedByOwnerPolicy
                        "
                        @click="addMember"
                      >
                        <IconPlus />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        addMemberDisabledReason ||
                        t("components.teamDialog.tooltips.addMember")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
          </ButtonGroup>
        </Field>

        <!-- Invitations -->
        <Field
          v-if="
            stagedInvites.length > 0 ||
            (canShowTeamInvitations && visibleTeamInvitations.length > 0)
          "
          class="grid gap-2"
        >
          <!-- 2b. Invitations List (Drafts + Sent) -->
          <FieldLabel class="text-secondary-foreground text-xs">
            {{ t("components.teamDialog.labels.invitations") }}
          </FieldLabel>
          <!-- Staged Invites (Drafts) -->
          <ButtonGroup
            v-for="(member, index) in stagedInvites"
            :key="`staged-${index}`"
            class="grow"
          >
            <ButtonGroup class="grow">
              <InputGroup>
                <InputGroupInput
                  v-model="member.email"
                  :placeholder="$t('components.teamDialog.placeholders.email')"
                  type="email"
                />
                <InputGroupAddon align="inline-end">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <InputGroupButton
                          variant="secondary"
                          size="icon-xs"
                          class="text-xs"
                        >
                          <IconCircleDashed />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ t("components.teamDialog.tooltips.draft") }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </InputGroupAddon>
              </InputGroup>
            </ButtonGroup>
            <ButtonGroup>
              <ButtonGroup>
                <Select v-model="member.role">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        value="owner"
                        :disabled="!canManageOwnerRoles"
                        >{{
                          t("components.teamDialog.roles.owner")
                        }}</SelectItem
                      >
                      <SelectItem value="admin">{{
                        t("components.teamDialog.roles.admin")
                      }}</SelectItem>
                      <SelectItem value="member">{{
                        t("components.teamDialog.roles.member")
                      }}</SelectItem>
                      <SelectItem value="guest">{{
                        t("components.teamDialog.roles.guest")
                      }}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </ButtonGroup>
              <ButtonGroup>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon"
                        :disabled="isMemberRemovalDisabled(member)"
                        @click="removeMember(member.email)"
                      >
                        <IconTrash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        isMemberRemovalDisabled(member)
                          ? ownerRoleManagementReason
                          : t("components.teamDialog.tooltips.cancelInvitation")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
          </ButtonGroup>
          <!-- Sent Invitations -->
          <template v-if="canShowTeamInvitations">
            <ButtonGroup
              v-for="invite in visibleTeamInvitations"
              :key="invite.id"
              class="grow"
            >
              <ButtonGroup class="grow">
                <InputGroup>
                  <InputGroupInput
                    :model-value="invite.email"
                    :placeholder="
                      $t('components.teamDialog.placeholders.email')
                    "
                    type="email"
                    disabled
                  />
                  <InputGroupAddon align="inline-end">
                    <TooltipProvider>
                      <Tooltip v-if="invite.status !== 'declined'">
                        <TooltipTrigger as-child>
                          <InputGroupButton
                            size="icon-xs"
                            :disabled="isResending(invite.id!)"
                            @click="handleResendInvitation(invite)"
                          >
                            <Spinner v-if="isResending(invite.id!)" />
                            <IconForward v-else />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{
                            t("components.teamDialog.tooltips.resendInvitation")
                          }}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <InputGroupButton
                            variant="secondary"
                            size="icon-xs"
                            class="text-xs capitalize"
                          >
                            <IconBan v-if="invite.status === 'declined'" />
                            <IconCircle v-else />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{
                            invite.status === "declined"
                              ? t("components.teamDialog.tooltips.declined")
                              : t("components.teamDialog.tooltips.pending")
                          }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </InputGroupAddon>
                </InputGroup>
              </ButtonGroup>
              <ButtonGroup>
                <ButtonGroup>
                  <Select
                    v-model="invite.role"
                    :disabled="
                      invite.status === 'declined' ||
                      (!canManageOwnerRoles && invite.role === 'owner')
                    "
                    @update:model-value="
                      (val) => handleInvitationRoleChange(invite.id!, val)
                    "
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem
                          value="owner"
                          :disabled="
                            !canManageOwnerRoles && invite.role !== 'owner'
                          "
                          >{{
                            t("components.teamDialog.roles.owner")
                          }}</SelectItem
                        >
                        <SelectItem value="admin">{{
                          t("components.teamDialog.roles.admin")
                        }}</SelectItem>
                        <SelectItem value="member">{{
                          t("components.teamDialog.roles.member")
                        }}</SelectItem>
                        <SelectItem value="guest">{{
                          t("components.teamDialog.roles.guest")
                        }}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </ButtonGroup>
                <ButtonGroup>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="outline"
                          size="icon"
                          @click="invitationStore.cancelInvitation(invite.id!)"
                        >
                          <IconTrash />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{
                          t("components.teamDialog.tooltips.cancelInvitation")
                        }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </ButtonGroup>
              </ButtonGroup>
            </ButtonGroup>
          </template>
        </Field>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isLoading">
            {{ t("common.actions.cancel") }}
          </Button>
        </DialogClose>
        <Button
          :disabled="isLoading || (!canUpdateTeam && mode === 'edit')"
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{
            mode === "create"
              ? t("components.teamDialog.actions.create")
              : mode === "edit"
                ? t("components.teamDialog.actions.save")
                : t("components.teamDialog.actions.invite")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

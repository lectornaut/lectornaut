<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconBan,
  IconCircle,
  IconCircleDashed,
  IconForward,
  IconPlus,
  IconTrash,
  IconX,
} from "@/data/icons"
import { defaultTeamRole } from "@/helpers/defaults"
import { getInitials } from "@/helpers/utilities"
import {
  useInvitationStore,
  useTeamInvitations,
  type IInvitation,
} from "@/stores/invitationStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IMembership, IMembershipRole, ITeam } from "@/types"
import { validateImageFile } from "@/utils/imageFile"
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
const { createTeam, updateTeam } = useTeamActions()
const membershipStore = useMembershipStore()
const invitationStore = useInvitationStore()
const user = useCurrentUser()

// State
const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const teamName = ref("")
const inviteEmail = ref("")
const inviteRole = ref<IMembershipRole>(defaultTeamRole)
const members = ref<PendingMember[]>([])
const removedMemberIds = ref<string[]>([])

// Local Invitation Query
const targetTeamId = computed(() => {
  if (props.mode === "create") return null
  return props.team?.id
})

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
  return userRole.value === "owner" || userRole.value === "admin"
})

// Photo Upload State
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)
const {
  files,
  open: openFileDialog,
  reset,
} = useFileDialog({
  accept: "image/*",
  multiple: false,
})

/** Revoke blob URL to prevent memory leaks */
const revokeBlobUrl = () => {
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
}

watch(files, (newFiles) => {
  const file = newFiles?.item(0)
  if (!file) return
  const res = validateImageFile(file)
  if (!res.ok) {
    toast.error(res.message)
    return
  }
  // Revoke previous blob URL to avoid leaks
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
  photoFile.value = file
  photoPreview.value = URL.createObjectURL(file)
})

const removePhoto = () => {
  revokeBlobUrl()
  photoFile.value = null
  photoPreview.value = null
  reset()
}

const resetForm = () => {
  revokeBlobUrl()
  teamName.value = ""
  inviteEmail.value = ""
  inviteRole.value = defaultTeamRole
  members.value = []
  removedMemberIds.value = []
  photoFile.value = null
  photoPreview.value = null
  reset()
}

// Sync internal open state with prop
watch(
  () => props.open,
  (val) => {
    isOpen.value = val ?? false
  }
)

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
        photoPreview.value = props.team.photoURL || null
        // Load existing team members from membershipStore for the specific team
        const teamMembers = await membershipStore.getMembersForTeam(
          props.team.id
        )
        if (teamMembers && teamMembers.length > 0) {
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

  members.value.push({
    email: email,
    role: inviteRole.value,
  })
  inviteEmail.value = ""
  inviteRole.value = defaultTeamRole
}

const removeMember = (email: string, id?: string) => {
  if (id) {
    removedMemberIds.value.push(id)
  }
  members.value = members.value.filter((m) => m.email !== email)
}

const handleSubmit = async () => {
  if (props.mode !== "invite" && !teamName.value.trim()) return

  isLoading.value = true
  try {
    if (props.mode === "create") {
      // 1. Create Team (useTeamActions handles success toast)
      const newTeamId = await createTeam(
        teamName.value,
        photoFile.value || undefined
      )

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

      await updateTeam(props.team.id, {
        name: teamName.value,
        photoFile: filePayload,
      })

      // 2. Process Member Changes
      // Remove deleted members
      if (removedMemberIds.value.length > 0) {
        await membershipStore.removeMembers(
          props.team.id,
          removedMemberIds.value
        )
      }

      // Update existing member roles if changed
      const membersToUpdate = members.value.filter(
        (m) => m.id && m.role !== m.originalRole
      )
      if (membersToUpdate.length > 0) {
        const updatePromises = membersToUpdate.map((member) =>
          membershipStore.changeRole(props.team!.id, member.id!, member.role)
        )
        await Promise.all(updatePromises)
      }

      // Invite new members (those without an id)
      const newMembers = members.value.filter((m) => !m.id)
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
        ? "Failed to create team"
        : props.mode === "edit"
          ? "Failed to update team"
          : "Failed to invite members",
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
                    <Avatar
                      class="size-16 rounded-md"
                      @click="
                        openFileDialog({ accept: 'image/*', multiple: false })
                      "
                    >
                      <AvatarImage
                        class="size-16 rounded-md"
                        :src="photoPreview!"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback class="size-16 rounded-md">
                        {{ getInitials(teamName) }}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.teamDialog.tooltips.uploadPhoto") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip v-if="photoPreview">
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-5 rounded-full opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon-sm"
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
            <p class="text-muted-foreground text-xs">
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
          <Input
            id="name"
            v-model="teamName"
            placeholder="Acme Inc."
            @keyup.enter="handleSubmit"
          />
        </Field>

        <!-- 1. MEMBERS SECTION (Active) -->
        <Field v-if="mode === 'edit'" class="grid gap-2">
          <FieldLabel class="text-secondary-foreground text-xs">
            {{ t("components.teamDialog.labels.members") }}
          </FieldLabel>
          <ButtonGroup
            v-for="member in activeMembers"
            :key="member.id"
            class="flex-1"
          >
            <ButtonGroup class="flex-1">
              <InputGroup>
                <InputGroupInput :model-value="member.email" disabled />
              </InputGroup>
            </ButtonGroup>
            <ButtonGroup>
              <ButtonGroup>
                <Select v-model="member.role">
                  <SelectTrigger class="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
                        @click="removeMember(member.email, member.id)"
                      >
                        <IconTrash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.teamDialog.tooltips.removeMember") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
          </ButtonGroup>
          <p
            v-if="activeMembers.length === 0"
            class="text-muted-foreground text-xs"
          >
            No active members found.
          </p>
        </Field>

        <!-- 2. INVITATIONS SECTION -->
        <!-- Invite -->
        <Field class="grid gap-2">
          <!-- 2a. Invite Input + Staged List -->
          <FieldLabel class="text-secondary-foreground text-xs">
            Invite
          </FieldLabel>
          <!-- Input Form -->
          <ButtonGroup class="flex-1">
            <ButtonGroup class="flex-1">
              <InputGroup>
                <InputGroupInput
                  id="invite"
                  v-model="inviteEmail"
                  placeholder="user@example.com"
                  type="email"
                />
              </InputGroup>
            </ButtonGroup>
            <ButtonGroup>
              <ButtonGroup>
                <Select v-model="inviteRole">
                  <SelectTrigger class="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
                  </SelectContent>
                </Select>
              </ButtonGroup>
              <ButtonGroup>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="outline" size="icon" @click="addMember">
                        <IconPlus />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.teamDialog.tooltips.addMember") }}
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
            (mode === 'edit' &&
              isPrivileged &&
              teamInvitations &&
              teamInvitations.length > 0)
          "
          class="grid gap-2"
        >
          <!-- 2b. Invitations List (Drafts + Sent) -->
          <FieldLabel class="text-secondary-foreground text-xs">
            Invitations
          </FieldLabel>
          <!-- Staged Invites (Drafts) -->
          <ButtonGroup
            v-for="(member, index) in stagedInvites"
            :key="`staged-${index}`"
            class="flex-1"
          >
            <ButtonGroup class="flex-1">
              <InputGroup>
                <InputGroupInput
                  v-model="member.email"
                  placeholder="Email"
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
                  <SelectTrigger class="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
                        @click="removeMember(member.email)"
                      >
                        <IconTrash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.teamDialog.tooltips.cancelInvitation") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
          </ButtonGroup>
          <!-- Sent Invitations (Edit Mode Only) -->
          <template v-if="mode === 'edit' && isPrivileged">
            <ButtonGroup
              v-for="invite in teamInvitations"
              :key="invite.id"
              class="flex-1"
            >
              <ButtonGroup class="flex-1">
                <InputGroup>
                  <InputGroupInput
                    :model-value="invite.email"
                    placeholder="Email"
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
                    :disabled="invite.status === 'declined'"
                    @update:model-value="
                      (val) =>
                        invitationStore.updateInvitationRole(
                          invite.id!,
                          val as IMembershipRole
                        )
                    "
                  >
                    <SelectTrigger class="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
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
          <Button variant="outline">
            {{ t("actions.cancel") }}
          </Button>
        </DialogClose>
        <Button
          :disabled="
            isLoading ||
            (mode !== 'invite' && !teamName.trim()) ||
            (mode === 'invite' && members.length === 0)
          "
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{
            mode === "create"
              ? t("components.teamDialog.buttons.createTeam")
              : mode === "edit"
                ? t("components.teamDialog.buttons.saveChanges")
                : t("components.teamDialog.buttons.inviteMembers", {
                    count: members.length,
                  })
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { IconPlus, IconTrash, IconX } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type { IMembership, IMembershipRole, ITeam } from "@/types"
import { toast } from "vue-sonner"

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

const teamStore = useTeamStore()
const membershipStore = useMembershipStore()

const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const teamName = ref("")
const inviteEmail = ref("")
const inviteRole = ref<IMembershipRole>("member")
const members = ref<{ email: string; role: IMembershipRole; id?: string }[]>([])
const removedMemberIds = ref<string[]>([])

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

watch(files, (newFiles) => {
  if (newFiles && newFiles.length > 0) {
    const file = newFiles.item(0)
    if (file) {
      photoFile.value = file
      photoPreview.value = URL.createObjectURL(file)
    }
  }
})

const removePhoto = () => {
  if (photoPreview.value && photoPreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
  photoFile.value = null
  photoPreview.value = null
  reset()
}

const resetForm = () => {
  if (photoPreview.value && photoPreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
  teamName.value = ""
  inviteEmail.value = ""
  inviteRole.value = "member"
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
      teamName.value = props.team.name
      photoPreview.value = props.team.photoURL || null
      // Load existing team members from membershipStore
      const teamMembers = membershipStore.teamMembers
      if (teamMembers && teamMembers.length > 0) {
        members.value = teamMembers.map((membership: IMembership) => ({
          email: membership.user.email!,
          role: membership.role,
          id: membership.userId,
        }))
      }
    }
  }
})

const addMember = (e?: Event) => {
  e?.preventDefault()

  const email = inviteEmail.value.trim()
  if (!email) return

  // Check if email already exists
  if (members.value.some((m) => m.email === email)) {
    toast.error("Email already added")
    return
  }

  members.value.push({
    email: email,
    role: inviteRole.value,
  })
  inviteEmail.value = ""
  inviteRole.value = "member"
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
      // 1. Create Team
      await teamStore.createTeam(teamName.value, photoFile.value || undefined)
      toast.success("Team created successfully")
    } else if (props.mode === "edit" && props.team) {
      // Update Team
      // If photoFile is set, we upload it.
      // If photoPreview is null but we had a photo, it means we removed it.
      // However, my logic for removePhoto sets photoFile to null and preview to null.
      // If I want to support removing the photo, I need to distinguish between "no change" and "remove".
      // Current logic:
      // - If photoFile is present -> Upload new photo
      // - If photoFile is null AND photoPreview is null AND props.team.photoURL is present -> Remove photo
      // - Else -> No change to photo

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

      await teamStore.updateTeam(props.team.id, {
        name: teamName.value,
        photoFile: filePayload,
      })
      toast.success("Team updated successfully")
    }

    // 2. Process Member Changes
    if (props.mode === "edit") {
      // Remove deleted members
      if (removedMemberIds.value.length > 0 && props.team) {
        await membershipStore.removeMembers(
          props.team.id,
          removedMemberIds.value
        )
      }
      // Invite new members (those without an id)
      const newMembers = members.value.filter((m) => !m.id)
      if (newMembers.length > 0) {
        const currentTeam = teamStore.currentTeam
        if (!currentTeam) throw new Error("No current team")
        const invitePromises = newMembers.map((member) =>
          membershipStore
            .inviteMember(
              currentTeam.id,
              currentTeam,
              member.email,
              member.role
            )
            .catch((e: Error) =>
              console.error(`Failed to invite ${member.email}:`, e)
            )
        )
        await Promise.all(invitePromises)
      }
    } else if (members.value.length > 0) {
      // For create and invite modes, invite all members
      const currentTeam = teamStore.currentTeam
      if (!currentTeam) throw new Error("No current team")
      const invitePromises = members.value.map((member) =>
        membershipStore
          .inviteMember(currentTeam.id, currentTeam, member.email, member.role)
          .catch((e: Error) =>
            console.error(`Failed to invite ${member.email}:`, e)
          )
      )
      await Promise.all(invitePromises)
      if (props.mode === "invite") {
        toast.success(`Invited ${members.value.length} members`)
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
        <div v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <div class="flex flex-col items-center gap-2">
            <Label class="text-secondary-foreground text-xs">
              {{ t("components.teamDialog.labels.teamPhoto") }}
            </Label>
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
        </div>

        <!-- Team Name (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'">
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

        <!-- Invite/Manage Members -->
        <form @submit="addMember">
          <Field>
            <FieldLabel class="text-secondary-foreground text-xs">
              {{ t("components.teamDialog.labels.inviteMembers") }}
            </FieldLabel>
            <ButtonGroup class="w-full">
              <ButtonGroup class="flex-1">
                <Input
                  id="invite"
                  v-model="inviteEmail"
                  placeholder="email@example.com"
                  type="email"
                  required
                />
              </ButtonGroup>
              <ButtonGroup>
                <Select v-model="inviteRole">
                  <SelectTrigger class="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">{{
                      t("components.teamDialog.roles.owner")
                    }}</SelectItem>
                    <SelectItem value="member">{{
                      t("components.teamDialog.roles.member")
                    }}</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" type="submit">
                  <IconPlus />
                </Button>
              </ButtonGroup>
            </ButtonGroup>
          </Field>
        </form>

        <!-- Pending Members List -->
        <Field v-if="members.length > 0">
          <FieldLabel class="text-secondary-foreground text-xs">
            {{
              mode === "edit"
                ? t("components.teamDialog.labels.members")
                : t("components.teamDialog.labels.sendInvites")
            }}
          </FieldLabel>
          <ButtonGroup
            v-for="(member, index) in members"
            :key="index"
            class="w-full"
          >
            <ButtonGroup class="flex-1">
              <Input
                v-model="member.email"
                type="email"
                required
                :disabled="mode === 'edit' && member.id"
              />
            </ButtonGroup>
            <ButtonGroup>
              <Select v-model="member.role">
                <SelectTrigger class="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">{{
                    t("components.teamDialog.roles.owner")
                  }}</SelectItem>
                  <SelectItem value="member">{{
                    t("components.teamDialog.roles.member")
                  }}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                @click="removeMember(member.email, member.id)"
              >
                <IconTrash />
              </Button>
            </ButtonGroup>
          </ButtonGroup>
        </Field>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline">{{ t("actions.cancel") }}</Button>
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

<script lang="ts" setup>
import { IconX } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { useTeamStore } from "@/stores/teamStore"
import type { ITeam } from "@/types"
import { useFileDialog } from "@vueuse/core"
import { ref, watch } from "vue"
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

const teamStore = useTeamStore()

const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const teamName = ref("")
const inviteEmail = ref("")
const inviteRole = ref<"owner" | "member">("member")
const pendingInvites = ref<{ email: string; role: "owner" | "member" }[]>([])

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

watch(isOpen, (val) => {
  emit("update:open", val)
  if (!val) {
    // Reset form when closed
    setTimeout(() => {
      teamName.value = ""
      inviteEmail.value = ""
      inviteRole.value = "member"
      pendingInvites.value = []
      photoFile.value = null
      photoPreview.value = null
      reset()
    }, 300)
  } else {
    // Initialize form when opened
    if (props.mode === "edit" && props.team) {
      teamName.value = props.team.name
      photoPreview.value = props.team.photoURL || null
    }
  }
})

const addPendingInvite = () => {
  if (!inviteEmail.value.trim()) return
  if (!pendingInvites.value.some((i) => i.email === inviteEmail.value.trim())) {
    pendingInvites.value.push({
      email: inviteEmail.value.trim(),
      role: inviteRole.value,
    })
  }
  inviteEmail.value = ""
  inviteRole.value = "member"
}

const removePendingInvite = (email: string) => {
  pendingInvites.value = pendingInvites.value.filter((i) => i.email !== email)
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

    // 2. Process Invites (for create and invite modes)
    if (props.mode !== "edit" && pendingInvites.value.length > 0) {
      const invitePromises = pendingInvites.value.map((invite) =>
        teamStore
          .inviteMember(invite.email, invite.role)
          .catch((e) => console.error(`Failed to invite ${invite.email}:`, e))
      )
      await Promise.all(invitePromises)
      if (props.mode === "invite") {
        toast.success(`Invited ${pendingInvites.value.length} members`)
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
    <DialogContent class="w-sm max-w-fit">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === "create"
              ? "Create Team"
              : mode === "edit"
                ? "Rename Team"
                : "Invite Members"
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? "Add a new team to manage products and customers."
              : mode === "edit"
                ? "Update your team name and profile picture."
                : "Invite new members to your team."
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Team Profile Picture (Create/Edit Mode) -->
        <div
          v-if="mode === 'create' || mode === 'edit'"
          class="flex flex-col items-center gap-2"
        >
          <div class="group relative">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Avatar
                    class="size-16 cursor-pointer"
                    @click="
                      openFileDialog({ accept: 'image/*', multiple: false })
                    "
                  >
                    <AvatarImage
                      v-if="photoPreview"
                      :src="photoPreview"
                      class="object-cover"
                    />
                    <AvatarFallback>
                      {{ getInitials(teamName || "T") }}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent> Upload team photo </TooltipContent>
              </Tooltip>
              <div
                v-if="photoPreview"
                class="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="destructive"
                      size="icon"
                      class="size-6 rounded-full p-0"
                      @click.stop="removePhoto"
                    >
                      <IconX class="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> Remove team photo </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
          <p class="text-muted-foreground text-xs">
            {{ photoPreview ? "Click to change" : "Click to upload logo" }}
          </p>
        </div>

        <!-- Team Name (Create/Edit Mode) -->
        <div v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <Label class="text-secondary-foreground text-xs" for="name">
            Team name
          </Label>
          <Input
            id="name"
            v-model="teamName"
            placeholder="Acme Inc."
            @keyup.enter="handleSubmit"
          />
        </div>

        <!-- Invite Members (Create/Invite Mode Only) -->
        <div v-if="mode !== 'edit'" class="grid gap-2">
          <Label class="text-secondary-foreground text-xs" for="invite">
            {{ mode === "create" ? "Invite members" : "Email address" }}
          </Label>
          <div class="flex gap-2">
            <Input
              id="invite"
              v-model="inviteEmail"
              placeholder="email@example.com"
              class="flex-1"
              @keyup.enter="addPendingInvite"
            />
            <Select v-model="inviteRole">
              <SelectTrigger class="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" type="button" @click="addPendingInvite">
              Add
            </Button>
          </div>

          <!-- Pending Invites List -->
          <div
            v-if="pendingInvites.length > 0"
            class="mt-2 flex flex-wrap gap-2"
          >
            <div
              v-for="invite in pendingInvites"
              :key="invite.email"
              class="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-md px-2 py-1 text-xs"
            >
              <span>{{ invite.email }}</span>
              <span class="text-muted-foreground text-[10px] uppercase">
                ({{ invite.role }})
              </span>
              <button
                class="hover:text-destructive"
                @click="removePendingInvite(invite.email)"
              >
                <IconX class="size-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          :disabled="
            isLoading ||
            (mode !== 'invite' && !teamName.trim()) ||
            (mode === 'invite' && pendingInvites.length === 0)
          "
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{
            mode === "create"
              ? "Create Team"
              : mode === "edit"
                ? "Save Changes"
                : `Invite ${pendingInvites.length > 0 ? pendingInvites.length : ""} Member${pendingInvites.length !== 1 ? "s" : ""}`
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { IconX } from "@/data/icons"
import { useTeamStore } from "@/stores/teamStore"
import type { ITeam } from "@/types"
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
    }, 300)
  } else {
    // Initialize form when opened
    if (props.mode === "edit" && props.team) {
      teamName.value = props.team.name
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
      await teamStore.createTeam(teamName.value)
      toast.success("Team created successfully")
    } else if (props.mode === "edit" && props.team) {
      // Update Team Name
      await teamStore.updateTeamName(props.team.id, teamName.value)
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
                ? "Update your team name."
                : "Invite new members to your team."
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
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

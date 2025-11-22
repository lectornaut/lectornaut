<script lang="ts" setup>
import {
  IconBxsZap,
  IconCheck,
  IconChevronDown,
  IconCirclePlus,
  IconSettings,
  IconUsers,
  IconUsersRound,
  IconX,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useTeamStore } from "@/stores/teamStore"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"

const online = useOnline()
const teamStore = useTeamStore()
const { currentTeam, memberships, isLoading } = storeToRefs(teamStore)

const newTeamName = ref("")
const isCreating = ref(false)
const inviteEmail = ref("")
const pendingInvites = ref<string[]>([])

// Group memberships for the dropdown
const groups = computed(() => [
  {
    label: "My Teams",
    teams: memberships.value.map((m) => ({
      label: m.team.name,
      value: m.team.id,
      original: m.team,
    })),
  },
])

const activeTeamLabel = computed(() => currentTeam.value?.name || "Select Team")
const activeTeamValue = computed(() => currentTeam.value?.id || "")

const handleSwitchTeam = (teamId: string) => {
  teamStore.switchTeam(teamId)
}

const addPendingInvite = () => {
  if (!inviteEmail.value.trim()) return
  if (!pendingInvites.value.includes(inviteEmail.value.trim())) {
    pendingInvites.value.push(inviteEmail.value.trim())
  }
  inviteEmail.value = ""
}

const removePendingInvite = (email: string) => {
  pendingInvites.value = pendingInvites.value.filter((e) => e !== email)
}

const handleCreateTeam = async () => {
  if (!newTeamName.value.trim()) return
  isCreating.value = true
  try {
    // 1. Create Team
    await teamStore.createTeam(newTeamName.value)

    // 2. Process Invites
    if (pendingInvites.value.length > 0) {
      // We need to wait for the team switch to propagate or ensure we are inviting to the *newly created* team.
      // teamStore.createTeam switches the current team.
      // However, inviteMember uses `currentTeam`.
      // Let's assume createTeam sets currentTeam correctly before returning or we might need to pass teamId if we refactor inviteMember.
      // Based on my implementation of createTeam, it does `currentTeam.value = newTeam` optimistically and via transaction.

      // Process all invites
      const invitePromises = pendingInvites.value.map((email) =>
        teamStore
          .inviteMember(email)
          .catch((e) => console.error(`Failed to invite ${email}:`, e))
      )
      await Promise.all(invitePromises)
    }

    newTeamName.value = ""
    pendingInvites.value = []
    inviteEmail.value = ""
  } catch (error) {
    console.error(error)
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            id="tour-team-switcher"
            variant="ghost"
            class="data-[state=open]:bg-accent"
          >
            <Avatar class="size-4">
              <AvatarImage
                :src="`https://avatar.vercel.sh/${activeTeamValue}.png`"
                :alt="activeTeamLabel"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback>
                {{ getInitials(activeTeamLabel) }}
              </AvatarFallback>
            </Avatar>
            <span
              v-if="!online"
              class="bg-muted text-muted-foreground flex items-center gap-1 rounded-full border px-1.5 py-0.5"
            >
              <IconBxsZap />
              Offline
            </span>
            <span v-else class="hidden md:flex">
              {{ activeTeamLabel }}
            </span>
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-48" align="center">
          <DropdownMenuGroup>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'general')"
            >
              <IconSettings />
              Settings
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'members')"
            >
              <IconUsers />
              Members
              <DropdownMenuShortcut>⇧⌘M</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuItem as-child>
                <DropdownMenuSubTrigger>
                  <IconUsersRound />
                  Switch team
                </DropdownMenuSubTrigger>
              </DropdownMenuItem>
              <DropdownMenuSubContent class="w-48" align="start">
                <DropdownMenuGroup
                  v-if="isLoading"
                  class="flex justify-center py-2"
                >
                  <Spinner />
                </DropdownMenuGroup>
                <DropdownMenuGroup
                  v-else
                  v-for="group in groups"
                  :key="group.label"
                  :heading="group.label"
                >
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    {{ group.label }}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="team in group.teams"
                    :key="team.value"
                    @click="handleSwitchTeam(team.value)"
                  >
                    <Avatar class="size-4">
                      <AvatarImage
                        :src="`https://avatar.vercel.sh/${team.value}.png`"
                        referrerpolicy="no-referrer"
                        :alt="team.label"
                      />
                      <AvatarFallback>
                        {{ getInitials(team.label) }}
                      </AvatarFallback>
                    </Avatar>
                    {{ team.label }}
                    <IconCheck
                      v-if="activeTeamValue === team.value"
                      class="ml-auto"
                    />
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DialogTrigger as-child>
                    <DropdownMenuItem>
                      <IconCirclePlus />
                      Create team
                    </DropdownMenuItem>
                  </DialogTrigger>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DialogContent class="w-sm max-w-fit">
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
          <DialogDescription>
            Add a new team to manage products and customers.
          </DialogDescription>
        </DialogHeader>
        <div class="mt-4 grid gap-4">
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="name">
              Team name
            </Label>
            <Input
              id="name"
              v-model="newTeamName"
              placeholder="Acme Inc."
              @keyup.enter="handleCreateTeam"
            />
          </div>

          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="invite">
              Invite members
            </Label>
            <div class="flex gap-2">
              <Input
                id="invite"
                v-model="inviteEmail"
                placeholder="email@example.com"
                @keyup.enter="addPendingInvite"
              />
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
                v-for="email in pendingInvites"
                :key="email"
                class="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              >
                <span>{{ email }}</span>
                <button
                  class="hover:text-destructive"
                  @click="removePendingInvite(email)"
                >
                  <IconX class="size-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline"> Cancel </Button>
          </DialogClose>
          <DialogClose as-child>
            <Button
              type="submit"
              :disabled="!newTeamName.trim() || isCreating"
              @click="handleCreateTeam"
            >
              {{ isCreating ? "Creating..." : "Continue" }}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

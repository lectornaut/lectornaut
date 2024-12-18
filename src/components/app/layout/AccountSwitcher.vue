<script setup lang="ts">
import { getInitials } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import type { User } from "firebase/auth"
import type { c } from "node_modules/vuefire/dist/shared/vuefire.cc4a8ea4.mjs"
import { useCurrentUser } from "vuefire"

const online = useOnline()

const user = useCurrentUser()

const generateGroups = (user: c<User>) => [
  {
    label: "Personal Account",
    teams: [
      {
        label: user?.displayName || "Personal",
        value: "personal",
      },
    ],
  },
  {
    label: "Teams",
    teams: [
      { label: "Acme Inc.", value: "acme-inc" },
      { label: "Monsters Inc.", value: "monsters" },
    ],
  },
]

const groups = computed(() => generateGroups(user.value))

type Team = { label: string; value: string }

const openAccountSwitcher = ref(false)
const showNewTeamDialog = ref(false)
const selectedTeam = ref<Team>(
  groups.value[0]?.teams[0] || { label: "", value: "" }
)
</script>

<template>
  <div class="flex items-center justify-between gap-2 p-2">
    <Dialog v-model:open="showNewTeamDialog">
      <Popover v-model:open="openAccountSwitcher">
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            class="gap-3 truncate data-[state=open]:bg-muted"
          >
            <Avatar class="size-4">
              <AvatarImage
                :src="selectedTeam.value === 'personal' ? user?.photoURL! : ''"
                referrerpolicy="no-referrer"
                :alt="selectedTeam.label"
              />
              <AvatarFallback>
                {{ getInitials(selectedTeam.label) }}
              </AvatarFallback>
            </Avatar>
            <span
              v-if="!online"
              v-motion-fade
              class="flex items-center gap-1 rounded-full border bg-muted px-1.5 py-0.5 text-muted-foreground"
            >
              <icon-bx-bxs-zap />
              Offline
            </span>
            <span v-else v-motion-fade class="truncate">
              {{
                selectedTeam.value === "personal"
                  ? user?.displayName
                  : selectedTeam.label
              }}
            </span>
            <icon-lucide-chevron-down />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search team..."
              class="border-none focus:border-inherit focus:ring-0"
            />
            <CommandList>
              <CommandEmpty>No team found.</CommandEmpty>
              <CommandGroup
                v-for="group in groups"
                :key="group.label"
                :heading="group.label"
              >
                <CommandItem
                  v-for="team in group.teams"
                  :key="team.value"
                  :value="team.label"
                  class="grow justify-start gap-3 truncate"
                  @select="
                    () => {
                      selectedTeam = team
                      openAccountSwitcher = false
                    }
                  "
                >
                  <Avatar class="size-4">
                    <AvatarImage
                      :src="team.value === 'personal' ? user?.photoURL! : ''"
                      referrerpolicy="no-referrer"
                      :alt="team.label"
                    />
                    <AvatarFallback>
                      {{ getInitials(team.label) }}
                    </AvatarFallback>
                  </Avatar>
                  <span class="truncate">
                    {{ team.label }}
                  </span>
                  <icon-lucide-check
                    v-if="selectedTeam.value === team.value"
                    class="ml-auto"
                  />
                </CommandItem>
              </CommandGroup>
            </CommandList>
            <CommandSeparator />
            <CommandList>
              <CommandGroup>
                <DialogTrigger as-child>
                  <CommandItem
                    value="create-team"
                    class="grow justify-start gap-3 truncate"
                    @select="
                      () => {
                        openAccountSwitcher = false
                        showNewTeamDialog = true
                      }
                    "
                  >
                    <icon-lucide-plus-circle />
                    Create Team
                  </CommandItem>
                </DialogTrigger>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
          <DialogDescription>
            Add a new team to manage products and customers.
          </DialogDescription>
        </DialogHeader>
        <div>
          <div class="space-y-4 py-2 pb-4">
            <div class="space-y-2">
              <Label for="name">Team name</Label>
              <Input
                id="name"
                placeholder="Acme Inc."
                class="focus:border-inherit focus:ring-0"
              />
            </div>
            <div class="space-y-2">
              <Label for="plan">Subscription plan</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">
                    <span class="font-medium">Free</span> -
                    <span class="text-muted-foreground">
                      Trial for two weeks
                    </span>
                  </SelectItem>
                  <SelectItem value="pro">
                    <span class="font-medium">Pro</span> -
                    <span class="text-muted-foreground">
                      $9/month per user
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showNewTeamDialog = false">
            Cancel
          </Button>
          <Button type="submit"> Continue </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div class="flex justify-end gap-2">
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="text-muted-foreground data-[state=open]:bg-muted"
                >
                  <icon-lucide-bolt />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent> Settings </TooltipContent>
            <DropdownMenuContent class="w-48" align="start">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem class="gap-2">
                  <icon-lucide-user />
                  <span>Profile</span>
                  <DropdownMenuShortcut>⇧ ⌘ P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="gap-2"
                  @click="emitter.emit('Dialog.Settings.Open')"
                >
                  <icon-lucide-settings />
                  <span>Preferences</span>
                  <DropdownMenuShortcut>⌘ ,</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  class="gap-2"
                  @click="emitter.emit('Dialog.Exit.Open')"
                >
                  <icon-lucide-log-out />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="text-muted-foreground"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-lucide-chevrons-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Collapse Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>

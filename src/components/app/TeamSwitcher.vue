<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()

const groups = computed(() => [
  {
    label: "Personal Account",
    teams: [
      {
        label: user.value?.displayName || "Personal",
        value: "personal",
      },
    ],
  },
  {
    label: "Teams",
    teams: [
      {
        label: "Acme Inc.",
        value: "acme-inc",
      },
      {
        label: "Monsters Inc.",
        value: "monsters",
      },
    ],
  },
])

type Team = (typeof groups.value)[number]["teams"][number]

const openAccountSwitcher = ref(false)
const showNewTeamDialog = ref(false)
const selectedTeam = ref<Team>(
  groups.value[0]?.teams[0] ?? { label: "", value: "" }
)
</script>

<template>
  <div
    class="flex gap-2 p-2"
    :class="isTauri ? 'flex-col-reverse' : 'items-center'"
  >
    <Dialog v-model:open="showNewTeamDialog">
      <Popover v-model:open="openAccountSwitcher">
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            class="grow justify-start gap-3 truncate data-[state=open]:bg-muted"
            size="xs"
          >
            <Avatar class="h-4 w-4">
              <AvatarImage
                :src="
                  selectedTeam.value === 'personal'
                    ? user?.photoURL!
                    : `https://avatar.vercel.sh/${selectedTeam.value}.png`
                "
                referrerpolicy="no-referrer"
                :alt="selectedTeam.label"
              />
              <AvatarFallback>{{ selectedTeam.label }}</AvatarFallback>
            </Avatar>
            <span class="truncate">{{ selectedTeam.label }}</span>
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
                  <Avatar class="h-4 w-4">
                    <AvatarImage
                      :src="
                        team.value === 'personal'
                          ? user?.photoURL!
                          : `https://avatar.vercel.sh/${selectedTeam.value}.png`
                      "
                      referrerpolicy="no-referrer"
                      :alt="team.label"
                    />
                    <AvatarFallback>{{ team.label }}</AvatarFallback>
                  </Avatar>
                  <span class="truncate">{{ team.label }}</span>
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
    <div data-tauri-drag-region class="flex justify-end">
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="xs"
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
              size="xs"
              class="text-muted-foreground"
              @click="emitter.emit('Sidebar.Left.Toggle')"
            >
              <icon-lucide-panel-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Collapse Sidebar </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>

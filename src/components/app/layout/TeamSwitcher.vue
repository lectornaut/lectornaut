<script setup lang="ts">
import { getInitials } from "@/helpers/utilities"

const online = useOnline()

const groups = [
  {
    label: "Personal Account",
    teams: [
      {
        label: "Alicia Koch",
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
]

type Team = (typeof groups)[number]["teams"][number]

const openTeamSwitcher = ref(false)
const showNewTeamDialog = ref(false)
const selectedTeam = ref<Team>(
  groups[0]?.teams[0] ?? { label: "Default Team", value: "default" }
)

type User = {
  name: string
  email: string
  avatar: string
}

const users = ref<User[]>([
  {
    name: "Tom",
    email: "t@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Whitney",
    email: "w@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Leonard",
    email: "l@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Floyd",
    email: "f@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Emily",
    email: "e@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
])

const selectedUsers = ref<User[]>([])
</script>

<template>
  <div data-tauri-drag-region class="flex items-center justify-between gap-2">
    <Dialog v-model:open="showNewTeamDialog">
      <Popover v-model:open="openTeamSwitcher">
        <PopoverTrigger as-child>
          <Button
            id="tour-team-switcher"
            variant="ghost"
            class="data-[state=open]:bg-accent"
          >
            <Avatar class="size-4">
              <AvatarImage
                :src="`https://avatar.vercel.sh/${selectedTeam.value}.png`"
                :alt="selectedTeam.label"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback>
                {{ getInitials(selectedTeam.label) }}
              </AvatarFallback>
            </Avatar>
            <span
              v-if="!online"
              v-motion-fade
              class="bg-muted text-muted-foreground flex items-center gap-1 rounded-full border px-1.5 py-0.5"
            >
              <icon-bx-bxs-zap />
              Offline
            </span>
            <span v-else v-motion-fade>
              {{ selectedTeam.label }}
            </span>
            <icon-lucide-chevron-down />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="center">
          <Command>
            <CommandInput
              placeholder="Search team..."
              class="border-none p-0 focus:border-inherit focus:ring-0"
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
                  :value="team"
                  class="py-2"
                  @select="
                    () => {
                      selectedTeam = team
                      openTeamSwitcher = false
                    }
                  "
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
                  <span>
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
                    class="py-2"
                    @select="
                      () => {
                        showNewTeamDialog = true
                        openTeamSwitcher = false
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
              placeholder="Acme Inc."
              class="focus:border-inherit focus:ring-0"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="members">
              People with access
            </Label>
          </div>
          <div class="grid rounded-md border">
            <Popover>
              <Command>
                <PopoverTrigger>
                  <CommandInput
                    placeholder="Search for agents or add people by email"
                    class="border-none p-0 focus:border-inherit focus:ring-0"
                  />
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" class="w-xs p-0">
                  <CommandList>
                    <CommandEmpty>No users found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        v-for="user in users"
                        :key="user.email"
                        :value="user"
                        class="py-2"
                        @select="
                          () => {
                            if (!selectedUsers.includes(user)) {
                              selectedUsers.push(user)
                            } else {
                              selectedUsers.splice(
                                selectedUsers.indexOf(user),
                                1
                              )
                            }
                          }
                        "
                      >
                        <Avatar>
                          <AvatarImage :src="user.avatar" alt="Image" />
                          <AvatarFallback>{{ user.name[0] }}</AvatarFallback>
                        </Avatar>
                        <div class="ml-2">
                          <p class="text-sm leading-none font-medium">
                            {{ user.name }}
                          </p>
                          <p class="text-muted-foreground text-sm">
                            {{ user.email }}
                          </p>
                        </div>
                        <icon-lucide-circle-check-big
                          v-if="selectedUsers.includes(user)"
                          class="ml-auto"
                        />
                        <icon-lucide-circle v-else class="ml-auto" />
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </PopoverContent>
              </Command>
            </Popover>
            <div v-if="selectedUsers.length" class="grid gap-4 p-4">
              <div
                v-for="person in selectedUsers"
                :key="person.email"
                class="flex justify-between space-x-4"
              >
                <div class="flex gap-3">
                  <Avatar>
                    <AvatarImage
                      class="inline-block size-8 rounded-full"
                      :src="person.avatar"
                      :alt="person.name"
                    />
                    <AvatarFallback>
                      {{ person.name[0] }}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p class="font-medium">
                      {{ person.name }}
                    </p>
                    <p class="text-muted-foreground text-xs">
                      {{ person.email }}
                    </p>
                  </div>
                </div>
                <Select default-value="edit">
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent align="end" side="bottom">
                    <SelectItem value="edit"> Edit </SelectItem>
                    <SelectItem value="view"> View </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div
              v-if="!selectedUsers.length"
              class="text-muted-foreground flex items-center justify-center p-4 text-sm"
            >
              No users selected
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
  </div>
</template>

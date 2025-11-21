<script lang="ts" setup>
import {
  IconBxsZap,
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconCircleCheckBig,
  IconCirclePlus,
  IconSettings,
  IconUsers,
  IconUsersRound,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import emitter from "@/modules/mitt"

const online = useOnline()

const groups = [
  {
    label: "Personal",
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

const selectedTeam = ref<Team>(
  groups[0]?.teams[0] ?? { label: "Default Team", value: "default" }
)

type User = {
  name: string
  email: string
  avatar: string
  role: string
}

const users = ref<User[]>([
  {
    name: "Tom",
    email: "t@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "edit",
  },
  {
    name: "Whitney",
    email: "w@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
  {
    name: "Leonard",
    email: "l@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
  {
    name: "Floyd",
    email: "f@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
  {
    name: "Emily",
    email: "e@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
])

const selectedEmails = ref<string[]>([])

const selectedUserObjects = computed(() => {
  return selectedEmails.value
    .map((email) => users.value.find((u) => u.email === email))
    .filter(Boolean) as User[]
})
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
              class="bg-muted text-muted-foreground flex items-center gap-1 rounded-full border px-1.5 py-0.5"
            >
              <IconBxsZap />
              Offline
            </span>
            <span v-else class="hidden md:flex">
              {{ selectedTeam.label }}
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
              @click="emitter.emit('Dialog.Settings.Open', 'people')"
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
                    @click="selectedTeam = team"
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
                      v-if="selectedTeam.value === team.value"
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
            <Input id="name" placeholder="Acme Inc." />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="members">
              People with access
            </Label>
          </div>
          <div class="grid gap-2 rounded-md border p-2">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" class="w-full justify-between">
                  Select users...
                  <IconChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="bottom" class="w-xs">
                <DropdownMenuItem
                  v-for="user in users"
                  :key="user.email"
                  @select="
                    () => {
                      if (!selectedEmails.includes(user.email)) {
                        selectedEmails.push(user.email)
                      } else {
                        selectedEmails.splice(
                          selectedEmails.indexOf(user.email),
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
                  <IconCircleCheckBig
                    v-if="selectedEmails.includes(user.email)"
                    class="ml-auto"
                  />
                  <IconCircle v-else class="ml-auto" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div v-if="selectedUserObjects.length" class="grid gap-2">
              <div
                v-for="person in selectedUserObjects"
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
                <Select v-model="person.role" class="w-24">
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
              v-if="!selectedUserObjects.length"
              class="text-muted-foreground flex items-center justify-center p-4 text-sm"
            >
              No users selected
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline"> Cancel </Button>
          </DialogClose>
          <DialogClose as-child>
            <Button type="submit"> Continue </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

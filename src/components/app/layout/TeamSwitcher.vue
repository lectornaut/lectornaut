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

const open = ref(false)
const showNewTeamDialog = ref(false)
const selectedTeam = ref<Team>(
  groups[0]?.teams[0] ?? { label: "Default Team", value: "default" }
)
</script>

<template>
  <div data-tauri-drag-region class="flex items-center justify-between gap-2">
    <Dialog v-model:open="showNewTeamDialog">
      <Popover v-model:open="open">
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            class="data-[state=open]:bg-accent gap-3 truncate"
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
            <span v-else v-motion-fade class="truncate">
              {{ selectedTeam.label }}
            </span>
            <icon-lucide-chevron-down />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
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
                  class="grow justify-start gap-2 truncate py-2"
                  @select="
                    () => {
                      selectedTeam = team
                      open = false
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
                    class="grow justify-start gap-2 truncate py-2"
                    @select="
                      () => {
                        open = false
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
          <div class="flex flex-col gap-4">
            <div class="grid gap-4">
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
  </div>
</template>

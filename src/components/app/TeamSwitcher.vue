<script setup lang="ts">
import { isTauri } from "@/helpers/utilities"
import { leftSidebarVisibility } from "@/modules/theme"

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
const selectedTeam = ref<Team>(groups[0].teams[0])
</script>

<template>
  <div
    class="flex gap-2"
    :class="isTauri ? 'flex-col-reverse items-stretch' : 'items-center'"
  >
    <Dialog v-model:open="showNewTeamDialog">
      <Popover v-model:open="open">
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            class="grow justify-start gap-3 truncate"
            size="xs"
          >
            <Avatar class="h-4 w-4">
              <AvatarImage
                :src="`https://avatar.vercel.sh/${selectedTeam.value}.png`"
                :alt="selectedTeam.label"
              />
              <AvatarFallback>SC</AvatarFallback>
            </Avatar>
            <span class="truncate">{{ selectedTeam.label }}</span>
            <icon-lucide-chevron-down class="ml-auto" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="p-0" align="start">
          <Command
            :filter-function="
              (list, term) =>
                list.filter((i) => i.label?.toLowerCase()?.includes(term))
            "
          >
            <CommandList>
              <CommandInput
                placeholder="Search team..."
                class="border-none focus:border-inherit focus:ring-0"
              />
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
                  class="grow justify-start gap-3 truncate"
                  @select="
                    () => {
                      selectedTeam = team
                      open = false
                    }
                  "
                >
                  <Avatar class="h-4 w-4">
                    <AvatarImage
                      :src="`https://avatar.vercel.sh/${team.value}.png`"
                      :alt="team.label"
                      class="grayscale"
                    />
                    <AvatarFallback>SC</AvatarFallback>
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
                        open = false
                        showNewTeamDialog = true
                      }
                    "
                  >
                    <icon-lucide-plus-circle class="h-4 w-4 opacity-50" />
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
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="xs"
              @click="leftSidebarVisibility = false"
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

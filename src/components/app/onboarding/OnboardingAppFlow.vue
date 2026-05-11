<script lang="ts" setup>
import {
  IconCheck,
  IconChevronDown,
  IconCommand,
  IconKeyboard,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSwitchHorizontal,
} from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import confetti from "canvas-confetti"

type DemoWorkspace = {
  id: string
  name: string
}

const platformSpecialKey = computed(() => getPlatformSpecialKey())

const commandDialogOpen = ref(false)
const shortcutsDialogOpen = ref(false)
const completed = reactive({
  command: false,
  workspace: false,
  shortcuts: false,
})
const hasCelebrated = ref(false)
const lastDemoAction = ref<string | null>(null)

const demoWorkspaces: DemoWorkspace[] = [
  { id: "product", name: "Product" },
  { id: "design", name: "Design" },
  { id: "engineering", name: "Engineering" },
]
const activeWorkspaceId = ref(demoWorkspaces[0]?.id ?? "")
const activeWorkspaceName = computed(
  () =>
    demoWorkspaces.find((workspace) => workspace.id === activeWorkspaceId.value)
      ?.name ?? "Workspace"
)

const sampleCommands = [
  {
    id: "new-tab",
    label: "Open new tab",
    icon: IconCommand,
  },
  {
    id: "toggle-settings",
    label: "Go to settings",
    icon: IconSettings,
  },
  {
    id: "ask-ai",
    label: "Ask AI",
    icon: IconSparkles,
  },
]

const completionCount = computed(
  () =>
    Number(completed.command) +
    Number(completed.workspace) +
    Number(completed.shortcuts)
)

const isCompleted = computed(
  () => completed.command && completed.workspace && completed.shortcuts
)

const playConfetti = () => {
  const end = Date.now() + 1000
  const colors = ["#a786ff", "#fd8bbc", "#eca184", "#f8deb1"]

  const frame = () => {
    if (Date.now() > end) return

    confetti({
      particleCount: 2,
      angle: 60,
      spread: 55,
      startVelocity: 60,
      origin: { x: 0, y: 0.5 },
      colors,
    })

    confetti({
      particleCount: 2,
      angle: 120,
      spread: 55,
      startVelocity: 60,
      origin: { x: 1, y: 0.5 },
      colors,
    })

    requestAnimationFrame(frame)
  }

  frame()
}

watch(isCompleted, (done) => {
  if (!done || hasCelebrated.value) return
  hasCelebrated.value = true
  playConfetti()
})

const runSampleCommand = (label: string) => {
  completed.command = true
  lastDemoAction.value = `Command demo: ${label}`
  commandDialogOpen.value = false
}

const selectWorkspace = (workspaceId: string) => {
  activeWorkspaceId.value = workspaceId
  completed.workspace = true
  lastDemoAction.value = `Workspace demo: switched to ${activeWorkspaceName.value}`
}

const openShortcutsDemo = () => {
  completed.shortcuts = true
  shortcutsDialogOpen.value = true
  lastDemoAction.value = "Shortcuts demo: opened keyboard shortcuts"
}
</script>

<template>
  <div class="p-4">
    <div class="mb-4 border p-3">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-medium">Try all 3 demos to celebrate</p>
        <Badge variant="secondary">{{ completionCount }} / 3</Badge>
      </div>
      <p v-if="lastDemoAction" class="text-muted-foreground mt-2 text-xs">
        {{ lastDemoAction }}
      </p>
    </div>

    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Command and Search</FieldLabel>
            <FieldDescription>
              Use <strong>{{ platformSpecialKey }} + K</strong> to open commands
              and search.
            </FieldDescription>
          </FieldContent>
          <div class="flex flex-col items-end gap-2">
            <KbdGroup>
              <Kbd>{{ platformSpecialKey }}</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
            <Dialog v-model:open="commandDialogOpen">
              <DialogTrigger as-child>
                <Button variant="outline">
                  <IconSearch />
                  Try sample
                </Button>
              </DialogTrigger>
              <DialogContent class="bg-secondary p-1.5">
                <Command class="border">
                  <CommandInput placeholder="Type a command or search" />
                  <CommandList>
                    <CommandGroup heading="Sample commands">
                      <CommandItem
                        v-for="command in sampleCommands"
                        :key="command.id"
                        :value="command.label"
                        @select="runSampleCommand(command.label)"
                      >
                        <Component :is="command.icon" />
                        <span>{{ command.label }}</span>
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </DialogContent>
            </Dialog>
          </div>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Workspace Switcher</FieldLabel>
            <FieldDescription>
              Use <strong>{{ platformSpecialKey }} + Shift + ↑/↓</strong> to
              move between workspaces.
            </FieldDescription>
          </FieldContent>
          <div class="flex flex-col items-end gap-2">
            <div class="flex flex-col items-end gap-1">
              <KbdGroup>
                <Kbd>{{ platformSpecialKey }}</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>↑</Kbd>
              </KbdGroup>
              <KbdGroup>
                <Kbd>{{ platformSpecialKey }}</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline">
                  <IconSwitchHorizontal />
                  {{ activeWorkspaceName }}
                  <IconChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-50">
                <DropdownMenuLabel> Sample workspaces </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    v-for="workspace in demoWorkspaces"
                    :key="workspace.id"
                    @click="selectWorkspace(workspace.id)"
                  >
                    <span>{{ workspace.name }}</span>
                    <DropdownMenuShortcut
                      v-if="workspace.id === activeWorkspaceId"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Full Keyboard Shortcuts</FieldLabel>
            <FieldDescription>
              Use <strong>{{ platformSpecialKey }} + /</strong> to open keyboard
              shortcuts.
            </FieldDescription>
          </FieldContent>
          <div class="flex flex-col items-end gap-2">
            <KbdGroup>
              <Kbd>{{ platformSpecialKey }}</Kbd>
              <Kbd>/</Kbd>
            </KbdGroup>
            <Dialog v-model:open="shortcutsDialogOpen">
              <DialogTrigger as-child>
                <Button variant="outline" @click="openShortcutsDemo">
                  <IconKeyboard />
                  Open sample
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Keyboard shortcuts</DialogTitle>
                  <DialogDescription>
                    Sample shortcuts panel used during onboarding.
                  </DialogDescription>
                </DialogHeader>
                <div class="space-y-2">
                  <div class="flex items-center justify-between border p-2">
                    <span class="text-sm">Commands</span>
                    <KbdGroup>
                      <Kbd>{{ platformSpecialKey }}</Kbd>
                      <Kbd>K</Kbd>
                    </KbdGroup>
                  </div>
                  <div class="flex items-center justify-between border p-2">
                    <span class="text-sm">Workspace previous</span>
                    <KbdGroup>
                      <Kbd>{{ platformSpecialKey }}</Kbd>
                      <Kbd>Shift</Kbd>
                      <Kbd>↑</Kbd>
                    </KbdGroup>
                  </div>
                  <div class="flex items-center justify-between border p-2">
                    <span class="text-sm">Workspace next</span>
                    <KbdGroup>
                      <Kbd>{{ platformSpecialKey }}</Kbd>
                      <Kbd>Shift</Kbd>
                      <Kbd>↓</Kbd>
                    </KbdGroup>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

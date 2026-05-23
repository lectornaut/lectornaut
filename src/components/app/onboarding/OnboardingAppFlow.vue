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

const { t } = useI18n()

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

const demoWorkspaces = computed<DemoWorkspace[]>(() => [
  {
    id: "product",
    name: t("pages.welcome.onboarding.appFlow.workspaceProduct"),
  },
  { id: "design", name: t("pages.welcome.onboarding.appFlow.workspaceDesign") },
  {
    id: "engineering",
    name: t("pages.welcome.onboarding.appFlow.workspaceEngineering"),
  },
])
const activeWorkspaceId = ref(demoWorkspaces.value[0]?.id ?? "")
const activeWorkspaceName = computed(
  () =>
    demoWorkspaces.value.find(
      (workspace) => workspace.id === activeWorkspaceId.value
    )?.name ?? t("pages.welcome.onboarding.appFlow.workspaceFallback")
)

const sampleCommands = computed(() => [
  {
    id: "new-tab",
    label: t("pages.welcome.onboarding.appFlow.commandNewTab"),
    icon: IconCommand,
  },
  {
    id: "toggle-settings",
    label: t("pages.welcome.onboarding.appFlow.commandToggleSettings"),
    icon: IconSettings,
  },
  {
    id: "ask-ai",
    label: t("pages.welcome.onboarding.appFlow.commandAskAi"),
    icon: IconSparkles,
  },
])

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
  lastDemoAction.value = t(
    "pages.welcome.onboarding.appFlow.commandDemoLabel",
    { label }
  )
  commandDialogOpen.value = false
}

const selectWorkspace = (workspaceId: string) => {
  activeWorkspaceId.value = workspaceId
  completed.workspace = true
  lastDemoAction.value = t(
    "pages.welcome.onboarding.appFlow.workspaceDemoLabel",
    { name: activeWorkspaceName.value }
  )
}

const openShortcutsDemo = () => {
  completed.shortcuts = true
  shortcutsDialogOpen.value = true
  lastDemoAction.value = t(
    "pages.welcome.onboarding.appFlow.shortcutsDemoLabel"
  )
}
</script>

<template>
  <div class="p-4">
    <div class="mb-4 border p-3">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-medium">
          {{ t("pages.welcome.onboarding.appFlow.header") }}
        </p>
        <Badge variant="secondary">{{
          t("pages.welcome.onboarding.appFlow.progress", {
            count: completionCount,
          })
        }}</Badge>
      </div>
      <p v-if="lastDemoAction" class="text-muted-foreground mt-2 text-xs">
        {{ lastDemoAction }}
      </p>
    </div>

    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{
              t("pages.welcome.onboarding.appFlow.commandLabel")
            }}</FieldLabel>
            <FieldDescription>
              <i18n-t
                keypath="pages.welcome.onboarding.appFlow.commandDescription"
                tag="span"
              >
                <template #keys>
                  <strong>{{ platformSpecialKey }} + K</strong>
                </template>
              </i18n-t>
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
                  {{ t("pages.welcome.onboarding.appFlow.trySample") }}
                </Button>
              </DialogTrigger>
              <DialogContent class="bg-secondary p-1.5">
                <Command class="border">
                  <CommandInput
                    :placeholder="
                      t('pages.welcome.onboarding.appFlow.commandPlaceholder')
                    "
                  />
                  <CommandList>
                    <CommandGroup
                      :heading="
                        t(
                          'pages.welcome.onboarding.appFlow.sampleCommandsHeading'
                        )
                      "
                    >
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
            <FieldLabel>{{
              t("pages.welcome.onboarding.appFlow.workspaceLabel")
            }}</FieldLabel>
            <FieldDescription>
              <i18n-t
                keypath="pages.welcome.onboarding.appFlow.workspaceDescription"
                tag="span"
              >
                <template #keys>
                  <strong>{{ platformSpecialKey }} + Shift + ↑/↓</strong>
                </template>
              </i18n-t>
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
              <DropdownMenuContent class="w-auto">
                <DropdownMenuLabel>
                  {{
                    t(
                      "pages.welcome.onboarding.appFlow.sampleWorkspacesHeading"
                    )
                  }}
                </DropdownMenuLabel>
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
            <FieldLabel>{{
              t("pages.welcome.onboarding.appFlow.shortcutsLabel")
            }}</FieldLabel>
            <FieldDescription>
              <i18n-t
                keypath="pages.welcome.onboarding.appFlow.shortcutsDescription"
                tag="span"
              >
                <template #keys>
                  <strong>{{ platformSpecialKey }} + /</strong>
                </template>
              </i18n-t>
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
                  {{ t("pages.welcome.onboarding.appFlow.openSample") }}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{{
                    t("pages.welcome.onboarding.appFlow.shortcutsDialogTitle")
                  }}</DialogTitle>
                  <DialogDescription>
                    {{
                      t(
                        "pages.welcome.onboarding.appFlow.shortcutsDialogDescription"
                      )
                    }}
                  </DialogDescription>
                </DialogHeader>
                <div class="space-y-2">
                  <div class="flex items-center justify-between border p-2">
                    <span class="text-sm">{{
                      t("pages.welcome.onboarding.appFlow.shortcutCommands")
                    }}</span>
                    <KbdGroup>
                      <Kbd>{{ platformSpecialKey }}</Kbd>
                      <Kbd>K</Kbd>
                    </KbdGroup>
                  </div>
                  <div class="flex items-center justify-between border p-2">
                    <span class="text-sm">{{
                      t(
                        "pages.welcome.onboarding.appFlow.shortcutWorkspacePrevious"
                      )
                    }}</span>
                    <KbdGroup>
                      <Kbd>{{ platformSpecialKey }}</Kbd>
                      <Kbd>Shift</Kbd>
                      <Kbd>↑</Kbd>
                    </KbdGroup>
                  </div>
                  <div class="flex items-center justify-between border p-2">
                    <span class="text-sm">{{
                      t(
                        "pages.welcome.onboarding.appFlow.shortcutWorkspaceNext"
                      )
                    }}</span>
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

<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
} from "@/composables/useBotChat"
import {
  IconArchive,
  IconBolt,
  IconBot,
  IconGlobe,
  IconLock,
  IconMessageCircle,
  IconPencil,
  IconRotateCcw,
  IconTrash2,
  IconUsers,
  IconWrench,
} from "@/data/icons"
import type { IBotSessionVisibility } from "@/types/domain"
import { computed, inject, nextTick, ref, type Component } from "vue"

const botChat = inject(BotChatContextKey)

const sessionId = computed(() => botChat?.sessionId.value ?? null)
const activeSession = computed(() => botChat?.activeSession.value ?? null)
const activeVisibility = computed(
  () => botChat?.activeVisibility.value ?? "private"
)
const isActiveArchived = computed(
  () => botChat?.isActiveArchived.value ?? false
)
const canChangeVisibility = computed(
  () => botChat?.canChangeVisibilityActive.value ?? false
)
const canManage = computed(() => botChat?.canManageActive.value ?? false)
const isActiveOwner = computed(() => botChat?.isActiveOwner.value ?? false)
const isUpdatingVisibility = computed(
  () => botChat?.isUpdatingVisibility.value ?? false
)
const isMutating = computed(() => botChat?.isMutatingSession.value ?? false)

// ── Mode (action context) ────────────────────────────────────────────────────
//
// The composer's dropdown is the primary control for switching modes;
// this side-panel radio group is the "what does each mode do?" explainer
// plus a secondary control for users who already have the panel open.
// Both bind to the same `botChat.mode` ref, so they stay in sync.

const modeOptions = BOT_CHAT_MODE_OPTIONS
const activeMode = computed<BotChatMode>(() => botChat?.mode.value ?? "auto")
const activeModeOption = computed(
  () => botChat?.activeModeOption.value ?? modeOptions[0]
)
const toolsAreEnabled = computed(() => activeModeOption.value.toolsEnabled)

// Per-mode icon. Lives here (not on the option object in the composable)
// because the composable is plain TypeScript and component imports
// shouldn't leak into it.
const modeIcons: Record<BotChatMode, Component> = {
  auto: IconBolt,
  agent: IconBot,
  manual: IconMessageCircle,
}

const onModeChange = (value: unknown) => {
  if (!botChat) return
  if (typeof value !== "string") return
  if (!modeOptions.some((o) => o.value === value)) return
  botChat.mode.value = value as BotChatMode
}

// ── Visibility (radio group) ────────────────────────────────────────────────

interface VisibilityOption {
  value: IBotSessionVisibility
  label: string
  description: string
  icon: Component
  disabled?: boolean
}

// Private's description is contextual: a team admin tightening someone
// else's chat to private is *losing* their own access (not gaining
// exclusive access), so phrase it from the actor's perspective.
const visibilityOptions = computed<VisibilityOption[]>(() => [
  {
    value: "private",
    label: "Private",
    description: isActiveOwner.value
      ? "Only you can see this chat."
      : "Only the owner can see this chat.",
    icon: IconLock,
  },
  {
    value: "shared",
    label: "Shared with team",
    description:
      "Members can read this chat. Owner and admins can keep editing.",
    icon: IconUsers,
  },
  {
    value: "public",
    label: "Public",
    description: "Anyone with the link can view. Coming soon.",
    icon: IconGlobe,
    disabled: true,
  },
])

const confirmShareOpen = ref(false)
const pendingVisibility = ref<IBotSessionVisibility | null>(null)

const onVisibilityChange = (value: string) => {
  if (!sessionId.value) return
  // Proactive gate: members shouldn't reach `setActiveVisibility` at all.
  // The radio is also `:disabled` for them, but if the underlying control
  // ever emits an update event programmatically, this stops the call
  // before the composable would have to error out with a toast.
  if (!canChangeVisibility.value) return
  const target = value as IBotSessionVisibility
  if (target === activeVisibility.value) return
  if (target === "public") {
    void botChat?.setActiveVisibility("public") // toasts "coming soon"
    return
  }
  // Confirm only when broadening (private → shared). Tightening is instant.
  if (activeVisibility.value === "private" && target === "shared") {
    pendingVisibility.value = target
    confirmShareOpen.value = true
    return
  }
  void botChat?.setActiveVisibility(target)
}

const handleConfirmShare = async () => {
  const target = pendingVisibility.value
  confirmShareOpen.value = false
  pendingVisibility.value = null
  if (!target) return
  await botChat?.setActiveVisibility(target)
}

const handleCancelShare = () => {
  confirmShareOpen.value = false
  pendingVisibility.value = null
}

// ── Rename ───────────────────────────────────────────────────────────────────

const renameDialogOpen = ref(false)
const renameInput = ref("")
const renameInputEl = ref<HTMLInputElement | null>(null)

const openRename = () => {
  if (!sessionId.value || !canManage.value) return
  renameInput.value = activeSession.value?.title ?? ""
  renameDialogOpen.value = true
  nextTick(() => renameInputEl.value?.focus())
}

const submitRename = async () => {
  const id = sessionId.value
  if (!id) return
  const next = renameInput.value.trim()
  if (!next || next === (activeSession.value?.title ?? "")) {
    renameDialogOpen.value = false
    return
  }
  await botChat?.renameSession(id, next)
  renameDialogOpen.value = false
}

// ── Archive ──────────────────────────────────────────────────────────────────

const onArchiveToggle = () => {
  const id = sessionId.value
  if (!id || !canManage.value) return
  void botChat?.archiveSession(id, !isActiveArchived.value)
}

// ── Available tools ──────────────────────────────────────────────────────────
//
// Mirror of the server-side tool catalog declared in
// `functions/src/bot.ts` (`BOT_TOOLS`). Kept as a static mirror because
// the catalog is small and changes rarely; if it grows or becomes
// team-scoped, promote to a `listBotTools` callable so the two stay in
// lock-step automatically.

interface AvailableTool {
  name: string
  description: string
  example: string
}

interface AvailableInterrupt {
  name: string
  description: string
  example: string
}

const availableTools: AvailableTool[] = [
  {
    name: "getWeather",
    description: "Look up current weather for a location.",
    example: "What's the weather in Tokyo?",
  },
  {
    name: "rollDice",
    description: "Roll a six-sided die.",
    example: "Roll a die for me.",
  },
]

// Interrupt tools pause the chat and surface a form. Listed separately
// from action tools because they're available in *every* mode (including
// `manual`) — a clarifying question has no side effects.
const availableInterrupts: AvailableInterrupt[] = [
  {
    name: "askQuestion",
    description:
      "Pauses the chat and asks you a multiple-choice question. Pick a " +
      "choice (or type your own when allowed) to continue.",
    example: "Help me plan a backyard BBQ.",
  },
]

// ── Delete ───────────────────────────────────────────────────────────────────

const deleteDialogOpen = ref(false)

const openDelete = () => {
  if (!sessionId.value || !canManage.value) return
  deleteDialogOpen.value = true
}

const submitDelete = async () => {
  const id = sessionId.value
  if (!id) return
  await botChat?.removeSession(id)
  deleteDialogOpen.value = false
}
</script>

<template>
  <SidebarContent>
    <OverlayScrollbarsWrapper>
      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <Component :is="modeIcons[activeMode]" />
          Mode
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2 p-2">
          <p class="text-muted-foreground text-xs">
            Mode steers how the assistant approaches each turn — what tools it
            can reach, how proactive it is, and how it phrases replies.
          </p>
          <RadioGroup
            :model-value="activeMode"
            @update:model-value="(v) => onModeChange(v)"
          >
            <Field
              v-for="opt in modeOptions"
              :key="opt.value"
              orientation="horizontal"
            >
              <RadioGroupItem
                :id="`bot-mode-${opt.value}`"
                :value="opt.value"
                class="mt-0.5"
              />
              <FieldContent>
                <FieldLabel
                  :for="`bot-mode-${opt.value}`"
                  class="flex items-center gap-2 text-sm"
                >
                  <Component :is="modeIcons[opt.value]" class="size-4" />
                  {{ opt.label }}
                </FieldLabel>
                <p class="text-muted-foreground text-xs">
                  {{ opt.longDescription }}
                </p>
              </FieldContent>
            </Field>
          </RadioGroup>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconWrench />
          Available tools
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2 p-2">
          <p v-if="toolsAreEnabled" class="text-muted-foreground text-xs">
            The assistant can call these on its own when relevant. Try one of
            the example prompts below.
          </p>
          <p v-else class="text-muted-foreground text-xs">
            Tools are disabled in
            <strong>{{ activeModeOption.label }}</strong> mode. Switch to
            <strong>Auto</strong> or <strong>Agent</strong> to re-enable them.
          </p>
          <ul class="space-y-2">
            <li
              v-for="tool in availableTools"
              :key="tool.name"
              class="border-border/60 bg-background/40 rounded-md border p-2 transition-opacity"
              :class="{ 'opacity-50': !toolsAreEnabled }"
            >
              <div class="flex items-center gap-2">
                <IconWrench class="text-muted-foreground size-3.5" />
                <code class="text-foreground text-xs font-medium">{{
                  tool.name
                }}</code>
              </div>
              <p class="text-muted-foreground mt-1 text-xs">
                {{ tool.description }}
              </p>
              <p class="text-muted-foreground/80 mt-1 text-[11px] italic">
                e.g. “{{ tool.example }}”
              </p>
            </li>
          </ul>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconMessageCircle />
          Human-in-the-Loop
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2 p-2">
          <p class="text-muted-foreground text-xs">
            The assistant can pause and ask you a clarifying question instead of
            guessing. These interrupts are available in every mode — including
            <strong>Manual</strong>.
          </p>
          <ul class="space-y-2">
            <li
              v-for="interrupt in availableInterrupts"
              :key="interrupt.name"
              class="border-border/60 bg-background/40 rounded-md border p-2"
            >
              <div class="flex items-center gap-2">
                <IconMessageCircle class="text-muted-foreground size-3.5" />
                <code class="text-foreground text-xs font-medium">{{
                  interrupt.name
                }}</code>
              </div>
              <p class="text-muted-foreground mt-1 text-xs">
                {{ interrupt.description }}
              </p>
              <p class="text-muted-foreground/80 mt-1 text-[11px] italic">
                e.g. “{{ interrupt.example }}”
              </p>
            </li>
          </ul>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Manage chat</SidebarGroupLabel>
        <SidebarGroupContent class="grid gap-2 p-2">
          <p v-if="!sessionId" class="text-muted-foreground text-xs">
            Send a message to start a chat — actions will appear here.
          </p>
          <template v-else>
            <Button
              variant="secondary"
              class="justify-start"
              :disabled="!canManage || isMutating"
              @click="openRename"
            >
              <IconPencil />
              Rename
            </Button>
            <Button
              variant="secondary"
              class="justify-start"
              :disabled="!canManage || isMutating"
              @click="onArchiveToggle"
            >
              <Component :is="isActiveArchived ? IconRotateCcw : IconArchive" />
              {{ isActiveArchived ? "Restore from archive" : "Archive" }}
            </Button>
            <Button
              variant="destructive"
              class="justify-start text-current"
              :disabled="!canManage || isMutating"
              @click="openDelete"
            >
              <IconTrash2 />
              Delete chat
            </Button>
            <p v-if="!canManage" class="text-muted-foreground text-xs">
              Only the owner or a team admin can manage this chat.
            </p>
          </template>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconLock v-if="activeVisibility === 'private'" />
          <IconUsers v-else-if="activeVisibility === 'shared'" />
          <IconGlobe v-else />
          Visibility
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2 p-2">
          <p v-if="!sessionId" class="text-muted-foreground text-xs">
            Send a message to start a chat — visibility can be set after.
          </p>
          <RadioGroup
            v-else
            :model-value="activeVisibility"
            :disabled="!canChangeVisibility || isUpdatingVisibility"
            @update:model-value="(v) => onVisibilityChange(String(v))"
          >
            <Field
              v-for="opt in visibilityOptions"
              :key="opt.value"
              orientation="horizontal"
              :class="{
                'opacity-60': opt.disabled,
              }"
            >
              <RadioGroupItem
                :id="`bot-visibility-${opt.value}`"
                :value="opt.value"
                :disabled="opt.disabled"
                class="mt-0.5"
              />
              <FieldContent>
                <FieldLabel
                  :for="`bot-visibility-${opt.value}`"
                  class="flex items-center gap-2 text-sm"
                >
                  <Component :is="opt.icon" class="size-4" />
                  {{ opt.label }}
                </FieldLabel>
                <p class="text-muted-foreground text-xs">
                  {{ opt.description }}
                </p>
              </FieldContent>
            </Field>
          </RadioGroup>
          <p
            v-if="sessionId && !canChangeVisibility"
            class="text-muted-foreground text-xs"
          >
            Only the owner or a team admin can change visibility.
          </p>
        </SidebarGroupContent>
      </SidebarGroup>
    </OverlayScrollbarsWrapper>
  </SidebarContent>

  <!-- Confirm sharing -->
  <AlertDialog v-model:open="confirmShareOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Share this chat with the team?</AlertDialogTitle>
        <AlertDialogDescription>
          Members of this workspace will be able to read every message in this
          chat. Owner and admins will also be able to send new messages. You can
          switch back to private at any time.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleCancelShare">Cancel</AlertDialogCancel>
        <AlertDialogAction
          :disabled="isUpdatingVisibility"
          @click.prevent="handleConfirmShare"
        >
          <Spinner v-if="isUpdatingVisibility" />
          Share with team
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Rename dialog -->
  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename chat</DialogTitle>
        <DialogDescription>
          Pick a name that helps you find this chat later.
        </DialogDescription>
      </DialogHeader>
      <form class="grid gap-2" @submit.prevent="submitRename">
        <Label for="bot-actions-rename-input">Title</Label>
        <Input
          id="bot-actions-rename-input"
          ref="renameInputEl"
          v-model="renameInput"
          placeholder="e.g. Q3 launch checklist"
          maxlength="120"
          :disabled="isMutating"
        />
      </form>
      <DialogFooter>
        <Button
          variant="ghost"
          :disabled="isMutating"
          @click="renameDialogOpen = false"
        >
          Cancel
        </Button>
        <Button
          :disabled="isMutating || !renameInput.trim()"
          @click="submitRename"
        >
          <Spinner v-if="isMutating" />
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Delete confirm -->
  <AlertDialog v-model:open="deleteDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
        <AlertDialogDescription>
          <span class="text-foreground font-medium">{{
            activeSession?.title || "This chat"
          }}</span>
          will be permanently deleted, including all of its messages. This
          action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isMutating">Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          class="text-current"
          :disabled="isMutating"
          @click.prevent="submitDelete"
        >
          <Spinner v-if="isMutating" />
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

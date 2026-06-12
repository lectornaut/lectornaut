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
} from "@/data/icons"
import type { IBotSessionVisibility } from "@/types/domain"
import { computed, inject, ref, type Component } from "vue"

const botChat = inject(BotChatContextKey)
const { t } = useI18n()

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
    label: t("ai.visibilityPrivate"),
    description: isActiveOwner.value
      ? t("ai.sidebar.visibilityPrivateSelf")
      : t("ai.sidebar.visibilityPrivateOther"),
    icon: IconLock,
  },
  {
    value: "shared",
    label: t("ai.sidebar.visibilitySharedLabel"),
    description: t("ai.sidebar.visibilitySharedDescription"),
    icon: IconUsers,
  },
  {
    value: "public",
    label: t("ai.sidebar.visibilityPublicLabel"),
    description: t("ai.sidebar.visibilityPublicDescription"),
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

const handleShareDialogOpenChange = (value: boolean) => {
  confirmShareOpen.value = value
  if (!value) pendingVisibility.value = null
}

// ── Rename ───────────────────────────────────────────────────────────────────

const renameDialogOpen = ref(false)
const renameInput = ref("")

const openRename = () => {
  if (!sessionId.value || !canManage.value) return
  renameInput.value = activeSession.value?.title ?? ""
  // Reka-ui's DialogContent autofocuses the first tabbable (the input) on open.
  renameDialogOpen.value = true
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
  <div class="flex size-full min-h-0 grow flex-col">
    <OverlayScrollbarsWrapper>
      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <Component :is="modeIcons[activeMode]" />
          {{ t("ai.mode") }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <p class="text-muted-foreground text-xs">
            {{ t("ai.sidebar.modeDescription") }}
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
              />
              <FieldContent>
                <FieldLabel
                  :for="`bot-mode-${opt.value}`"
                  class="flex items-center gap-2 text-sm"
                >
                  <Component :is="modeIcons[opt.value]" class="size-4" />
                  {{ t(`ai.modes.${opt.value}.label`) }}
                </FieldLabel>
                <p class="text-muted-foreground text-xs">
                  {{ t(`ai.modes.${opt.value}.longDescription`) }}
                </p>
              </FieldContent>
            </Field>
          </RadioGroup>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconLock v-if="activeVisibility === 'private'" />
          <IconUsers v-else-if="activeVisibility === 'shared'" />
          <IconGlobe v-else />
          {{ t("ai.sidebar.visibility") }}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <p v-if="!sessionId" class="text-muted-foreground text-xs">
            {{ t("ai.sidebar.noSessionVisibility") }}
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
            {{ t("ai.sidebar.cannotChangeVisibility") }}
          </p>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>{{ t("ai.sidebar.manageChat") }}</SidebarGroupLabel>
        <SidebarGroupContent class="grid gap-2 p-2">
          <p v-if="!sessionId" class="text-muted-foreground text-xs">
            {{ t("ai.sidebar.noSessionActions") }}
          </p>
          <template v-else>
            <Button
              variant="secondary"
              class="justify-start"
              :disabled="!canManage || isMutating"
              @click="openRename"
            >
              <IconPencil />
              {{ t("actions.rename") }}
            </Button>
            <Button
              variant="secondary"
              class="justify-start"
              :disabled="!canManage || isMutating"
              @click="onArchiveToggle"
            >
              <Component :is="isActiveArchived ? IconRotateCcw : IconArchive" />
              {{
                isActiveArchived
                  ? t("ai.sidebar.restoreFromArchive")
                  : t("ai.archive")
              }}
            </Button>
            <Button
              variant="destructive"
              class="justify-start text-current"
              :disabled="!canManage || isMutating"
              @click="openDelete"
            >
              <IconTrash2 />
              {{ t("ai.sidebar.deleteChat") }}
            </Button>
            <p v-if="!canManage" class="text-muted-foreground text-xs">
              {{ t("ai.sidebar.cannotManage") }}
            </p>
          </template>
        </SidebarGroupContent>
      </SidebarGroup>
    </OverlayScrollbarsWrapper>
  </div>

  <!-- Confirm sharing -->
  <AlertDialog
    :open="confirmShareOpen"
    @update:open="handleShareDialogOpenChange"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("ai.sidebar.shareConfirmTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("ai.sidebar.shareConfirmDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>
          {{ t("actions.cancel") }}
          <Kbd aria-hidden="true">Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction
          :disabled="isUpdatingVisibility"
          @click.prevent="handleConfirmShare"
        >
          <Spinner v-if="isUpdatingVisibility" />
          {{ t("ai.sidebar.shareConfirmAction") }}
          <Kbd aria-hidden="true">↩</Kbd>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Rename dialog -->
  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("ai.renameChat") }}</DialogTitle>
        <DialogDescription>
          {{ t("ai.renameChatHint") }}
        </DialogDescription>
      </DialogHeader>
      <form class="grid gap-2" @submit.prevent="submitRename">
        <Label for="bot-actions-rename-input">{{ t("ai.chatTitle") }}</Label>
        <Input
          id="bot-actions-rename-input"
          v-model="renameInput"
          :placeholder="t('ai.chatTitlePlaceholder')"
          maxlength="120"
          :disabled="isMutating"
        />
      </form>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isMutating">
            {{ t("actions.cancel") }}
            <Kbd aria-hidden="true">Esc</Kbd>
          </Button>
        </DialogClose>
        <Button
          data-dialog-action
          :disabled="isMutating || !renameInput.trim()"
          @click="submitRename"
        >
          <Spinner v-if="isMutating" />
          {{ t("actions.save") }}
          <Kbd aria-hidden="true">↩</Kbd>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Delete confirm -->
  <AlertDialog v-model:open="deleteDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("ai.deleteChatTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          <span class="text-foreground font-medium">{{
            activeSession?.title || t("ai.thisChat")
          }}</span>
          {{ t("ai.deleteChatConfirm") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isMutating">
          {{ t("actions.cancel") }}
          <Kbd aria-hidden="true">Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction :disabled="isMutating" @click.prevent="submitDelete">
          <Spinner v-if="isMutating" />
          {{ t("actions.delete") }}
          <Kbd aria-hidden="true">↩</Kbd>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

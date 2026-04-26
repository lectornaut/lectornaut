<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import {
  IconArchive,
  IconGlobe,
  IconLock,
  IconPencil,
  IconRotateCcw,
  IconTrash2,
  IconUsers,
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
const isUpdatingVisibility = computed(
  () => botChat?.isUpdatingVisibility.value ?? false
)
const isMutating = computed(() => botChat?.isMutatingSession.value ?? false)

// ── Visibility (radio group) ────────────────────────────────────────────────

interface VisibilityOption {
  value: IBotSessionVisibility
  label: string
  description: string
  icon: Component
  disabled?: boolean
}

const visibilityOptions: VisibilityOption[] = [
  {
    value: "private",
    label: "Private",
    description: "Only you can see this chat.",
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
]

const confirmShareOpen = ref(false)
const pendingVisibility = ref<IBotSessionVisibility | null>(null)

const onVisibilityChange = (value: string) => {
  if (!sessionId.value) return
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
              <component :is="isActiveArchived ? IconRotateCcw : IconArchive" />
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
              class="bg-muted/40 hover:bg-muted/70 items-start gap-3 border p-2"
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
                  <component :is="opt.icon" class="size-4" />
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

<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MAX_ATTACHED_NODES,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
  type BotChatNodeRef,
} from "@/composables/useBotChat"
import { BOT_TOOL_CATALOG, type BotToolDescriptor } from "@/data/botTools"
import {
  IconAiFill,
  IconArrowUp,
  IconFile,
  IconFolder,
  IconPlus,
  IconX,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { storeToRefs } from "pinia"
import { computed, inject, nextTick, ref, watch, watchEffect } from "vue"

const props = withDefaults(
  defineProps<{
    placeholder?: string
    usageLabel?: string
  }>(),
  {
    usageLabel: "52% used",
  }
)

const { t } = useI18n()
const userInput = ref("")
const textareaRef = ref<{ $el?: HTMLTextAreaElement } | null>(null)

const botChat = inject(BotChatContextKey)
const isSending = computed(() => botChat?.isSending.value ?? false)
const canSend = computed(() => botChat?.canSend.value ?? false)
const canEditActive = computed(() => botChat?.canEditActive.value ?? true)
const isActiveArchived = computed(
  () => botChat?.isActiveArchived.value ?? false
)
const isReadOnly = computed(
  () => !!botChat?.sessionId.value && !canEditActive.value
)

// ── Attached node context ────────────────────────────────────────────────────
//
// Workspace nodes (files/folders) the user picked as ground-truth context
// for this chat session. Sent on every send. Lives on the injected
// BotChatContext, so the side-panel, AiAsk sheet, and Bot inspector tab
// all see the same set when bound to the same composable instance.

const authStore = useAuthStore()
const fileTreeStore = useFileTreeStore()
const { currentTeamId, currentWorkspaceId } = storeToRefs(authStore)

const attachedNodes = computed<BotChatNodeRef[]>(
  () => botChat?.attachedNodes.value ?? []
)
const canAttachMoreNodes = computed(
  () => botChat?.canAttachMoreNodes.value ?? false
)
const hasAttachedNodes = computed(() => attachedNodes.value.length > 0)

// Side-effect: when a node ref is attached we may not yet have its doc
// cached in the file-tree store (the user could have picked it from a
// route they never expanded). Calling `ensureNodeLoaded` per ref hydrates
// the store so the chip's name + icon render correctly.
watch(
  () => attachedNodes.value.map((n) => `${n.scope}:${n.nodeId}`).join(","),
  () => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    for (const node of attachedNodes.value) {
      const existing = fileTreeStore.getNode(
        node.scope,
        teamId,
        workspaceId,
        node.nodeId
      )
      if (!existing) {
        void fileTreeStore.ensureNodeLoaded(
          node.scope,
          teamId,
          workspaceId,
          node.nodeId
        )
      }
    }
  },
  { immediate: true }
)

// Retain the workspace for every scope that currently has an attached
// node so the file-tree store doesn't evict it when no `FileTree` is
// mounted. Without this, the picker sheet (which is the only retainer
// on the `/bot` route) tears down on close — `releaseWorkspace` hits
// count=0, `cleanupWorkspaceState` wipes `nodesByWorkspace[key]`, and
// the next `attachedNodeDetails` read flips every chip into the
// "missing or archived" state. By retaining alongside the attachments
// themselves, this component holds onto the workspace state for as
// long as it is meaningful.
//
// `watchEffect` is the right primitive here: its cleanup callback fires
// before the next run AND on unmount, so a scope going away (detach,
// workspace switch, send-cleared) always pairs with a matching
// `releaseWorkspace` — no manual diffing of old-vs-new scopes.
watchEffect((onCleanup) => {
  const teamId = currentTeamId.value
  const workspaceId = currentWorkspaceId.value
  if (!teamId || !workspaceId) return

  const scopes = new Set<WorkspaceNodeScope>(
    attachedNodes.value.map((node) => node.scope)
  )
  for (const scope of scopes) {
    fileTreeStore.retainWorkspace(scope, teamId, workspaceId)
  }

  onCleanup(() => {
    for (const scope of scopes) {
      fileTreeStore.releaseWorkspace(scope, teamId, workspaceId)
    }
  })
})

interface AttachedNodeDisplay {
  scope: WorkspaceNodeScope
  nodeId: string
  name: string
  type: "folder" | "file"
  /**
   * Resolved availability:
   *   - `ok`        — node exists and is active
   *   - `archived`  — node exists but is soft-deleted (recoverable)
   *   - `deleted`   — node doc doesn't resolve (gone from Firestore, or
   *     team/workspace not loaded yet — the hydration watcher above
   *     calls `ensureNodeLoaded`, so a persisted `deleted` is "really
   *     gone")
   */
  status: "ok" | "archived" | "deleted"
}

const attachedNodeDetails = computed<AttachedNodeDisplay[]>(() => {
  const teamId = currentTeamId.value
  const workspaceId = currentWorkspaceId.value
  return attachedNodes.value.map((ref) => {
    if (!teamId || !workspaceId) {
      return {
        scope: ref.scope,
        nodeId: ref.nodeId,
        name: ref.nodeId,
        type: "file" as const,
        status: "deleted" as const,
      }
    }
    const node = fileTreeStore.getNode(
      ref.scope,
      teamId,
      workspaceId,
      ref.nodeId
    )
    if (!node) {
      return {
        scope: ref.scope,
        nodeId: ref.nodeId,
        name: ref.nodeId,
        type: "file" as const,
        status: "deleted" as const,
      }
    }
    return {
      scope: ref.scope,
      nodeId: ref.nodeId,
      name: node.name,
      type: node.type,
      status: node.isArchived ? ("archived" as const) : ("ok" as const),
    }
  })
})

const hasUnavailableAttachment = computed(() =>
  attachedNodeDetails.value.some((node) => node.status !== "ok")
)

const detachAttachedNode = (node: BotChatNodeRef) => {
  botChat?.detachNode(node)
}

const attachSheetOpen = ref(false)
const activeAttachScope = ref<WorkspaceNodeScope>("code")

const updateActiveAttachScope = (value: string | number) => {
  if (value === "code" || value === "write") {
    activeAttachScope.value = value
  }
}

const canOpenAttachSheet = computed(
  () =>
    !isReadOnly.value &&
    !isActiveArchived.value &&
    !!currentTeamId.value &&
    !!currentWorkspaceId.value
)

/**
 * Per-scope id sets the FileTree uses to render checkmarks. Derived
 * straight from `attachedNodes` so toggling on the server-side cap or
 * the dedupe-in-attachNode immediately reflects in the picker UI.
 */
const codeAttachedIds = computed<string[]>(() =>
  attachedNodes.value
    .filter((node) => node.scope === "code")
    .map((node) => node.nodeId)
)
const writeAttachedIds = computed<string[]>(() =>
  attachedNodes.value
    .filter((node) => node.scope === "write")
    .map((node) => node.nodeId)
)

/**
 * Row click in multiple-select mode is a toggle: pick an unattached
 * node to attach (subject to the 10-item cap enforced inside
 * `attachNode`), or pick an already-attached node to detach. The sheet
 * stays open so a user can adjust several attachments in a row without
 * re-opening the picker.
 */
const handleAttachNodeSelect = (
  scope: WorkspaceNodeScope,
  node: { id: string }
) => {
  if (!botChat) return
  const ref = { scope, nodeId: node.id }
  const isAttached = attachedNodes.value.some(
    (existing) => existing.scope === scope && existing.nodeId === node.id
  )
  if (isAttached) {
    botChat.detachNode(ref)
    return
  }
  botChat.attachNode(ref)
}

// Mode selector — the dropdown in the composer toolbar. We bind to
// `botChat.mode` directly so the side panel and composer stay in sync,
// and so the next `sendMessage` automatically picks up the new mode.
// Options live in `useBotChat` so labels and descriptions are shared
// with the side-panel explainer (single source of truth).
const modeOptions = BOT_CHAT_MODE_OPTIONS
const mode = computed<BotChatMode>(() => botChat?.mode.value ?? "auto")
const onModeChange = (next: unknown) => {
  if (!botChat) return
  if (typeof next !== "string") return
  if (!modeOptions.some((o) => o.value === next)) return
  botChat.mode.value = next as BotChatMode
}

const modeLabel = (value: BotChatMode): string => {
  // Map mode → i18n key. Keeping this explicit (rather than `t(\`ai.${value}\`)`)
  // so the i18n-extractor toolchain can statically discover the keys.
  if (value === "auto") return t("ai.auto")
  if (value === "agent") return t("ai.agent")
  return t("ai.manual")
}

const inputPlaceholder = computed(() => {
  if (isActiveArchived.value) return t("ai.placeholderArchived")
  if (isReadOnly.value) return t("ai.placeholderReadOnly")
  return props.placeholder ?? t("ai.placeholder")
})

const isDisabled = computed(
  () =>
    userInput.value.trim().length === 0 ||
    !canSend.value ||
    hasUnavailableAttachment.value
)

const handleSend = async () => {
  if (isDisabled.value || !botChat) return
  const text = userInput.value
  userInput.value = ""
  await botChat.sendMessage(text)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    handleSend()
  }
}

// ── Tool picker ──────────────────────────────────────────────────────────────
//
// Click the AI badge on top of the composer to expand a list of tools the
// bot can call. Picking one inserts that tool's example prompt into the
// textarea at the current caret (or appends to the end if the textarea
// hasn't been focused). The picker auto-collapses after a pick. Tool
// dispatch on the model side is driven by natural-language intent, not by
// any sigil syntax — that's why we insert a full sentence, not "/cmd".

const toolsOpen = ref(false)

const insertToolPrompt = (tool: BotToolDescriptor) => {
  const el = textareaRef.value?.$el
  if (el) {
    const start = el.selectionStart ?? userInput.value.length
    const end = el.selectionEnd ?? userInput.value.length
    const before = userInput.value.slice(0, start)
    const after = userInput.value.slice(end)
    userInput.value = `${before}${tool.example}${after}`
    const caret = before.length + tool.example.length
    nextTick(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  } else {
    userInput.value = `${userInput.value}${tool.example}`
  }
  toolsOpen.value = false
}
</script>

<template>
  <Collapsible v-model:open="toolsOpen" class="bg-secondary mx-2 mb-2 rounded">
    <TooltipProvider>
      <Tooltip>
        <CollapsibleTrigger as-child>
          <TooltipTrigger as-child>
            <Badge variant="ghost" class="m-1">
              <IconAiFill />
            </Badge>
          </TooltipTrigger>
        </CollapsibleTrigger>
        <TooltipContent>
          {{ toolsOpen ? t("ai.hideTools") : t("ai.showTools") }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <CollapsibleContent>
      <ItemGroup class="p-1">
        <Item
          v-for="tool in BOT_TOOL_CATALOG"
          :key="tool.name"
          size="xs"
          class="hover:bg-muted"
          :disabled="isReadOnly"
          @click="insertToolPrompt(tool)"
        >
          <ItemMedia variant="icon">
            <Component :is="tool.icon" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{{ tool.label }}</ItemTitle>
            <ItemDescription>{{ tool.description }}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </CollapsibleContent>
    <div
      v-if="hasAttachedNodes"
      class="flex flex-wrap items-center gap-1 px-2 pt-2"
    >
      <Badge
        v-for="node in attachedNodeDetails"
        :key="`${node.scope}:${node.nodeId}`"
        :variant="node.status === 'ok' ? 'secondary' : 'destructive'"
        class="gap-1 pr-1"
      >
        <Component :is="node.type === 'folder' ? IconFolder : IconFile" />
        <span v-if="node.status === 'deleted'" class="max-w-40 truncate italic">
          {{ t("ai.attachedNodeDeleted") }}
        </span>
        <template v-else>
          <span class="max-w-40 truncate">{{ node.name }}</span>
          <span
            v-if="node.status === 'archived'"
            class="text-xs uppercase opacity-70"
          >
            {{ t("ai.attachedNodeArchived") }}
          </span>
          <span v-else class="text-muted-foreground text-xs uppercase">
            {{ node.scope }}
          </span>
        </template>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                :disabled="isReadOnly || isSending"
                @click="
                  detachAttachedNode({
                    scope: node.scope,
                    nodeId: node.nodeId,
                  })
                "
              >
                <IconX />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {{ t("ai.detachContextNode", { name: node.name }, node.name) }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Badge>
    </div>
    <InputGroup class="bg-background">
      <InputGroupTextarea
        ref="textareaRef"
        v-model="userInput"
        :placeholder="inputPlaceholder"
        :disabled="isSending || isReadOnly"
        @keydown="handleKeydown"
      />
      <InputGroupAddon align="block-end">
        <Sheet v-model:open="attachSheetOpen">
          <TooltipProvider>
            <Tooltip>
              <SheetTrigger as-child>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    variant="outline"
                    size="icon-xs"
                    :disabled="!canOpenAttachSheet"
                  >
                    <IconPlus />
                  </InputGroupButton>
                </TooltipTrigger>
              </SheetTrigger>
              <TooltipContent>
                {{
                  canAttachMoreNodes
                    ? t("ai.attachContext")
                    : t("ai.attachContextFull", {
                        count: BOT_CHAT_MAX_ATTACHED_NODES,
                      })
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SheetContent
            class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-xl border"
          >
            <SheetHeader>
              <SheetTitle>{{ t("ai.attachContext") }}</SheetTitle>
              <SheetDescription>
                {{ t("ai.attachContextDescription") }}
              </SheetDescription>
            </SheetHeader>
            <OverlayScrollbarsWrapper>
              <Tabs
                v-if="currentTeamId && currentWorkspaceId"
                class="gap-0"
                :model-value="activeAttachScope"
                @update:model-value="updateActiveAttachScope"
              >
                <TabsList class="m-2 bg-transparent">
                  <TabsTrigger value="code">
                    {{ t("ai.scopeCode") }}
                  </TabsTrigger>
                  <TabsTrigger value="write">
                    {{ t("ai.scopeWrite") }}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="code">
                  <Sidebar collapsible="none" class="w-full">
                    <SidebarContent>
                      <OverlayScrollbarsWrapper>
                        <FileTree
                          :team-id="currentTeamId"
                          :workspace-id="currentWorkspaceId"
                          :scope="'code'"
                          selection-mode="multiple"
                          :selection="codeAttachedIds"
                          @select="handleAttachNodeSelect('code', $event)"
                        />
                      </OverlayScrollbarsWrapper>
                    </SidebarContent>
                  </Sidebar>
                </TabsContent>
                <TabsContent value="write">
                  <Sidebar collapsible="none" class="w-full">
                    <SidebarContent>
                      <OverlayScrollbarsWrapper>
                        <FileTree
                          :team-id="currentTeamId"
                          :workspace-id="currentWorkspaceId"
                          :scope="'write'"
                          selection-mode="multiple"
                          :selection="writeAttachedIds"
                          @select="handleAttachNodeSelect('write', $event)"
                        />
                      </OverlayScrollbarsWrapper>
                    </SidebarContent>
                  </Sidebar>
                </TabsContent>
              </Tabs>
              <div v-else class="text-muted-foreground p-4 text-xs">
                {{ t("ai.attachContextNoWorkspace") }}
              </div>
              <div class="text-muted-foreground p-4 text-xs">
                {{
                  t("ai.attachContextCount", {
                    count: attachedNodes.length,
                    max: BOT_CHAT_MAX_ATTACHED_NODES,
                  })
                }}
              </div>
            </OverlayScrollbarsWrapper>
            <SheetFooter>
              <Button @click="attachSheetOpen = false">
                {{ t("actions.done") }}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
        <Select :model-value="mode" @update:model-value="onModeChange">
          <InputGroupButton variant="ghost" as-child>
            <SelectTrigger>
              <SelectValue :placeholder="t('ai.mode')">
                {{ modeLabel(mode) }}
              </SelectValue>
            </SelectTrigger>
          </InputGroupButton>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="option in modeOptions"
                :key="option.value"
                :value="option.value"
              >
                <div class="flex flex-col gap-0.5">
                  <span class="text-sm font-medium">
                    {{ modeLabel(option.value) }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ option.shortDescription }}
                  </span>
                </div>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <InputGroupText class="ml-auto text-xs">
          {{ usageLabel }}
        </InputGroupText>
        <Separator orientation="vertical" class="my-2" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <InputGroupButton
                variant="default"
                size="icon-xs"
                :disabled="isDisabled"
                @click="handleSend"
              >
                <IconArrowUp />
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>{{ t("actions.send") }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </InputGroupAddon>
    </InputGroup>
  </Collapsible>
</template>

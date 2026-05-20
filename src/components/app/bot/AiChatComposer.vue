<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MAX_ATTACHED_NODES,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
  type BotChatNodeRef,
} from "@/composables/useBotChat"
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { BOT_TOOL_CATALOG } from "@/data/botTools"
import {
  IconAiFill,
  IconArrowUp,
  IconBot,
  IconFile,
  IconFolder,
  IconPlus,
  IconWrench,
  IconX,
} from "@/data/icons"
import { findBotModel } from "@/helpers/defaults"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useTeamCustomToolsStore } from "@/stores/teamCustomToolsStore"
import type {
  IBotAgentModel,
  ITeamAgent,
  ITeamCustomTool,
} from "@/types/domain"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { storeToRefs } from "pinia"
import { computed, inject, nextTick, ref, watch, watchEffect } from "vue"
import type { Component } from "vue"
import Avatar from "vue-boring-avatars"

const { t } = useI18n()

// No `withDefaults` here: the placeholder default depends on `t()` from
// `useI18n()`, which is `const`-bound inside setup and thus unavailable
// at the module-scope evaluation point where the compiler hoists prop
// defaults. The fallback is applied at the consumption site below
// (`inputPlaceholder`) instead, which has full access to local refs.
const props = defineProps<{
  placeholder?: string
}>()

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

// ── Active model picker ──────────────────────────────────────────────────────
//
// Mirrors the mode dropdown's pattern: bind directly to `botChat.model`
// so the next `sendMessage` automatically picks up the chosen model and
// the side-panel (when it gains a model surface) stays in sync. The
// composable owns the seed-from-team-default, rehydrate-on-session-load,
// and clamp-to-allowlist behaviors so this component only renders.
//
// `availableModelsByProvider` is already filtered+grouped by the team's
// current provider/model toggles, so admins disabling a publisher
// removes its group here in the same tick — no extra plumbing.
//
// The `??` fallback never fires in practice (the `/bot` route and the
// inspector tab both `provide()` the context before mounting this
// component), but matches the mode dropdown's "default to auto"
// pattern so the trigger always has *something* to render.
const model = computed<IBotAgentModel>(
  () => botChat?.model.value ?? "gemini-3-flash-preview"
)
const availableModelsByProvider = computed(
  () => botChat?.availableModelsByProvider.value ?? []
)
// Catalog lookup for the *currently selected* model so the trigger
// renders a compact name + badge identical to the read-only display
// it replaces. `findBotModel` returns a synthetic stub for unknown ids
// so an out-of-catalog wire-name (server ahead of client) still
// renders something instead of crashing the trigger.
const activeModel = computed(() => findBotModel(model.value))
const onModelChange = (next: unknown) => {
  if (!botChat) return
  if (typeof next !== "string") return
  // Defensive — server clamps to the allowlist on receive, but rejecting
  // out-of-list picks here avoids a UI flicker where the trigger shows
  // a model that the next send would silently substitute.
  const allowed = availableModelsByProvider.value.some((group) =>
    group.models.some((entry) => entry.id === next)
  )
  if (!allowed) return
  botChat.model.value = next as IBotAgentModel
}

// ── Active agent picker (multi-agent persona swap) ────────────────────────
//
// Sidebar/inline badges let the user swap the conversation's persona
// without leaving the composer. We mirror the model+mode pattern: bind
// to `botChat.activeAgentId` directly so the next `sendMessage` picks
// up the change.
//
// Two related lists govern this UI:
//   - `pickerAgents` (the store's merged view) — what the user can
//     PICK FROM. Built-in presets (gated by `agentConfig.builtInAgents`)
//     come first, then enabled non-archived custom agents.
//   - `activeAgent` (the composable's full-list lookup) — the record
//     for the currently-bound agent, possibly disabled / archived /
//     deleted. Powers the badge label + status sub-label even when
//     the agent has fallen out of `pickerAgents`.
//
// The status sub-label ("Disabled" / "Archived" / "Deleted") comes
// from `botChat.activeAgentStatus` and renders inline on the active
// badge so the user sees at a glance why the chat may be dispatching
// under a different persona than the badge name suggests.

const teamAgentsStore = useTeamAgentsStore()
const { pickerAgents: availableAgents } = storeToRefs(teamAgentsStore)
const activeAgentId = computed<string | null>(
  () => botChat?.activeAgentId.value ?? null
)
const activeAgent = computed<ITeamAgent | null>(
  () => botChat?.activeAgent.value ?? null
)
const activeAgentStatus = computed<
  "active" | "disabled" | "archived" | "deleted" | null
>(() => botChat?.activeAgentStatus.value ?? null)
const hasAnyAgents = computed(() => availableAgents.value.length > 0)

/**
 * Whether to render the agents picker row at all. True when the team
 * has at least one selectable agent OR when the current chat has a
 * non-selectable (disabled / archived / deleted) agent pinned — the
 * row carries the status badge in that case so the user sees what's
 * happening even when there's nothing else to pick from.
 */
const showAgentsRow = computed(
  () =>
    hasAnyAgents.value ||
    phantomActiveAgent.value !== null ||
    activeAgentStatus.value === "deleted"
)

/**
 * Tooltip text for the phantom (non-selectable) active badge,
 * tailored to the specific lifecycle state. Empty when no phantom
 * badge is showing — the v-if on the badge keeps it from rendering
 * at all in that case.
 */
const phantomActiveTooltip = computed<string>(() => {
  switch (activeAgentStatus.value) {
    case "disabled":
      return t("ai.agents.disabledTooltip")
    case "archived":
      return t("ai.agents.archivedTooltip")
    case "deleted":
      return t("ai.agents.deletedTooltip")
    default:
      return ""
  }
})

/**
 * The currently-selected agent might be disabled, archived, or
 * deleted — in which case it won't appear in `availableAgents`. We
 * still want to render a badge for it so the user sees what they
 * picked. This computed surfaces it as a "phantom" entry the picker
 * appends to the visible list. Returns null when the active agent
 * IS in `availableAgents` (no duplication needed) or when there's
 * no active agent at all.
 */
const phantomActiveAgent = computed<ITeamAgent | null>(() => {
  const agent = activeAgent.value
  if (!agent) return null
  if (availableAgents.value.some((a) => a.id === agent.id)) return null
  return agent
})

/**
 * Label suffix appended to the active badge when its status is
 * anything other than "active". Localized via the `ai.agents.status*`
 * key family. Empty string when no decoration is needed so the badge
 * just shows the agent's name.
 */
const activeStatusLabel = computed<string>(() => {
  switch (activeAgentStatus.value) {
    case "disabled":
      return t("ai.agents.statusDisabled")
    case "archived":
      return t("ai.agents.statusArchived")
    case "deleted":
      return t("ai.agents.statusDeleted")
    default:
      return ""
  }
})

const onAgentSelect = (agentId: string | null): void => {
  if (!botChat) return
  if (isReadOnly.value) return
  // Toggle: clicking the already-active badge clears back to default
  // so users can deselect without hunting for a separate button.
  if (agentId !== null && activeAgentId.value === agentId) {
    botChat.selectAgent(null)
    return
  }
  botChat.selectAgent(agentId)
}
const agentAvatarSeed = (agent: ITeamAgent): string =>
  agent.avatarSeed.trim() || agent.name.trim() || agent.id

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

// ── Reply prefill ────────────────────────────────────────────────────────────
//
// `AiChat` (sibling component) writes a Markdown blockquote of the
// message being replied to into `pendingComposerDraft`. We consume it
// once: prepend (separated by a blank line so the user's pre-existing
// draft stays grouped as its own paragraph), focus the textarea, park
// the caret at the end, then reset the ref to null so the same reply
// doesn't get re-injected on subsequent runs of the watcher.
//
// Read-only / archived sessions: still allowed. The textarea is
// disabled in those modes so the user can't add to it or send, but
// they can read the quote and the model's response that prompted it.
// Suppressing the prefill there would silently swallow the click,
// which is worse UX than showing the quote in a disabled state.
watch(
  () => botChat?.pendingComposerDraft.value ?? null,
  (next) => {
    if (next === null) return
    const existing = userInput.value
    userInput.value = existing.trim().length
      ? `${next}\n\n${existing}`
      : `${next}\n\n`
    if (botChat) botChat.pendingComposerDraft.value = null
    nextTick(() => {
      const el = textareaRef.value?.$el
      if (!el) return
      el.focus()
      const caret = userInput.value.length
      el.setSelectionRange(caret, caret)
    })
  }
)

// ── Tool picker ──────────────────────────────────────────────────────────────
//
// Click the AI badge on top of the composer to expand a list of tools the
// bot can call. Picking one inserts that tool's example prompt into the
// textarea at the current caret (or appends to the end if the textarea
// hasn't been focused). The picker auto-collapses after a pick. Tool
// dispatch on the model side is driven by natural-language intent, not by
// any sigil syntax — that's why we insert a full sentence, not "/cmd".
//
// The visible catalog is filtered to match what the server will actually
// register for the upcoming turn — mirrors `pickChatTools` in
// `functions/src/bot.ts`, intersecting team-level and agent-level toggles
// so a badge never inserts a prompt the model has no tool to satisfy.

const agentConfigStore = useAgentConfigStore()
const { config: teamAgentConfig } = storeToRefs(agentConfigStore)

const teamCustomToolsStore = useTeamCustomToolsStore()
const { selectableTools: teamSelectableCustomTools } =
  storeToRefs(teamCustomToolsStore)

/**
 * Shared display shape for the composer's tool picker. Both built-in
 * `BotToolDescriptor`s and admin-authored `ITeamCustomTool`s funnel
 * into this shape so the picker renders a single uniform list. The
 * `kind` discriminator lets the template tag custom tools with a
 * "Custom" badge without re-deriving from the source.
 */
interface ComposerToolEntry {
  /** Unique render key — wire-name for built-ins, doc id for custom. */
  key: string
  /** What the model invokes by — also what the user sees on the badge. */
  label: string
  description: string
  icon: Component
  /** Prompt text inserted into the textarea on pick. */
  example: string
  kind: "builtin" | "custom"
}

/**
 * Synthesize a sentence-opener for a custom tool's slash-menu example.
 * Mirrors the built-in catalog's "user fills in the rest" pattern
 * (e.g. `"What's the weather in "`). We deliberately mention the tool
 * by name — admins author these and want them discoverable, unlike
 * built-ins where the design intentionally hides the wire-name from
 * users. A trailing space leaves the caret in a natural position for
 * the user to keep typing.
 */
const buildCustomToolExample = (tool: ITeamCustomTool): string => {
  const displayLabel = tool.displayName.trim() || tool.name
  return `Use ${displayLabel} to `
}

const availableTools = computed<readonly ComposerToolEntry[]>(() => {
  const teamTools = teamAgentConfig.value.tools
  const agentTools = activeAgent.value?.tools
  const agentCustomToolOverrides = activeAgent.value?.customTools
  const entries: ComposerToolEntry[] = []

  // Built-ins — apply the same team×agent intersection the server
  // dispatcher uses (`pickChatTools` in `functions/src/bot.ts`).
  for (const tool of BOT_TOOL_CATALOG) {
    if (teamTools[tool.name] === false) continue
    if (agentTools && agentTools[tool.name] === false) continue
    entries.push({
      key: tool.name,
      label: tool.label,
      description: tool.description,
      icon: tool.icon,
      example: tool.example,
      kind: "builtin",
    })
  }

  // Custom tools — `selectableTools` already filters by the team-wide
  // `customTools` gate + per-tool `enabled && !archivedAt`. Layer the
  // per-agent override on top here so the picker mirrors what the
  // dispatcher would actually register on the next send. Missing keys
  // default to enabled (`!== false`), matching the opt-out convention
  // shared with built-in toggles.
  for (const tool of teamSelectableCustomTools.value) {
    if (
      agentCustomToolOverrides &&
      agentCustomToolOverrides[tool.id] === false
    ) {
      continue
    }
    entries.push({
      key: tool.id,
      label: tool.displayName.trim() || tool.name,
      description: tool.description,
      icon: IconWrench,
      example: buildCustomToolExample(tool),
      kind: "custom",
    })
  }

  return entries
})

const toolsOpen = ref(false)

const insertToolPrompt = (tool: ComposerToolEntry) => {
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
  <Collapsible v-model:open="toolsOpen" class="bg-muted m-2 rounded">
    <TooltipProvider>
      <Tooltip>
        <CollapsibleTrigger as-child>
          <TooltipTrigger as-child>
            <Badge variant="ghost" class="m-2">
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
      <div
        v-if="availableTools.length > 0"
        class="flex flex-wrap items-center gap-2 px-2 pb-2"
      >
        <TooltipProvider>
          <Tooltip v-for="tool in availableTools" :key="tool.key">
            <TooltipTrigger as-child>
              <Badge
                :class="{ 'pointer-events-none opacity-50': isReadOnly }"
                @click="insertToolPrompt(tool)"
              >
                <Component :is="tool.icon" />
                <!--
                  Custom tools render the wire-name in a monospace
                  span — visual cue that this is an identifier the
                  model invokes by, separating it from built-ins
                  whose labels are prose ("Weather", "Roll dice").
                  Built-ins keep their plain-text label.
                -->
                <span v-if="tool.kind === 'custom'" class="font-mono text-xs">{{
                  tool.label
                }}</span>
                <template v-else>{{ tool.label }}</template>
                <Badge
                  v-if="tool.kind === 'custom'"
                  variant="secondary"
                  class="text-xs"
                >
                  {{ t("ai.tools.customBadge") }}
                </Badge>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{{ tool.description }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <!--
        Agent picker badges. Visible only when the team has at least one
        custom agent — otherwise the whole row would just show "Default"
        with no alternatives, which is noise. Each badge toggles the
        active persona; clicking the already-active one clears back to
        default. Selected state is filled (Badge default variant);
        inactive options use the outline variant for visual quietness.
      -->
      <div
        v-if="showAgentsRow"
        class="flex flex-wrap items-center gap-2 border-t px-2 pt-2 pb-2"
      >
        <span class="text-muted-foreground mr-1 text-xs">
          {{ t("ai.agents.label") }}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                :variant="activeAgentId === null ? 'default' : 'outline'"
                :class="{ 'pointer-events-none opacity-50': isReadOnly }"
                @click="onAgentSelect(null)"
              >
                <IconBot />
                {{ t("ai.agents.default") }}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{{ t("ai.agents.defaultTooltip") }}</TooltipContent>
          </Tooltip>
          <Tooltip v-for="agent in availableAgents" :key="agent.id">
            <TooltipTrigger as-child>
              <Badge
                :variant="activeAgentId === agent.id ? 'default' : 'outline'"
                :class="{ 'pointer-events-none opacity-50': isReadOnly }"
                @click="onAgentSelect(agent.id)"
              >
                <span class="size-4 shrink-0 overflow-hidden rounded-full">
                  <Avatar
                    variant="beam"
                    :name="agentAvatarSeed(agent)"
                    :colors="[
                      'var(--color-chart-1)',
                      'var(--color-chart-2)',
                      'var(--color-chart-3)',
                      'var(--color-chart-4)',
                      'var(--color-chart-5)',
                    ]"
                  />
                </span>
                {{ agent.name }}
                <!--
                  Mirrors the "Custom" tag on custom tools — built-ins
                  ship with the app, custom agents are admin-authored,
                  so the badge distinguishes the two sources at a
                  glance. `isBuiltInAgentId` keys off the `_` prefix
                  convention; no need to recompute server-side.
                -->
                <Badge
                  v-if="!isBuiltInAgentId(agent.id)"
                  variant="secondary"
                  class="text-xs"
                >
                  {{ t("ai.agents.customBadge") }}
                </Badge>
              </Badge>
            </TooltipTrigger>
            <TooltipContent v-if="agent.description">
              {{ agent.description }}
            </TooltipContent>
          </Tooltip>
          <!--
            Phantom badge for an active agent that's NOT in the
            selectable list — i.e. the admin disabled, archived, or
            hard-deleted the agent after this chat was bound to it.
            The badge renders the agent's name (if the record still
            exists) plus a status sub-label so the user can see why
            their chat may be dispatching under a different persona.
            Click-deselect is intentionally NOT wired — the badge is
            informational; the only way out is to pick a different
            agent or the default.
          -->
          <Tooltip v-if="phantomActiveAgent || activeAgentStatus === 'deleted'">
            <TooltipTrigger as-child>
              <Badge variant="default" class="pointer-events-none opacity-80">
                <span
                  v-if="phantomActiveAgent"
                  class="size-4 shrink-0 overflow-hidden rounded-full"
                >
                  <Avatar
                    variant="beam"
                    :name="agentAvatarSeed(phantomActiveAgent)"
                    :colors="[
                      'var(--color-chart-1)',
                      'var(--color-chart-2)',
                      'var(--color-chart-3)',
                      'var(--color-chart-4)',
                      'var(--color-chart-5)',
                    ]"
                  />
                </span>
                <IconBot v-else />
                {{
                  phantomActiveAgent?.name ?? t("ai.agents.deletedAgentLabel")
                }}
                <span class="text-xs opacity-80"
                  >· {{ activeStatusLabel }}</span
                >
              </Badge>
            </TooltipTrigger>
            <TooltipContent v-if="phantomActiveTooltip">
              {{ phantomActiveTooltip }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </CollapsibleContent>
    <div
      v-if="hasAttachedNodes"
      class="flex flex-wrap items-center gap-2 px-2 pb-2"
    >
      <Badge
        v-for="node in attachedNodeDetails"
        :key="`${node.scope}:${node.nodeId}`"
        :variant="node.status === 'ok' ? 'secondary' : 'outline'"
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
              <InputGroupButton
                size="icon-xs"
                class="size-3"
                :disabled="isReadOnly || isSending"
                @click="
                  detachAttachedNode({
                    scope: node.scope,
                    nodeId: node.nodeId,
                  })
                "
              >
                <IconX />
              </InputGroupButton>
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
                <span class="flex items-center gap-2">
                  {{ modeLabel(mode) }}
                </span>
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
                  <span class="flex items-center gap-2 text-sm font-medium">
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
        <Select :model-value="model" @update:model-value="onModelChange">
          <InputGroupButton variant="ghost" class="ml-auto" as-child>
            <SelectTrigger>
              <SelectValue :placeholder="t('ai.model')">
                <span class="flex items-center gap-2">
                  {{ activeModel.name }}
                  <Badge
                    v-if="activeModel.badge"
                    variant="secondary"
                    class="text-xs"
                  >
                    {{ activeModel.badge }}
                  </Badge>
                </span>
              </SelectValue>
            </SelectTrigger>
          </InputGroupButton>
          <SelectContent>
            <template
              v-for="(group, groupIndex) in availableModelsByProvider"
              :key="group.id"
            >
              <SelectGroup>
                <SelectLabel>{{ group.name }}</SelectLabel>
                <SelectItem
                  v-for="entry in group.models"
                  :key="entry.id"
                  :value="entry.id"
                >
                  <div class="flex flex-col gap-0.5">
                    <span class="flex items-center gap-2 text-sm font-medium">
                      {{ entry.name }}
                      <Badge
                        v-if="entry.badge"
                        variant="secondary"
                        class="text-xs"
                      >
                        {{ entry.badge }}
                      </Badge>
                    </span>
                    <span class="text-muted-foreground text-xs">
                      {{ entry.description }}
                    </span>
                  </div>
                </SelectItem>
              </SelectGroup>
              <SelectSeparator
                v-if="groupIndex < availableModelsByProvider.length - 1"
              />
            </template>
          </SelectContent>
        </Select>
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

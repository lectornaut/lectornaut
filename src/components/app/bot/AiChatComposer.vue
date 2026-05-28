<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MAX_ATTACHED_NODES,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
  type BotChatNodeRef,
} from "@/composables/useBotChat"
import { useDictation } from "@/composables/useDictation"
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { BOT_NODE_TOOL_CATALOG, BOT_TOOL_CATALOG } from "@/data/botTools"
import {
  IconAiFill,
  IconArrowUp,
  IconBadgeCheck,
  IconBot,
  IconFile,
  IconFolder,
  IconMic,
  IconPlus,
  IconWrench,
  IconX,
} from "@/data/icons"
import { findBotModel } from "@/helpers/defaults"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useTeamCustomToolsStore } from "@/stores/teamCustomToolsStore"
import type {
  IBotAgentModel,
  ITeamAgent,
  ITeamCustomTool,
} from "@/types/domain"
import { isAgentMembership } from "@/types/membership"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { can, Capabilities } from "@/types/permissions"
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

// ── Voice dictation (Web Speech API) ──────────────────────────────────────
// Appends spoken words to the composer input; see `useDictation`. The mic
// button (left of Send) toggles it and is hidden when the browser has no
// SpeechRecognition. `handleSend` stops it so a trailing result can't
// repopulate the just-cleared field.
const {
  isSupported: isDictationSupported,
  isListening: isDictating,
  toggleDictation,
  stopDictation,
} = useDictation(userInput)

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

// Agents added as members of the active team get a check-badge on their
// row in the picker dropdown — mirrors the indicator the Agents sidebar
// and the Navigation edit submenu render. `teamMembers` is already scoped
// to the current team, so we narrow to the agent rows and key by agentId
// for an O(1) per-row lookup.
const membershipStore = useMembershipStore()
const { teamMembers, currentUserRole } = storeToRefs(membershipStore)
const { currentUser } = storeToRefs(authStore)
const memberAgentIds = computed(
  () =>
    new Set(
      teamMembers.value
        .filter(isAgentMembership)
        .map((member) => member.agentId)
    )
)

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

// Partition selectable agents for the grouped picker: built-in presets
// vs. admin-authored custom agents. `isBuiltInAgentId` keys off the `_`
// id prefix — the same signal the removed per-item "Custom" badge used.
const builtInAgents = computed(() =>
  availableAgents.value.filter((agent) => isBuiltInAgentId(agent.id))
)
const customAgents = computed(() =>
  availableAgents.value.filter((agent) => !isBuiltInAgentId(agent.id))
)

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

// Sentinel value for the "Default" option. `<Select>` items need a
// non-empty string value, and `null` (clear back to the built-in
// persona) can't round-trip through reka-ui's string-keyed model — so we
// map null↔sentinel at the boundary. Double-underscore can't collide
// with real agent ids (built-ins use a single `_` prefix, e.g.
// `_researcher`).
const AGENT_DEFAULT_VALUE = "__default__"

// Drives the Select trigger. A phantom (disabled/archived/deleted) active
// agent keeps its id here even though it has no matching SelectItem — the
// trigger renders it via the SelectValue slot regardless.
const agentSelectValue = computed(
  () => activeAgentId.value ?? AGENT_DEFAULT_VALUE
)

const onAgentChange = (next: unknown): void => {
  if (!botChat) return
  if (isReadOnly.value) return
  if (typeof next !== "string") return
  if (next === AGENT_DEFAULT_VALUE) {
    botChat.selectAgent(null)
    return
  }
  // Allowlist guard mirroring onModeChange/onModelChange: only ids in the
  // selectable list are pickable. Phantom agents render in the trigger
  // but can't be re-selected — the only way out is Default or another
  // listed agent.
  if (!availableAgents.value.some((a) => a.id === next)) return
  botChat.selectAgent(next)
}

const agentAvatarSeed = (agent: ITeamAgent): string =>
  agent.avatarSeed.trim() || agent.name.trim() || agent.id

// Shared palette so each agent's generated `vue-boring-avatars` "beam"
// avatar uses the app's chart tokens. Hoisted to a const because the
// trigger and every dropdown item reference the same array.
const agentAvatarColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
]

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
  stopDictation()
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
 * Shared display shape for the composer's tool picker. Built-in
 * `BotToolDescriptor`s, node-CRUD `BotNodeToolDescriptor`s, and
 * admin-authored `ITeamCustomTool`s all funnel into this shape so the
 * picker renders a single uniform list. The `kind` discriminator partitions
 * the flat list into the three template groups ("Tools", "Content",
 * "Custom") without re-deriving from the source.
 */
interface ComposerToolEntry {
  /** Unique render key — wire-name for built-ins/node, doc id for custom. */
  key: string
  /** What the model invokes by — also what the user sees on the badge. */
  label: string
  description: string
  icon: Component
  /** Prompt text inserted into the textarea on pick. */
  example: string
  kind: "builtin" | "content" | "custom"
}

/**
 * Synthesize a sentence-opener for a custom tool's slash-menu example.
 * Mirrors the built-in catalog's "user fills in the rest" pattern
 * (e.g. `"Search the web for "`). We deliberately mention the tool
 * by name — admins author these and want them discoverable, unlike
 * built-ins where the design intentionally hides the wire-name from
 * users. A trailing space leaves the caret in a natural position for
 * the user to keep typing.
 */
const buildCustomToolExample = (tool: ITeamCustomTool): string => {
  const displayLabel = tool.displayName.trim() || tool.name
  return `Use ${displayLabel} to `
}

// ── Node-tool visibility gate ────────────────────────────────────────────────
//
// Mirrors `bot.ts`'s `nodeWriteEnabled` / `nodeReadEnabled` (see lines
// ~1985–2036 in `functions/src/bot.ts`). Two layers stacked:
//
//   1. Security — membership × capability. BOTH the active agent AND the
//      current user must be team members with the relevant capability
//      (`MANAGE_WORKSPACE_CONTENT` for write, `READ_WORKSPACE` for read).
//      `null` role short-circuits `can()` to `false`, so a non-member
//      agent / non-member user keeps the gate closed automatically.
//   2. Feature toggle — team-wide AND per-agent `manageContent` /
//      `readContent` switches. Missing keys default to `true` (the
//      `!== false` check) to match the server's opt-out convention.
//
// Default persona (no active agent) gets nothing: the server-side
// agent-capability check is `!!activeAgent && can(...)`. We mirror that
// by gating the agent role on `activeAgent.value` being non-null.
//
// The activeAgentMembershipRole resolves on-demand from the membership
// store, so a freshly-added agent membership flips the gate live as the
// store updates.
const activeAgentMembershipRole = computed(() => {
  const agentId = activeAgentId.value
  if (!agentId) return null
  const row = teamMembers.value
    .filter(isAgentMembership)
    .find((member) => member.agentId === agentId)
  return row?.role ?? null
})

const nodeWriteEnabled = computed(() => {
  if (!activeAgent.value) return false
  const userCan = can(
    currentUser.value,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
    {
      scope: "workspace",
      teamRole: currentUserRole.value,
    }
  )
  const agentCan = can(
    activeAgent.value.id,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
    { scope: "workspace", teamRole: activeAgentMembershipRole.value }
  )
  if (!userCan || !agentCan) return false
  if (teamAgentConfig.value.tools.manageContent === false) return false
  if (activeAgent.value.tools.manageContent === false) return false
  return true
})

const nodeReadEnabled = computed(() => {
  if (!activeAgent.value) return false
  const userCan = can(currentUser.value, Capabilities.READ_WORKSPACE, {
    scope: "workspace",
    teamRole: currentUserRole.value,
  })
  const agentCan = can(activeAgent.value.id, Capabilities.READ_WORKSPACE, {
    scope: "workspace",
    teamRole: activeAgentMembershipRole.value,
  })
  if (!userCan || !agentCan) return false
  if (teamAgentConfig.value.tools.readContent === false) return false
  if (activeAgent.value.tools.readContent === false) return false
  return true
})

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

  // Node-CRUD tools — registered server-side as two independently-gated
  // blocks (`NODE_READ_TOOLS` / `NODE_WRITE_TOOLS` in `botNodeTools.ts`).
  // A read-only agent only sees `readNode`; an editor agent sees the
  // whole set. When neither gate holds (e.g. default persona, non-member
  // agent, or toggles off) the catalog contributes nothing here and the
  // group's `v-if` in the template hides the section entirely.
  const writeOk = nodeWriteEnabled.value
  const readOk = nodeReadEnabled.value
  if (writeOk || readOk) {
    for (const tool of BOT_NODE_TOOL_CATALOG) {
      if (tool.kind === "read" && !readOk) continue
      if (tool.kind === "write" && !writeOk) continue
      entries.push({
        key: tool.name,
        label: tool.label,
        description: tool.description,
        icon: tool.icon,
        example: tool.example,
        kind: "content",
      })
    }
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

// Split the flat tool list into built-in / node-CRUD / admin-authored
// custom for the grouped dropdown. The `kind` discriminator was set when
// each entry was pushed into `availableTools`, so this is a cheap
// partition.
const builtInTools = computed(() =>
  availableTools.value.filter((tool) => tool.kind === "builtin")
)
const contentTools = computed(() =>
  availableTools.value.filter((tool) => tool.kind === "content")
)
const customTools = computed(() =>
  availableTools.value.filter((tool) => tool.kind === "custom")
)

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
  // The menu auto-closes on item select; `toolsOpen` syncs back via
  // `v-model:open`, so no manual close is needed here.
}

// Keep the caret in the textarea after picking a tool. reka-ui restores
// focus to the trigger button when the menu closes; we prevent that so
// `insertToolPrompt`'s `el.focus()` wins and the user can keep typing
// right where the example prompt was inserted.
const onToolMenuCloseAutoFocus = (event: Event) => {
  event.preventDefault()
}
</script>

<template>
  <div class="mx-2 mb-2 grid gap-2">
    <InputGroup class="bg-background">
      <InputGroupTextarea
        ref="textareaRef"
        v-model="userInput"
        :placeholder="inputPlaceholder"
        :disabled="isSending || isReadOnly"
        @keydown="handleKeydown"
      />
      <InputGroupAddon v-if="hasAttachedNodes" align="block-start">
        <ItemGroup>
          <Item
            v-for="node in attachedNodeDetails"
            :key="`${node.scope}:${node.nodeId}`"
            :variant="node.status === 'ok' ? 'muted' : 'outline'"
            size="xs"
          >
            <ItemMedia variant="icon">
              <Component :is="node.type === 'folder' ? IconFolder : IconFile" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle v-if="node.status === 'deleted'" class="italic">
                {{ t("ai.attachedNodeDeleted") }}
              </ItemTitle>
              <template v-else>
                <ItemTitle>{{ node.name }}</ItemTitle>
                <ItemDescription
                  v-if="node.status === 'archived'"
                  class="uppercase"
                >
                  {{ t("ai.attachedNodeArchived") }}
                </ItemDescription>
                <ItemDescription v-else class="uppercase">
                  {{ node.scope }}
                </ItemDescription>
              </template>
            </ItemContent>
            <ItemActions>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
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
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      t("ai.detachContextNode", { name: node.name }, node.name)
                    }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ItemActions>
          </Item>
        </ItemGroup>
      </InputGroupAddon>
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
        <Separator orientation="vertical" class="my-2" />
        <DropdownMenu v-model:open="toolsOpen">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-xs">
                    <IconAiFill />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  v-if="availableTools.length > 0"
                  class="w-auto"
                  @close-auto-focus="onToolMenuCloseAutoFocus"
                >
                  <DropdownMenuGroup v-if="builtInTools.length > 0">
                    <DropdownMenuLabel>
                      {{ t("ai.tools.groupBuiltIn") }}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      v-for="tool in builtInTools"
                      :key="tool.key"
                      :disabled="isReadOnly"
                      @select="insertToolPrompt(tool)"
                    >
                      <Component :is="tool.icon" />
                      {{ tool.label }}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <!--
                    Node-CRUD tools — only render when the active agent is
                    a content-capable team member (mirrors `pickChatTools`
                    in `functions/src/bot.ts`). Read-only agents get the
                    READ entry; full editors get the WRITE entries too.
                  -->
                  <template v-if="contentTools.length > 0">
                    <DropdownMenuSeparator v-if="builtInTools.length > 0" />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        {{ t("ai.tools.groupContent") }}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        v-for="tool in contentTools"
                        :key="tool.key"
                        :disabled="isReadOnly"
                        @select="insertToolPrompt(tool)"
                      >
                        <Component :is="tool.icon" />
                        {{ tool.label }}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </template>
                  <template v-if="customTools.length > 0">
                    <DropdownMenuSeparator
                      v-if="builtInTools.length > 0 || contentTools.length > 0"
                    />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        {{ t("ai.tools.groupCustom") }}
                      </DropdownMenuLabel>
                      <!--
                        Custom tools render the wire-name in a monospace
                        span — a cue that this is an identifier the model
                        invokes by, vs. built-ins whose labels are prose.
                      -->
                      <DropdownMenuItem
                        v-for="tool in customTools"
                        :key="tool.key"
                        :disabled="isReadOnly"
                        @select="insertToolPrompt(tool)"
                      >
                        <Component :is="tool.icon" />
                        {{ tool.label }}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </template>
                </DropdownMenuContent>
              </TooltipTrigger>
              <TooltipContent>
                {{ toolsOpen ? t("ai.hideTools") : t("ai.showTools") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DropdownMenu>
        <!-- <InputGroupText class="ml-auto"> 52% used </InputGroupText> -->
        <Select
          v-if="showAgentsRow"
          :model-value="agentSelectValue"
          :disabled="isReadOnly"
          @update:model-value="onAgentChange"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton variant="ghost" class="ml-auto" as-child>
                  <SelectTrigger>
                    <SelectValue :placeholder="t('ai.agents.label')">
                      <InputGroupText>
                        <!-- Default persona: no avatar, just the bot glyph. -->
                        <template v-if="activeAgentId === null">
                          <IconBot />
                          {{ t("ai.agents.default") }}
                        </template>
                        <!-- Active agent we still have a record for (selectable
                         or phantom): avatar + name + optional status suffix. -->
                        <template v-else-if="activeAgent">
                          <span
                            class="size-4 shrink-0 overflow-hidden rounded-full"
                          >
                            <Avatar
                              variant="beam"
                              :name="agentAvatarSeed(activeAgent)"
                              :colors="agentAvatarColors"
                            />
                          </span>
                          {{ activeAgent.name }}
                          <span
                            v-if="activeStatusLabel"
                            class="text-muted-foreground text-xs"
                          >
                            · {{ activeStatusLabel }}
                          </span>
                        </template>
                        <!-- Hard-deleted agent: no record left, fall back to a
                         generic label + the "Deleted" suffix. -->
                        <template v-else>
                          <IconBot />
                          {{ t("ai.agents.deletedAgentLabel") }}
                          <span
                            v-if="activeStatusLabel"
                            class="text-muted-foreground text-xs"
                          >
                            · {{ activeStatusLabel }}
                          </span>
                        </template>
                      </InputGroupText>
                    </SelectValue>
                  </SelectTrigger>
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{{ t("ai.agents.tooltip") }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{{ t("ai.agents.groupBuiltIn") }}</SelectLabel>
              <SelectItem :value="AGENT_DEFAULT_VALUE">
                <Item size="xs" class="border-0 p-0">
                  <ItemMedia variant="icon">
                    <IconBot />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ t("ai.agents.default") }}</ItemTitle>
                    <ItemDescription>
                      {{ t("ai.agents.defaultTooltip") }}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </SelectItem>
              <SelectItem
                v-for="agent in builtInAgents"
                :key="agent.id"
                :value="agent.id"
              >
                <Item size="xs" class="border-0 p-0">
                  <ItemMedia variant="icon">
                    <span class="size-4 shrink-0 overflow-hidden rounded-full">
                      <Avatar
                        variant="beam"
                        :name="agentAvatarSeed(agent)"
                        :colors="agentAvatarColors"
                      />
                    </span>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ agent.name }}</ItemTitle>
                    <ItemDescription v-if="agent.description">
                      {{ agent.description }}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions v-if="memberAgentIds.has(agent.id)">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <span>
                            <IconBadgeCheck />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {{ t("ai.agents.teamMember") }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </ItemActions>
                </Item>
              </SelectItem>
            </SelectGroup>
            <template v-if="customAgents.length > 0">
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{{ t("ai.agents.groupCustom") }}</SelectLabel>
                <SelectItem
                  v-for="agent in customAgents"
                  :key="agent.id"
                  :value="agent.id"
                >
                  <Item size="xs" class="border-0 p-0">
                    <ItemMedia variant="icon">
                      <span
                        class="size-4 shrink-0 overflow-hidden rounded-full"
                      >
                        <Avatar
                          variant="beam"
                          :name="agentAvatarSeed(agent)"
                          :colors="agentAvatarColors"
                        />
                      </span>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{{ agent.name }}</ItemTitle>
                      <ItemDescription v-if="agent.description">
                        {{ agent.description }}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions v-if="memberAgentIds.has(agent.id)">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <span>
                              <IconBadgeCheck />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {{ t("ai.agents.teamMember") }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </ItemActions>
                  </Item>
                </SelectItem>
              </SelectGroup>
            </template>
          </SelectContent>
        </Select>
        <Separator orientation="vertical" class="my-2" />
        <TooltipProvider v-if="isDictationSupported">
          <Tooltip>
            <TooltipTrigger as-child>
              <InputGroupButton
                variant="ghost"
                size="icon-xs"
                :class="isDictating ? 'text-destructive animate-pulse' : ''"
                :disabled="isReadOnly || isSending"
                :aria-pressed="isDictating"
                @click="toggleDictation"
              >
                <IconMic />
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>
              {{ isDictating ? t("ai.dictateStop") : t("ai.dictate") }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
    <!--
      Agent picker. Visible only when the team has a selectable agent OR
      the chat is pinned to a non-selectable (disabled / archived /
      deleted) one — otherwise the dropdown would offer nothing but
      "Default", which is noise. The trigger reflects the active persona
      (including a phantom one, with a status suffix); the dropdown lists
      Default + every selectable agent. Picking "Default" clears back to
      the built-in persona.
    -->
    <div class="flex flex-wrap items-center gap-2">
      <Select
        :model-value="mode"
        :disabled="isReadOnly"
        @update:model-value="onModeChange"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <InputGroupButton variant="ghost" as-child>
                <SelectTrigger>
                  <SelectValue :placeholder="t('ai.mode')">
                    <InputGroupText class="text-xs">
                      {{ modeLabel(mode) }}
                    </InputGroupText>
                  </SelectValue>
                </SelectTrigger>
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>{{ t("ai.modeTooltip") }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
      <Select
        :model-value="model"
        :disabled="isReadOnly"
        @update:model-value="onModelChange"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <InputGroupButton variant="ghost" class="ml-auto" as-child>
                <SelectTrigger>
                  <SelectValue :placeholder="t('ai.model')">
                    <InputGroupText class="text-xs">
                      {{ activeModel.name }}
                      <Badge
                        v-if="activeModel.badge"
                        variant="secondary"
                        class="text-xs"
                      >
                        {{ activeModel.badge }}
                      </Badge>
                    </InputGroupText>
                  </SelectValue>
                </SelectTrigger>
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>{{ t("ai.modelTooltip") }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
    </div>
  </div>
</template>

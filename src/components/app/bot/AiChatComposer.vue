<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MAX_ATTACHED_NODES,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
  type BotChatNodeRef,
} from "@/composables/useBotChat"
import { useDictation } from "@/composables/useDictation"
import type { BotSessionPendingAttachment } from "@/composables/useFunctions"
import {
  stageBotSessionAttachmentBlob,
  useSessionAttachmentsState,
  type BotSessionAttachmentContext,
} from "@/composables/useSessionAttachments"
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { BOT_NODE_TOOL_CATALOG, BOT_TOOL_CATALOG } from "@/data/botTools"
import {
  IconAiFill,
  IconArrowUp,
  IconAsterisk,
  IconAtSign,
  IconBadgeCheck,
  IconBot,
  IconFile,
  IconFolder,
  IconLogosGoogleDrive,
  IconMic,
  IconPlus,
  IconUpload,
  IconX,
} from "@/data/icons"
import { findBotModel } from "@/helpers/defaults"
import { NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES } from "@/helpers/node-attachments"
import { generateId } from "@/helpers/utilities"
import { useIntegrationsStore } from "@/stores/integrationsStore"
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
import { toast } from "vue-sonner"

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
// button (left of Send) toggles it and is hidden when dictation is
// unavailable — unsupported by the browser, or switched off in Preferences.
// `handleSend` stops it so a trailing result can't repopulate the
// just-cleared field.
const {
  isAvailable: isDictationAvailable,
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

// ── Session attachments (uploaded files) ──────────────────────────────────
//
// Uploaded files live on the chat session (full CRUD in the Bot inspector's
// "Attachments" tab). Here we expose a quick "Upload files" action + chips
// for the per-turn selection so the recurring token cost stays visible.
// Scoped to the current session id; on a brand-new chat (null) this query is
// idle and picks are buffered locally instead (see `pendingUploadFiles`),
// then staged + sent with the first message — so uploads no longer wait on a
// session existing.
const sessionAttachmentContext = computed<BotSessionAttachmentContext | null>(
  () => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    const sessionId = botChat?.sessionId.value ?? null
    if (!teamId || !workspaceId || !sessionId) return null
    return { teamId, workspaceId, sessionId }
  }
)
const { attachments: sessionAttachments, createAttachmentFromFile } =
  useSessionAttachmentsState(sessionAttachmentContext)

const selectedAttachmentIds = computed<string[]>(
  () => botChat?.selectedAttachmentIds.value ?? []
)
const selectedAttachments = computed(() =>
  selectedAttachmentIds.value.map((id) => ({
    id,
    name:
      sessionAttachments.value.find((entry) => entry.id === id)?.displayName ??
      "File",
  }))
)
const hasSelectedAttachments = computed(
  () => selectedAttachments.value.length > 0
)
const deselectAttachment = (id: string) =>
  botChat?.toggleAttachmentSelection(id)

// Uploads no longer require an existing session: on a brand-new chat the
// picked files are buffered locally (preview chips) and their bytes are staged
// + sent with the first message (see `handleSend`). The gate matches "attach
// context" — team + workspace + editable.
const canUploadFiles = computed(() => canOpenAttachSheet.value)

// Brand-new chat (no session id yet): files the user picked, held as local
// previews and uploaded only when the first message is sent. Deferring the
// upload to send avoids creating a session — or orphaning blobs — for a chat
// the user never sends. On an existing session the immediate-upload path in
// `watch(uploadFiles)` is used instead.
// Shared on the BotChatContext so the inspector's Attachments tab can buffer
// into the same first-message staging path (see `useBotChat`). Fallback ref
// keeps the component self-contained if rendered without a provider.
const pendingUploadFiles = botChat?.pendingUploadFiles ?? ref<File[]>([])
const hasPendingUploads = computed(() => pendingUploadFiles.value.length > 0)
const removePendingUpload = (index: number) => {
  pendingUploadFiles.value.splice(index, 1)
}

// Drive picks buffered for the first message (see `useBotChat`). Picked in the
// inspector's Attachments tab, shown here too so the composer reflects exactly
// what the next send carries.
const pendingDriveImports =
  botChat?.pendingDriveImports ??
  ref<{ fileId: string; displayName: string }[]>([])
const hasPendingDriveImports = computed(
  () => pendingDriveImports.value.length > 0
)
const removePendingDriveImport = (index: number) => {
  pendingDriveImports.value.splice(index, 1)
}

const { files: uploadFiles, open: openUploadDialog } = useFileDialog({
  multiple: true,
})
const triggerSessionUpload = () => {
  if (!canUploadFiles.value) return
  openUploadDialog()
}
watch(uploadFiles, async (files) => {
  if (!files || files.length === 0) return
  // Brand-new chat: no session id to upload into yet. Buffer the files as
  // local previews; their bytes are staged + attached with the first message
  // in `handleSend`. Size-check up front so an oversized pick is rejected
  // before send (the stage step + server re-check it too).
  if (!botChat?.sessionId.value) {
    for (const file of Array.from(files)) {
      if (file.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
        toast.error(`${file.name} is larger than 25 MB.`)
        continue
      }
      pendingUploadFiles.value.push(file)
    }
    return
  }
  // Existing session: upload immediately and select for the next turn.
  let success = 0
  for (const file of Array.from(files)) {
    try {
      const id = await createAttachmentFromFile(file)
      if (!selectedAttachmentIds.value.includes(id)) {
        botChat?.toggleAttachmentSelection(id)
      }
      success += 1
    } catch (uploadError) {
      toast.error((uploadError as Error).message)
    }
  }
  if (success > 0) {
    toast.success(
      success === 1 ? "File attached." : `${success} files attached.`
    )
  }
})

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
  () => botChat?.model.value ?? "gemini-3.5-flash"
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

  // Brand-new chat with buffered uploads: mint a session id, stage each file's
  // bytes to it, and hand the refs to `sendMessage` so the first turn carries
  // them — the server writes the attachment docs + materializes the session in
  // the same call. If nothing stages successfully we fall back to a plain new
  // chat (per-file errors are toasted).
  // Drive picks (buffered by the inspector's Attachments tab) have no client
  // bytes to stage — only their ids ride along; the server fetches them.
  const driveFileIds = botChat.pendingDriveImports.value.map((d) => d.fileId)
  let sendOpts:
    | {
        newSessionId: string
        pendingAttachments: BotSessionPendingAttachment[]
        pendingDriveImports: string[]
      }
    | undefined
  if (
    (hasPendingUploads.value || driveFileIds.length > 0) &&
    !botChat.sessionId.value
  ) {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (teamId && workspaceId) {
      const newSessionId = generateId()
      const staged: BotSessionPendingAttachment[] = []
      for (const file of pendingUploadFiles.value) {
        try {
          staged.push(
            await stageBotSessionAttachmentBlob(
              { teamId, workspaceId, sessionId: newSessionId },
              file
            )
          )
        } catch (uploadError) {
          toast.error((uploadError as Error).message)
        }
      }
      if (staged.length > 0 || driveFileIds.length > 0) {
        sendOpts = {
          newSessionId,
          pendingAttachments: staged,
          pendingDriveImports: driveFileIds,
        }
      }
    }
  }

  userInput.value = ""
  // Keep the preview chips visible THROUGH the send (they read from the
  // buffer) so the file doesn't flicker to nothing mid-stream; clear + promote
  // to selected only once the turn commits.
  await botChat.sendMessage(text, sendOpts)
  pendingUploadFiles.value = []
  // Drive picks were forwarded as ids and attached server-side this turn; the
  // server minted their attachment ids (we don't have them client-side), so
  // unlike local uploads they aren't promoted to selected chips — they show up
  // in the inspector's live attachment list for any follow-up turn.
  botChat.pendingDriveImports.value = []
  // The uploads are now committed under the freshly-created session. Add them
  // to the per-turn selection so they persist as selected chips for subsequent
  // turns — matching the existing-session upload path, which selects on upload.
  // The user can unselect from the chip row or the inspector sidebar. Guarded
  // on the session having actually been created (a failed send leaves
  // `sessionId` null), and clearing the buffer first so the two ref writes
  // batch into a single render (chip swaps pending → selected, no duplicate).
  if (sendOpts && botChat.sessionId.value === sendOpts.newSessionId) {
    for (const pending of sendOpts.pendingAttachments) {
      if (!selectedAttachmentIds.value.includes(pending.attachmentId)) {
        botChat.toggleAttachmentSelection(pending.attachmentId)
      }
    }
  }
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

// Built-in tool install + enable resolves from the unified integrations store
// (catalog overlay). A built-in tool is active when its integration is
// installed AND enabled — the install + team-enable axes the old
// `installedBuiltInTools` map and `tools.<name>` toggle covered separately.
const integrationsStore = useIntegrationsStore()
const isBuiltInToolActive = (name: string): boolean => {
  const i = integrationsStore.toolIntegrations.find(
    (t) => t.source !== "custom" && t.sourceKey === name
  )
  return i ? i.installed && i.enabled : true
}

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
  // No team-wide switch — membership (MANAGE_WORKSPACE_CONTENT) is the
  // team-level authorization; the per-agent toggle is the only feature flag,
  // mirroring `nodeWriteEnabled` on the server.
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
  // Read has no team-wide switch (unlike write's `manageContent`); the
  // per-agent toggle is the only feature gate, mirroring `nodeReadEnabled`
  // on the server.
  if (activeAgent.value.tools.readContent === false) return false
  return true
})

const availableTools = computed<readonly ComposerToolEntry[]>(() => {
  const agentTools = activeAgent.value?.tools
  const agentCustomToolOverrides = activeAgent.value?.customTools
  const entries: ComposerToolEntry[] = []

  // Built-ins — installed + enabled (unified integrations state) intersected
  // with the active agent's per-tool toggle, mirroring server dispatch.
  for (const tool of BOT_TOOL_CATALOG) {
    if (!isBuiltInToolActive(tool.name)) continue
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
      icon: IconAsterisk,
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
    <InputGroup>
      <InputGroupTextarea
        ref="textareaRef"
        v-model="userInput"
        :placeholder="inputPlaceholder"
        :disabled="isSending || isReadOnly"
        @keydown="handleKeydown"
      />
      <InputGroupAddon
        v-if="
          hasAttachedNodes ||
          hasSelectedAttachments ||
          hasPendingUploads ||
          hasPendingDriveImports
        "
        align="block-start"
      >
        <ItemGroup>
          <template v-if="hasAttachedNodes">
            <Item
              v-for="node in attachedNodeDetails"
              :key="`${node.scope}:${node.nodeId}`"
              :variant="node.status === 'ok' ? 'muted' : 'outline'"
              size="xs"
            >
              <ItemMedia variant="icon">
                <Component
                  :is="node.type === 'folder' ? IconFolder : IconFile"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle v-if="node.status === 'deleted'" class="italic">
                  {{ t("ai.attachedNodeDeleted") }}
                </ItemTitle>
                <template v-else>
                  <ItemTitle>{{ node.name }}</ItemTitle>
                  <ItemDescription
                    v-if="node.status === 'archived'"
                    class="text-xs"
                  >
                    {{ t("ai.attachedNodeArchived") }}
                  </ItemDescription>
                  <ItemDescription v-else class="text-xs">
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
                        t(
                          "ai.detachContextNode",
                          { name: node.name },
                          node.name
                        )
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ItemActions>
            </Item>
          </template>
          <template v-if="hasSelectedAttachments">
            <Item
              v-for="att in selectedAttachments"
              :key="`att:${att.id}`"
              variant="muted"
              size="xs"
            >
              <ItemMedia variant="icon">
                <IconUpload />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{{ att.name }}</ItemTitle>
                <ItemDescription class="text-xs">File</ItemDescription>
              </ItemContent>
              <ItemActions>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="isReadOnly || isSending"
                        @click="deselectAttachment(att.id)"
                      >
                        <IconX />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        t("ai.detachAttachment", { name: att.name }, att.name)
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ItemActions>
            </Item>
          </template>
          <template v-if="hasPendingUploads">
            <Item
              v-for="(file, index) in pendingUploadFiles"
              :key="`pending:${index}:${file.name}`"
              variant="muted"
              size="xs"
            >
              <ItemMedia variant="icon">
                <IconUpload />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{{ file.name }}</ItemTitle>
                <ItemDescription class="text-xs">Pending</ItemDescription>
              </ItemContent>
              <ItemActions>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="isReadOnly || isSending"
                        @click="removePendingUpload(index)"
                      >
                        <IconX />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        t("ai.detachAttachment", { name: file.name }, file.name)
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ItemActions>
            </Item>
          </template>
          <template v-if="hasPendingDriveImports">
            <Item
              v-for="(file, index) in pendingDriveImports"
              :key="`drive:${index}:${file.fileId}`"
              variant="muted"
              size="xs"
            >
              <ItemMedia variant="icon">
                <IconLogosGoogleDrive />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{{ file.displayName }}</ItemTitle>
                <ItemDescription class="text-xs">Pending</ItemDescription>
              </ItemContent>
              <ItemActions>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="isReadOnly || isSending"
                        @click="removePendingDriveImport(index)"
                      >
                        <IconX />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        t(
                          "ai.detachAttachment",
                          { name: file.displayName },
                          file.displayName
                        )
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ItemActions>
            </Item>
          </template>
        </ItemGroup>
      </InputGroupAddon>
      <InputGroupAddon align="block-end">
        <TooltipProvider>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <InputGroupButton
                    variant="outline"
                    size="icon-xs"
                    :disabled="!canOpenAttachSheet && !canUploadFiles"
                  >
                    <IconPlus />
                  </InputGroupButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{{ t("ai.attachContent") }}</TooltipContent>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  :disabled="!canUploadFiles"
                  data-hotkey="u"
                  @select="triggerSessionUpload"
                >
                  <IconUpload />
                  {{ t("ai.uploadFiles") }}
                  <DropdownMenuShortcut>U</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  :disabled="!canOpenAttachSheet"
                  data-hotkey="c"
                  @select="attachSheetOpen = true"
                >
                  <IconAtSign />
                  {{ t("ai.attachContext") }}
                  <DropdownMenuShortcut>C</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </TooltipProvider>
        <Sheet v-model:open="attachSheetOpen">
          <SheetContent
            class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-2xl border"
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
                  <SelectTrigger class="bg-transparent">
                    <SelectValue :placeholder="t('ai.agents.label')">
                      <InputGroupText>
                        <!-- Icon/avatar only — name hidden. -->
                        <AppAvatar
                          v-if="activeAgentId !== null && activeAgent"
                          variant="beam"
                          :name="agentAvatarSeed(activeAgent)"
                          class="size-4"
                        />
                        <IconBot v-else />
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
                <Item size="xs" class="p-0">
                  <ItemMedia variant="icon">
                    <IconBot />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ t("ai.agents.default") }}</ItemTitle>
                    <ItemDescription class="text-xs">
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
                <Item size="xs" class="p-0">
                  <ItemMedia variant="icon">
                    <AppAvatar
                      variant="beam"
                      :name="agentAvatarSeed(agent)"
                      class="size-4"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ agent.name }}</ItemTitle>
                    <ItemDescription v-if="agent.description" class="text-xs">
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
                  <Item size="xs" class="p-0">
                    <ItemMedia variant="icon">
                      <AppAvatar
                        variant="beam"
                        :name="agentAvatarSeed(agent)"
                        class="size-4"
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{{ agent.name }}</ItemTitle>
                      <ItemDescription v-if="agent.description" class="text-xs">
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
        <TooltipProvider v-if="isDictationAvailable">
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
                <SelectTrigger class="bg-transparent">
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
              <Item size="xs" class="p-0">
                <ItemContent>
                  <ItemTitle>{{ modeLabel(option.value) }}</ItemTitle>
                  <ItemDescription class="text-xs">
                    {{ option.shortDescription }}
                  </ItemDescription>
                </ItemContent>
              </Item>
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
                <SelectTrigger class="bg-transparent">
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
                <Item size="xs" class="p-0">
                  <ItemContent>
                    <ItemTitle>
                      {{ entry.name }}
                      <Badge
                        v-if="entry.badge"
                        variant="secondary"
                        class="text-xs"
                      >
                        {{ entry.badge }}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription class="text-xs">
                      {{ entry.description }}
                    </ItemDescription>
                  </ItemContent>
                </Item>
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

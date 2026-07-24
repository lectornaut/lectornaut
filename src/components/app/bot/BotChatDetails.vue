<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import {
  BOT_TOOL_CATALOG,
  type BotToolDescriptor,
  type BotToolName,
} from "@/data/botTools"
import {
  IconArchive,
  IconCalendar,
  IconClock,
  IconGlobe,
  IconHash,
  IconHistory,
  IconLock,
  IconMessageCircle,
  IconUserRound,
  IconUsers,
  IconWrench,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { useAuthStore } from "@/stores/authStore"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamCustomToolsStore } from "@/stores/teamCustomToolsStore"
import { isUserMembership } from "@/types/membership"
import type {
  IBotSessionVisibility,
  ITeamAgent,
  ITeamCustomTool,
} from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, inject, type Component } from "vue"

const botChat = inject(BotChatContextKey)
const { t } = useI18n()
const { currentUser } = storeToRefs(useAuthStore())
const { teamMembers } = storeToRefs(useMembershipStore())

const sessionId = computed(() => botChat?.sessionId.value ?? null)
const activeSession = computed(() => botChat?.activeSession.value ?? null)
const activeVisibility = computed(
  () => botChat?.activeVisibility.value ?? "private"
)
const isActiveOwner = computed(() => botChat?.isActiveOwner.value ?? false)
const canEditActive = computed(() => botChat?.canEditActive.value ?? false)
const isActiveArchived = computed(
  () => botChat?.isActiveArchived.value ?? false
)
const localMessageCount = computed(() => botChat?.messages.value.length ?? 0)
const activeMode = computed(() => botChat?.mode.value ?? "auto")
const activeModeLabel = computed(() => t(`ai.modes.${activeMode.value}.label`))

const tsToDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  return null
}

const formatAbsolute = (date: Date | null): string => {
  if (!date) return "—"
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

const visibilityIcon = (v: IBotSessionVisibility) => {
  if (v === "shared") return IconUsers
  if (v === "public") return IconGlobe
  return IconLock
}

const visibilityLabel = (v: IBotSessionVisibility): string => {
  if (v === "shared") return t("ai.sidebar.visibilitySharedLabel")
  if (v === "public") return t("ai.sidebar.visibilityPublicLabel")
  return t("ai.visibilityPrivate")
}

/**
 * Resolve the owner's display name via the team-members map. The
 * membership doc carries a denormalized `user` snapshot so this is a
 * pure in-memory lookup — no extra Firestore read.
 *
 * Owner resolution states:
 *   - self     → "You"
 *   - resolved → displayName ?? email ?? "Team member"
 *   - former   → "Former member" (teamMembers loaded, owner missing)
 *   - unknown  → "Team member" (memberships still loading)
 *
 * Distinguishing former-member from still-loading uses a property of
 * teams: every team has at least one member (the creator-owner), so
 * `teamMembers.length === 0` reliably means "not yet loaded".
 */
const ownerMember = computed(() => {
  const uid = activeSession.value?.ownerUid
  if (!uid) return null
  return (
    teamMembers.value.filter(isUserMembership).find((m) => m.userId === uid) ??
    null
  )
})

const isOwnerFormer = computed(() => {
  const session = activeSession.value
  if (!session) return false
  if (session.ownerUid === currentUser.value?.uid) return false
  if (teamMembers.value.length === 0) return false // memberships still loading
  return ownerMember.value === null
})

const ownerLabel = computed(() => {
  const session = activeSession.value
  if (!session) return ""
  if (session.ownerUid === currentUser.value?.uid) return t("ai.details.you")
  if (isOwnerFormer.value) return t("ai.details.formerMember")
  const snapshot = ownerMember.value?.user
  return (
    snapshot?.displayName?.trim() ||
    snapshot?.email ||
    t("ai.details.teamMember")
  )
})

const ownerPhotoURL = computed(() => ownerMember.value?.user?.photoURL ?? null)

const createdAt = computed(() => tsToDate(activeSession.value?.createdAt))
const updatedAt = computed(() => tsToDate(activeSession.value?.updatedAt))
const archivedAt = computed(() => tsToDate(activeSession.value?.archivedAt))

const messageCount = computed(() => {
  // Prefer server-derived count (covers history not yet fetched into the
  // local list); fall back to the local list for fresh new chats.
  return activeSession.value?.messageCount ?? localMessageCount.value
})

// ── Available tools (dynamic per agent + team config + mode) ──────────────
//
// Mirrors the server's `pickChatTools` dispatch logic (see
// `functions/src/bot.ts`) so the panel shows exactly what the next
// turn will have access to — not a stale static list. Two inputs
// converge into the visible set:
//
//   1. The team's tool toggles (`teamAgentConfig.tools`) — admin gate.
//   2. The active agent's per-tool overrides (`activeAgent.tools`) —
//      persona gate. `null` activeAgent (default persona) skips this
//      filter entirely, matching the server.
//
// Both filters apply to BOTH built-in and custom tools. Tools are
// available in every mode, so mode no longer narrows this set.
const activeAgent = computed<ITeamAgent | null>(
  () => botChat?.activeAgent.value ?? null
)

// Built-in tool availability comes from the unified integrations store: a
// built-in tool is active for the turn when its integration is installed AND
// enabled (the install + team-enable axes the old `installedBuiltInTools` map
// and `tools.<name>` toggle used to cover separately). Per-agent overrides
// (`activeAgent.tools[name]`) still intersect on top, below.
const integrationsStore = useIntegrationsStore()
const builtInToolActive = computed<Map<string, boolean>>(() => {
  const map = new Map<string, boolean>()
  for (const i of integrationsStore.toolIntegrations) {
    if (i.source !== "custom" && i.sourceKey) {
      map.set(i.sourceKey, i.installed && i.enabled)
    }
  }
  return map
})
const isBuiltInToolActive = (name: string): boolean =>
  builtInToolActive.value.get(name) ?? true

const teamCustomToolsStore = useTeamCustomToolsStore()
const { selectableTools: teamSelectableCustomTools } =
  storeToRefs(teamCustomToolsStore)

/**
 * Names of catalog tools that are *interrupts* (pause the chat and
 * surface a form) rather than side-effecting actions. The split
 * matters in the UI because action tools dim in manual mode while
 * interrupts stay live. Server-side mirror lives at
 * `functions/src/bot.ts::INTERRUPT_TOOL_NAMES` — keep both in sync if
 * a new HITL tool ships. Set so future entries are O(1) lookups.
 */
const INTERRUPT_TOOL_NAMES: ReadonlySet<BotToolName> = new Set(["askQuestion"])

/**
 * Shared display shape for the two tool lists. Custom tools and
 * built-ins funnel into this so the template renders a uniform card
 * regardless of source; the `kind: "custom"` discriminator powers
 * the "Custom" badge (same affordance custom agents and custom tool
 * picker entries already use).
 */
interface AvailableToolEntry {
  key: string
  name: string
  description: string
  example: string
  icon: Component
  kind: "builtin" | "custom"
}

/**
 * Project a `BotToolDescriptor` into the display shape. Catalog
 * `name` doubles as the model-callable wire name (the user-facing
 * "what is this tool called" affordance), so it surfaces in both the
 * label and the `<code>` chip in the template.
 */
const builtInEntry = (tool: BotToolDescriptor): AvailableToolEntry => ({
  key: tool.name,
  name: tool.name,
  description: tool.description,
  example: tool.example,
  icon: tool.icon,
  kind: "builtin",
})

/**
 * Project an admin-authored custom tool. Uses `displayName` when set,
 * falling back to the wire-name (`tool.name`) so a half-configured
 * record still renders something meaningful. Mirrors the composer's
 * `buildCustomToolExample` pattern (`"Use <Name> to …"`) so the
 * example line in the details panel reads consistently with the slash
 * menu's prompt insertion.
 */
const customEntry = (tool: ITeamCustomTool): AvailableToolEntry => {
  const displayLabel = tool.displayName.trim() || tool.name
  return {
    key: tool.id,
    name: displayLabel,
    description: tool.description,
    example: `Use ${displayLabel} to …`,
    icon: IconWrench,
    kind: "custom",
  }
}

/**
 * Action tools (everything except interrupts). Filters the catalog
 * + custom tools against the team×agent intersection — the same set
 * the next turn will have access to, in any mode.
 */
const availableActionTools = computed<AvailableToolEntry[]>(() => {
  const agentTools = activeAgent.value?.tools
  const agentCustomToolOverrides = activeAgent.value?.customTools
  const entries: AvailableToolEntry[] = []

  for (const tool of BOT_TOOL_CATALOG) {
    if (INTERRUPT_TOOL_NAMES.has(tool.name)) continue
    if (!isBuiltInToolActive(tool.name)) continue
    if (agentTools && agentTools[tool.name] === false) continue
    entries.push(builtInEntry(tool))
  }

  for (const tool of teamSelectableCustomTools.value) {
    if (
      agentCustomToolOverrides &&
      agentCustomToolOverrides[tool.id] === false
    ) {
      continue
    }
    entries.push(customEntry(tool))
  }

  return entries
})

/**
 * Interrupt tools. Same team×agent intersection as action tools,
 * but no mode filtering — HITL interrupts are available even in
 * `manual` (a clarifying question has no side effects). Currently
 * just `askQuestion`; the set lookup makes adding a second
 * interrupt a one-line schema change.
 */
const availableInterruptTools = computed<AvailableToolEntry[]>(() => {
  const agentTools = activeAgent.value?.tools
  const entries: AvailableToolEntry[] = []
  for (const tool of BOT_TOOL_CATALOG) {
    if (!INTERRUPT_TOOL_NAMES.has(tool.name)) continue
    if (!isBuiltInToolActive(tool.name)) continue
    if (agentTools && agentTools[tool.name] === false) continue
    entries.push(builtInEntry(tool))
  }
  return entries
})

interface DetailRow {
  id: string
  label: string
  value: string
  icon: typeof IconClock
}

// Owner gets a richer custom row (avatar + name) rendered above the
// data-driven `dl`; everything else is straight label/value pairs.
const detailRows = computed<DetailRow[]>(() => {
  if (!activeSession.value) return []
  const rows: DetailRow[] = [
    {
      id: "created",
      label: t("ai.details.created"),
      value: formatAbsolute(createdAt.value),
      icon: IconCalendar,
    },
    {
      id: "updated",
      label: t("ai.details.lastActivity"),
      value: formatAbsolute(updatedAt.value),
      icon: IconClock,
    },
    {
      id: "messages",
      label: t("ai.details.messages"),
      value: String(messageCount.value),
      icon: IconHash,
    },
  ]
  if (archivedAt.value) {
    rows.push({
      id: "archived",
      label: t("ai.details.archivedAt"),
      value: formatAbsolute(archivedAt.value),
      icon: IconArchive,
    })
  }
  return rows
})
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col gap-2">
    <ScrollContainer>
      <SidebarGroup>
        <SidebarGroupContent class="space-y-2">
          <Empty v-if="!sessionId" class="rounded-xl border border-dashed p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconHistory />
              </EmptyMedia>
              <EmptyTitle>{{ t("ai.details.empty") }}</EmptyTitle>
            </EmptyHeader>
          </Empty>
          <template v-else>
            <div class="space-y-1">
              <p
                class="text-foreground line-clamp-2 text-base leading-tight font-medium"
              >
                {{ activeSession?.title || t("ai.untitledChat") }}
              </p>
              <p
                v-if="activeSession?.preview"
                class="text-muted-foreground line-clamp-2 text-xs"
              >
                {{ activeSession.preview }}
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                <Component :is="visibilityIcon(activeVisibility)" />
                {{ visibilityLabel(activeVisibility) }}
              </Badge>
              <Badge variant="outline">
                {{ t("ai.details.modeBadge", { mode: activeModeLabel }) }}
              </Badge>
              <Badge v-if="isActiveOwner" variant="secondary">
                {{ t("ai.details.owner") }}
              </Badge>
              <Badge v-else-if="canEditActive" variant="secondary">
                {{ t("ai.details.editor") }}
              </Badge>
              <Badge v-else variant="secondary">
                {{ t("ai.details.readOnly") }}
              </Badge>
              <Badge v-if="isActiveArchived" variant="outline">
                <IconArchive />
                {{ t("ai.archived") }}
              </Badge>
            </div>

            <dl class="space-y-3">
              <div class="flex items-start justify-between gap-2">
                <dt class="text-muted-foreground flex items-center gap-2">
                  <IconUserRound />
                  {{ t("ai.details.owner") }}
                </dt>
                <dd
                  class="flex min-w-0 items-center gap-2 text-right"
                  :class="{ 'text-muted-foreground italic': isOwnerFormer }"
                >
                  <AppAvatar
                    class="size-5"
                    :class="{ 'opacity-60': isOwnerFormer }"
                    :src="ownerPhotoURL"
                    :name="ownerLabel"
                  >
                    <template #fallback>
                      <IconUserRound v-if="isOwnerFormer" />
                      <template v-else>{{ getInitials(ownerLabel) }}</template>
                    </template>
                  </AppAvatar>
                  <span class="truncate text-sm font-medium">
                    {{ ownerLabel }}
                  </span>
                </dd>
              </div>
              <div
                v-for="row in detailRows"
                :key="row.id"
                class="flex items-start justify-between gap-2"
              >
                <dt class="text-muted-foreground flex items-center gap-2">
                  <Component :is="row.icon" />
                  {{ row.label }}
                </dt>
                <dd class="text-right text-sm font-medium">{{ row.value }}</dd>
              </div>
            </dl>
          </template>
        </SidebarGroupContent>
      </SidebarGroup>

      <!--
        Available tools — dynamic per (team config × active agent ×
        mode). Migrated here from BotChatActions because the panel
        previously rendered a stale hardcoded list that ignored both
        the agent picker and the team's
        custom tools. The intersection mirrors `pickChatTools`
        server-side, so the visible list always matches what the next
        turn will actually have access to.
      -->
      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconWrench />
          {{ t("ai.sidebar.availableTools") }}
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2">
          <p class="text-muted-foreground text-xs">
            {{ t("ai.sidebar.toolsEnabledHint") }}
          </p>
          <Empty
            v-if="availableActionTools.length === 0"
            class="rounded-xl border border-dashed p-6"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconWrench />
              </EmptyMedia>
              <EmptyTitle>{{ t("ai.sidebar.noTools") }}</EmptyTitle>
            </EmptyHeader>
          </Empty>
          <ul v-else class="space-y-2">
            <li
              v-for="tool in availableActionTools"
              :key="tool.key"
              class="border-border/60 bg-background/40 rounded border p-2"
            >
              <div class="flex items-center gap-2">
                <Component :is="tool.icon" />
                <code class="text-foreground text-xs font-medium">{{
                  tool.name
                }}</code>
                <Badge
                  v-if="tool.kind === 'custom'"
                  variant="secondary"
                  class="ml-auto text-xs"
                >
                  {{ t("ai.tools.customBadge") }}
                </Badge>
              </div>
              <p class="text-muted-foreground text-xs">
                {{ tool.description }}
              </p>
              <p class="text-muted-foreground/80 text-xs italic">
                e.g. “{{ tool.example }}”
              </p>
            </li>
          </ul>
        </SidebarGroupContent>
      </SidebarGroup>

      <!--
        Human-in-the-Loop — interrupt tools. Same team×agent
        intersection as action tools but no mode filter: a clarifying
        question has no side effects, so it's available even in
        manual mode. The section hides entirely when the intersection
        produces nothing (e.g. an agent that disables askQuestion).
      -->
      <SidebarGroup v-if="availableInterruptTools.length > 0">
        <SidebarGroupLabel class="flex items-center gap-2">
          <IconMessageCircle />
          {{ t("ai.sidebar.humanInTheLoop") }}
        </SidebarGroupLabel>
        <SidebarGroupContent class="space-y-2">
          <i18n-t
            keypath="ai.sidebar.humanInTheLoopHint"
            tag="p"
            class="text-muted-foreground text-xs"
          >
            <template #manual>
              <strong>{{ t("ai.modes.manual.label") }}</strong>
            </template>
          </i18n-t>
          <ul class="space-y-2">
            <li
              v-for="interrupt in availableInterruptTools"
              :key="interrupt.key"
              class="border-border/60 bg-background/40 rounded border p-2"
            >
              <div class="flex items-center gap-2">
                <Component :is="interrupt.icon" />
                <code class="text-foreground text-xs font-medium">{{
                  interrupt.name
                }}</code>
              </div>
              <p class="text-muted-foreground text-xs">
                {{ interrupt.description }}
              </p>
              <p class="text-muted-foreground/80 text-xs italic">
                e.g. “{{ interrupt.example }}”
              </p>
            </li>
          </ul>
        </SidebarGroupContent>
      </SidebarGroup>
    </ScrollContainer>
  </div>
</template>

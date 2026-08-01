<script lang="ts" setup>
import type AgentChatShell from "@/components/app/bot/AgentChatShell.vue"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { isBuiltInAgentId } from "@/data/builtInAgents"
import {
  IconBadgeCheck,
  IconCirclePlus,
  IconPictureInPicture,
  IconSparkle,
  IconSparkles,
  IconX,
} from "@/data/icons"
import { openAiAskPopoutWindow } from "@/modules/aiAskPopout"
import { emitter } from "@/modules/mitt"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useUiPreferencesStore } from "@/stores/uiPreferencesStore"
import { isAgentMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"

const { t } = useI18n()
const isFullscreen = useIsFullscreen()

// Live agents list from the Pinia store. `pickerAgents` is the merged
// view: built-in presets (gated per-id by `agentConfig.builtInAgents`)
// followed by selectable custom agents. The team-wide `customAgents`
// toggle short-circuits both inner lists to empty, so when the feature
// is disabled team-wide this list goes empty automatically and the
// per-agent sheets stop rendering. Admins re-enable it from the
// AI → Agents settings page. The local binding stays `activeAgents`
// to keep the template diff minimal — semantics now include built-ins.
const teamAgentsStore = useTeamAgentsStore()
const { pickerAgents: activeAgents, customAgentsEnabled } =
  storeToRefs(teamAgentsStore)

// Per-user visibility filter, set from the Edit → Agents submenu.
// `isAgentVisible` reads the layout store's reactive map, so this
// computed re-runs when the user toggles an agent. Only the rendered
// sheets are filtered — the empty-state hints below stay keyed on
// `activeAgents` (team availability), so hiding every agent yourself
// doesn't trip the "no agents available" message.
const uiPreferencesStore = useUiPreferencesStore()
const { isAgentVisible } = uiPreferencesStore
const visibleAgents = computed(() =>
  activeAgents.value.filter((agent) => isAgentVisible(agent.id))
)

const membershipStore = useMembershipStore()
const { isOwner, isAdmin, teamMembers } = storeToRefs(membershipStore)
// Mirrors the server's `assertAdminRole` gate. UI-only — non-admins
// who somehow trigger a management flow are rejected by the callable.
const canManageAgents = computed(() => isOwner.value || isAdmin.value)

// Agents added as members of the active team get a corner dot on their
// row. `teamMembers` is already scoped to the current team, so we narrow
// to the agent rows and key by agentId for an O(1) per-row lookup.
const memberAgentIds = computed(
  () =>
    new Set(
      teamMembers.value
        .filter(isAgentMembership)
        .map((member) => member.agentId)
    )
)

// Avatar seed precedence: explicit `avatarSeed` if set, else fall back
// to `name` so the avatar pattern stays deterministic from the
// label the admin chose. `agent.id` as the last-ditch fallback covers
// the (impossible) case where both are empty strings.
const avatarSeed = (agent: { avatarSeed: string; name: string; id: string }) =>
  agent.avatarSeed.trim() || agent.name.trim() || agent.id

// Agent-kind glyph + label. A single `sparkle` marks an admin-authored
// custom agent; the plural `sparkles` marks a built-in preset. Keyed off
// `isBuiltInAgentId`, which detects the `_`-prefixed built-in ids.
const agentKindIcon = (agentId: string) =>
  isBuiltInAgentId(agentId) ? IconSparkles : IconSparkle
const agentKindLabel = (agentId: string) =>
  isBuiltInAgentId(agentId)
    ? t("ai.agents.builtInTooltip")
    : t("ai.agents.customTooltip")

/**
 * Open the custom agents management dialog directly in "editor"
 * mode (new agent). Avoids the two-hop "open Settings → Tools cog"
 * flow — clicking "New agent" in the sidebar takes the admin
 * straight to the form. The dialog is mounted globally in `app.vue`
 * and listens for this mitt event.
 */
const openNewAgentDialog = (): void => {
  emitter.emit("Dialog.CustomAgents.Open", "new")
}

// Sheets are controlled through a single id so popping a chat out can
// close its sheet programmatically. Modal sheets only ever show one at
// a time, so one id (and one shell ref below) is enough state.
const openSheetId = ref<string | null>(null)

// The open sheet's `AgentChatShell` instance — exposes the live session
// id (see `defineExpose` there). Nulled by Vue when the sheet unmounts.
const openShell = ref<InstanceType<typeof AgentChatShell> | null>(null)
const setShellRef = (el: unknown) => {
  openShell.value = el as InstanceType<typeof AgentChatShell> | null
}

// Hand the sheet's chat off to a detached window: resume the session if
// one was started, else open a fresh chat with this agent pre-selected.
// One-way handoff (same as AiAsk's pop-out) — the sheet closes and its
// context unmounts, so the window is the only live surface.
const popOutAgent = (agent: { id: string; name: string }): void => {
  const sessionId = openShell.value?.sessionId ?? null
  openSheetId.value = null
  openAiAskPopoutWindow({ sessionId, agentId: agent.id, title: agent.name })
}
</script>

<template>
  <SidebarMenu id="tour-team-members">
    <!--
      "New agent" entry — visible only when:
        - The team-wide customAgents toggle is on (otherwise the
          feature is gated and creating new agents would just be
          friction until re-enabled).
        - The viewer is an owner/admin (mirrors the server's
          `assertAdminRole` gate; non-admins would only hit
          permission-denied anyway).
      Clicking opens the management dialog directly in editor mode.
    -->
    <SidebarMenuItem v-if="customAgentsEnabled && canManageAgents">
      <SidebarMenuButton
        :tooltip="t('ai.agents.newAgent')"
        @click="openNewAgentDialog"
      >
        <IconCirclePlus />
        <span class="truncate">
          {{ t("ai.agents.newAgent") }}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>

    <!--
      Empty-state hints. When customAgents is globally disabled,
      everyone (admins and members) sees a message explaining why
      the list is empty even if agents exist.
    -->
    <SidebarMenuItem v-if="!customAgentsEnabled">
      <SidebarMenuButton :tooltip="t('ai.agents.featureDisabled')" disabled>
        {{ t("ai.agents.featureDisabled") }}
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem v-else-if="!activeAgents.length && !canManageAgents">
      <SidebarMenuButton :tooltip="t('ai.agents.emptyMember')" disabled>
        {{ t("ai.agents.emptyMember") }}
      </SidebarMenuButton>
    </SidebarMenuItem>

    <!--
      One sheet per active agent. Each sheet creates its OWN
      BotChatContext via `AgentChatShell` so the conversations stay
      independent — opening agent A doesn't bleed messages or session
      state into agent B's sheet. The avatar uses boring-avatars
      seeded from `avatarSeed || name` so it stays deterministic as
      long as the admin doesn't relabel the agent.
    -->
    <Sheet
      v-for="agent in visibleAgents"
      :key="agent.id"
      :open="openSheetId === agent.id"
      @update:open="(open) => (openSheetId = open ? agent.id : null)"
    >
      <SheetTrigger as-child>
        <SidebarMenuItem>
          <SidebarMenuButton :tooltip="agent.name">
            <AppAvatar
              variant="beam"
              :name="avatarSeed(agent)"
              class="size-8"
            />
            <span class="truncate">
              {{ agent.name }}
            </span>
          </SidebarMenuButton>
          <!--
            Right-aligned indicator cluster. The team-membership check sits
            to the LEFT of the agent-kind glyph (sparkle = custom, sparkles
            = built-in). SidebarMenuBadge is `pointer-events-none` so the
            row stays clickable through it; we re-enable pointer events only
            on the tooltip trigger spans, so hovering a glyph shows its
            tooltip without swallowing clicks meant to open the sheet.
          -->
          <TooltipProvider>
            <SidebarMenuBadge class="flex items-center gap-1">
              <Tooltip v-if="memberAgentIds.has(agent.id)">
                <TooltipTrigger as-child>
                  <span>
                    <IconBadgeCheck />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {{ t("ai.agents.teamMember") }}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span>
                    <Component :is="agentKindIcon(agent.id)" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {{ agentKindLabel(agent.id) }}
                </TooltipContent>
              </Tooltip>
            </SidebarMenuBadge>
          </TooltipProvider>
        </SidebarMenuItem>
      </SheetTrigger>
      <SheetContent
        class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-4xl border"
        side="left"
        :class="{ 'mt-12': isTauri && !isFullscreen }"
        :show-close-button="false"
      >
        <SheetHeader>
          <div class="flex items-center justify-between gap-2">
            <SheetTitle class="flex items-center gap-2">
              <AppAvatar
                variant="beam"
                :name="avatarSeed(agent)"
                class="size-5"
              />
              {{ agent.name }}
            </SheetTitle>
            <div class="flex items-center gap-1">
              <TooltipProvider v-if="isTauri">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      @click="popOutAgent(agent)"
                    >
                      <IconPictureInPicture />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("ai.openInNewWindow") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <SheetClose as-child>
                <Button variant="ghost" size="icon-sm">
                  <IconX />
                </Button>
              </SheetClose>
            </div>
          </div>
          <SheetDescription v-if="agent.description">
            {{ agent.description }}
          </SheetDescription>
        </SheetHeader>
        <AgentChatShell :ref="setShellRef" :agent="agent" />
      </SheetContent>
    </Sheet>
  </SidebarMenu>
</template>

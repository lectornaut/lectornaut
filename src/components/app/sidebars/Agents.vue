<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { IconCirclePlus } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import Avatar from "vue-boring-avatars"

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
const layoutStore = useLayoutStore()
const { isAgentVisible } = layoutStore
const visibleAgents = computed(() =>
  activeAgents.value.filter((agent) => isAgentVisible(agent.id))
)

const membershipStore = useMembershipStore()
const { isOwner, isAdmin } = storeToRefs(membershipStore)
// Mirrors the server's `assertAdminRole` gate. UI-only — non-admins
// who somehow trigger a management flow are rejected by the callable.
const canManageAgents = computed(() => isOwner.value || isAdmin.value)

// Avatar seed precedence: explicit `avatarSeed` if set, else fall back
// to `name` so the avatar pattern stays deterministic from the
// label the admin chose. `agent.id` as the last-ditch fallback covers
// the (impossible) case where both are empty strings.
const avatarSeed = (agent: { avatarSeed: string; name: string; id: string }) =>
  agent.avatarSeed.trim() || agent.name.trim() || agent.id

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
        {{ t("ai.agents.newAgent") }}
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
    <Sheet v-for="agent in visibleAgents" :key="agent.id">
      <SheetTrigger as-child>
        <SidebarMenuItem>
          <SidebarMenuButton :tooltip="agent.name">
            <Avatar
              variant="beam"
              :name="avatarSeed(agent)"
              :colors="[
                'var(--color-chart-1)',
                'var(--color-chart-2)',
                'var(--color-chart-3)',
                'var(--color-chart-4)',
                'var(--color-chart-5)',
              ]"
            />
            {{ agent.name }}
            <!-- "Custom" tag for admin-authored agents (built-ins use `_`-prefixed ids); mirrors AiChatComposer's agent picker. -->
            <Badge
              v-if="!isBuiltInAgentId(agent.id)"
              variant="secondary"
              class="text-xs"
            >
              {{ t("ai.agents.customBadge") }}
            </Badge>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SheetTrigger>
      <SheetContent
        class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-xl border"
        side="left"
        :class="{ 'mt-12': isTauri && !isFullscreen }"
      >
        <SheetHeader>
          <SheetTitle class="flex items-center gap-2">
            <span class="size-6 shrink-0 overflow-hidden rounded-full">
              <Avatar
                variant="beam"
                :name="avatarSeed(agent)"
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
          </SheetTitle>
          <SheetDescription v-if="agent.description">
            {{ agent.description }}
          </SheetDescription>
        </SheetHeader>
        <AgentChatShell :agent="agent" />
      </SheetContent>
    </Sheet>
  </SidebarMenu>
</template>

<script lang="ts" setup>
import { IconBot, IconCirclePlus, IconLock, IconSearch } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import type { ITeamAgent } from "@/types/domain"
import { storeToRefs } from "pinia"

/**
 * Team agents directory. Lists every installed built-in preset and every
 * custom agent (all lifecycle states, badged) — an inventory like
 * SettingsAgents' list, not a picker, so the team-wide `customAgents`
 * gate deliberately doesn't hide rows here. Each row links to the
 * agent's profile at `/agents/{uid}`.
 */

definePage({
  // The parent `agents.vue` is layout-free (so the public [id] profile
  // can render bare); this child opts back into the app chrome + auth.
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Agents",
    breadcrumb: "Agents",
  },
})

useHead({
  title: "Agents",
})

const { t } = useI18n()

const integrationsStore = useIntegrationsStore()
const teamAgentsStore = useTeamAgentsStore()
const {
  agents: customAgents,
  isLoading,
  loadError,
} = storeToRefs(teamAgentsStore)

// Affordance-only gate (server enforces): mirrors SettingsAgents.
const membershipStore = useMembershipStore()
const { isOwner, isAdmin } = storeToRefs(membershipStore)
const canManage = computed(() => isOwner.value || isAdmin.value)

const searchQuery = ref("")

const matchesQuery = (name: string, description: string): boolean => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return true
  return (
    name.toLowerCase().includes(query) ||
    description.toLowerCase().includes(query)
  )
}

interface AgentListRow {
  id: string
  name: string
  description: string
  avatarSeed: string
  isBuiltIn: boolean
  status: "active" | "disabled" | "archived"
  /** The agent's OWN visibility flag (admin's lever), not team-combined. */
  isPublic: boolean
}

/**
 * Installed built-in presets. Same source + i18n-override pattern as
 * SettingsAgents' rows; the enable toggle there maps to a status badge
 * here.
 */
const builtInRows = computed<AgentListRow[]>(() =>
  integrationsStore.agentIntegrations
    .filter((i) => i.source !== "custom" && i.installed)
    .map((i): AgentListRow => {
      const id = i.sourceKey ?? i.id
      return {
        id,
        name: t(`settings.agents.builtInAgents.${id}.label`, i.name),
        description: t(
          `settings.agents.builtInAgents.${id}.description`,
          i.description
        ),
        avatarSeed: i.avatarSeed || i.name,
        isBuiltIn: true,
        status: i.enabled ? "active" : "disabled",
        isPublic: true,
      }
    })
    .filter((row) => matchesQuery(row.name, row.description))
)

const toCustomRow = (agent: ITeamAgent): AgentListRow => ({
  id: agent.id,
  name: agent.name,
  description: agent.description,
  avatarSeed: agent.avatarSeed || agent.name,
  isBuiltIn: false,
  status: agent.archivedAt
    ? "archived"
    : agent.enabled === false
      ? "disabled"
      : "active",
  isPublic: agent.isPublic !== false,
})

const customRows = computed<AgentListRow[]>(() =>
  customAgents.value
    .map(toCustomRow)
    .filter((row) => matchesQuery(row.name, row.description))
)

const hasNoAgentsAtAll = computed(
  () =>
    !isLoading.value &&
    integrationsStore.agentIntegrations.length === 0 &&
    customAgents.value.length === 0
)

const hasNoMatches = computed(
  () =>
    !isLoading.value &&
    !hasNoAgentsAtAll.value &&
    builtInRows.value.length === 0 &&
    customRows.value.length === 0
)

const openNewAgentDialog = (): void => {
  emitter.emit("Dialog.CustomAgents.Open", "new")
}
</script>

<template>
  <ScrollContainer>
    <div class="container mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold tracking-tight">
          {{ t("pages.agents.title") }}
        </h1>
        <p class="text-muted-foreground">
          {{ t("pages.agents.description") }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <div class="relative flex grow items-center">
          <span
            class="pointer-events-none absolute inset-y-0 inset-s-0 flex items-center justify-center px-3"
          >
            <IconSearch />
          </span>
          <Input
            v-model="searchQuery"
            class="pl-9"
            :placeholder="t('pages.agents.searchPlaceholder')"
          />
        </div>
        <Button v-if="canManage" variant="outline" @click="openNewAgentDialog">
          <IconCirclePlus />
          {{ t("settings.agents.custom.newAgent") }}
        </Button>
      </div>

      <LoadingState v-if="isLoading" />

      <template v-else>
        <Empty v-if="loadError" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconBot />
            </EmptyMedia>
            <EmptyTitle>{{ t("pages.agents.loadError") }}</EmptyTitle>
          </EmptyHeader>
        </Empty>

        <Empty v-else-if="hasNoAgentsAtAll" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconBot />
            </EmptyMedia>
            <EmptyTitle>{{ t("pages.agents.noAgents") }}</EmptyTitle>
            <EmptyDescription v-if="canManage">
              {{ t("pages.agents.noAgentsHint") }}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <Empty v-else-if="hasNoMatches" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconSearch />
            </EmptyMedia>
            <EmptyTitle>{{ t("pages.agents.noMatches") }}</EmptyTitle>
          </EmptyHeader>
        </Empty>

        <template v-else>
          <div v-if="builtInRows.length > 0" class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold tracking-tight">
              {{ t("pages.agents.builtInSection") }}
            </h2>
            <ItemGroup class="grid grid-cols-1 gap-2">
              <Item
                v-for="row in builtInRows"
                :key="row.id"
                variant="outline"
                as-child
              >
                <RouterLink :to="`/agents/${row.id}`">
                  <ItemMedia variant="image" class="rounded-md">
                    <AppAvatar
                      variant="beam"
                      :name="row.avatarSeed"
                      class="size-full"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ row.name }}</ItemTitle>
                    <ItemDescription class="text-xs">
                      {{ row.description }}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge v-if="row.status === 'disabled'" variant="outline">
                      {{ t("settings.agents.custom.disabledBadge") }}
                    </Badge>
                  </ItemActions>
                </RouterLink>
              </Item>
            </ItemGroup>
          </div>

          <div v-if="customRows.length > 0" class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold tracking-tight">
              {{ t("pages.agents.customSection") }}
            </h2>
            <ItemGroup class="grid grid-cols-1 gap-2">
              <Item
                v-for="row in customRows"
                :key="row.id"
                variant="outline"
                as-child
              >
                <RouterLink :to="`/agents/${row.id}`">
                  <ItemMedia variant="image" class="rounded-md">
                    <AppAvatar
                      variant="beam"
                      :name="row.avatarSeed"
                      class="size-full"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ row.name }}</ItemTitle>
                    <ItemDescription class="text-xs">
                      {{ row.description }}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge v-if="!row.isPublic" variant="outline">
                      <IconLock />
                      {{ t("pages.publicProfile.private") }}
                    </Badge>
                    <Badge v-if="row.status === 'disabled'" variant="outline">
                      {{ t("settings.agents.custom.disabledBadge") }}
                    </Badge>
                    <Badge
                      v-else-if="row.status === 'archived'"
                      variant="outline"
                    >
                      {{ t("settings.agents.custom.archivedBadge") }}
                    </Badge>
                  </ItemActions>
                </RouterLink>
              </Item>
            </ItemGroup>
          </div>
        </template>
      </template>
    </div>
  </ScrollContainer>
</template>

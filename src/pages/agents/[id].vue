<script lang="ts" setup>
import {
  getPublicAgentProfile,
  type GetPublicAgentProfileResponse,
} from "@/composables/useFunctions"
import { useTeamActions } from "@/composables/useTeamActions"
import { BUILT_IN_AGENTS_BY_ID, isBuiltInAgentId } from "@/data/builtInAgents"
import {
  IconAtSign,
  IconBot,
  IconCheck,
  IconCopy,
  IconGlobe,
  IconLock,
} from "@/data/icons"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { useIsCurrentUserLoaded } from "vuefire"

/**
 * Public agent profile — the agent counterpart of `[username].vue`. The
 * agent's uid doubles as its immutable public handle (`/agents/{uid}`).
 *
 * Resolution tiers, richest wins:
 *
 *   1. **Built-in** (`_`-prefixed id) — platform persona, resolved
 *      synchronously from the client registry. No team context; tools
 *      come from the static definition (they ship in the bundle, so
 *      showing them leaks nothing).
 *
 *   2. **Member view** — when the viewer is signed in and the agent
 *      belongs to their *current* team, the live store provides the
 *      full record (tools, precise lifecycle, timestamps) without any
 *      server round-trip. Works even for agents not enrolled as team
 *      members.
 *
 *   3. **Public view** — `getPublicAgentProfile` resolves any custom
 *      agent by its uid (team-member enrollment not required), gated on
 *      the team being public (or the caller being a member). Returns
 *      display fields only — never prompts or tool toggles.
 */

definePage({
  // Public page: bare chrome (own PageHeader), no auth requirement.
  // The parent `agents.vue` is deliberately layout-free + meta-light so
  // nothing auth-gated is inherited here.
  meta: {
    layout: false,
  },
})

const route = useRoute()
const isAuthLoaded = useIsCurrentUserLoaded()
const { t } = useI18n()

const agentId = computed(() => {
  const id = (route.params as { id?: string }).id || ""
  return id.trim()
})

// ── Tier 1: built-in registry (synchronous) ─────────────────────────────────

const builtInDefinition = computed(() =>
  isBuiltInAgentId(agentId.value)
    ? (BUILT_IN_AGENTS_BY_ID[agentId.value] ?? null)
    : null
)

// ── Tier 2: live store (member view of the current team's agents) ──────────

const teamAgentsStore = useTeamAgentsStore()
const storeAgent = computed(() =>
  agentId.value && !isBuiltInAgentId(agentId.value)
    ? teamAgentsStore.getById(agentId.value)
    : null
)

const { currentTeam } = useTeamActions()

// ── Tier 3: public callable (anonymous + cross-team viewers) ───────────────

const remote = ref<GetPublicAgentProfileResponse | null>(null)
const isFetching = ref(false)
let fetchRequestId = 0

const fetchPublicProfile = async (): Promise<void> => {
  const requestId = ++fetchRequestId
  isFetching.value = true
  try {
    const response = await getPublicAgentProfile({ agentId: agentId.value })
    if (requestId !== fetchRequestId) return
    remote.value = response.data
  } catch (error) {
    if (requestId !== fetchRequestId) return
    console.error("Couldn't load agent profile:", error)
    remote.value = { status: "not_found" }
  } finally {
    if (requestId === fetchRequestId) {
      isFetching.value = false
    }
  }
}

// Wait for auth before fetching so signed-in members get the
// membership-aware result instead of an anonymous "private" flash —
// same gating as [username].vue.
watch(
  [agentId, isAuthLoaded],
  ([id, authLoaded]) => {
    remote.value = null
    if (!authLoaded || !id || isBuiltInAgentId(id)) return
    void fetchPublicProfile()
  },
  { immediate: true }
)

// ── Merged view model ───────────────────────────────────────────────────────

type AgentProfileStatus = "active" | "disabled" | "archived"

interface AgentProfileView {
  id: string
  name: string
  description: string
  avatarSeed: string
  isBuiltIn: boolean
  status: AgentProfileStatus
  /** Effective public reachability — team.isPublic && agent.isPublic. */
  isPublic: boolean
  memberSince: Date | null
  createdAt: Date | null
}

const remoteFound = computed(() =>
  remote.value?.status === "found" ? remote.value : null
)

const profile = computed<AgentProfileView | null>(() => {
  const definition = builtInDefinition.value
  if (definition) {
    return {
      id: definition.id,
      name: t(
        `settings.agents.builtInAgents.${definition.id}.label`,
        definition.name
      ),
      description: t(
        `settings.agents.builtInAgents.${definition.id}.description`,
        definition.description
      ),
      avatarSeed: definition.avatarSeed || definition.name,
      isBuiltIn: true,
      status: "active",
      isPublic: true,
      memberSince: null,
      createdAt: null,
    }
  }

  const local = storeAgent.value
  if (local) {
    return {
      id: local.id,
      name: local.name,
      description: local.description,
      avatarSeed: local.avatarSeed || local.name,
      isBuiltIn: false,
      status: local.archivedAt
        ? "archived"
        : local.enabled === false
          ? "disabled"
          : "active",
      // Server-computed effective visibility when available; local
      // approximation (current team's flag × agent flag) while the
      // callable is in flight.
      isPublic:
        remoteFound.value?.agent.isPublic ??
        ((currentTeam.value?.isPublic ?? false) && local.isPublic !== false),
      memberSince: remoteFound.value?.agent.memberSinceMillis
        ? new Date(remoteFound.value.agent.memberSinceMillis)
        : null,
      createdAt: local.createdAt ? local.createdAt.toDate() : null,
    }
  }

  const found = remoteFound.value
  if (found) {
    return {
      id: found.agent.id,
      name: found.agent.name,
      description: found.agent.description,
      avatarSeed: found.agent.avatarSeed || found.agent.name,
      isBuiltIn: found.agent.isBuiltIn,
      status: found.agent.status,
      isPublic: found.agent.isPublic,
      memberSince: found.agent.memberSinceMillis
        ? new Date(found.agent.memberSinceMillis)
        : null,
      createdAt: found.agent.createdAtMillis
        ? new Date(found.agent.createdAtMillis)
        : null,
    }
  }

  return null
})

interface AgentProfileTeamView {
  name: string
  photoURL: string | null
  username: string | null
}

const team = computed<AgentProfileTeamView | null>(() => {
  if (builtInDefinition.value) return null
  const found = remoteFound.value
  if (found?.team) {
    return {
      name: found.team.name,
      photoURL: found.team.photoURL,
      username: found.team.username,
    }
  }
  // Member view of an agent the public callable can't resolve (not
  // enrolled as a team member): the viewer's current team IS the
  // agent's team — custom agents are team-scoped.
  if (storeAgent.value && currentTeam.value) {
    return {
      name: currentTeam.value.name,
      photoURL: currentTeam.value.photoURL ?? null,
      username: currentTeam.value.username ?? null,
    }
  }
  return null
})

/**
 * Enabled tools — member tier (live store) or built-in definition.
 * Deliberately absent from the public-callable payload, so anonymous
 * viewers of custom agents never see this section.
 */
const AGENT_TOOL_KEYS = [
  "rollDice",
  "browseInternet",
  "askQuestion",
  "searchWorkspaceNodes",
  "listWorkspaceNodes",
  "summarizeNode",
  "compareNodes",
  "findRelatedNodes",
  "manageContent",
  "readContent",
] as const

const enabledTools = computed<string[]>(() => {
  const toggles = builtInDefinition.value?.tools ?? storeAgent.value?.tools
  if (!toggles) return []
  return AGENT_TOOL_KEYS.filter((key) => toggles[key] !== false)
})

// ── Page state ──────────────────────────────────────────────────────────────

type ProfilePageState = "loading" | "found" | "private" | "not_found"

const pageState = computed<ProfilePageState>(() => {
  if (!agentId.value) return "not_found"
  if (builtInDefinition.value) return "found"
  if (isBuiltInAgentId(agentId.value)) return "not_found"
  if (storeAgent.value) return "found"
  if (isFetching.value || remote.value === null) return "loading"
  return remote.value.status
})

const memberSinceLabel = useDateFormat(
  computed(() => profile.value?.memberSince ?? new Date(0)),
  "D MMM YYYY"
)
const createdAtLabel = useDateFormat(
  computed(() => profile.value?.createdAt ?? new Date(0)),
  "D MMM YYYY"
)

const source = computed(() => window.location.href)
const { copy, copied } = useClipboard({ source, legacy: true })

useHead(() => ({
  title: profile.value?.name || t("pages.agents.profile.title"),
}))
</script>

<template>
  <div class="flex grow flex-col items-center">
    <PageHeader />
    <div class="w-full max-w-2xl px-2">
      <template v-if="pageState === 'loading'">
        <LoadingState class="h-screen" />
      </template>

      <template v-else>
        <div class="flex flex-col items-center justify-center p-2">
          <div
            class="bg-background flex aspect-video max-h-40 w-full flex-col rounded-2xl border shadow-xs"
          >
            <div class="flex items-center justify-between p-2">
              <Logo class="size-8 shrink-0 p-2" />
              <Button
                v-if="pageState === 'found'"
                variant="ghost"
                size="icon"
                @click="copy(source)"
              >
                <IconCopy v-if="!copied" />
                <IconCheck v-else />
              </Button>
            </div>
            <div class="flex grow items-center justify-between p-2"></div>
            <div
              v-if="pageState === 'found' && profile"
              class="flex items-center justify-between p-2"
            >
              <div class="flex items-center gap-2">
                <Badge variant="secondary">
                  <IconBot />
                  {{
                    profile.isBuiltIn
                      ? t("pages.agents.profile.builtInBadge")
                      : t("pages.agents.profile.customBadge")
                  }}
                </Badge>
                <Badge variant="secondary">
                  <IconGlobe v-if="profile.isPublic" />
                  <IconLock v-else />
                  {{
                    profile.isPublic
                      ? t("pages.publicProfile.public")
                      : t("pages.publicProfile.private")
                  }}
                </Badge>
              </div>
              <Badge v-if="profile.status !== 'active'" variant="outline">
                {{ t(`pages.agents.profile.status.${profile.status}`) }}
              </Badge>
            </div>
          </div>
          <div
            class="bg-background mx-auto -mt-10 rounded-full border p-1.5 shadow-xs"
          >
            <div v-if="pageState === 'found' && profile">
              <AppAvatar
                variant="beam"
                class="size-20"
                :name="profile.avatarSeed"
              />
            </div>
            <div
              v-else
              class="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-2xl"
            >
              <IconBot />
            </div>
          </div>
        </div>

        <template v-if="pageState === 'found' && profile">
          <div
            class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
          >
            <h1 class="text-2xl font-bold tracking-tight">
              {{ profile.name }}
            </h1>
            <!-- The uid IS the agent's handle — immutable by design. -->
            <Badge variant="secondary" class="text-muted-foreground">
              <IconAtSign />
              {{ profile.id }}
            </Badge>
            <p
              v-if="profile.description"
              class="text-muted-foreground max-w-md text-center text-sm"
            >
              {{ profile.description }}
            </p>
            <div
              class="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs"
            >
              <span v-if="profile.memberSince">
                {{
                  t("pages.agents.profile.memberSince", {
                    date: memberSinceLabel,
                  })
                }}
              </span>
              <span v-if="profile.createdAt">
                {{ t("labels.createdOn") }} {{ createdAtLabel }}
              </span>
            </div>
          </div>

          <div
            v-if="team"
            class="mx-auto flex w-full max-w-md flex-col gap-2 p-2"
          >
            <span class="text-muted-foreground text-xs">
              {{ t("pages.agents.profile.team") }}
            </span>
            <ItemGroup class="grid grid-cols-1 gap-2">
              <Item variant="outline" :as-child="!!team.username">
                <RouterLink v-if="team.username" :to="`/${team.username}`">
                  <ItemMedia>
                    <AppAvatar :src="team.photoURL" :name="team.name" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ team.name }}</ItemTitle>
                    <ItemDescription class="text-xs">
                      @{{ team.username }}
                    </ItemDescription>
                  </ItemContent>
                </RouterLink>
                <template v-else>
                  <ItemMedia>
                    <AppAvatar :src="team.photoURL" :name="team.name" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{{ team.name }}</ItemTitle>
                  </ItemContent>
                </template>
              </Item>
            </ItemGroup>
          </div>

          <div
            v-if="enabledTools.length > 0"
            class="mx-auto flex w-full max-w-md flex-col gap-2 p-2"
          >
            <span class="text-muted-foreground text-xs">
              {{ t("pages.agents.profile.tools") }}
            </span>
            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="tool in enabledTools" :key="tool" variant="outline">
                {{ t(`settings.agents.tools.${tool}.label`, tool) }}
              </Badge>
            </div>
          </div>
        </template>

        <template v-else-if="pageState === 'private'">
          <div
            class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
          >
            <h1 class="text-2xl font-bold tracking-tight">
              {{ t("pages.agents.profile.privateTitle") }}
            </h1>
            <p class="text-muted-foreground text-center text-sm">
              {{ t("pages.agents.profile.privateDescription") }}
            </p>
          </div>
        </template>

        <template v-else>
          <div
            class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
          >
            <h1 class="text-2xl font-bold tracking-tight">
              {{ t("pages.agents.profile.notFoundTitle") }}
            </h1>
            <p class="text-muted-foreground text-center text-sm">
              {{ t("pages.agents.profile.notFoundDescription") }}
            </p>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

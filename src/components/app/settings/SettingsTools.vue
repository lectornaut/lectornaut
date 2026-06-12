<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useAgentConfig } from "@/composables/useAgentConfig"
import { useIntegrations } from "@/composables/useIntegrations"
import { useTeamCustomTools } from "@/composables/useTeamCustomTools"
import { CONNECTION_APPS } from "@/data/connectionApps"
import { IconChevronDown, IconCirclePlus, IconWrench } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import type { IConnection } from "@/schemas/connections"
import { useAuthStore } from "@/stores/authStore"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import { getConnectionsCollection } from "@/utils/firebase/firebase-helpers"
import {
  useCollectionQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import { CONNECTION_TOOL_KEYS } from "@lectornaut/shared/domain"
import type { ITeamCustomTool } from "@/types/domain"
import { storeToRefs } from "pinia"

/**
 * SettingsTools — three sibling sections, top-to-bottom:
 *
 *   1. **Built-in tools** — enable/disable the bot's installed
 *      first-party model-callable tools (rollDice, browseInternet,
 *      askQuestion, searchWorkspaceNodes, summarizeNode). Each is a
 *      catalog integration: toggling enable is an immediate
 *      per-integration write, and an uninstalled tool drops out of the
 *      list entirely (install/remove lives on the Integrations page).
 *
 *   2. **Connection tools** — tools contributed by connection apps
 *      (Google Calendar, Google Drive). Same immediate per-integration
 *      enable write as built-ins, but the install default inverts: they're
 *      doc-backed opt-ins, so the whole section (separator included) hides
 *      until a connection app is installed on the Integrations page — no
 *      empty state, that page is the discovery surface. Rows are key-driven
 *      (one per installed `CONNECTION_TOOL_KEYS` entry), so a new app needs
 *      only its `settings.agents.tools.{key}.*` locale entries.
 *
 *   3. **Custom tools** — admin-authored Genkit tools. Inline list
 *      with active / disabled / archived collapsibles, row actions,
 *      and dialog editor. The team-wide `customTools` gate sits at
 *      the top of this section.
 *
 * Node read/write (`readContent` / `manageContent`) have NO team-wide
 * switch — agents are real team members, so their READ_WORKSPACE /
 * MANAGE_WORKSPACE_CONTENT role IS the team-level authorization; a parallel
 * team toggle would only duplicate (and could conflict with) membership.
 * Both are per-agent toggles only (in the agent editor), and the inspector's
 * summary button is always-on — so none of them appears on this page.
 *
 * Built-in agents + custom agents (and the team-wide `customAgents`
 * gate) live on the sibling `SettingsAgents` page. AI config
 * (providers, model, generation params, prompts, …) lives on
 * `SettingsAi`. All three pages back the same Pinia-backed
 * `useAgentConfig` store.
 *
 * Field ownership within `tools.*`: this page owns only the `customTools`
 * gate, and toggling it is now an immediate write (no unsaved bar) — same
 * apply-on-change model as the built-in tool toggles above it. `customAgents`
 * stays on `SettingsAgents`. To avoid clobbering the sibling page's
 * `tools.customAgents` edit, the toggle's save payload overlays `customTools`
 * onto `config.value.tools` (latest server state) — Firestore's `{merge:true}`
 * is a shallow top-level merge so sending the full `tools` object always
 * replaces it.
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

// ── Tool toggles (built-in tools + custom tools gate) ──────────────────────

const configMessagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  saveSuccess: t("settings.agents.saveSuccess"),
  saveError: t("settings.agents.saveError"),
  loadError: t("settings.agents.loadError"),
})

const { config, isLoading, isSaving, canEdit, save } =
  useAgentConfig(configMessagesGetter)

/**
 * The team-wide `customTools` gate applies immediately on toggle — no
 * unsaved bar. `save()` isn't optimistic (`config` only updates once the
 * callable returns), so hold the intended value locally for instant Switch
 * feedback and revert if the save fails; mirrors SettingsOverview's
 * immediate public-team toggle. The payload overlays `customTools` onto the
 * latest `config.value.tools` so a sibling tab's in-flight edit to another
 * tool key (notably `tools.customAgents`) isn't clobbered.
 */
const pendingCustomTools = ref<boolean | null>(null)
const customToolsEnabled = computed(
  () => pendingCustomTools.value ?? config.value.tools.customTools
)

const handleToggleCustomTools = async (value: boolean): Promise<void> => {
  if (!canEdit.value) return
  pendingCustomTools.value = value
  try {
    await save({ tools: { ...config.value.tools, customTools: value } })
  } finally {
    pendingCustomTools.value = null
  }
}

/**
 * Built-in tool install + enable state, resolved from the unified integrations
 * store (catalog overlay). Uninstalled tools (removed on the Integrations page)
 * drop out of this enable/disable list — install is a separate axis from on/off.
 * Toggling enable is an IMMEDIATE per-integration write (materializes a thin doc
 * carrying the flag), so it's no longer part of the dirty-bar form. The feature
 * gates below (summary button, node read/write) always show + stay on the form.
 */
const integrationsStore = useIntegrationsStore()
const { setEnabled: setIntegrationEnabled } = useIntegrations()

const builtInToolState = computed(() => {
  const map = new Map<string, { installed: boolean; enabled: boolean }>()
  for (const i of integrationsStore.toolIntegrations) {
    if (i.source !== "custom" && i.sourceKey) {
      map.set(i.sourceKey, { installed: i.installed, enabled: i.enabled })
    }
  }
  return map
})
const isToolInstalled = (name: string): boolean =>
  builtInToolState.value.get(name)?.installed ?? true
const isBuiltInToolEnabled = (name: string): boolean =>
  builtInToolState.value.get(name)?.enabled ?? true
/**
 * Connection-contributed tools invert the default: they're doc-backed
 * (opt-in), so "no doc" means NOT installed — the row appears only while the
 * connection app is installed on the Integrations page. (Built-ins above use
 * `?? true` because absence means "never diverged from the shipped default".)
 */
const isConnectionToolInstalled = (name: string): boolean =>
  builtInToolState.value.get(name)?.installed ?? false
// Drives both the section gate and the per-tool rows. Keys come from the
// shared vocabulary (the app directory's `toolKeys` mirror it), so a new
// connection app surfaces here without touching this component's logic.
const installedConnectionToolKeys = computed(() =>
  CONNECTION_TOOL_KEYS.filter((name) => isConnectionToolInstalled(name))
)
const hasConnectionTools = computed(
  () => installedConnectionToolKeys.value.length > 0
)

/**
 * Team-wide kill switch reflection (Settings → Connections → info dialog →
 * "Enabled for the team"). While the OWNING connection is `status:
 * "disabled"`, the server force-drops its tools from dispatch regardless of
 * the per-tool enable bit — so the rows below lock their Switch and show a
 * badge instead of silently lying. A plain connections-doc read, NOT
 * `useConnections` (which would pull binding listeners + the GIS preload
 * onto this page); the underlying subscription dedupes with the Connections
 * page's via the query cache.
 */
const authStore = useAuthStore()
const { currentTeamId } = storeToRefs(authStore)
const connectionsQuery = useCollectionQuery<IConnection>(
  (): CollectionQuerySource | null => {
    const teamId = currentTeamId.value
    if (!teamId) return null
    return {
      query: getConnectionsCollection(teamId),
      path: `teams/${teamId}/connections`,
    }
  }
)
const PROVIDER_BY_TOOL_KEY = new Map(
  CONNECTION_APPS.flatMap((app) =>
    app.toolKeys.map((key) => [key, app.provider] as const)
  )
)
const disabledConnectionProviders = computed<Set<string>>(
  () =>
    new Set(
      (connectionsQuery.data.value ?? [])
        .filter((c) => c?.status === "disabled")
        .map((c) => c!.provider)
    )
)
const isConnectionToolKilled = (name: string): boolean => {
  const provider = PROVIDER_BY_TOOL_KEY.get(name)
  return !!provider && disabledConnectionProviders.value.has(provider)
}
const handleToggleBuiltInTool = async (
  name: string,
  value: boolean
): Promise<void> => {
  await setIntegrationEnabled({ type: "tool", sourceKey: name }, value)
}

// Every shipped built-in tool, used to detect the all-uninstalled empty
// state. A tool reads as installed unless an explicit divergence doc opts it
// out (see `isToolInstalled`), so this stays true until the last one is
// removed on the Integrations page.
const BUILT_IN_TOOL_NAMES = [
  "rollDice",
  "browseInternet",
  "askQuestion",
  "searchWorkspaceNodes",
  "summarizeNode",
] as const
const hasBuiltInTools = computed(() =>
  BUILT_IN_TOOL_NAMES.some((name) => isToolInstalled(name))
)

// ── Custom tools (inline list) ─────────────────────────────────────────────

const toolsMessagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  createSuccess: t("settings.agents.customTools.createSuccess"),
  createError: t("settings.agents.customTools.createError"),
  updateSuccess: t("settings.agents.customTools.updateSuccess"),
  updateError: t("settings.agents.customTools.updateError"),
  archiveSuccess: t("settings.agents.customTools.archiveSuccess"),
  archiveError: t("settings.agents.customTools.archiveError"),
  restoreSuccess: t("settings.agents.customTools.restoreSuccess"),
  restoreError: t("settings.agents.customTools.restoreError"),
  enableSuccess: t("settings.agents.customTools.enableSuccess"),
  disableSuccess: t("settings.agents.customTools.disableSuccess"),
  setEnabledError: t("settings.agents.customTools.setEnabledError"),
  deleteSuccess: t("settings.agents.customTools.deleteSuccess"),
  deleteError: t("settings.agents.customTools.deleteError"),
})

const {
  selectableTools,
  disabledTools,
  archivedTools,
  isLoading: isLoadingTools,
  isSaving: isSavingTools,
  canManage: canManageTools,
  cannotManageReason: cannotManageToolsReason,
  archive: archiveTool,
  restore: restoreTool,
  setEnabled: setToolEnabled,
  remove: removeTool,
} = useTeamCustomTools(toolsMessagesGetter)

const customToolsActiveOpen = ref(true)
const customToolsDisabledOpen = ref(false)
const customToolsArchivedOpen = ref(false)

const openNewToolDialog = (): void => {
  emitter.emit("Dialog.CustomTools.Open", "new")
}

const openEditToolDialog = (tool: ITeamCustomTool): void => {
  emitter.emit("Dialog.CustomTools.Open", { toolId: tool.id })
}

const handleToggleToolEnabled = async (
  tool: ITeamCustomTool,
  enabled: boolean
): Promise<void> => {
  await setToolEnabled(tool.id, enabled)
}

const handleArchiveTool = async (tool: ITeamCustomTool): Promise<void> => {
  await archiveTool(tool.id)
}

const handleRestoreTool = async (tool: ITeamCustomTool): Promise<void> => {
  await restoreTool(tool.id)
}

const handleRemoveTool = async (tool: ITeamCustomTool): Promise<void> => {
  await removeTool(tool.id)
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <LoadingState v-if="isLoading" />
    <FieldGroup v-else>
      <!-- ── Built-in tools ─────────────────────────────────────────── -->
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.agents.tools.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field v-if="isToolInstalled('rollDice')" orientation="horizontal">
          <FieldContent>
            <FieldLabel for="agent-tool-dice">
              {{ t("settings.agents.tools.rollDice.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.rollDice.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-tool-dice"
            :model-value="isBuiltInToolEnabled('rollDice')"
            :disabled="!canEdit"
            @update:model-value="
              (v) => handleToggleBuiltInTool('rollDice', Boolean(v))
            "
          />
        </Field>

        <Field
          v-if="isToolInstalled('browseInternet')"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel for="agent-tool-browse-internet">
              {{ t("settings.agents.tools.browseInternet.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.browseInternet.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-tool-browse-internet"
            :model-value="isBuiltInToolEnabled('browseInternet')"
            :disabled="!canEdit"
            @update:model-value="
              (v) => handleToggleBuiltInTool('browseInternet', Boolean(v))
            "
          />
        </Field>

        <Field v-if="isToolInstalled('askQuestion')" orientation="horizontal">
          <FieldContent>
            <FieldLabel for="agent-tool-ask">
              {{ t("settings.agents.tools.askQuestion.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.askQuestion.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-tool-ask"
            :model-value="isBuiltInToolEnabled('askQuestion')"
            :disabled="!canEdit"
            @update:model-value="
              (v) => handleToggleBuiltInTool('askQuestion', Boolean(v))
            "
          />
        </Field>

        <Field
          v-if="isToolInstalled('searchWorkspaceNodes')"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel for="agent-tool-search-nodes">
              {{ t("settings.agents.tools.searchWorkspaceNodes.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.searchWorkspaceNodes.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-tool-search-nodes"
            :model-value="isBuiltInToolEnabled('searchWorkspaceNodes')"
            :disabled="!canEdit"
            @update:model-value="
              (v) => handleToggleBuiltInTool('searchWorkspaceNodes', Boolean(v))
            "
          />
        </Field>

        <Field v-if="isToolInstalled('summarizeNode')" orientation="horizontal">
          <FieldContent>
            <FieldLabel for="agent-tool-summarize-node">
              {{ t("settings.agents.tools.summarizeNode.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.summarizeNode.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-tool-summarize-node"
            :model-value="isBuiltInToolEnabled('summarizeNode')"
            :disabled="!canEdit"
            @update:model-value="
              (v) => handleToggleBuiltInTool('summarizeNode', Boolean(v))
            "
          />
        </Field>

        <!-- Every built-in tool uninstalled via Integrations — nothing left
               to enable here. -->
        <Empty v-if="!hasBuiltInTools" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconWrench />
            </EmptyMedia>
            <EmptyTitle>{{ t("settings.agents.tools.empty") }}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </FieldSet>

      <!-- ── Connection tools ───────────────────────────────────── -->
      <!--
          Doc-backed opt-ins contributed by connection apps. The section
          (separator included) renders only while at least one app is
          installed on Integrations — no empty state here; that page is
          the discovery surface. One row per installed tool key, labels
          from the same `settings.agents.tools.{key}.*` locale entries the
          connection info dialog's Overview tab reads — a new app's tool
          surfaces here with locale entries alone.
        -->
      <template v-if="hasConnectionTools">
        <FieldSeparator />

        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.tools.connectionTools.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.connectionTools.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field
            v-for="toolKey in installedConnectionToolKeys"
            :key="toolKey"
            orientation="horizontal"
          >
            <FieldContent>
              <FieldLabel :for="`agent-tool-connection-${toolKey}`">
                {{ t(`settings.agents.tools.${toolKey}.label`) }}
                <!-- Connection-level kill switch outranks this per-tool
                     enable: the server won't dispatch the tool either way,
                     so the Switch locks to avoid posing a dead control. -->
                <Badge v-if="isConnectionToolKilled(toolKey)" variant="outline">
                  {{ t("settings.agents.tools.disabledForTeam") }}
                </Badge>
              </FieldLabel>
              <FieldDescription>
                {{ t(`settings.agents.tools.${toolKey}.description`) }}
              </FieldDescription>
            </FieldContent>
            <Switch
              :id="`agent-tool-connection-${toolKey}`"
              :model-value="isBuiltInToolEnabled(toolKey)"
              :disabled="!canEdit || isConnectionToolKilled(toolKey)"
              @update:model-value="
                (v) => handleToggleBuiltInTool(toolKey, Boolean(v))
              "
            />
          </Field>
        </FieldSet>
      </template>

      <FieldSeparator />

      <!-- ── Custom tools ────────────────────────────────────────── -->
      <FieldSet>
        <!--
            Team-wide feature gate doubles as the section header.
            Sibling of `tools.customAgents` — same on/off semantics.
            When false, the server's dispatcher skips the Firestore
            read for `teams/{teamId}/tools` AND no custom tools are
            registered with Genkit that turn. The list below stays
            visible to admins so they can manage tools even while the
            feature is gated.
          -->
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="agent-tool-custom-tools">
              {{ t("settings.agents.tools.customTools.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.tools.customTools.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-tool-custom-tools"
            :model-value="customToolsEnabled"
            :disabled="!canEdit || isSaving"
            @update:model-value="(v) => handleToggleCustomTools(Boolean(v))"
          />
        </Field>

        <!--
            "New tool" CTA row. Gated on admin rights AND the
            team-wide feature toggle — admins can't create a tool that
            wouldn't be reachable.
          -->
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.agents.customTools.available") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.agents.customTools.availableDescription") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="inline-block">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!canManageTools || !customToolsEnabled"
                    @click="openNewToolDialog"
                  >
                    <IconCirclePlus />
                    {{ t("settings.agents.customTools.newTool") }}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent v-if="!canManageTools && cannotManageToolsReason">
                {{ cannotManageToolsReason }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!--
            Inline list — same active / disabled / archived collapsible
            layout as Custom agents. Empty state surfaces only when
            EVERY bucket is empty.
          -->
        <div class="flex flex-col gap-2">
          <LoadingState v-if="isLoadingTools" />

          <template v-else>
            <Empty
              v-if="
                selectableTools.length === 0 &&
                disabledTools.length === 0 &&
                archivedTools.length === 0
              "
              class="border border-dashed"
            >
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconWrench />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("settings.agents.customTools.empty") }}
                </EmptyTitle>
                <EmptyDescription v-if="canManageTools">
                  {{ t("settings.agents.customTools.emptyHint") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>

            <!-- Active (selectable) tools -->
            <Collapsible
              v-if="selectableTools.length > 0"
              v-model:open="customToolsActiveOpen"
            >
              <CollapsibleTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="w-full justify-between"
                >
                  <span class="flex items-center gap-2">
                    {{
                      t("settings.agents.customTools.activeSection", {
                        count: selectableTools.length,
                      })
                    }}
                  </span>
                  <IconChevronDown
                    class="size-4 transition-transform"
                    :class="{ 'rotate-180': customToolsActiveOpen }"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ItemGroup class="gap-2 pt-2">
                  <SettingsCustomToolRow
                    v-for="tool in selectableTools"
                    :key="tool.id"
                    :tool="tool"
                    :can-manage="canManageTools"
                    :is-saving="isSavingTools"
                    @edit="openEditToolDialog(tool)"
                    @toggle-enabled="
                      (value) => handleToggleToolEnabled(tool, value)
                    "
                    @archive="handleArchiveTool(tool)"
                    @restore="handleRestoreTool(tool)"
                    @remove="handleRemoveTool(tool)"
                  />
                </ItemGroup>
              </CollapsibleContent>
            </Collapsible>

            <!-- Disabled tools -->
            <Collapsible
              v-if="disabledTools.length > 0"
              v-model:open="customToolsDisabledOpen"
            >
              <CollapsibleTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="w-full justify-between"
                >
                  <span class="flex items-center gap-2">
                    {{
                      t("settings.agents.customTools.disabledSection", {
                        count: disabledTools.length,
                      })
                    }}
                  </span>
                  <IconChevronDown
                    class="size-4 transition-transform"
                    :class="{ 'rotate-180': customToolsDisabledOpen }"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ItemGroup class="gap-2 pt-2">
                  <SettingsCustomToolRow
                    v-for="tool in disabledTools"
                    :key="tool.id"
                    :tool="tool"
                    :can-manage="canManageTools"
                    :is-saving="isSavingTools"
                    @edit="openEditToolDialog(tool)"
                    @toggle-enabled="
                      (value) => handleToggleToolEnabled(tool, value)
                    "
                    @archive="handleArchiveTool(tool)"
                    @restore="handleRestoreTool(tool)"
                    @remove="handleRemoveTool(tool)"
                  />
                </ItemGroup>
              </CollapsibleContent>
            </Collapsible>

            <!-- Archived tools -->
            <Collapsible
              v-if="archivedTools.length > 0"
              v-model:open="customToolsArchivedOpen"
            >
              <CollapsibleTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="w-full justify-between"
                >
                  <span class="flex items-center gap-2">
                    {{
                      t("settings.agents.customTools.archivedSection", {
                        count: archivedTools.length,
                      })
                    }}
                  </span>
                  <IconChevronDown
                    class="size-4 transition-transform"
                    :class="{ 'rotate-180': customToolsArchivedOpen }"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ItemGroup class="gap-2 pt-2">
                  <SettingsCustomToolRow
                    v-for="tool in archivedTools"
                    :key="tool.id"
                    :tool="tool"
                    :can-manage="canManageTools"
                    :is-saving="isSavingTools"
                    @edit="openEditToolDialog(tool)"
                    @toggle-enabled="
                      (value) => handleToggleToolEnabled(tool, value)
                    "
                    @archive="handleArchiveTool(tool)"
                    @restore="handleRestoreTool(tool)"
                    @remove="handleRemoveTool(tool)"
                  />
                </ItemGroup>
              </CollapsibleContent>
            </Collapsible>
          </template>
        </div>
      </FieldSet>
    </FieldGroup>
  </div>
  <SettingsRestricted v-else />
</template>

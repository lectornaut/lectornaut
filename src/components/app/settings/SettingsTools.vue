<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { cloneAgentConfig, useAgentConfig } from "@/composables/useAgentConfig"
import { useIntegrations } from "@/composables/useIntegrations"
import { useTeamCustomTools } from "@/composables/useTeamCustomTools"
import { IconChevronDown, IconCirclePlus, IconWrench } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import type { IBotAgentConfig, ITeamCustomTool } from "@/types/domain"

/**
 * SettingsTools — two sibling sections, top-to-bottom:
 *
 *   1. **Built-in tools** — enable/disable the bot's installed
 *      first-party model-callable tools (rollDice, browseInternet,
 *      askQuestion, searchWorkspaceNodes, summarizeNode). Each is a
 *      catalog integration: toggling enable is an immediate
 *      per-integration write, and an uninstalled tool drops out of the
 *      list entirely (install/remove lives on the Integrations page).
 *
 *   2. **Custom tools** — admin-authored Genkit tools. Inline list
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
 * Field ownership within `tools.*`: this page's dirty-bar form owns only the
 * `customTools` gate (see `TOOLS_PAGE_FIELDS`); built-in tool enable/disable
 * is an immediate per-integration write, not part of the form. `customAgents`
 * stays on `SettingsAgents`. To avoid clobbering the sibling page's
 * `tools.customAgents` edit on save, the save handler bases its payload on
 * `config.value.tools` (latest server state) and overlays only this page's
 * owned keys — Firestore's `{merge:true}` is a shallow top-level merge so
 * sending the full `tools` object always replaces it.
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

// `tools.*` keys owned by this page's dirty-bar form. Only the `customTools`
// feature gate now: built-in tool enable/disable is an immediate
// per-integration write (see below), and node read/write are per-agent +
// membership-gated (no team switch), so neither lives on this form.
const TOOLS_PAGE_FIELDS = [
  "customTools",
] as const satisfies readonly (keyof IBotAgentConfig["tools"])[]

// ── Tool toggles (built-in tools + custom tools gate) ──────────────────────

const configMessagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  saveSuccess: t("settings.agents.saveSuccess"),
  saveError: t("settings.agents.saveError"),
  loadError: t("settings.agents.loadError"),
})

const { config, isLoading, isSaving, canEdit, save } =
  useAgentConfig(configMessagesGetter)

const draft = ref<IBotAgentConfig>(cloneAgentConfig(config.value))

/**
 * Dirty check is scoped to the `tools.*` keys this page owns. The
 * sibling Agents page's `tools.customAgents` change must NOT show up
 * as dirty here, so we compare only the page's own slice.
 */
const isDirty = computed(() => {
  const draftSlice: Record<string, unknown> = {}
  const configSlice: Record<string, unknown> = {}
  for (const key of TOOLS_PAGE_FIELDS) {
    draftSlice[key] = draft.value.tools[key]
    configSlice[key] = config.value.tools[key]
  }
  return JSON.stringify(draftSlice) !== JSON.stringify(configSlice)
})

// Dirty-aware re-clone: snap to the canonical config only when this
// page has no unsaved changes. Lets a sibling-tab save (AI or Agents)
// propagate here without clobbering an in-flight toggle change.
watch(
  config,
  (next) => {
    if (!isDirty.value) draft.value = cloneAgentConfig(next)
  },
  { deep: true }
)

/**
 * Build the save payload by overlaying this page's owned keys onto
 * the latest `config.value.tools`. Necessary because Firestore's
 * `{merge:true}` is a top-level shallow merge — sending a partial
 * `tools` object would replace any sibling-page edits to keys this
 * page doesn't own (notably `tools.customAgents`).
 */
const handleSave = async () => {
  const nextTools = { ...config.value.tools }
  for (const key of TOOLS_PAGE_FIELDS) {
    nextTools[key] = draft.value.tools[key]
  }
  await save({ tools: nextTools })
}

const handleDiscard = () => {
  draft.value = cloneAgentConfig(config.value)
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
const handleToggleBuiltInTool = async (
  name: string,
  value: boolean
): Promise<void> => {
  await setIntegrationEnabled({ type: "tool", sourceKey: name }, value)
}

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
  <div v-if="canViewTeamSettings" class="flex grow flex-col justify-between">
    <div class="p-6">
      <div v-if="isLoading" class="flex justify-center py-8">
        <Spinner />
      </div>
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
                {{
                  t("settings.agents.tools.searchWorkspaceNodes.description")
                }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-search-nodes"
              :model-value="isBuiltInToolEnabled('searchWorkspaceNodes')"
              :disabled="!canEdit"
              @update:model-value="
                (v) =>
                  handleToggleBuiltInTool('searchWorkspaceNodes', Boolean(v))
              "
            />
          </Field>

          <Field
            v-if="isToolInstalled('summarizeNode')"
            orientation="horizontal"
          >
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
        </FieldSet>

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
              v-model="draft.tools.customTools"
              :disabled="!canEdit"
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
                      :disabled="!canManageTools || !draft.tools.customTools"
                      @click="openNewToolDialog"
                    >
                      <IconCirclePlus />
                      {{ t("settings.agents.customTools.newTool") }}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  v-if="!canManageTools && cannotManageToolsReason"
                >
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
            <div v-if="isLoadingTools" class="flex justify-center py-8">
              <Spinner />
            </div>

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
    <SettingsUnsavedBar
      v-if="!isLoading && isDirty && canEdit"
      :saving="isSaving"
      @discard="handleDiscard"
      @save="handleSave"
    />
  </div>
  <SettingsRestricted v-else />
</template>

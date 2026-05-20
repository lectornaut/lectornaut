<script lang="ts" setup>
import { cloneAgentConfig, useAgentConfig } from "@/composables/useAgentConfig"
import { useTeamAgents } from "@/composables/useTeamAgents"
import { IconBot, IconChevronDown, IconCirclePlus } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import type { IBotAgentConfig, ITeamAgent } from "@/types/domain"

/**
 * SettingsAgents — two sibling sections:
 *
 *   1. **Built-in tools** — feature flags for the bot's first-party
 *      tool surface (getWeather, rollDice, askQuestion,
 *      searchWorkspaceNodes, summarizeNode). Saved as the `tools`
 *      subset of `agentConfig`.
 *
 *   2. **Custom agents** — team-wide feature gate toggle + an inline
 *      list of the team's agents (active + collapsible Disabled +
 *      collapsible Archived). Per-agent edit, archive/restore,
 *      enable/disable, and hard-delete actions sit on each row. A
 *      "New agent" button opens the (now editor-only)
 *      `SettingsCustomAgents` dialog in create mode; row edit opens
 *      the same dialog with that agent loaded.
 *
 * High-level AI config (providers, model, generation params, system
 * prompts, display limits, restore-defaults) lives in the sibling
 * `SettingsAi` page. Both pages back the same Pinia-backed
 * `useAgentConfig` store; this page sends ONLY the `tools` field on
 * save so a parallel edit on the AI tab can't be clobbered. The
 * dirty-aware watcher preserves in-flight tool edits across saves
 * triggered by the AI tab.
 */

const { t } = useI18n()

// ── Tool toggles (built-in tools + customAgents gate) ───────────────────────

// i18n strings handed to the composable as a getter so locale changes
// flow into toasts and `cannotEditReason` tooltip without remounting.
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
 * Dirty check is scoped to `tools` only — the rest of the draft is a
 * read-through copy from the shared config, and a save on the AI tab
 * legitimately changes those fields without meaning this page is
 * dirty.
 */
const isDirty = computed(
  () => JSON.stringify(draft.value.tools) !== JSON.stringify(config.value.tools)
)

// Dirty-aware re-clone: snap to the canonical config only when this
// page has no unsaved changes. Lets an AI-tab save propagate here
// without clobbering an in-flight tool toggle change.
watch(
  config,
  (next) => {
    if (!isDirty.value) draft.value = cloneAgentConfig(next)
  },
  { deep: true }
)

/**
 * Save the tools subset only — providers, model, prompts, etc. live
 * in `SettingsAi` and are deliberately omitted here so a save on
 * this page can't clobber an in-flight edit on the AI tab.
 */
const handleSave = async () => {
  await save({
    tools: { ...draft.value.tools },
  })
}

const handleDiscard = () => {
  draft.value = cloneAgentConfig(config.value)
}

// ── Custom agents (inline list) ─────────────────────────────────────────────

const agentsMessagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  createSuccess: t("settings.agents.custom.createSuccess"),
  createError: t("settings.agents.custom.createError"),
  updateSuccess: t("settings.agents.custom.updateSuccess"),
  updateError: t("settings.agents.custom.updateError"),
  archiveSuccess: t("settings.agents.custom.archiveSuccess"),
  archiveError: t("settings.agents.custom.archiveError"),
  restoreSuccess: t("settings.agents.custom.restoreSuccess"),
  restoreError: t("settings.agents.custom.restoreError"),
  enableSuccess: t("settings.agents.custom.enableSuccess"),
  disableSuccess: t("settings.agents.custom.disableSuccess"),
  setEnabledError: t("settings.agents.custom.setEnabledError"),
  deleteSuccess: t("settings.agents.custom.deleteSuccess"),
  deleteError: t("settings.agents.custom.deleteError"),
})

const {
  selectableAgents,
  disabledAgents,
  archivedAgents,
  isLoading: isLoadingAgents,
  isSaving: isSavingAgents,
  canManage,
  cannotManageReason,
  archive,
  restore,
  setEnabled,
  remove,
} = useTeamAgents(agentsMessagesGetter)

// Active section starts open — it's the primary content. Disabled
// and Archived sections start collapsed; they're admin-discoverability
// extras carried over from the previous dialog list.
const activeSectionOpen = ref(true)
const disabledSectionOpen = ref(false)
const archivedSectionOpen = ref(false)

/**
 * Open the editor-only dialog for a fresh agent. The dialog is mounted
 * globally in `app.vue` and listens for this mitt event.
 */
const openNewAgentDialog = (): void => {
  emitter.emit("Dialog.CustomAgents.Open", "new")
}

/**
 * Open the editor dialog for an existing agent. Payload-shape contract
 * with the dialog: `{ agentId }` selects edit mode.
 */
const openEditAgentDialog = (agent: ITeamAgent): void => {
  emitter.emit("Dialog.CustomAgents.Open", { agentId: agent.id })
}

const handleToggleAgentEnabled = async (
  agent: ITeamAgent,
  enabled: boolean
): Promise<void> => {
  await setEnabled(agent.id, enabled)
}

const handleArchiveAgent = async (agent: ITeamAgent): Promise<void> => {
  await archive(agent.id)
}

const handleRestoreAgent = async (agent: ITeamAgent): Promise<void> => {
  await restore(agent.id)
}

const handleRemoveAgent = async (agent: ITeamAgent): Promise<void> => {
  await remove(agent.id)
}
</script>

<template>
  <div class="flex grow flex-col justify-between">
    <div class="p-6">
      <div v-if="isLoading" class="flex justify-center py-8">
        <Spinner />
      </div>
      <FieldGroup v-else>
        <!-- ── Custom agents ──────────────────────────────────────────── -->
        <FieldSet>
          <!--
            Pure section header — no control. Matches the header
            pattern used by every other FieldSet in this page and the
            sibling AI page (Providers, Generation parameters, …).
            The team-wide feature gate lives in its own Field below
            so the header isn't doing double duty.
          -->
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.custom.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.custom.sectionDescription") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <!--
            Team-wide feature gate. When off, the sidebar's Agents
            section collapses to a single "feature disabled" hint and
            the per-agent sheets stop rendering. The list below stays
            visible to admins so they can manage agents even while the
            feature is gated team-wide — turning it back on then
            instantly surfaces them in the sidebar.
          -->
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-custom-agents">
                {{ t("settings.agents.tools.customAgents.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.customAgents.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-custom-agents"
              v-model="draft.tools.customAgents"
              :disabled="!canEdit"
            />
          </Field>

          <!--
            "New agent" CTA row. Gated on admin rights AND on the
            team-wide feature toggle being on — matches the sidebar
            "New agent" entry's gating so an admin can't create an
            agent that wouldn't appear anywhere yet.
          -->
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.custom.available") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.custom.availableDescription") }}
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="inline-block">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="!canManage || !draft.tools.customAgents"
                      @click="openNewAgentDialog"
                    >
                      <IconCirclePlus />
                      {{ t("settings.agents.custom.newAgent") }}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent v-if="!canManage && cannotManageReason">
                  {{ cannotManageReason }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>

          <!--
            Inline list (loading / empty state / active / Disabled +
            Archived collapsibles). Kept in its own gap-2 column so
            row spacing stays tight regardless of FieldSet's default
            child spacing.
          -->
          <div class="flex flex-col gap-2">
            <div v-if="isLoadingAgents" class="flex justify-center py-8">
              <Spinner />
            </div>

            <template v-else>
              <!--
                Empty-state — only when no agents exist in any bucket.
                If only the active bucket is empty we still want the
                collapsible Disabled/Archived sections to surface the
                stored entries, so this hint stays out of the way.
              -->
              <Empty
                v-if="
                  selectableAgents.length === 0 &&
                  disabledAgents.length === 0 &&
                  archivedAgents.length === 0
                "
                class="border border-dashed"
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconBot />
                  </EmptyMedia>
                  <EmptyTitle>{{
                    t("settings.agents.custom.empty")
                  }}</EmptyTitle>
                  <EmptyDescription v-if="canManage">
                    {{ t("settings.agents.custom.emptyHint") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>

              <!-- Active (selectable) agents -->
              <Collapsible
                v-if="selectableAgents.length > 0"
                v-model:open="activeSectionOpen"
              >
                <CollapsibleTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-between"
                  >
                    <span class="flex items-center gap-2">
                      {{
                        t("settings.agents.custom.activeSection", {
                          count: selectableAgents.length,
                        })
                      }}
                    </span>
                    <IconChevronDown
                      class="size-4 transition-transform"
                      :class="{ 'rotate-180': activeSectionOpen }"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ItemGroup class="gap-2 pt-2">
                    <SettingsCustomAgentRow
                      v-for="agent in selectableAgents"
                      :key="agent.id"
                      :agent="agent"
                      :can-manage="canManage"
                      :is-saving="isSavingAgents"
                      @edit="openEditAgentDialog(agent)"
                      @toggle-enabled="
                        (value) => handleToggleAgentEnabled(agent, value)
                      "
                      @archive="handleArchiveAgent(agent)"
                      @restore="handleRestoreAgent(agent)"
                      @remove="handleRemoveAgent(agent)"
                    />
                  </ItemGroup>
                </CollapsibleContent>
              </Collapsible>

              <!-- Disabled agents -->
              <Collapsible
                v-if="disabledAgents.length > 0"
                v-model:open="disabledSectionOpen"
              >
                <CollapsibleTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-between"
                  >
                    <span class="flex items-center gap-2">
                      {{
                        t("settings.agents.custom.disabledSection", {
                          count: disabledAgents.length,
                        })
                      }}
                    </span>
                    <IconChevronDown
                      class="size-4 transition-transform"
                      :class="{ 'rotate-180': disabledSectionOpen }"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ItemGroup class="gap-2 pt-2">
                    <SettingsCustomAgentRow
                      v-for="agent in disabledAgents"
                      :key="agent.id"
                      :agent="agent"
                      :can-manage="canManage"
                      :is-saving="isSavingAgents"
                      @edit="openEditAgentDialog(agent)"
                      @toggle-enabled="
                        (value) => handleToggleAgentEnabled(agent, value)
                      "
                      @archive="handleArchiveAgent(agent)"
                      @restore="handleRestoreAgent(agent)"
                      @remove="handleRemoveAgent(agent)"
                    />
                  </ItemGroup>
                </CollapsibleContent>
              </Collapsible>

              <!-- Archived agents -->
              <Collapsible
                v-if="archivedAgents.length > 0"
                v-model:open="archivedSectionOpen"
              >
                <CollapsibleTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-between"
                  >
                    <span class="flex items-center gap-2">
                      {{
                        t("settings.agents.custom.archivedSection", {
                          count: archivedAgents.length,
                        })
                      }}
                    </span>
                    <IconChevronDown
                      class="size-4 transition-transform"
                      :class="{ 'rotate-180': archivedSectionOpen }"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ItemGroup class="gap-2 pt-2">
                    <SettingsCustomAgentRow
                      v-for="agent in archivedAgents"
                      :key="agent.id"
                      :agent="agent"
                      :can-manage="canManage"
                      :is-saving="isSavingAgents"
                      @edit="openEditAgentDialog(agent)"
                      @toggle-enabled="
                        (value) => handleToggleAgentEnabled(agent, value)
                      "
                      @archive="handleArchiveAgent(agent)"
                      @restore="handleRestoreAgent(agent)"
                      @remove="handleRemoveAgent(agent)"
                    />
                  </ItemGroup>
                </CollapsibleContent>
              </Collapsible>
            </template>
          </div>
        </FieldSet>

        <FieldSeparator />

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

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-weather">
                {{ t("settings.agents.tools.getWeather.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.getWeather.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-weather"
              v-model="draft.tools.getWeather"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
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
              v-model="draft.tools.rollDice"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
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
              v-model="draft.tools.askQuestion"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
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
              v-model="draft.tools.searchWorkspaceNodes"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
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
              v-model="draft.tools.summarizeNode"
              :disabled="!canEdit"
            />
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>
    <DialogFooter
      v-if="!isLoading && isDirty && canEdit"
      class="bg-background/90 sticky bottom-3 z-10 m-3 flex items-center gap-2 rounded-lg border p-2 shadow-lg backdrop-blur-lg"
    >
      <p class="text-muted-foreground mr-auto ml-2 text-xs">
        {{ t("settings.unsavedChanges") }}
      </p>
      <Button variant="secondary" :disabled="isSaving" @click="handleDiscard">
        {{ t("common.discard") }}
      </Button>
      <Button :disabled="isSaving" @click="handleSave">
        <Spinner v-if="isSaving" />
        {{ t("common.save") }}
      </Button>
    </DialogFooter>
  </div>
</template>

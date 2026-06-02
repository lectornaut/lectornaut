<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { cloneAgentConfig, useAgentConfig } from "@/composables/useAgentConfig"
import { useIntegrations } from "@/composables/useIntegrations"
import { useTeamAgents } from "@/composables/useTeamAgents"
import { IconBot, IconChevronDown, IconCirclePlus } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import type { IBotAgentConfig, ITeamAgent } from "@/types/domain"

/**
 * SettingsAgents — three sibling sections, top-to-bottom:
 *
 *   1. **Built-in agents** — per-preset feature toggles for the four
 *      shipped personas (Researcher / Writer / Summarizer / Code
 *      helper). Saved as `agentConfig.builtInAgents` (a string-keyed
 *      record). Disabling a preset hides it from the pickers and the
 *      cross-agent transfer roster — same effect as setting a custom
 *      agent's `enabled` to false.
 *
 *   2. **Custom agents (team-wide gate)** — `agentConfig.tools
 *      .customAgents`. Top-of-section toggle that controls whether
 *      the entire custom-agents feature is visible to members. Sits
 *      under `tools.*` in the schema but conceptually belongs to the
 *      Agents page.
 *
 *   3. **Custom agents (inline list)** — active + collapsible
 *      Disabled + collapsible Archived. Per-agent edit, archive /
 *      restore, enable/disable, and hard-delete actions sit on each
 *      row. A "New agent" button opens the editor-only
 *      `SettingsCustomAgents` dialog in create mode; row edit opens
 *      the same dialog with that agent loaded.
 *
 * Built-in tools + custom tools (and the `customTools` gate) live on
 * the sibling `SettingsTools` page. High-level AI config (providers,
 * model, generation params, prompts, …) lives on `SettingsAi`. All
 * three pages back the same Pinia-backed `useAgentConfig` store.
 *
 * Field ownership within `tools.*`: this page owns ONLY
 * `tools.customAgents`. SettingsTools owns the other six. To avoid
 * clobbering SettingsTools' edits on save, the handler bases its
 * `tools` payload on `config.value.tools` (latest server state) and
 * overlays only `customAgents` — Firestore's `{merge:true}` is a
 * shallow top-level merge so sending the full `tools` object always
 * replaces it.
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

// ── Top-level dirty / save handling ─────────────────────────────────────────

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
 * Dirty check is scoped to the single field this page's save owns:
 * `tools.customAgents` (the team-wide feature gate). Built-in agent
 * enable/disable is now an immediate per-integration write (see below), no
 * longer part of the dirty-bar form. The rest of `tools.*` belongs to
 * SettingsTools, so a `tools` save from there must NOT register as dirty here.
 */
const isDirty = computed(
  () => draft.value.tools.customAgents !== config.value.tools.customAgents
)

// Dirty-aware re-clone: snap to the canonical config only when this
// page has no unsaved changes. Lets a sibling-tab save (AI or Tools)
// propagate here without clobbering an in-flight toggle change.
watch(
  config,
  (next) => {
    if (!isDirty.value) draft.value = cloneAgentConfig(next)
  },
  { deep: true }
)

/**
 * Save only the fields this page owns. The `tools` payload is built
 * by overlaying `tools.customAgents` onto the latest `config.value
 * .tools` — necessary because Firestore's `{merge:true}` is a
 * top-level shallow merge, so sending the partial `tools` object
 * would clobber SettingsTools' edits to the other tool keys.
 */
const handleSave = async () => {
  await save({
    tools: {
      ...config.value.tools,
      customAgents: draft.value.tools.customAgents,
    },
  })
}

const handleDiscard = () => {
  draft.value = cloneAgentConfig(config.value)
}

// ── Built-in agents (per-preset enable toggles) ─────────────────────────────

/**
 * Installed built-in agents + their enabled state, resolved from the unified
 * integrations store (catalog overlay). Install is a separate axis from the
 * enable/disable toggle this section controls: an uninstalled preset (removed
 * on the Integrations page) drops out here. Toggling enable is an IMMEDIATE
 * per-integration write — `setEnabled` materializes a thin doc carrying the
 * flag — so it's no longer part of the dirty-bar form.
 */
const integrationsStore = useIntegrationsStore()
const { setEnabled: setIntegrationEnabled } = useIntegrations()

const builtInAgentRows = computed(() =>
  integrationsStore.agentIntegrations
    .filter((i) => i.source !== "custom" && i.installed)
    .map((i) => ({
      id: i.sourceKey ?? i.id,
      enabled: i.enabled,
      fallbackName: i.name,
      fallbackDescription: i.description,
    }))
)

const handleToggleBuiltInAgent = async (
  id: string,
  value: boolean
): Promise<void> => {
  await setIntegrationEnabled({ type: "agent", sourceKey: id }, value)
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
  <div v-if="canViewTeamSettings" class="flex grow flex-col justify-between">
    <div class="p-6">
      <div v-if="isLoading" class="flex justify-center py-8">
        <Spinner />
      </div>
      <FieldGroup v-else>
        <!-- ── Built-in agents (per-preset toggles) ──────────────────── -->
        <!--
          One Switch per shipped preset. The team-wide `customAgents`
          gate still applies on top: when that's off, the pickers
          collapse entirely regardless of these per-preset toggles
          (server short-circuits the available-agents list). Admins
          who want a fully-curated agent surface can disable presets
          they don't want their team to see WITHOUT disabling the
          whole feature.
        -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.builtInAgents.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.builtInAgents.sectionDescription") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field
            v-for="row in builtInAgentRows"
            :key="row.id"
            orientation="horizontal"
          >
            <FieldContent>
              <FieldLabel :for="`builtin-agent-${row.id}`">
                {{
                  t(
                    `settings.agents.builtInAgents.${row.id}.label`,
                    row.fallbackName
                  )
                }}
              </FieldLabel>
              <FieldDescription>
                {{
                  t(
                    `settings.agents.builtInAgents.${row.id}.description`,
                    row.fallbackDescription
                  )
                }}
              </FieldDescription>
            </FieldContent>
            <Switch
              :id="`builtin-agent-${row.id}`"
              :model-value="row.enabled"
              :disabled="!canEdit"
              @update:model-value="
                (value) => handleToggleBuiltInAgent(row.id, Boolean(value))
              "
            />
          </Field>

          <!-- Every preset removed via Integrations — nothing left to toggle. -->
          <p
            v-if="builtInAgentRows.length === 0"
            class="text-muted-foreground rounded-md border border-dashed p-4 text-sm"
          >
            {{ t("settings.agents.builtInAgents.empty") }}
          </p>
        </FieldSet>

        <FieldSeparator />

        <!-- ── Custom agents ──────────────────────────────────────────── -->
        <FieldSet>
          <!--
            Team-wide feature gate doubles as the section header. When
            off, the sidebar's Agents section collapses to a single
            "feature disabled" hint and the per-agent sheets stop
            rendering. The list below stays visible to admins so they
            can manage agents even while the feature is gated team-
            wide — turning it back on then instantly surfaces them in
            the sidebar.
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

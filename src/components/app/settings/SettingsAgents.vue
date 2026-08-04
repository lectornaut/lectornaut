<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useAgentConfig } from "@/composables/useAgentConfig"
import { useIntegrations } from "@/composables/useIntegrations"
import { useTeamAgents } from "@/composables/useTeamAgents"
import { BUILT_IN_AGENTS } from "@/data/builtInAgents"
import {
  IconBot,
  IconChevronDown,
  IconCirclePlus,
  IconPencil,
  IconRotateCcw,
  IconSettings,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import type { ITeamAgent } from "@/types/domain"

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
 * `tools.customAgents`, and toggling it is now an immediate write (no
 * unsaved bar) — same apply-on-change model as the built-in agent toggles.
 * SettingsTools owns the other six. To avoid clobbering its edits, the
 * toggle's payload overlays only `customAgents` onto `config.value.tools`
 * (latest server state) — Firestore's `{merge:true}` is a shallow top-level
 * merge so sending the full `tools` object always replaces it.
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

/**
 * The team-wide `customAgents` gate applies immediately on toggle — no
 * unsaved bar. `save()` isn't optimistic (`config` only updates once the
 * callable returns), so hold the intended value locally for instant Switch
 * feedback and revert if the save fails; mirrors SettingsOverview's
 * immediate public-team toggle. The payload overlays `customAgents` onto the
 * latest `config.value.tools` so a sibling tab's in-flight edit to another
 * tool key isn't clobbered (Firestore's `{merge:true}` is a shallow merge).
 */
const pendingCustomAgents = ref<boolean | null>(null)
const customAgentsEnabled = computed(
  () => pendingCustomAgents.value ?? config.value.tools.customAgents
)

const handleToggleCustomAgents = async (value: boolean): Promise<void> => {
  if (!canEdit.value) return
  pendingCustomAgents.value = value
  try {
    await save({ tools: { ...config.value.tools, customAgents: value } })
  } finally {
    pendingCustomAgents.value = null
  }
}

// ── Built-in agents (per-preset enable toggles) ─────────────────────────────

/**
 * Installed built-in agents + their enabled state, resolved from the unified
 * integrations store (catalog overlay). Install is a separate axis from the
 * enable/disable toggle this section controls: an uninstalled preset (removed
 * on the Integrations page) drops out here. Toggling enable is an IMMEDIATE
 * per-integration write — `setEnabled` materializes a thin doc carrying the
 * flag — so it's no longer part of the dirty-bar form.
 *
 * Display resolution: presets localize through the
 * `settings.agents.builtInAgents.*` keys, but a team RENAME must win over
 * the locale label — `t(key, fallback)` ignores its fallback once the key
 * exists, so renamed/redescribed presets read the doc value directly while
 * untouched ones keep localizing.
 */
const integrationsStore = useIntegrationsStore()
const { setEnabled: setIntegrationEnabled } = useIntegrations()

const builtInAgentRows = computed(() =>
  integrationsStore.agentIntegrations
    .filter((i) => i.source !== "custom" && i.installed)
    .map((i) => {
      const id = i.sourceKey ?? i.id
      const def = BUILT_IN_AGENTS.find((a) => a.id === id)
      const renamed = def !== undefined && i.name !== def.name
      const redescribed = def !== undefined && i.description !== def.description
      return {
        id,
        enabled: i.enabled,
        customized: i.customized,
        name: renamed
          ? i.name
          : t(`settings.agents.builtInAgents.${id}.label`, i.name),
        description: redescribed
          ? i.description
          : t(`settings.agents.builtInAgents.${id}.description`, i.description),
      }
    })
)

const handleToggleBuiltInAgent = async (
  id: string,
  value: boolean
): Promise<void> => {
  await setIntegrationEnabled({ type: "agent", sourceKey: id }, value)
}

/**
 * Customize a built-in: opens the SAME editor dialog custom agents use,
 * pre-filled with the preset's effective persona. Saving stores the edits
 * as a customization override on the preset's divergence doc.
 */
const openEditBuiltInDialog = (id: string): void => {
  emitter.emit("Dialog.CustomAgents.Open", { agentId: id })
}

/**
 * Reset-to-default confirm state. Resetting discards the team's
 * customization override (irreversible — there's no history of the
 * override), so it goes through an AlertDialog like hard-delete does.
 */
const resetTarget = ref<{ id: string; name: string } | null>(null)
const resetConfirmOpen = computed({
  get: () => resetTarget.value !== null,
  set: (open: boolean) => {
    if (!open) resetTarget.value = null
  },
})

const handleResetConfirmed = async (): Promise<void> => {
  const target = resetTarget.value
  resetTarget.value = null
  if (target) await resetBuiltIn(target.id)
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
  resetSuccess: t("settings.agents.builtInAgents.resetSuccess"),
  resetError: t("settings.agents.builtInAgents.resetError"),
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
  resetBuiltIn,
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
  <div v-if="canViewTeamSettings" class="p-6">
    <LoadingState v-if="isLoading" />
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
              {{ row.name }}
              <Badge v-if="row.customized" variant="secondary">
                {{ t("settings.agents.builtInAgents.customizedBadge") }}
              </Badge>
            </FieldLabel>
            <FieldDescription>
              {{ row.description }}
            </FieldDescription>
          </FieldContent>
          <div class="flex items-center gap-1">
            <!-- Customize cog — Edit opens the shared agent editor dialog
                 on this preset; Reset (only once customized) discards the
                 override via the confirm dialog below. -->
            <TooltipProvider>
              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger as-child>
                    <DropdownMenuTrigger as-child>
                      <InputGroupButton
                        variant="ghost"
                        size="icon-xs"
                        :disabled="!canManage"
                      >
                        <IconSettings />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("settings.agents.builtInAgents.configure") }}
                  </TooltipContent>
                  <DropdownMenuContent align="end" class="w-44">
                    <DropdownMenuItem
                      data-hotkey="e"
                      @select="openEditBuiltInDialog(row.id)"
                    >
                      <IconPencil />
                      {{ t("settings.agents.custom.edit") }}
                      <DropdownMenuShortcut>E</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="row.customized"
                      data-hotkey="r"
                      @select="resetTarget = { id: row.id, name: row.name }"
                    >
                      <IconRotateCcw />
                      {{ t("settings.agents.builtInAgents.reset") }}
                      <DropdownMenuShortcut>R</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Tooltip>
            </TooltipProvider>

            <Switch
              :id="`builtin-agent-${row.id}`"
              :model-value="row.enabled"
              :disabled="!canEdit"
              @update:model-value="
                (value) => handleToggleBuiltInAgent(row.id, Boolean(value))
              "
            />
          </div>
        </Field>

        <!-- Every preset removed via Integrations — nothing left to toggle. -->
        <Empty
          v-if="builtInAgentRows.length === 0"
          class="border border-dashed"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconBot />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("settings.agents.builtInAgents.empty") }}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      </FieldSet>

      <!--
        Reset-to-default confirmation, shared across the built-in rows.
        Required because resetting discards the team's customization
        override with no way back (the override isn't versioned).
      -->
      <AlertDialog v-model:open="resetConfirmOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{ t("settings.agents.builtInAgents.resetConfirmTitle") }}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {{
                t("settings.agents.builtInAgents.resetConfirmBody", {
                  name: resetTarget?.name ?? "",
                })
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {{ t("common.cancel") }}<Kbd>Esc</Kbd>
            </AlertDialogCancel>
            <AlertDialogAction @click="handleResetConfirmed">
              {{ t("settings.agents.builtInAgents.reset") }}
              <Kbd>↩</Kbd>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            :model-value="customAgentsEnabled"
            :disabled="!canEdit || isSaving"
            @update:model-value="(v) => handleToggleCustomAgents(Boolean(v))"
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
                    :disabled="!canManage || !customAgentsEnabled"
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
          <LoadingState v-if="isLoadingAgents" />

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
                <EmptyTitle>{{ t("settings.agents.custom.empty") }}</EmptyTitle>
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
                <Button variant="ghost" class="w-full justify-between">
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
                <Button variant="ghost" class="w-full justify-between">
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
                <Button variant="ghost" class="w-full justify-between">
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
  <SettingsRestricted v-else />
</template>

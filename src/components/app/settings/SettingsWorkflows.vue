<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useAgentConfig } from "@/composables/useAgentConfig"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { DEFAULT_AGENT_ID } from "@/data/builtInAgents"
import { WORKFLOW_PRESETS, type WorkflowPreset } from "@/data/workflowPresets"
import {
  IconChevronDown,
  IconCirclePlus,
  IconPencil,
  IconRotateCcw,
  IconSettings,
  IconWorkflow,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import type { IWorkflow } from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

const {
  wsActiveWorkflows,
  wsArchivedWorkflows,
  availablePresetKeys,
  isLoading,
  isSaving,
  canManage,
  loadError,
  setEnabled,
  archive,
  remove,
  enablePreset,
  update,
} = useTeamWorkflows()

const authStore = useAuthStore()
const { currentWorkspaceId } = storeToRefs(authStore)

// ── Team-wide "custom workflows" gate (agent-config tools toggle) ────────────
// Mirrors SettingsAgents' `tools.customAgents`: owned here, toggling it is an
// immediate write to the shared agent-config (no unsaved bar), overlay-merged
// so an in-flight save from another settings tab isn't clobbered.
const configMessages = () => ({
  permissionRequired: t("settings.workflows.permissionRequired"),
  saveSuccess: t("settings.workflows.gateSaveSuccess"),
  saveError: t("settings.workflows.gateSaveError"),
  loadError: t("settings.workflows.gateLoadError"),
})
const {
  config,
  isLoading: isLoadingConfig,
  isSaving: isSavingConfig,
  canEdit,
  save,
} = useAgentConfig(configMessages)

// The team-wide customWorkflows gate applies immediately on toggle (no
// unsaved bar). `save()` isn't optimistic — `config` only updates once the
// callable returns — so hold the intended value locally for instant Switch
// feedback and revert if the save fails; mirrors SettingsOverview's immediate
// public-team toggle. The payload overlays `customWorkflows` onto the latest
// `config.value.tools` so a sibling tab's in-flight edit to another tool key
// isn't clobbered (Firestore's `{merge:true}` is a shallow top-level merge).
const pendingCustomWorkflows = ref<boolean | null>(null)
const customWorkflowsValue = computed(
  () => pendingCustomWorkflows.value ?? config.value.tools.customWorkflows
)
const customWorkflowsOn = computed(() => customWorkflowsValue.value !== false)
const handleToggleCustomWorkflows = async (value: boolean): Promise<void> => {
  if (!canEdit.value) return
  pendingCustomWorkflows.value = value
  try {
    await save({ tools: { ...config.value.tools, customWorkflows: value } })
  } finally {
    pendingCustomWorkflows.value = null
  }
}

// Custom creation is gated on admin rights and the team-wide toggle. There's
// no agent prerequisite anymore — a workflow runs as the Default agent unless
// the editor's "Run as a specific agent" toggle picks one.
const canCreateCustom = computed(
  () => canManage.value && customWorkflowsOn.value
)

// ── Predefined workflows (one Field + Switch per preset) ─────────────────────
// Two-tier: a preset shows here only if the team made it AVAILABLE (the
// Integrations tier, `availablePresetKeys`); the Switch then deploys/enables it
// in the CURRENT workspace, so enabling "Grammar" in one workspace is
// independent of every other. Predefined workflows always run as the Default
// agent (`DEFAULT_AGENT_ID`).
const availablePresets = computed(() =>
  WORKFLOW_PRESETS.filter((p) => availablePresetKeys.value.has(p.key))
)
// Scoped to the current workspace: this preset's active deployment here.
const presetActiveWorkflow = (key: string): IWorkflow | undefined =>
  wsActiveWorkflows.value.find((w) => w.presetKey === key)
// Active OR archived in THIS workspace — the toggle restores an archived
// deployment rather than re-materializing, so one workspace never ends up with
// two docs sharing a `presetKey`.
const presetAnyWorkflow = (key: string): IWorkflow | undefined =>
  wsActiveWorkflows.value.find((w) => w.presetKey === key) ??
  wsArchivedWorkflows.value.find((w) => w.presetKey === key)

// Per-preset in-flight lockout. The store's `isSaving` only covers the
// materialize (`enablePreset`) path — `setEnabled`/`archive` don't set it — so
// without this a rapid double-click on an already-materialized preset would
// re-enter `togglePreset` against the same stale snapshot and fire a redundant
// enable/disable callable (+ duplicate toast). Reassigned rather than mutated
// so the reactive read in `isPresetSwitchDisabled` always re-runs.
const pendingPresetKeys = ref<Set<string>>(new Set())
const setPresetPending = (key: string, pending: boolean): void => {
  const next = new Set(pendingPresetKeys.value)
  if (pending) next.add(key)
  else next.delete(key)
  pendingPresetKeys.value = next
}

const isPresetEnabled = (preset: WorkflowPreset): boolean =>
  !!presetActiveWorkflow(preset.key)?.enabled

const isPresetSwitchDisabled = (preset: WorkflowPreset): boolean => {
  if (!canManage.value || isSaving.value) return true
  if (pendingPresetKeys.value.has(preset.key)) return true
  // The first enable materializes a doc bound to the active workspace; toggling
  // an already-materialized preset doesn't need one.
  if (!presetActiveWorkflow(preset.key) && !currentWorkspaceId.value)
    return true
  return false
}

// The Configure cog stays visible on every preset row (consistent with the
// other settings rows) but is only actionable once the preset is materialized —
// there's no workflow doc to edit before it's enabled.
const isPresetEditDisabled = (preset: WorkflowPreset): boolean =>
  !canManage.value || isSaving.value || !presetActiveWorkflow(preset.key)

/**
 * One Switch, three dispatch paths — keeps a preset's single `presetKey` doc
 * canonical:
 *   • turn on, never materialized → `enablePreset` (creates it, enabled)
 *   • turn on, archived doc exists → restore, then ensure enabled
 *   • turn on, active-but-disabled → `setEnabled(true)`
 *   • turn off, active-and-enabled → `setEnabled(false)`
 */
const togglePreset = async (
  preset: WorkflowPreset,
  value: boolean
): Promise<void> => {
  if (!canManage.value) return
  if (pendingPresetKeys.value.has(preset.key)) return
  setPresetPending(preset.key, true)
  try {
    const existing = presetAnyWorkflow(preset.key)
    if (value) {
      if (!existing) {
        const workspaceId = currentWorkspaceId.value
        if (!workspaceId) return
        await enablePreset(preset.key, {
          workspaceId,
          agentId: DEFAULT_AGENT_ID,
        })
        return
      }
      if (existing.archivedAt) await archive(existing.id, false)
      if (!existing.enabled) await setEnabled(existing.id, true)
    } else if (existing && !existing.archivedAt && existing.enabled) {
      await setEnabled(existing.id, false)
    }
  } finally {
    setPresetPending(preset.key, false)
  }
}

// ── Custom workflows (inline list — active / disabled / archived) ────────────
// Mirrors SettingsAgents/SettingsTools: the non-archived custom workflows split
// into enabled ("Active") and disabled buckets, each in its own collapsible,
// with archived (custom + predefined) below. Predefined presets keep their own
// per-toggle section above and are excluded here via the `presetKey` filter.
const customWorkflows = computed(() =>
  wsActiveWorkflows.value.filter((w) => !w.presetKey)
)
const activeCustomWorkflows = computed(() =>
  customWorkflows.value.filter((w) => w.enabled)
)
const disabledCustomWorkflows = computed(() =>
  customWorkflows.value.filter((w) => !w.enabled)
)

// Active section starts open — it's the primary content. Disabled and Archived
// start collapsed; they're admin-discoverability extras, matching the sibling
// SettingsAgents / SettingsTools panes.
const activeSectionOpen = ref(true)
const disabledSectionOpen = ref(false)
const archivedSectionOpen = ref(false)

// ── Editor dialog (shared with the Workflows page) ───────────────────────────
const editorOpen = ref(false)
const editingWorkflow = ref<IWorkflow | null>(null)
const openCreate = (): void => {
  editingWorkflow.value = null
  editorOpen.value = true
}
const openEdit = (wf: IWorkflow): void => {
  editingWorkflow.value = wf
  editorOpen.value = true
}
// Edit a predefined preset by opening its materialized workflow doc. The cog is
// only shown once `presetActiveWorkflow` resolves, so `wf` is always present
// here, but the guard keeps this safe if called before materialization.
const editPreset = (preset: WorkflowPreset): void => {
  const wf = presetActiveWorkflow(preset.key)
  if (wf) openEdit(wf)
}

// ── Reset a preset's materialized doc back to its catalog defaults ──────────
// Restores every editable field from the client preset catalog (agent binding
// is immutable and `enabled` is the row Switch's axis, so both stay put).
// Confirm-gated: it overwrites whatever the team customized in the editor,
// and there's no history of those edits to recover.
const resetWorkflowTarget = ref<WorkflowPreset | null>(null)
const resetWorkflowConfirmOpen = computed({
  get: () => resetWorkflowTarget.value !== null,
  set: (open: boolean) => {
    if (!open) resetWorkflowTarget.value = null
  },
})

const handleResetWorkflowConfirmed = async (): Promise<void> => {
  const preset = resetWorkflowTarget.value
  resetWorkflowTarget.value = null
  if (!preset) return
  const wf = presetActiveWorkflow(preset.key)
  if (!wf) return
  await update(wf.id, {
    name: preset.name,
    description: preset.description,
    avatarSeed: preset.avatarSeed,
    instructions: preset.instructions,
    additionalPrompt: preset.additionalPrompt ?? "",
    targetScope: preset.defaultTargetScope,
    trigger: preset.defaultTrigger,
    updateMode: preset.defaultUpdateMode,
  })
}

// ── Row description (trigger · mode) — used by custom + archived rows ─────────
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const minuteToTime = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
const triggerSummary = (wf: IWorkflow): string => {
  const tr = wf.trigger
  if (tr.type === "manual") return t("settings.workflows.triggerManual")
  if (tr.type === "event")
    return t("settings.workflows.triggerEvent", { scope: tr.scope })
  const s = tr.schedule
  if (s.type === "interval")
    return t("settings.workflows.everyHours", { n: s.everyHours })
  if (s.type === "daily")
    return t("settings.workflows.daily", { time: minuteToTime(s.atMinuteUTC) })
  return t("settings.workflows.weekly", {
    day: dayNames[s.dayOfWeek],
    time: minuteToTime(s.atMinuteUTC),
  })
}
const modeLabel = (wf: IWorkflow): string =>
  (wf.updateMode ?? "require_review") === "automatic"
    ? t("settings.workflows.modeAutomatic")
    : t("settings.workflows.modeReview")
const rowDescription = (wf: IWorkflow): string =>
  `${triggerSummary(wf)} · ${modeLabel(wf)}`
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <LoadingState v-if="isLoading" />
    <!-- Surfaces a failed/denied live read (e.g. the workflows Firestore
           rules aren't deployed) instead of silently rendering an empty list —
           an empty `activeWorkflows` otherwise hides custom workflows AND makes
           every preset toggle read OFF, with no clue why. -->
    <div
      v-else-if="loadError"
      class="text-destructive border-destructive/30 rounded-md border p-4 text-sm"
    >
      {{ t("settings.workflows.loadError") }}
      <span class="text-muted-foreground mt-1 block text-xs">
        {{ loadError }}
      </span>
    </div>
    <FieldGroup v-else>
      <!-- ── Predefined workflows (per-preset toggles) ─────────────────
             One Switch per shipped preset, mirroring SettingsAgents'
             built-in agents. Toggling materializes / re-enables / disables
             the preset's workflow doc. -->
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.workflows.catalogTitle") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.workflows.predefinedDescription") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <TooltipProvider>
          <Field
            v-for="preset in availablePresets"
            :key="preset.key"
            orientation="horizontal"
          >
            <FieldContent>
              <FieldLabel :for="`wf-preset-${preset.key}`">
                {{ preset.name }}
              </FieldLabel>
              <FieldDescription>
                {{ preset.description }}
              </FieldDescription>
            </FieldContent>
            <div class="flex items-center gap-1">
              <!-- Configure cog — always visible (like the other settings
                     rows), but only actionable once the preset is materialized
                     as a real workflow doc; nothing to edit before it's
                     enabled. -->
              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger as-child>
                    <DropdownMenuTrigger as-child>
                      <InputGroupButton
                        variant="ghost"
                        size="icon-xs"
                        :disabled="isPresetEditDisabled(preset)"
                      >
                        <IconSettings />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("settings.workflows.configure") }}
                  </TooltipContent>
                  <DropdownMenuContent align="end" class="w-44">
                    <DropdownMenuItem
                      data-hotkey="e"
                      @select="editPreset(preset)"
                    >
                      <IconPencil />
                      {{ t("settings.workflows.edit") }}
                      <DropdownMenuShortcut>E</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-hotkey="r"
                      @select="resetWorkflowTarget = preset"
                    >
                      <IconRotateCcw />
                      {{ t("settings.workflows.reset") }}
                      <DropdownMenuShortcut>R</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Tooltip>

              <!-- Enable/disable Switch. -->
              <Switch
                :id="`wf-preset-${preset.key}`"
                :model-value="isPresetEnabled(preset)"
                :disabled="isPresetSwitchDisabled(preset)"
                @update:model-value="
                  (value) => togglePreset(preset, Boolean(value))
                "
              />
            </div>
          </Field>
        </TooltipProvider>

        <!-- Nothing the team has made available yet — point admins to the
               Integrations page (the availability tier). -->
        <Empty
          v-if="availablePresets.length === 0"
          class="border border-dashed"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconWorkflow />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("settings.workflows.noAvailablePresets") }}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      </FieldSet>

      <!--
        Reset-to-default confirmation, shared across the preset rows.
        Overwrites the team's edits to the materialized workflow with the
        catalog defaults — there's no history of those edits to recover.
      -->
      <AlertDialog v-model:open="resetWorkflowConfirmOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{ t("settings.workflows.resetConfirmTitle") }}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {{
                t("settings.workflows.resetConfirmBody", {
                  name: resetWorkflowTarget?.name ?? "",
                })
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {{ t("common.cancel") }}<Kbd aria-hidden="true">Esc</Kbd>
            </AlertDialogCancel>
            <AlertDialogAction @click="handleResetWorkflowConfirmed">
              {{ t("settings.workflows.reset") }}
              <Kbd aria-hidden="true">↩</Kbd>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FieldSeparator />

      <!-- ── Custom workflows (team-wide gate + inline list) ───────────── -->
      <FieldSet>
        <!-- Team-wide feature gate — mirrors SettingsAgents' customAgents. -->
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="wf-custom-gate">
              {{ t("settings.workflows.customWorkflows.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.workflows.customWorkflows.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="wf-custom-gate"
            :model-value="customWorkflowsValue"
            :disabled="!canEdit || isLoadingConfig || isSavingConfig"
            @update:model-value="(v) => handleToggleCustomWorkflows(Boolean(v))"
          />
        </Field>

        <!-- "New workflow" CTA — gated on admin rights + the team toggle. -->
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.workflows.available") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.workflows.availableDescription") }}
            </FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            size="sm"
            :disabled="!canCreateCustom"
            @click="openCreate"
          >
            <IconCirclePlus />
            {{ t("settings.workflows.new") }}
          </Button>
        </Field>

        <!--
            Inline list — active / disabled / archived collapsibles, mirroring
            SettingsAgents and SettingsTools. Active custom workflows open by
            default; Disabled + Archived start collapsed. The empty / gate-off
            hint shows only when every bucket is empty. Each row keeps the same
            Field + cog + Switch layout as the predefined toggles above.
          -->
        <div class="flex flex-col gap-2">
          <!-- Empty / gate-off state — only when no custom workflows exist in
                 any bucket (active, disabled, or archived). -->
          <Empty
            v-if="
              activeCustomWorkflows.length === 0 &&
              disabledCustomWorkflows.length === 0 &&
              wsArchivedWorkflows.length === 0
            "
            class="border border-dashed"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconWorkflow />
              </EmptyMedia>
              <EmptyTitle>
                {{
                  customWorkflowsOn
                    ? t("settings.workflows.emptyCustom")
                    : t("settings.workflows.customWorkflowsOff")
                }}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>

          <!-- Active (enabled) custom workflows -->
          <Collapsible
            v-if="activeCustomWorkflows.length > 0"
            v-model:open="activeSectionOpen"
          >
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="w-full justify-between">
                <span class="flex items-center gap-2">
                  {{
                    t("settings.workflows.activeCount", {
                      n: activeCustomWorkflows.length,
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
                <SettingsWorkflowRow
                  v-for="wf in activeCustomWorkflows"
                  :id="wf.id"
                  :key="wf.id"
                  :name="wf.name"
                  :avatar-seed="wf.avatarSeed"
                  :description="rowDescription(wf)"
                  :enabled="wf.enabled"
                  :is-predefined="false"
                  :is-archived="false"
                  :can-manage="canManage"
                  :is-saving="isSaving"
                  :can-archive="true"
                  :can-delete="true"
                  @edit="openEdit(wf)"
                  @toggle-enabled="(v) => setEnabled(wf.id, v)"
                  @archive="archive(wf.id, true)"
                  @remove="remove(wf.id)"
                />
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>

          <!-- Disabled custom workflows -->
          <Collapsible
            v-if="disabledCustomWorkflows.length > 0"
            v-model:open="disabledSectionOpen"
          >
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="w-full justify-between">
                <span class="flex items-center gap-2">
                  {{
                    t("settings.workflows.disabledCount", {
                      n: disabledCustomWorkflows.length,
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
                <SettingsWorkflowRow
                  v-for="wf in disabledCustomWorkflows"
                  :id="wf.id"
                  :key="wf.id"
                  :name="wf.name"
                  :avatar-seed="wf.avatarSeed"
                  :description="rowDescription(wf)"
                  :enabled="wf.enabled"
                  :is-predefined="false"
                  :is-archived="false"
                  :can-manage="canManage"
                  :is-saving="isSaving"
                  :can-archive="true"
                  :can-delete="true"
                  @edit="openEdit(wf)"
                  @toggle-enabled="(v) => setEnabled(wf.id, v)"
                  @archive="archive(wf.id, true)"
                  @remove="remove(wf.id)"
                />
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>

          <!-- Archived (custom + predefined) -->
          <Collapsible
            v-if="wsArchivedWorkflows.length > 0"
            v-model:open="archivedSectionOpen"
          >
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="w-full justify-between">
                <span class="flex items-center gap-2">
                  {{
                    t("settings.workflows.archivedCount", {
                      n: wsArchivedWorkflows.length,
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
                <SettingsWorkflowRow
                  v-for="wf in wsArchivedWorkflows"
                  :id="wf.id"
                  :key="wf.id"
                  :name="wf.name"
                  :avatar-seed="wf.avatarSeed"
                  :description="rowDescription(wf)"
                  :enabled="wf.enabled"
                  :is-predefined="!!wf.presetKey"
                  is-archived
                  :can-manage="canManage"
                  :is-saving="isSaving"
                  :can-archive="false"
                  :can-delete="true"
                  @edit="openEdit(wf)"
                  @toggle-enabled="(v) => setEnabled(wf.id, v)"
                  @restore="archive(wf.id, false)"
                  @remove="remove(wf.id)"
                />
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </FieldSet>
    </FieldGroup>

    <SettingsCustomWorkflow
      v-model:open="editorOpen"
      :workflow="editingWorkflow"
    />
  </div>
  <SettingsRestricted v-else />
</template>

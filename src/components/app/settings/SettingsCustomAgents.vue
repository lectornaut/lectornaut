<script lang="ts" setup>
import { useTeamAgents } from "@/composables/useTeamAgents"
import { BOT_TOOL_CATALOG } from "@/data/botTools"
import { emitter } from "@/modules/mitt"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import type { IBotAgentConfig, ITeamAgent } from "@/types/domain"
import { storeToRefs } from "pinia"
import { onBeforeUnmount, onMounted } from "vue"
import Avatar from "vue-boring-avatars"

const { t } = useI18n()

/**
 * Custom Agents editor dialog — create / edit a single team agent.
 *
 * Layout mirrors the SSO Configuration Dialog in `SettingsSecurity.vue`:
 *   DialogHeader (title + optional lifecycle badge)
 *   → OverlayScrollbarsWrapper > FieldGroup (p-6)
 *     ├ FieldSet ........... identity (name / description / avatar seed)
 *     ├ FieldSeparator
 *     ├ FieldSet ........... system prompt + mode-specific suffixes
 *     ├ FieldSeparator
 *     └ FieldSet ........... per-agent tool toggles
 *   → DialogFooter (DialogClose cancel + Save)
 *
 * Form state (draft + dirty / canSave logic) is owned here rather than
 * in a child card component — the dialog footer needs to drive the
 * Save button's enable state, and keeping everything in one file
 * matches the SSO dialog's cohesion.
 *
 * Mounted globally in `app.vue` so any surface can open it via the
 * `Dialog.CustomAgents.Open` mitt event. Payload shapes:
 *   - `"new"` (string) or `undefined` — create flow.
 *   - `{ agentId }` — edit the agent with that id.
 */

// Only CRUD keys (the dialog's own actions). Lifecycle toasts
// (archive / restore / setEnabled / remove) are surfaced by the
// inline list in `SettingsAgents.vue` — omitting those keys here is
// the API's clean way of suppressing duplicates (no empty-string
// sentinels needed; see `UseTeamAgentsI18n`).
const messagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  createSuccess: t("settings.agents.custom.createSuccess"),
  createError: t("settings.agents.custom.createError"),
  updateSuccess: t("settings.agents.custom.updateSuccess"),
  updateError: t("settings.agents.custom.updateError"),
})

const {
  selectableAgents,
  disabledAgents,
  archivedAgents,
  isSaving,
  canManage,
  create,
  update,
} = useTeamAgents(messagesGetter)

// Read the team's currently *saved* tool toggles. Drives the per-agent
// switches' `enabledAtTeam` gating below.
const agentConfigStore = useAgentConfigStore()
const { config: teamConfig } = storeToRefs(agentConfigStore)
const teamTools = computed<IBotAgentConfig["tools"]>(
  () => teamConfig.value.tools
)

// ── Dialog state ────────────────────────────────────────────────────────────

const open = ref(false)
const editingAgentId = ref<string | null>(null)

// Resolve the agent by id across all three lifecycle buckets so editing
// a disabled or archived agent (selected from the inline list) works
// without special-casing the source bucket.
const editingAgent = computed<ITeamAgent | null>(() => {
  const id = editingAgentId.value
  if (!id) return null
  return (
    selectableAgents.value.find((a) => a.id === id) ??
    disabledAgents.value.find((a) => a.id === id) ??
    archivedAgents.value.find((a) => a.id === id) ??
    null
  )
})

const isNew = computed(() => editingAgent.value === null)

const dialogTitle = computed<string>(() =>
  editingAgent.value
    ? t("settings.agents.custom.editorTitleEdit", {
        name: editingAgent.value.name,
      })
    : t("settings.agents.custom.editorTitleNew")
)

/**
 * Lifecycle badge for the dialog title — mirrors the row's status
 * badge so the editor confirms what bucket the agent is currently in.
 * Disabled wins over archived (it's the stronger gate).
 */
const statusBadgeKey = computed<"disabled" | "archived" | null>(() => {
  const agent = editingAgent.value
  if (!agent) return null
  if (agent.enabled === false) return "disabled"
  if (agent.archivedAt) return "archived"
  return null
})

// ── Draft state ─────────────────────────────────────────────────────────────

interface AgentDraft {
  name: string
  description: string
  avatarSeed: string
  systemPromptBase: string
  promptSuffixes: {
    auto: string
    agent: string
    manual: string
  }
  tools: ITeamAgent["tools"]
}

const DEFAULT_DRAFT: AgentDraft = {
  name: "",
  description: "",
  avatarSeed: "",
  systemPromptBase:
    "You are a focused assistant. Reply concisely and ground your " +
    "answers in the context you're given.",
  promptSuffixes: { auto: "", agent: "", manual: "" },
  tools: {
    getWeather: true,
    rollDice: true,
    askQuestion: true,
    searchWorkspaceNodes: true,
    summarizeNode: true,
    // Carried for type alignment with the team-level toggle schema —
    // ignored at the per-agent dispatch layer (see ITeamAgent JSDoc).
    customAgents: true,
  },
}

const cloneDraft = (source: ITeamAgent | null): AgentDraft => {
  if (!source) {
    return {
      ...DEFAULT_DRAFT,
      promptSuffixes: { ...DEFAULT_DRAFT.promptSuffixes },
      tools: { ...DEFAULT_DRAFT.tools },
    }
  }
  return {
    name: source.name,
    description: source.description,
    avatarSeed: source.avatarSeed,
    systemPromptBase: source.systemPromptBase,
    promptSuffixes: { ...source.promptSuffixes },
    tools: { ...source.tools },
  }
}

const draft = ref<AgentDraft>(cloneDraft(null))

/**
 * Mirrors `SettingsCustomAgentRow`'s `avatarSeedEffective` so the
 * editor preview always renders the exact same avatar the list row
 * will. Falls back to the name (then "Agent") when the seed input is
 * blank — the row does the same fallback at render time, so the
 * preview here matches what admins will see in pickers and badges.
 */
const effectiveAvatarSeed = computed(
  () => draft.value.avatarSeed.trim() || draft.value.name.trim() || "Agent"
)

const isDirty = computed(() => {
  if (isNew.value) {
    // For a new draft, "dirty" means the user has typed *something*
    // beyond defaults so Save isn't dead on arrival.
    return draft.value.name.trim().length > 0
  }
  if (!editingAgent.value) return false
  return (
    JSON.stringify(draft.value) !==
    JSON.stringify(cloneDraft(editingAgent.value))
  )
})

// Re-seed when the selected agent changes. Deep watch so an upstream
// Firestore update (the row's snapshot bumps while the dialog is open)
// pulls fresh server state into the draft. Dirty-aware: when the user
// has unsaved local edits, leave the draft alone — same guard pattern
// used by `SettingsAi` / `SettingsAgents` against the shared config
// store. Without this guard, a concurrent admin save (or even an echo
// of our own pending save) would silently clobber the user's edits.
watch(
  editingAgent,
  (next) => {
    if (!isDirty.value) draft.value = cloneDraft(next)
  },
  { deep: true }
)

const canSave = computed(() => {
  if (!canManage.value || isSaving.value) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.systemPromptBase.trim()) return false
  if (!isDirty.value) return false
  return true
})

// ── Tool subform (per-agent toggles, gated by team-level toggles) ──────────

interface ToolRow {
  name: Exclude<keyof ITeamAgent["tools"], "customAgents">
  label: string
  description: string
  enabledAtTeam: boolean
}

/**
 * `BOT_TOOL_CATALOG` covers the composer-facing tools (getWeather,
 * rollDice, askQuestion). The two workspace tools (`searchWorkspaceNodes`,
 * `summarizeNode`) aren't in the catalog because the catalog drives the
 * composer's slash menu — agents need the full tool surface, so we
 * append them inline. `customAgents` is deliberately NOT exposed here —
 * it's a team-level feature gate, not a per-agent capability.
 */
const toolRows = computed<ToolRow[]>(() => {
  const composerTools: ToolRow[] = BOT_TOOL_CATALOG.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    enabledAtTeam: teamTools.value[tool.name] !== false,
  }))
  const workspaceTools: ToolRow[] = [
    {
      name: "searchWorkspaceNodes",
      label: t("settings.agents.tools.searchWorkspaceNodes.label"),
      description: t("settings.agents.tools.searchWorkspaceNodes.description"),
      enabledAtTeam: teamTools.value.searchWorkspaceNodes !== false,
    },
    {
      name: "summarizeNode",
      label: t("settings.agents.tools.summarizeNode.label"),
      description: t("settings.agents.tools.summarizeNode.description"),
      enabledAtTeam: teamTools.value.summarizeNode !== false,
    },
  ]
  return [...composerTools, ...workspaceTools]
})

const setToolEnabled = (name: ToolRow["name"], value: boolean): void => {
  draft.value.tools[name] = value
}

// ── External event channel ──────────────────────────────────────────────────

type OpenPayload = { agentId?: string } | "new" | undefined

/**
 * Listener for `Dialog.CustomAgents.Open`. Accepts:
 *   - `"new"` / `undefined` — opens for creation.
 *   - `{ agentId }` — opens that agent's editor.
 *
 * Resets the draft explicitly because the deep-watcher on `editingAgent`
 * only fires when the resolved agent value changes — re-opening with
 * the same agent or with no agent (create) would otherwise reuse stale
 * draft state from a previous session.
 */
const handleOpenEvent = (event: unknown): void => {
  const payload = event as OpenPayload
  let agentId: string | null = null
  if (
    payload &&
    typeof payload === "object" &&
    typeof payload.agentId === "string" &&
    payload.agentId.length > 0
  ) {
    agentId = payload.agentId
  }
  editingAgentId.value = agentId
  draft.value = cloneDraft(editingAgent.value)
  open.value = true
}

onMounted(() => {
  emitter.on("Dialog.CustomAgents.Open", handleOpenEvent)
})
onBeforeUnmount(() => {
  emitter.off("Dialog.CustomAgents.Open", handleOpenEvent)
})

// ── Save handler ────────────────────────────────────────────────────────────

const handleEditorSave = async (): Promise<void> => {
  if (!canSave.value) return
  const target = editingAgent.value
  if (target) {
    await update(target.id, draft.value)
  } else {
    const created = await create(draft.value)
    if (!created) return
  }
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! overflow-auto overscroll-none scroll-smooth"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          {{ dialogTitle }}
          <Badge v-if="statusBadgeKey === 'disabled'" variant="outline">
            {{ t("settings.agents.custom.disabledBadge") }}
          </Badge>
          <Badge v-else-if="statusBadgeKey === 'archived'" variant="outline">
            {{ t("settings.agents.custom.archivedBadge") }}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {{ t("settings.agents.custom.sectionDescription") }}
        </DialogDescription>
      </DialogHeader>

      <OverlayScrollbarsWrapper class="-mx-6 w-[-webkit-fill-available]">
        <FieldGroup class="p-6">
          <!-- ── Identity ──────────────────────────────────────────────── -->
          <FieldSet>
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel :for="`agent-name-${editingAgent?.id ?? 'new'}`">
                  {{ t("settings.agents.custom.name.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.agents.custom.name.description") }}
                </FieldDescription>
              </FieldContent>
              <Input
                :id="`agent-name-${editingAgent?.id ?? 'new'}`"
                v-model="draft.name"
                :placeholder="t('settings.agents.custom.name.placeholder')"
                :maxlength="40"
                :disabled="!canManage"
              />
            </Field>

            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel
                  :for="`agent-description-${editingAgent?.id ?? 'new'}`"
                >
                  {{ t("settings.agents.custom.description.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.agents.custom.description.description") }}
                </FieldDescription>
              </FieldContent>
              <Input
                :id="`agent-description-${editingAgent?.id ?? 'new'}`"
                v-model="draft.description"
                :placeholder="
                  t('settings.agents.custom.description.placeholder')
                "
                :maxlength="200"
                :disabled="!canManage"
              />
            </Field>

            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel
                  :for="`agent-avatar-seed-${editingAgent?.id ?? 'new'}`"
                >
                  {{ t("settings.agents.custom.avatarSeed.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.agents.custom.avatarSeed.description") }}
                </FieldDescription>
              </FieldContent>
              <!--
                Live avatar preview reuses the boring-avatars component
                + chart-N palette from `SettingsCustomAgentRow`, so the
                preview matches the row 1:1 (no surprise on save). The
                preview rerenders on every keystroke via the
                `effectiveAvatarSeed` computed; boring-avatars is cheap
                enough (pure-SVG portrait) that this is fine.
              -->
              <div class="flex items-center gap-3">
                <div class="size-10 shrink-0 overflow-hidden rounded-full">
                  <Avatar
                    variant="beam"
                    :name="effectiveAvatarSeed"
                    :colors="[
                      'var(--color-chart-1)',
                      'var(--color-chart-2)',
                      'var(--color-chart-3)',
                      'var(--color-chart-4)',
                      'var(--color-chart-5)',
                    ]"
                  />
                </div>
                <Input
                  :id="`agent-avatar-seed-${editingAgent?.id ?? 'new'}`"
                  v-model="draft.avatarSeed"
                  :placeholder="
                    t('settings.agents.custom.avatarSeed.placeholder')
                  "
                  :maxlength="40"
                  :disabled="!canManage"
                  class="flex-1"
                />
              </div>
            </Field>
          </FieldSet>

          <FieldSeparator />

          <!-- ── System prompt + mode-specific suffixes ───────────────── -->
          <FieldSet>
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel
                  :for="`agent-system-prompt-${editingAgent?.id ?? 'new'}`"
                >
                  {{ t("settings.agents.custom.systemPromptBase.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.agents.custom.systemPromptBase.description") }}
                </FieldDescription>
              </FieldContent>
              <Textarea
                :id="`agent-system-prompt-${editingAgent?.id ?? 'new'}`"
                v-model="draft.systemPromptBase"
                :placeholder="
                  t('settings.agents.custom.systemPromptBase.placeholder')
                "
                :maxlength="4000"
                :disabled="!canManage"
                rows="4"
              />
            </Field>

            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel>
                  {{ t("settings.agents.custom.promptSuffixes.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.agents.custom.promptSuffixes.description") }}
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel
                  :for="`agent-suffix-auto-${editingAgent?.id ?? 'new'}`"
                >
                  {{ t("settings.agents.promptSuffixes.auto") }}
                </FieldLabel>
              </FieldContent>
              <Textarea
                :id="`agent-suffix-auto-${editingAgent?.id ?? 'new'}`"
                v-model="draft.promptSuffixes.auto"
                :maxlength="2000"
                :disabled="!canManage"
                rows="2"
              />
            </Field>

            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel
                  :for="`agent-suffix-agent-${editingAgent?.id ?? 'new'}`"
                >
                  {{ t("settings.agents.promptSuffixes.agent") }}
                </FieldLabel>
              </FieldContent>
              <Textarea
                :id="`agent-suffix-agent-${editingAgent?.id ?? 'new'}`"
                v-model="draft.promptSuffixes.agent"
                :maxlength="2000"
                :disabled="!canManage"
                rows="2"
              />
            </Field>

            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel
                  :for="`agent-suffix-manual-${editingAgent?.id ?? 'new'}`"
                >
                  {{ t("settings.agents.promptSuffixes.manual") }}
                </FieldLabel>
              </FieldContent>
              <Textarea
                :id="`agent-suffix-manual-${editingAgent?.id ?? 'new'}`"
                v-model="draft.promptSuffixes.manual"
                :maxlength="2000"
                :disabled="!canManage"
                rows="2"
              />
            </Field>
          </FieldSet>

          <FieldSeparator />

          <!-- ── Tools ────────────────────────────────────────────────── -->
          <FieldSet>
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel>
                  {{ t("settings.agents.custom.tools.label") }}
                </FieldLabel>
                <FieldDescription>
                  {{ t("settings.agents.custom.tools.description") }}
                </FieldDescription>
              </FieldContent>
            </Field>

            <TooltipProvider>
              <Field
                v-for="row in toolRows"
                :key="row.name"
                orientation="horizontal"
              >
                <FieldContent>
                  <FieldLabel
                    :for="`agent-tool-${row.name}-${editingAgent?.id ?? 'new'}`"
                    class="flex items-center gap-2"
                  >
                    {{ row.label }}
                    <Badge v-if="!row.enabledAtTeam" variant="outline">
                      {{ t("settings.agents.custom.tools.disabledAtTeam") }}
                    </Badge>
                  </FieldLabel>
                  <FieldDescription>
                    {{ row.description }}
                  </FieldDescription>
                </FieldContent>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="inline-block">
                      <Switch
                        :id="`agent-tool-${row.name}-${editingAgent?.id ?? 'new'}`"
                        :model-value="draft.tools[row.name]"
                        :disabled="!canManage || !row.enabledAtTeam"
                        @update:model-value="
                          (value) => setToolEnabled(row.name, Boolean(value))
                        "
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent v-if="!row.enabledAtTeam">
                    {{
                      t("settings.agents.custom.tools.disabledAtTeamTooltip")
                    }}
                  </TooltipContent>
                </Tooltip>
              </Field>
            </TooltipProvider>
          </FieldSet>
        </FieldGroup>
      </OverlayScrollbarsWrapper>

      <DialogFooter>
        <DialogClose as-child>
          <!--
            Disable cancel while saving so the dialog can't be closed
            mid-`create()` / `update()`. Without this guard the user
            could dismiss before the callable resolves, leaving the
            toast / state to fire against an unmounted form. Matches
            the inline-panel Discard guard in `SettingsAi` /
            `SettingsAgents`.
          -->
          <Button variant="outline" :disabled="isSaving">
            {{ t("common.cancel") }}
          </Button>
        </DialogClose>
        <!--
          `!canSave` is the canonical guard (combines `!canManage`,
          `isSaving`, empty name, empty prompt, and `!isDirty`); the
          extra `|| isSaving` is redundant but kept explicit so this
          reads symmetrically with the inline save buttons in
          `SettingsAi` / `SettingsAgents` (`:disabled="isSaving"`).
        -->
        <Button :disabled="!canSave || isSaving" @click="handleEditorSave">
          <Spinner v-if="isSaving" />
          {{ isNew ? t("settings.agents.custom.create") : t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

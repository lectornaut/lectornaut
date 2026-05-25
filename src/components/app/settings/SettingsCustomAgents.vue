<script lang="ts" setup>
import { generateTeamAgentConfig } from "@/composables/useFunctions"
import { useTeamAgents } from "@/composables/useTeamAgents"
import { BOT_TOOL_CATALOG } from "@/data/botTools"
import { IconAlertTriangle, IconSparkles } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import { useTeamCustomToolsStore } from "@/stores/teamCustomToolsStore"
import type {
  IBotAgentConfig,
  ITeamAgent,
  ITeamCustomTool,
} from "@/types/domain"
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

// Silent consumer of the custom tools store — we only need the catalog
// (no CRUD here). Bypasses `useTeamCustomTools` so the dialog doesn't
// double-emit toasts when the settings page already owns them.
const teamCustomToolsStore = useTeamCustomToolsStore()
const { tools: allCustomTools } = storeToRefs(teamCustomToolsStore)

/**
 * Non-archived custom tools the agent editor surfaces. Archived ones
 * are filtered out because admins can't reasonably configure overrides
 * for a tool that's been deprecated — the row would always read
 * "Archived" with no actionable state. Disabled-at-team tools STAY in
 * the list so admins can preconfigure per-agent state ahead of a
 * future re-enable; we surface their disabled-at-team status as a
 * Badge (same affordance built-in tools get when toggled off at team
 * level).
 */
const customToolsForAgent = computed<ITeamCustomTool[]>(() =>
  allCustomTools.value
    .filter((tool) => !tool.archivedAt)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
)

/** Team-wide gate — when off, the whole sub-section is "disabled at team." */
const customToolsFeatureOn = computed<boolean>(
  () => teamTools.value.customTools !== false
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
  /**
   * Per-custom-tool overrides keyed by tool id. Missing keys default
   * to enabled at dispatch time, so the editor only stores explicit
   * `false` entries — the absence of a key is "use the team-level
   * state." See the server-side merge note: the editor sends the
   * FULL set of known ids on save, so a removed-from-list tool id
   * reverts to the default rather than retaining a stale `false`.
   */
  customTools: Record<string, boolean>
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
    rollDice: true,
    browseInternet: true,
    askQuestion: true,
    searchWorkspaceNodes: true,
    summarizeNode: true,
    // Real per-agent toggles (consumed at dispatch): does this agent get
    // the node WRITE tools / the readNode tool? Each intersected with its
    // team toggle + membership.
    manageContent: true,
    readContent: true,
    // Carried for type alignment with the team-level toggle schema —
    // ignored at the per-agent dispatch layer (see ITeamAgent JSDoc).
    customAgents: true,
    customTools: true,
    summarizeNodeInspector: true,
  },
  customTools: {},
}

const cloneDraft = (source: ITeamAgent | null): AgentDraft => {
  if (!source) {
    return {
      ...DEFAULT_DRAFT,
      promptSuffixes: { ...DEFAULT_DRAFT.promptSuffixes },
      tools: { ...DEFAULT_DRAFT.tools },
      customTools: { ...DEFAULT_DRAFT.customTools },
    }
  }
  return {
    name: source.name,
    description: source.description,
    avatarSeed: source.avatarSeed,
    systemPromptBase: source.systemPromptBase,
    promptSuffixes: { ...source.promptSuffixes },
    tools: { ...source.tools },
    customTools: { ...(source.customTools ?? {}) },
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
 * One row per model-callable tool. `BOT_TOOL_CATALOG` is the exhaustive
 * source of those tools — its `Record<BotToolName, …>` backing forces an
 * entry for every tool, so this list can't silently drop (or, as before,
 * double-count) one — and we map it for the canonical set and display
 * order. Labels/descriptions resolve through the `settings.agents.tools.*`
 * i18n keys so this per-agent editor reads identically to the team-level
 * toggles in `SettingsTools.vue`; the catalog's own English `label` /
 * `example` stay reserved for the composer slash menu, which has no i18n
 * layer. `customAgents` / `customTools` are absent by construction —
 * `BotToolName` excludes them as team-level feature gates, not per-agent
 * capabilities.
 *
 * `manageContent` (node WRITE tools) and `readContent` (the `readNode`
 * tool) are appended AFTER the catalog rows: they're real per-agent
 * capabilities but each gates a tool block, not a single model-callable
 * tool, so they're deliberately kept out of `BOT_TOOL_CATALOG` / the
 * slash menu. The standalone entries here give them the same switch +
 * "Disabled at team" affordance as the catalog tools without leaking
 * them into the composer.
 */
const toolRows = computed<ToolRow[]>(() => [
  ...BOT_TOOL_CATALOG.map((tool) => ({
    name: tool.name,
    label: t(`settings.agents.tools.${tool.name}.label`),
    description: t(`settings.agents.tools.${tool.name}.description`),
    enabledAtTeam: teamTools.value[tool.name] !== false,
  })),
  {
    name: "manageContent" as const,
    label: t("settings.agents.tools.manageContent.label"),
    description: t("settings.agents.tools.manageContent.description"),
    enabledAtTeam: teamTools.value.manageContent !== false,
  },
  {
    name: "readContent" as const,
    label: t("settings.agents.tools.readContent.label"),
    description: t("settings.agents.tools.readContent.description"),
    enabledAtTeam: teamTools.value.readContent !== false,
  },
])

const setToolEnabled = (name: ToolRow["name"], value: boolean): void => {
  draft.value.tools[name] = value
}

/**
 * Toggle a custom tool's per-agent override. The draft holds the FULL
 * set of known ids on save (see `prepareDraftForSave` below); writing
 * the flag here is enough to land it. Reassigning the object (vs.
 * mutating a key) is the simplest way to keep Vue's reactive tracking
 * stable when the underlying record changes shape — same trick used
 * for `draft.builtInAgents` in SettingsAgents.vue.
 */
const setCustomToolEnabled = (toolId: string, value: boolean): void => {
  draft.value.customTools = {
    ...draft.value.customTools,
    [toolId]: value,
  }
}

const isCustomToolEnabledForAgent = (toolId: string): boolean =>
  draft.value.customTools[toolId] !== false

/**
 * Build the customTools map sent on save. Two things happen here:
 *
 *   1. We include EVERY known tool id (from the team's catalog) so the
 *      server's "replace, don't merge" update semantics don't leave
 *      stale `false` entries hanging around for tools the admin
 *      flipped back to enabled in this edit.
 *
 *   2. For tools NOT in the team catalog but already in the draft
 *      (e.g. a tool deleted between dialog-open and save), the entry
 *      is dropped — the server normalizer ignores unknown ids
 *      anyway, but pruning here keeps the doc clean.
 *
 * Tools whose effective state is `true` (the default) are emitted as
 * `true` rather than omitted, because the server replaces the map
 * wholesale — omitting would default to enabled, which is the same
 * outcome, but explicit booleans keep the Firestore doc readable.
 */
const prepareDraftForSave = (): AgentDraft => {
  const customTools: Record<string, boolean> = {}
  for (const tool of customToolsForAgent.value) {
    customTools[tool.id] = isCustomToolEnabledForAgent(tool.id)
  }
  return {
    ...draft.value,
    customTools,
  }
}

// ── AI generation (Prompt tab) ──────────────────────────────────────────────
//
// The "Prompt" tab lets an admin describe the agent in plain English and
// have the model draft the whole configuration. Generation writes straight
// into `draft` — the single source of truth the Configure tab edits, the
// preview renders, and Save persists — so there's no parallel state to
// reconcile. `isDirty` flips true the moment the generated name lands, so
// Save lights up and the editingAgent watcher won't clobber the result.

const authStore = useAuthStore()
const { currentTeamId } = storeToRefs(authStore)

/** Prompt textarea cap. The server independently caps at 4000. */
const AI_PROMPT_MAX = 2000

/** Default to the Prompt tab; reset on every open (see handleOpenEvent). */
const activeTab = ref("prompt")
const aiPrompt = ref("")
const isGenerating = ref(false)
const generateError = ref<string | null>(null)
/** Wire-name of the model that produced the current draft (UI receipt). */
const generatedModel = ref<string | null>(null)
/** True once a generation has populated the draft this session. */
const hasGenerated = ref(false)

/**
 * Show the preview pane when there's something worth previewing: always in
 * edit mode (the draft already mirrors a saved agent) and, in create mode,
 * once the first generation lands. Otherwise the empty state guides the
 * admin to write a prompt.
 */
const showPreview = computed(() => !isNew.value || hasGenerated.value)

/** Built-in tools enabled on the current draft — drives the preview chips. */
const enabledToolLabels = computed<string[]>(() =>
  toolRows.value
    .filter((row) => draft.value.tools[row.name])
    .map((row) => row.label)
)

const canGenerate = computed<boolean>(() => {
  if (!canManage.value || isGenerating.value || isSaving.value) return false
  if (!currentTeamId.value) return false
  return aiPrompt.value.trim().length > 0
})

const handleGenerate = async (): Promise<void> => {
  const prompt = aiPrompt.value.trim()
  const teamId = currentTeamId.value
  if (!prompt || !teamId || !canGenerate.value) return
  isGenerating.value = true
  generateError.value = null
  try {
    const { data } = await generateTeamAgentConfig({ teamId, prompt })
    // Merge into the single source of truth. Preserve the per-custom-tool
    // overrides plus the non-dispatchable `customAgents` / `customTools`
    // keys the model doesn't generate; override the text fields and the
    // five built-in tool toggles from the AI's draft.
    draft.value = {
      ...draft.value,
      name: data.name,
      description: data.description,
      avatarSeed: data.avatarSeed,
      systemPromptBase: data.systemPromptBase,
      promptSuffixes: { ...data.promptSuffixes },
      tools: { ...draft.value.tools, ...data.tools },
    }
    generatedModel.value = data.model
    hasGenerated.value = true
  } catch (error) {
    console.error("[SettingsCustomAgents] failed to generate config:", error)
    generateError.value = t("settings.agents.custom.ai.generateError")
  } finally {
    isGenerating.value = false
  }
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
  // Reset AI-mode state so a reopened dialog never shows a stale prompt,
  // preview receipt, or error from a previous session.
  activeTab.value = "prompt"
  aiPrompt.value = ""
  isGenerating.value = false
  generateError.value = null
  generatedModel.value = null
  hasGenerated.value = false
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
  const payload = prepareDraftForSave()
  const target = editingAgent.value
  if (target) {
    await update(target.id, payload)
  } else {
    const created = await create(payload)
    if (!created) return
  }
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden overscroll-none"
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

      <Tabs v-model="activeTab" class="min-h-0">
        <TabsList class="self-start">
          <TabsTrigger value="prompt">
            <IconSparkles />
            {{ t("settings.agents.custom.ai.tabPrompt") }}
          </TabsTrigger>
          <TabsTrigger value="configure">
            {{ t("settings.agents.custom.ai.tabConfigure") }}
          </TabsTrigger>
        </TabsList>

        <!-- ── Prompt tab — split view: input (left) + live preview (right) ── -->
        <TabsContent value="prompt" class="min-h-0">
          <div
            class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <!--
              Left: prompt input styled as an InputGroup — a single
              bordered group whose block-end footer carries the Generate
              action and the model receipt, so the textarea reads as one
              composer rather than a field stacked above a loose button.
            -->
            <div class="flex min-h-0 flex-col gap-3">
              <div class="flex flex-col gap-1">
                <Label
                  :for="`agent-ai-prompt-${editingAgent?.id ?? 'new'}`"
                  class="text-sm font-medium"
                >
                  {{ t("settings.agents.custom.ai.promptLabel") }}
                </Label>
                <p class="text-muted-foreground text-xs">
                  {{ t("settings.agents.custom.ai.promptDescription") }}
                </p>
              </div>
              <InputGroup class="min-h-0 grow">
                <InputGroupTextarea
                  :id="`agent-ai-prompt-${editingAgent?.id ?? 'new'}`"
                  v-model="aiPrompt"
                  :placeholder="
                    t('settings.agents.custom.ai.promptPlaceholder')
                  "
                  :maxlength="AI_PROMPT_MAX"
                  :disabled="!canManage || isGenerating"
                  class="min-h-40"
                />
                <InputGroupAddon align="block-end" class="border-t">
                  <InputGroupText
                    v-if="generatedModel && !isGenerating"
                    class="min-w-0 truncate text-xs"
                  >
                    {{
                      t("settings.agents.custom.ai.generatedBy", {
                        model: generatedModel,
                      })
                    }}
                  </InputGroupText>
                  <InputGroupButton
                    variant="default"
                    size="sm"
                    class="ml-auto"
                    :disabled="!canGenerate"
                    @click="handleGenerate"
                  >
                    <Spinner v-if="isGenerating" />
                    <IconSparkles v-else />
                    {{
                      isGenerating
                        ? t("settings.agents.custom.ai.generating")
                        : hasGenerated
                          ? t("settings.agents.custom.ai.regenerate")
                          : t("settings.agents.custom.ai.generate")
                    }}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <p
                v-if="generateError"
                class="text-destructive flex items-center gap-1.5 text-xs"
              >
                <IconAlertTriangle class="size-3.5 shrink-0" />
                {{ generateError }}
              </p>
            </div>

            <!-- Right: read-only "anticipated configuration" rendered from draft. -->
            <div
              class="bg-muted/30 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border"
            >
              <div class="shrink-0 border-b px-4 py-2.5">
                <span class="text-sm font-medium">
                  {{ t("settings.agents.custom.ai.previewTitle") }}
                </span>
              </div>
              <div
                v-if="!showPreview"
                class="flex grow flex-col items-center justify-center gap-2 p-6 text-center"
              >
                <IconSparkles class="text-muted-foreground size-7" />
                <p class="text-sm font-medium">
                  {{ t("settings.agents.custom.ai.previewEmptyTitle") }}
                </p>
                <p class="text-muted-foreground max-w-xs text-xs">
                  {{ t("settings.agents.custom.ai.previewEmptyHint") }}
                </p>
              </div>
              <OverlayScrollbarsWrapper v-else class="min-h-0 grow">
                <div class="flex flex-col gap-4 p-4">
                  <!-- Identity (avatar + name + description) -->
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
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">
                        {{
                          draft.name ||
                          t("settings.agents.custom.untitledAgent")
                        }}
                      </p>
                      <p class="text-muted-foreground truncate text-xs">
                        {{
                          draft.description ||
                          t("settings.agents.custom.ai.previewNoDescription")
                        }}
                      </p>
                    </div>
                  </div>

                  <!-- System prompt -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.agents.custom.ai.previewSystemPrompt") }}
                    </span>
                    <p
                      class="bg-background text-foreground/90 max-h-48 overflow-auto rounded-md border p-2.5 text-xs whitespace-pre-wrap"
                    >
                      {{ draft.systemPromptBase }}
                    </p>
                  </div>

                  <!-- Enabled tools -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.agents.custom.ai.previewTools") }}
                    </span>
                    <div
                      v-if="enabledToolLabels.length > 0"
                      class="flex flex-wrap gap-1.5"
                    >
                      <Badge
                        v-for="label in enabledToolLabels"
                        :key="label"
                        variant="secondary"
                        class="font-normal"
                      >
                        {{ label }}
                      </Badge>
                    </div>
                    <p v-else class="text-muted-foreground text-xs italic">
                      {{ t("settings.agents.custom.ai.previewNoTools") }}
                    </p>
                  </div>
                </div>
              </OverlayScrollbarsWrapper>
            </div>
          </div>
        </TabsContent>

        <!-- ── Configure tab — full manual form (unchanged) ───────────── -->
        <TabsContent value="configure" class="min-h-0">
          <OverlayScrollbarsWrapper
            class="-mx-6 h-full w-[-webkit-fill-available]"
          >
            <FieldGroup class="p-6">
              <!-- ── Identity ──────────────────────────────────────────────── -->
              <FieldSet>
                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel
                      :for="`agent-name-${editingAgent?.id ?? 'new'}`"
                    >
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
                      class="grow"
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
                      {{
                        t("settings.agents.custom.systemPromptBase.description")
                      }}
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
                      {{
                        t("settings.agents.custom.promptSuffixes.description")
                      }}
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
                              (value) =>
                                setToolEnabled(row.name, Boolean(value))
                            "
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent v-if="!row.enabledAtTeam">
                        {{
                          t(
                            "settings.agents.custom.tools.disabledAtTeamTooltip"
                          )
                        }}
                      </TooltipContent>
                    </Tooltip>
                  </Field>
                </TooltipProvider>

                <!--
              ── Custom tools sub-section ──
              Only renders when the team has at least one non-archived
              custom tool; the entire group falls out of the editor
              otherwise so the heading doesn't dangle empty. The
              team-wide `customTools` gate is treated the same way as a
              built-in tool's team-level switch — the "Disabled at
              team" badge appears on the sub-heading and the Switches
              go disabled. Per-tool team-level state (`tool.enabled`)
              gets its own per-row badge so admins can still
              preconfigure overrides for tools they've toggled off but
              not yet archived.
            -->
                <template v-if="customToolsForAgent.length > 0">
                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel class="flex items-center gap-2">
                        {{ t("settings.agents.custom.customToolsHeader") }}
                        <Badge v-if="!customToolsFeatureOn" variant="outline">
                          {{ t("settings.agents.custom.tools.disabledAtTeam") }}
                        </Badge>
                      </FieldLabel>
                      <FieldDescription>
                        {{ t("settings.agents.custom.customToolsHeaderDesc") }}
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <TooltipProvider>
                    <Field
                      v-for="tool in customToolsForAgent"
                      :key="tool.id"
                      orientation="horizontal"
                    >
                      <FieldContent>
                        <FieldLabel
                          :for="`agent-custom-tool-${tool.id}-${editingAgent?.id ?? 'new'}`"
                          class="flex items-center gap-2"
                        >
                          <!--
                        Use displayName when admins set it; otherwise
                        the wire-name (the model-facing string).
                        Matches the row in the team-level Custom tools
                        list so admins recognize the same identity
                        across surfaces.
                      -->
                          <span class="font-mono text-sm">
                            {{ tool.displayName || tool.name }}
                          </span>
                          <Badge
                            v-if="tool.enabled === false"
                            variant="outline"
                          >
                            {{
                              t("settings.agents.custom.tools.disabledAtTeam")
                            }}
                          </Badge>
                        </FieldLabel>
                        <FieldDescription v-if="tool.description">
                          {{ tool.description }}
                        </FieldDescription>
                      </FieldContent>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <span class="inline-block">
                            <Switch
                              :id="`agent-custom-tool-${tool.id}-${editingAgent?.id ?? 'new'}`"
                              :model-value="
                                isCustomToolEnabledForAgent(tool.id)
                              "
                              :disabled="
                                !canManage ||
                                !customToolsFeatureOn ||
                                tool.enabled === false
                              "
                              @update:model-value="
                                (value) =>
                                  setCustomToolEnabled(tool.id, Boolean(value))
                              "
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          v-if="!customToolsFeatureOn || tool.enabled === false"
                        >
                          {{
                            t(
                              "settings.agents.custom.tools.disabledAtTeamTooltip"
                            )
                          }}
                        </TooltipContent>
                      </Tooltip>
                    </Field>
                  </TooltipProvider>
                </template>
              </FieldSet>
            </FieldGroup>
          </OverlayScrollbarsWrapper>
        </TabsContent>
      </Tabs>

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

<script lang="ts" setup>
import {
  generateTeamWorkflowConfig,
  type CreateWorkflowDraft,
  type GeneratedTeamWorkflowConfig,
  type WorkflowNodeRefInput,
} from "@/composables/useFunctions"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import {
  DEFAULT_AGENT_DEFINITION,
  DEFAULT_AGENT_ID,
  isBuiltInAgentId,
} from "@/data/builtInAgents"
import {
  IconAlertTriangle,
  IconBadgeCheck,
  IconBot,
  IconSparkles,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import type { IWorkflow } from "@/types/domain"
import { isAgentMembership, isUserMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { computed, ref, watch } from "vue"

const props = defineProps<{
  open: boolean
  /** null/undefined = create; a workflow = edit (agent + workspace locked). */
  workflow?: IWorkflow | null
  /** Preselected agent for a new workflow. */
  defaultAgentId?: string
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  saved: [workflowId: string | null]
}>()

const { t } = useI18n()
const { isSaving, canManage, create, update } = useTeamWorkflows()

// Mirror the chat composer's agent picker. `pickerAgents` is the store's
// merged view (built-in presets + selectable custom agents); we partition it
// into the two dropdown groups. The Default agent (`_default`) is NOT in
// `pickerAgents` — it isn't a togglable preset — so the picker surfaces it
// explicitly as the top "Default" option, and the toggle below selects it.
const teamAgentsStore = useTeamAgentsStore()
const { pickerAgents } = storeToRefs(teamAgentsStore)
const builtInAgents = computed(() =>
  pickerAgents.value.filter((agent) => isBuiltInAgentId(agent.id))
)
const customAgents = computed(() =>
  pickerAgents.value.filter((agent) => !isBuiltInAgentId(agent.id))
)

// Team-member check badge — same indicator the composer/sidebar render. The
// Default agent is an implicit always-member (resolved server-side), so it's
// badged unconditionally; everything else keys off the membership roster.
const membershipStore = useMembershipStore()
const { teamMembers } = storeToRefs(membershipStore)
const memberAgentIds = computed(
  () =>
    new Set(
      teamMembers.value
        .filter(isAgentMembership)
        .map((member) => member.agentId)
    )
)
const isAgentMember = (agentId: string): boolean =>
  agentId === DEFAULT_AGENT_ID || memberAgentIds.value.has(agentId)

// Beam-avatar seed + palette copied from the composer so an agent's generated
// avatar looks identical here. Structural param type covers both `ITeamAgent`
// and the built-in `DEFAULT_AGENT_DEFINITION`.
const agentAvatarSeed = (agent: {
  avatarSeed: string
  name: string
  id: string
}): string => agent.avatarSeed.trim() || agent.name.trim() || agent.id

const authStore = useAuthStore()
const { currentTeamId, currentWorkspaceId, currentUser } =
  storeToRefs(authStore)

interface WorkflowFormDraft {
  name: string
  description: string
  avatarSeed: string
  agentId: string
  instructions: string
  additionalPrompt: string
  triggerType: "schedule" | "event" | "manual"
  scheduleType: "interval" | "daily" | "weekly"
  everyHours: number
  timeUTC: string
  dayOfWeek: number
  eventScope: "code" | "write"
  debounceMinutes: number
  targetScope: "code" | "write"
  updateMode: "automatic" | "require_review"
  contextNodes: WorkflowNodeRefInput[]
  /** P3 — member whose connection bindings headless runs act through. */
  actsAsUid: string | null
}

const emptyDraft = (): WorkflowFormDraft => ({
  name: "",
  description: "",
  avatarSeed: "",
  agentId: props.defaultAgentId || DEFAULT_AGENT_ID,
  instructions: "",
  additionalPrompt: "",
  triggerType: "manual",
  scheduleType: "daily",
  everyHours: 24,
  timeUTC: "09:00",
  dayOfWeek: 1,
  eventScope: "write",
  debounceMinutes: 30,
  targetScope: "write",
  updateMode: "require_review",
  contextNodes: [],
  actsAsUid: null,
})

const draft = ref<WorkflowFormDraft>(emptyDraft())

// Mirrors `SettingsWorkflowRow`'s `avatarSeedEffective` so the editor preview
// renders the exact avatar the list row will show after save: explicit seed
// first, else the workflow name, else a constant so an empty draft still
// yields a stable portrait.
const effectiveAvatarSeed = computed(
  () => draft.value.avatarSeed.trim() || draft.value.name.trim() || "Workflow"
)

// "Run as a specific agent" toggle. OFF → the workflow runs as the Default
// agent (`_default`) and the picker is hidden; ON → the picker appears with
// Default still pre-selected. Seeded from the draft's agent on open
// (`initDraft`); turning it off snaps the agent back to the Default.
const runAsSpecificAgent = ref(false)
watch(runAsSpecificAgent, (on) => {
  if (!on) draft.value.agentId = DEFAULT_AGENT_ID
})

// Drives the trigger's compact avatar + name (reka-ui would otherwise clone
// the selected row's full two-line layout into the trigger). Resolves the
// Default sentinel from the static definition; any other id from the picker.
const selectedAgent = computed<{
  id: string
  name: string
  avatarSeed: string
} | null>(() => {
  const id = draft.value.agentId
  if (id === DEFAULT_AGENT_ID) {
    return {
      id: DEFAULT_AGENT_ID,
      name: DEFAULT_AGENT_DEFINITION.name,
      avatarSeed: DEFAULT_AGENT_DEFINITION.avatarSeed,
    }
  }
  return pickerAgents.value.find((agent) => agent.id === id) ?? null
})

// ── Connections access (P3) ─────────────────────────────────────────────────
// "Run with my connected accounts": headless runs may read connection-backed
// tools (e.g. Google Calendar) through the binding owner's account. Consent
// is structural — the server accepts only the CALLER's own uid — so the
// toggle always writes MY uid; turning it on over someone else's binding
// replaces it with mine (their grant is surfaced in the hint below). OFF
// clears (`null`) — any editor may revoke.
const actsAsBindingOn = computed(() => draft.value.actsAsUid !== null)
const actsAsIsOther = computed(
  () =>
    draft.value.actsAsUid !== null &&
    draft.value.actsAsUid !== (currentUser.value?.uid ?? null)
)
const actsAsOtherName = computed<string>(() => {
  const uid = draft.value.actsAsUid
  if (!uid) return ""
  const member = teamMembers.value.find(
    (m) => isUserMembership(m) && m.userId === uid
  )
  if (!member || !isUserMembership(member)) return ""
  return member.user?.displayName || member.user?.email || ""
})
const handleToggleActsAs = (on: boolean): void => {
  draft.value.actsAsUid = on ? (currentUser.value?.uid ?? null) : null
}

const ctxScope = ref<"code" | "write">("code")
const ctxNodeId = ref("")

const editingId = computed(() => props.workflow?.id ?? null)
const dialogTitle = computed(() =>
  editingId.value
    ? t("settings.workflows.editTitle")
    : t("settings.workflows.newTitle")
)

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const parseTimeToMinute = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}
const minuteToTime = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

// ── AI generation (Prompt tab) ──────────────────────────────────────────────
//
// Mirror of the agent / custom-tool editors' Prompt tab: an admin describes the
// workflow in plain English and `generateTeamWorkflowConfig` drafts the full
// configuration straight into `draft` — the single source of truth the
// Configure tab edits, the preview renders, and Save persists. The server
// clamps every string and normalizes the trigger, so the generated draft is
// always saveable. The model never sees team data, so generation leaves the
// agent binding and context nodes untouched (the editor keeps its own values
// for those).

/** Prompt textarea cap. The server independently caps at 4000. */
const AI_PROMPT_MAX = 2000

/** Default to the Prompt tab; reset on every open (see the open watcher). */
const activeTab = ref("prompt")
const aiPrompt = ref("")
const isGenerating = ref(false)
const generateError = ref<string | null>(null)
/** Wire-name of the model that produced the current draft (UI receipt). */
const generatedModel = ref<string | null>(null)
/** True once a generation has populated the draft this session. */
const hasGenerated = ref(false)

const resetAiState = (): void => {
  activeTab.value = "prompt"
  aiPrompt.value = ""
  isGenerating.value = false
  generateError.value = null
  generatedModel.value = null
  hasGenerated.value = false
}

const initDraft = (): void => {
  const wf = props.workflow
  if (!wf) {
    draft.value = emptyDraft()
    // New workflow: collapse to the Default agent unless the opener
    // preselected a specific one.
    runAsSpecificAgent.value = draft.value.agentId !== DEFAULT_AGENT_ID
    return
  }
  const d = emptyDraft()
  d.name = wf.name
  d.description = wf.description ?? ""
  d.avatarSeed = wf.avatarSeed ?? ""
  d.agentId = wf.agentId
  d.instructions = wf.instructions ?? ""
  d.additionalPrompt = wf.additionalPrompt ?? ""
  d.targetScope = wf.targetScope ?? "write"
  d.updateMode = wf.updateMode ?? "require_review"
  d.contextNodes = (wf.contextNodes ?? []).map((n) => ({ ...n }))
  d.actsAsUid = wf.actsAsUid ?? null
  const trig = wf.trigger
  d.triggerType = trig.type
  if (trig.type === "event") {
    d.eventScope = trig.scope
    d.debounceMinutes = trig.debounceMinutes ?? 0
  }
  if (trig.type === "schedule") {
    d.scheduleType = trig.schedule.type
    if (trig.schedule.type === "interval")
      d.everyHours = trig.schedule.everyHours
    if (trig.schedule.type === "daily")
      d.timeUTC = minuteToTime(trig.schedule.atMinuteUTC)
    if (trig.schedule.type === "weekly") {
      d.timeUTC = minuteToTime(trig.schedule.atMinuteUTC)
      d.dayOfWeek = trig.schedule.dayOfWeek
    }
  }
  draft.value = d
  // Editing: show the picker only when this workflow runs as a specific
  // agent (agent binding is immutable, so the controls stay disabled).
  runAsSpecificAgent.value = d.agentId !== DEFAULT_AGENT_ID
}

// Re-seed the form each time the dialog opens, and clear any stale AI state
// (prompt text, preview receipt, error) from a previous session.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    initDraft()
    resetAiState()
  }
)

/**
 * Show the preview pane when there's something worth previewing: always in
 * edit mode (the draft already mirrors a saved workflow) and, in create mode,
 * once the first generation lands. Otherwise the empty state guides the admin
 * to write a prompt.
 */
const showPreview = computed(() => !!editingId.value || hasGenerated.value)

/** Concise, human-readable trigger line shown as a badge in the preview. */
const triggerSummary = computed<string>(() => {
  const d = draft.value
  if (d.triggerType === "event") {
    const scope =
      d.eventScope === "code"
        ? t("settings.workflows.scopeCode")
        : t("settings.workflows.scopeWrite")
    return `${t("settings.workflows.triggerEventOpt")} · ${scope}`
  }
  if (d.triggerType === "schedule") {
    if (d.scheduleType === "interval")
      return `${t("settings.workflows.every")} ${d.everyHours} ${t("settings.workflows.hours")}`
    if (d.scheduleType === "weekly")
      return `${t("settings.workflows.schedWeekly")} · ${dayNames[d.dayOfWeek] ?? ""} ${d.timeUTC} UTC`
    return `${t("settings.workflows.schedDaily")} · ${d.timeUTC} UTC`
  }
  return t("settings.workflows.triggerManualOpt")
})

const canGenerate = computed<boolean>(() => {
  if (!canManage.value || isGenerating.value || isSaving.value) return false
  if (!currentTeamId.value) return false
  return aiPrompt.value.trim().length > 0
})

/**
 * Merge a generated config into the draft IN PLACE so the chosen agent,
 * workspace, and context nodes survive. Un-flattens the server's
 * normalized trigger into the form's flat fields — the inverse of
 * `buildTrigger`, mirroring how `initDraft` reads a saved workflow's trigger.
 */
const applyGeneratedConfig = (data: GeneratedTeamWorkflowConfig): void => {
  const d = draft.value
  d.name = data.name
  d.description = data.description
  d.avatarSeed = data.avatarSeed
  d.instructions = data.instructions
  d.additionalPrompt = data.additionalPrompt
  d.targetScope = data.targetScope ?? "write"
  d.updateMode = data.updateMode
  const trig = data.trigger
  d.triggerType = trig.type
  if (trig.type === "event") {
    d.eventScope = trig.scope
    d.debounceMinutes = trig.debounceMinutes ?? 0
  } else if (trig.type === "schedule") {
    d.scheduleType = trig.schedule.type
    if (trig.schedule.type === "interval")
      d.everyHours = trig.schedule.everyHours
    else if (trig.schedule.type === "daily")
      d.timeUTC = minuteToTime(trig.schedule.atMinuteUTC)
    else {
      d.timeUTC = minuteToTime(trig.schedule.atMinuteUTC)
      d.dayOfWeek = trig.schedule.dayOfWeek
    }
  }
}

const handleGenerate = async (): Promise<void> => {
  const prompt = aiPrompt.value.trim()
  const teamId = currentTeamId.value
  if (!prompt || !teamId || !canGenerate.value) return
  isGenerating.value = true
  generateError.value = null
  try {
    const { data } = await generateTeamWorkflowConfig({ teamId, prompt })
    applyGeneratedConfig(data)
    generatedModel.value = data.model
    hasGenerated.value = true
  } catch (error) {
    console.error("[WorkflowEditorDialog] failed to generate config:", error)
    generateError.value = t("settings.workflows.ai.generateError")
  } finally {
    isGenerating.value = false
  }
}

const buildTrigger = (d: WorkflowFormDraft): CreateWorkflowDraft["trigger"] => {
  if (d.triggerType === "manual") return { type: "manual" }
  if (d.triggerType === "event")
    return {
      type: "event",
      scope: d.eventScope,
      debounceMinutes: d.debounceMinutes,
    }
  if (d.scheduleType === "interval")
    return {
      type: "schedule",
      schedule: { type: "interval", everyHours: d.everyHours },
    }
  if (d.scheduleType === "daily")
    return {
      type: "schedule",
      schedule: { type: "daily", atMinuteUTC: parseTimeToMinute(d.timeUTC) },
    }
  return {
    type: "schedule",
    schedule: {
      type: "weekly",
      dayOfWeek: d.dayOfWeek,
      atMinuteUTC: parseTimeToMinute(d.timeUTC),
    },
  }
}

const addContextNode = (): void => {
  const id = ctxNodeId.value.trim()
  if (!id) return
  if (
    draft.value.contextNodes.some(
      (n) => n.nodeId === id && n.scope === ctxScope.value
    )
  )
    return
  draft.value.contextNodes.push({ scope: ctxScope.value, nodeId: id })
  ctxNodeId.value = ""
}
const removeContextNode = (i: number): void => {
  draft.value.contextNodes.splice(i, 1)
}

const canSave = computed(() => {
  const d = draft.value
  if (!canManage.value || isSaving.value) return false
  if (!d.name.trim() || !d.instructions.trim() || !d.agentId) return false
  if (!editingId.value && !currentWorkspaceId.value) return false
  return true
})

const handleSave = async (): Promise<void> => {
  if (!canSave.value) return
  const d = draft.value
  const shared = {
    name: d.name.trim(),
    description: d.description.trim(),
    avatarSeed: d.avatarSeed.trim(),
    instructions: d.instructions.trim(),
    additionalPrompt: d.additionalPrompt.trim(),
    targetScope: d.targetScope,
    updateMode: d.updateMode,
    trigger: buildTrigger(d),
    contextNodes: d.contextNodes,
    actsAsUid: d.actsAsUid,
  }
  if (editingId.value) {
    const ok = await update(editingId.value, shared)
    if (ok) {
      emit("saved", editingId.value)
      emit("update:open", false)
    }
    return
  }
  const id = await create({
    ...shared,
    agentId: d.agentId,
    workspaceId: currentWorkspaceId.value as string,
  })
  if (id) {
    emit("saved", id)
    emit("update:open", false)
  }
}
</script>

<template>
  <Dialog
    :open="props.open"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <DialogContent
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden overscroll-none"
    >
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{
          t("settings.workflows.dialogHint")
        }}</DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeTab" class="min-h-0">
        <TabsList class="bg-input/50 h-9! self-start p-0">
          <TabsTrigger
            value="prompt"
            class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
          >
            <IconSparkles />
            {{ t("settings.workflows.ai.tabPrompt") }}
          </TabsTrigger>
          <TabsTrigger
            value="configure"
            class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
          >
            {{ t("settings.workflows.ai.tabConfigure") }}
          </TabsTrigger>
        </TabsList>

        <!-- ── Prompt tab — split view: input (left) + live preview (right) ── -->
        <TabsContent value="prompt" class="min-h-0">
          <div
            class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <!--
              Left: prompt input styled as an InputGroup — a single bordered
              group whose block-end footer carries the Generate action and the
              model receipt, so the textarea reads as one composer.
            -->
            <div class="flex min-h-0 flex-col gap-3">
              <InputGroup class="min-h-0 grow">
                <div class="w-full border-b p-2">
                  <span class="text-sm font-medium">
                    {{ t("settings.workflows.ai.promptLabel") }}
                  </span>
                </div>
                <InputGroupTextarea
                  id="wf-ai-prompt"
                  v-model="aiPrompt"
                  :placeholder="t('settings.workflows.ai.promptPlaceholder')"
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
                      t("settings.workflows.ai.generatedBy", {
                        model: generatedModel,
                      })
                    }}
                  </InputGroupText>
                  <InputGroupButton
                    variant="default"
                    class="ml-auto"
                    :disabled="!canGenerate"
                    @click="handleGenerate"
                  >
                    <Spinner v-if="isGenerating" />
                    <IconSparkles v-else />
                    {{
                      isGenerating
                        ? t("settings.workflows.ai.generating")
                        : hasGenerated
                          ? t("settings.workflows.ai.regenerate")
                          : t("settings.workflows.ai.generate")
                    }}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <p
                v-if="generateError"
                class="text-destructive flex items-center gap-1.5 text-xs"
              >
                <IconAlertTriangle class="size-3.5" />
                {{ generateError }}
              </p>
            </div>

            <!-- Right: read-only "anticipated configuration" from the draft. -->
            <div
              class="bg-muted/30 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border"
            >
              <div class="w-full border-b p-2">
                <span class="text-sm font-medium">
                  {{ t("settings.workflows.ai.previewTitle") }}
                </span>
              </div>
              <div
                v-if="!showPreview"
                class="flex grow flex-col items-center justify-center gap-2 p-6 text-center"
              >
                <IconSparkles class="text-muted-foreground size-7" />
                <p class="text-sm font-medium">
                  {{ t("settings.workflows.ai.previewEmptyTitle") }}
                </p>
                <p class="text-muted-foreground max-w-xs text-xs">
                  {{ t("settings.workflows.ai.previewEmptyHint") }}
                </p>
              </div>
              <ScrollContainer v-else class="min-h-0 grow">
                <div class="flex flex-col gap-4 p-4">
                  <!-- Identity (avatar + name + description) -->
                  <div class="flex items-center gap-3">
                    <AppAvatar
                      variant="bauhaus"
                      :name="effectiveAvatarSeed"
                      class="size-10"
                    />
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">
                        {{ draft.name || t("settings.workflows.newTitle") }}
                      </p>
                      <p class="text-muted-foreground truncate text-xs">
                        {{
                          draft.description ||
                          t("settings.workflows.ai.previewNoDescription")
                        }}
                      </p>
                    </div>
                  </div>

                  <!-- Runs as agent -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.workflows.agent") }}
                    </span>
                    <div class="flex items-center gap-2">
                      <IconBot
                        v-if="
                          !selectedAgent ||
                          selectedAgent.id === DEFAULT_AGENT_ID
                        "
                        class="size-4"
                      />
                      <AppAvatar
                        v-else
                        variant="beam"
                        :name="agentAvatarSeed(selectedAgent)"
                        class="size-4"
                      />
                      <span class="truncate text-sm">
                        {{
                          selectedAgent
                            ? selectedAgent.name
                            : DEFAULT_AGENT_DEFINITION.name
                        }}
                      </span>
                    </div>
                  </div>

                  <!-- Trigger -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.workflows.trigger") }}
                    </span>
                    <div>
                      <Badge variant="secondary" class="font-normal">
                        {{ triggerSummary }}
                      </Badge>
                    </div>
                  </div>

                  <!-- Instructions -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.workflows.instructions") }}
                    </span>
                    <p
                      class="bg-background text-foreground/90 max-h-48 overflow-auto rounded-4xl border p-2.5 text-xs whitespace-pre-wrap"
                    >
                      {{
                        draft.instructions ||
                        t("settings.workflows.ai.previewNoInstructions")
                      }}
                    </p>
                  </div>

                  <!-- Edits scope + update mode -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.workflows.targetScope") }}
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      <Badge variant="outline" class="font-normal">
                        {{
                          draft.targetScope === "code"
                            ? t("settings.workflows.scopeCode")
                            : t("settings.workflows.scopeWrite")
                        }}
                      </Badge>
                      <Badge variant="outline" class="font-normal">
                        {{
                          draft.updateMode === "automatic"
                            ? t("settings.workflows.modeAutomaticOpt")
                            : t("settings.workflows.modeReviewOpt")
                        }}
                      </Badge>
                    </div>
                  </div>
                </div>
              </ScrollContainer>
            </div>
          </div>
        </TabsContent>

        <!-- ── Configure tab — full manual form ───────────────────────── -->
        <TabsContent value="configure" class="min-h-0">
          <ScrollContainer class="-mx-6 h-full w-[-webkit-fill-available]">
            <FieldGroup class="gap-4 p-6">
              <Field>
                <FieldLabel for="wf-name">{{
                  t("settings.workflows.name")
                }}</FieldLabel>
                <Input
                  id="wf-name"
                  v-model="draft.name"
                  :placeholder="t('settings.workflows.namePlaceholder')"
                />
              </Field>

              <Field>
                <FieldLabel for="wf-desc">{{
                  t("settings.workflows.description")
                }}</FieldLabel>
                <Input id="wf-desc" v-model="draft.description" />
              </Field>

              <!--
                Avatar seed — live preview + input, mirroring the agent / tool
                editors. The `bauhaus` variant + chart-N palette match
                `SettingsWorkflowRow` 1:1, so the preview equals the list row
                after save. Blank falls back to the workflow name.
              -->
              <Field>
                <FieldLabel for="wf-avatar-seed">{{
                  t("settings.workflows.avatarSeed.label")
                }}</FieldLabel>
                <div class="flex items-center gap-3">
                  <AppAvatar
                    variant="bauhaus"
                    :name="effectiveAvatarSeed"
                    class="size-10"
                  />
                  <Input
                    id="wf-avatar-seed"
                    v-model="draft.avatarSeed"
                    :placeholder="
                      t('settings.workflows.avatarSeed.placeholder')
                    "
                    :maxlength="40"
                    class="grow"
                  />
                </div>
                <FieldDescription>
                  {{ t("settings.workflows.avatarSeed.description") }}
                </FieldDescription>
              </Field>

              <Field>
                <div class="flex items-center justify-between">
                  <FieldLabel for="wf-run-as">{{
                    t("settings.workflows.runAsAgentToggle")
                  }}</FieldLabel>
                  <Switch
                    id="wf-run-as"
                    :model-value="runAsSpecificAgent"
                    :disabled="!!editingId"
                    @update:model-value="
                      (v: boolean) => (runAsSpecificAgent = v)
                    "
                  />
                </div>

                <!-- Toggle OFF → runs as the Default agent; no picker. -->
                <FieldDescription v-if="!runAsSpecificAgent">
                  {{ t("settings.workflows.runAsAgentHint") }}
                </FieldDescription>

                <!-- Toggle ON → composer-style grouped picker, Default first. -->
                <Select v-else v-model="draft.agentId" :disabled="!!editingId">
                  <SelectTrigger id="wf-agent">
                    <SelectValue
                      :placeholder="t('settings.workflows.agentPlaceholder')"
                    >
                      <span
                        v-if="selectedAgent"
                        class="flex items-center gap-2 truncate"
                      >
                        <IconBot
                          v-if="selectedAgent.id === DEFAULT_AGENT_ID"
                          class="size-4"
                        />
                        <AppAvatar
                          v-else
                          variant="beam"
                          :name="agentAvatarSeed(selectedAgent)"
                          class="size-4"
                        />
                        {{ selectedAgent.name }}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{{
                        t("ai.agents.groupBuiltIn")
                      }}</SelectLabel>
                      <!-- Default agent — always available, always a member. -->
                      <SelectItem :value="DEFAULT_AGENT_ID">
                        <Item size="xs" class="p-0">
                          <ItemMedia variant="icon">
                            <IconBot />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>{{
                              DEFAULT_AGENT_DEFINITION.name
                            }}</ItemTitle>
                            <ItemDescription class="text-xs">
                              {{
                                t("settings.workflows.defaultAgentDescription")
                              }}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <span><IconBadgeCheck /></span>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  {{ t("ai.agents.teamMember") }}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </ItemActions>
                        </Item>
                      </SelectItem>
                      <!-- Built-in presets -->
                      <SelectItem
                        v-for="agent in builtInAgents"
                        :key="agent.id"
                        :value="agent.id"
                      >
                        <Item size="xs" class="p-0">
                          <ItemMedia variant="icon">
                            <AppAvatar
                              variant="beam"
                              :name="agentAvatarSeed(agent)"
                              class="size-4"
                            />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>{{ agent.name }}</ItemTitle>
                            <ItemDescription
                              v-if="agent.description"
                              class="text-xs"
                            >
                              {{ agent.description }}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions v-if="isAgentMember(agent.id)">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <span><IconBadgeCheck /></span>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  {{ t("ai.agents.teamMember") }}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </ItemActions>
                        </Item>
                      </SelectItem>
                    </SelectGroup>
                    <template v-if="customAgents.length > 0">
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>{{
                          t("ai.agents.groupCustom")
                        }}</SelectLabel>
                        <SelectItem
                          v-for="agent in customAgents"
                          :key="agent.id"
                          :value="agent.id"
                        >
                          <Item size="xs" class="p-0">
                            <ItemMedia variant="icon">
                              <AppAvatar
                                variant="beam"
                                :name="agentAvatarSeed(agent)"
                                class="size-4"
                              />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle>{{ agent.name }}</ItemTitle>
                              <ItemDescription
                                v-if="agent.description"
                                class="text-xs"
                              >
                                {{ agent.description }}
                              </ItemDescription>
                            </ItemContent>
                            <ItemActions v-if="isAgentMember(agent.id)">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger as-child>
                                    <span><IconBadgeCheck /></span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    {{ t("ai.agents.teamMember") }}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </ItemActions>
                          </Item>
                        </SelectItem>
                      </SelectGroup>
                    </template>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel for="wf-instructions">{{
                  t("settings.workflows.instructions")
                }}</FieldLabel>
                <Textarea
                  id="wf-instructions"
                  v-model="draft.instructions"
                  :rows="5"
                  :placeholder="t('settings.workflows.instructionsPlaceholder')"
                />
                <FieldDescription>
                  {{ t("settings.workflows.instructionsHint") }}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel for="wf-additional">{{
                  t("settings.workflows.additionalPrompt")
                }}</FieldLabel>
                <Textarea
                  id="wf-additional"
                  v-model="draft.additionalPrompt"
                  :rows="2"
                  :placeholder="
                    t('settings.workflows.additionalPromptPlaceholder')
                  "
                />
              </Field>

              <Field>
                <FieldLabel for="wf-trigger">{{
                  t("settings.workflows.trigger")
                }}</FieldLabel>
                <Select v-model="draft.triggerType">
                  <SelectTrigger id="wf-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="manual">
                        {{ t("settings.workflows.triggerManualOpt") }}
                      </SelectItem>
                      <SelectItem value="schedule">
                        {{ t("settings.workflows.triggerScheduleOpt") }}
                      </SelectItem>
                      <SelectItem value="event">
                        {{ t("settings.workflows.triggerEventOpt") }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <div
                v-if="draft.triggerType === 'schedule'"
                class="flex flex-col gap-3 rounded-4xl border p-3"
              >
                <Select v-model="draft.scheduleType">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="interval">
                        {{ t("settings.workflows.schedInterval") }}
                      </SelectItem>
                      <SelectItem value="daily">
                        {{ t("settings.workflows.schedDaily") }}
                      </SelectItem>
                      <SelectItem value="weekly">
                        {{ t("settings.workflows.schedWeekly") }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div
                  v-if="draft.scheduleType === 'interval'"
                  class="flex items-center gap-2"
                >
                  <span class="text-sm">{{
                    t("settings.workflows.every")
                  }}</span>
                  <Input
                    v-model.number="draft.everyHours"
                    type="number"
                    min="1"
                    max="720"
                    class="w-24"
                  />
                  <span class="text-sm">{{
                    t("settings.workflows.hours")
                  }}</span>
                </div>

                <div
                  v-if="draft.scheduleType === 'weekly'"
                  class="flex items-center gap-2"
                >
                  <Select v-model="draft.dayOfWeek">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem
                          v-for="(d, i) in dayNames"
                          :key="i"
                          :value="i"
                        >
                          {{ d }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div
                  v-if="draft.scheduleType !== 'interval'"
                  class="flex items-center gap-2"
                >
                  <span class="text-sm">{{
                    t("settings.workflows.atUTC")
                  }}</span>
                  <Input v-model="draft.timeUTC" type="time" />
                </div>
              </div>

              <div
                v-if="draft.triggerType === 'event'"
                class="flex flex-col gap-3 rounded-4xl border p-3"
              >
                <Field>
                  <FieldLabel>{{
                    t("settings.workflows.eventScope")
                  }}</FieldLabel>
                  <Select v-model="draft.eventScope">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="write">
                          {{ t("settings.workflows.scopeWrite") }}
                        </SelectItem>
                        <SelectItem value="code">
                          {{ t("settings.workflows.scopeCode") }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <div class="flex items-center gap-2">
                  <span class="text-sm">{{
                    t("settings.workflows.debounce")
                  }}</span>
                  <Input
                    v-model.number="draft.debounceMinutes"
                    type="number"
                    min="0"
                    max="1440"
                    class="w-24"
                  />
                  <span class="text-sm">{{
                    t("settings.workflows.minutes")
                  }}</span>
                </div>
              </div>

              <Field>
                <FieldLabel for="wf-target">{{
                  t("settings.workflows.targetScope")
                }}</FieldLabel>
                <Select v-model="draft.targetScope">
                  <SelectTrigger id="wf-target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="write">
                        {{ t("settings.workflows.scopeWrite") }}
                      </SelectItem>
                      <SelectItem value="code">
                        {{ t("settings.workflows.scopeCode") }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>{{
                  t("settings.workflows.contextNodes")
                }}</FieldLabel>
                <FieldDescription>
                  {{ t("settings.workflows.contextNodesHint") }}
                </FieldDescription>
                <div
                  v-for="(n, i) in draft.contextNodes"
                  :key="`${n.scope}:${n.nodeId}`"
                  class="flex items-center justify-between rounded-4xl border px-2 py-1 text-sm"
                >
                  <span class="truncate">{{ n.scope }} / {{ n.nodeId }}</span>
                  <Button variant="ghost" @click="removeContextNode(i)">
                    {{ t("settings.workflows.remove") }}
                  </Button>
                </div>
                <div class="flex items-center gap-2">
                  <Select v-model="ctxScope">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="code">code</SelectItem>
                        <SelectItem value="write">write</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Input
                    v-model="ctxNodeId"
                    :placeholder="
                      t('settings.workflows.contextNodeIdPlaceholder')
                    "
                    class="grow"
                    @keydown.enter.prevent="addContextNode"
                  />
                  <Button variant="outline" @click="addContextNode">
                    {{ t("settings.workflows.add") }}
                  </Button>
                </div>
              </Field>

              <Field>
                <FieldLabel for="wf-mode">{{
                  t("settings.workflows.updateMode")
                }}</FieldLabel>
                <Select v-model="draft.updateMode">
                  <SelectTrigger id="wf-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="require_review">
                        {{ t("settings.workflows.modeReviewOpt") }}
                      </SelectItem>
                      <SelectItem value="automatic">
                        {{ t("settings.workflows.modeAutomaticOpt") }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {{
                    draft.updateMode === "automatic"
                      ? t("settings.workflows.modeAutomaticHint")
                      : t("settings.workflows.modeReviewHint")
                  }}
                </FieldDescription>
              </Field>

              <!-- ── Connections access (P3) ─────────────────────────── -->
              <Field>
                <FieldLabel for="wf-acts-as">
                  {{ t("settings.workflows.connectionsLabel") }}
                </FieldLabel>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm">
                    {{ t("settings.workflows.connectionsToggle") }}
                  </span>
                  <Switch
                    id="wf-acts-as"
                    :model-value="actsAsBindingOn"
                    @update:model-value="(v) => handleToggleActsAs(Boolean(v))"
                  />
                </div>
                <FieldDescription>
                  {{ t("settings.workflows.connectionsHint") }}
                </FieldDescription>
                <!-- Bound by ANOTHER member: their consented grant powers
                     runs; toggling replaces it with yours, off revokes. -->
                <FieldDescription v-if="actsAsIsOther">
                  {{
                    t("settings.workflows.connectionsOther", {
                      name:
                        actsAsOtherName ||
                        t("settings.workflows.connectionsOtherFallback"),
                    })
                  }}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </ScrollContainer>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isSaving"
          @click="emit('update:open', false)"
        >
          {{ t("settings.workflows.cancel") }}
          <Kbd>Esc</Kbd>
        </Button>
        <Button data-dialog-action :disabled="!canSave" @click="handleSave">
          <Spinner v-if="isSaving" />
          {{ t("settings.workflows.save") }}
          <Kbd>↩</Kbd>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { generateTeamCustomToolConfig } from "@/composables/useFunctions"
import { useTeamCustomTools } from "@/composables/useTeamCustomTools"
import {
  IconAlertTriangle,
  IconCirclePlus,
  IconSparkles,
  IconTrash,
} from "@/data/icons"
import { botAgentBounds, botModels } from "@/helpers/defaults"
import { emitter } from "@/modules/mitt"
import { useAuthStore } from "@/stores/authStore"
import type {
  ICustomToolAction,
  ICustomToolField,
  ITeamCustomTool,
} from "@/types/domain"
import { storeToRefs } from "pinia"
import { onBeforeUnmount, onMounted } from "vue"
import Avatar from "vue-boring-avatars"

const { t } = useI18n()

/**
 * Literal interpolation marker shown to admins in hint copy
 * ("Use {{fieldName}} to …"). Defined as a script-side constant
 * rather than inlined into the template because Vue's compiler scans
 * templates for `{{ … }}` delimiters lexically — embedding the
 * literal inside a template expression makes the parser match the
 * inner `}}` as the end of the surrounding interpolation, producing
 * TS1005 ("`:` expected") errors. Routing the literal through an
 * identifier sidesteps the issue entirely (Vue never sees the braces
 * in the template source).
 */
const FIELD_INTERPOLATION_EXAMPLE = "{{fieldName}}"

/**
 * JSON-shaped example shown as the placeholder for a `constant`-kind
 * tool's value field. Lives here for the same reason as
 * `FIELD_INTERPOLATION_EXAMPLE`: any locale string containing `{ …` is
 * re-parsed by Vue I18n's message compiler, which then chokes on the
 * `"ok":` inside as an invalid placeholder token (error code 2).
 * Routed through a `{example}` named param so the literal never lands
 * in the JSON locale file.
 */
const CONSTANT_VALUE_EXAMPLE = '{ "ok": true }'

/**
 * Custom Tools editor dialog — create / edit a single team-scoped
 * Genkit tool. Mirrors `SettingsCustomAgents.vue`'s layout:
 *
 *   DialogHeader (title + optional lifecycle badge)
 *   → OverlayScrollbarsWrapper > FieldGroup (p-6)
 *     ├ FieldSet ........... identity (name / displayName / description / avatarSeed)
 *     ├ FieldSeparator
 *     ├ FieldSet ........... input schema (field list)
 *     ├ FieldSeparator
 *     ├ FieldSet ........... output schema (field list)
 *     ├ FieldSeparator
 *     └ FieldSet ........... action (kind picker + per-kind sub-form)
 *   → DialogFooter (Cancel + Save)
 *
 * Form state lives here (not in a separate row component) — the
 * dialog footer's Save needs to know about every field, and the per-
 * kind action sub-forms share state with the rest of the editor.
 *
 * Mounted globally in `app.vue` (sibling of `SettingsCustomAgents`),
 * opened via the `Dialog.CustomTools.Open` mitt event. Payload:
 *   - `"new"` / undefined — create flow.
 *   - `{ toolId }` — edit that tool.
 */

const messagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  createSuccess: t("settings.agents.customTools.createSuccess"),
  createError: t("settings.agents.customTools.createError"),
  updateSuccess: t("settings.agents.customTools.updateSuccess"),
  updateError: t("settings.agents.customTools.updateError"),
})

const {
  selectableTools,
  disabledTools,
  archivedTools,
  isSaving,
  canManage,
  create,
  update,
} = useTeamCustomTools(messagesGetter)

const bounds = botAgentBounds.customTool

// ── Dialog state ────────────────────────────────────────────────────────────

const open = ref(false)
const editingToolId = ref<string | null>(null)

const editingTool = computed<ITeamCustomTool | null>(() => {
  const id = editingToolId.value
  if (!id) return null
  return (
    selectableTools.value.find((t) => t.id === id) ??
    disabledTools.value.find((t) => t.id === id) ??
    archivedTools.value.find((t) => t.id === id) ??
    null
  )
})

const isNew = computed(() => editingTool.value === null)

const dialogTitle = computed<string>(() =>
  editingTool.value
    ? t("settings.agents.customTools.editorTitleEdit", {
        name: editingTool.value.displayName || editingTool.value.name,
      })
    : t("settings.agents.customTools.editorTitleNew")
)

const statusBadgeKey = computed<"disabled" | "archived" | null>(() => {
  const tool = editingTool.value
  if (!tool) return null
  if (tool.enabled === false) return "disabled"
  if (tool.archivedAt) return "archived"
  return null
})

// ── Draft state ─────────────────────────────────────────────────────────────

interface ToolDraft {
  name: string
  displayName: string
  description: string
  avatarSeed: string
  inputSchema: { fields: ICustomToolField[] }
  outputSchema: { fields: ICustomToolField[] }
  action: ICustomToolAction
}

const DEFAULT_DRAFT: ToolDraft = {
  name: "",
  displayName: "",
  description:
    "Describe when the model should call this tool and what it does.",
  avatarSeed: "",
  inputSchema: { fields: [] },
  outputSchema: { fields: [] },
  action: { kind: "constant", value: '{ "ok": true }' },
}

const cloneDraft = (source: ITeamCustomTool | null): ToolDraft => {
  if (!source) {
    return {
      ...DEFAULT_DRAFT,
      inputSchema: {
        fields: DEFAULT_DRAFT.inputSchema.fields.map((f) => ({ ...f })),
      },
      outputSchema: {
        fields: DEFAULT_DRAFT.outputSchema.fields.map((f) => ({ ...f })),
      },
      action: { ...DEFAULT_DRAFT.action },
    }
  }
  return {
    name: source.name,
    displayName: source.displayName,
    description: source.description,
    avatarSeed: source.avatarSeed,
    inputSchema: {
      fields: source.inputSchema.fields.map((f) => ({ ...f })),
    },
    outputSchema: {
      fields: source.outputSchema.fields.map((f) => ({ ...f })),
    },
    action: cloneAction(source.action),
  }
}

function cloneAction(action: ICustomToolAction): ICustomToolAction {
  switch (action.kind) {
    case "httpWebhook":
      return {
        kind: "httpWebhook",
        url: action.url,
        method: action.method,
        headers: action.headers.map((h) => ({ ...h })),
        bodyTemplate: action.bodyTemplate,
        maxResponseBytes: action.maxResponseBytes,
        timeoutMs: action.timeoutMs,
      }
    case "constant":
      return { kind: "constant", value: action.value }
    case "promptTemplate":
      return {
        kind: "promptTemplate",
        prompt: action.prompt,
        model: action.model,
      }
    case "workspaceSearch":
      return {
        kind: "workspaceSearch",
        scope: action.scope,
        defaultLimit: action.defaultLimit,
        filterHint: action.filterHint,
      }
  }
}

const draft = ref<ToolDraft>(cloneDraft(null))

const effectiveAvatarSeed = computed(
  () => draft.value.avatarSeed.trim() || draft.value.name.trim() || "Tool"
)

const isDirty = computed(() => {
  if (isNew.value) {
    return draft.value.name.trim().length > 0
  }
  if (!editingTool.value) return false
  return (
    JSON.stringify(draft.value) !==
    JSON.stringify(cloneDraft(editingTool.value))
  )
})

watch(
  editingTool,
  (next) => {
    if (!isDirty.value) draft.value = cloneDraft(next)
  },
  { deep: true }
)

const canSave = computed(() => {
  if (!canManage.value || isSaving.value) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.description.trim()) return false
  if (!isDirty.value) return false
  return true
})

// ── Field editors ──────────────────────────────────────────────────────────

/**
 * Push a fresh field onto either inputSchema or outputSchema. Defaults
 * to `string` (most common) and required=true so the model sees a
 * mandatory parameter — admins can flip later.
 */
const addField = (target: "inputSchema" | "outputSchema"): void => {
  const list = draft.value[target].fields
  if (list.length >= bounds.fieldsMax) return
  list.push({
    name: "",
    type: "string",
    description: "",
    required: true,
  })
}

const removeField = (
  target: "inputSchema" | "outputSchema",
  index: number
): void => {
  draft.value[target].fields.splice(index, 1)
}

// ── Action kind picker ─────────────────────────────────────────────────────

const actionKinds = [
  "httpWebhook",
  "constant",
  "promptTemplate",
  "workspaceSearch",
] as const

/**
 * Swap to a different action kind, preserving as much as possible
 * across kinds. The shape differs per kind so we reset to that kind's
 * defaults rather than try to deep-merge; admins re-entering fields
 * is preferable to silently dropping data.
 */
const setActionKind = (kind: ICustomToolAction["kind"]): void => {
  switch (kind) {
    case "httpWebhook":
      draft.value.action = {
        kind: "httpWebhook",
        url: "",
        method: "POST",
        headers: [],
        bodyTemplate: "",
        maxResponseBytes: bounds.httpResponseBytes.default,
        timeoutMs: bounds.httpTimeoutMs.default,
      }
      break
    case "constant":
      draft.value.action = { kind: "constant", value: '{ "ok": true }' }
      break
    case "promptTemplate":
      draft.value.action = {
        kind: "promptTemplate",
        prompt: "",
        model: null,
      }
      break
    case "workspaceSearch":
      draft.value.action = {
        kind: "workspaceSearch",
        scope: null,
        defaultLimit: bounds.workspaceSearchLimit.default,
        filterHint: "",
      }
      break
  }
}

const addHttpHeader = (): void => {
  if (draft.value.action.kind !== "httpWebhook") return
  draft.value.action.headers.push({ name: "", value: "" })
}

const removeHttpHeader = (index: number): void => {
  if (draft.value.action.kind !== "httpWebhook") return
  draft.value.action.headers.splice(index, 1)
}

// ── AI generation (Prompt tab) ──────────────────────────────────────────────
//
// Mirror of the agent editor's Prompt tab: an admin describes the tool in
// plain English and the model drafts the full configuration straight into
// `draft` (the single source of truth the Configure tab edits, the preview
// renders, and Save persists). The server clamps every string and coerces
// names to valid identifiers, so the generated draft is always saveable.

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
 * edit mode (the draft already mirrors a saved tool) and, in create mode,
 * once the first generation lands.
 */
const showPreview = computed(() => !isNew.value || hasGenerated.value)

/** Translated label for the draft action's kind — drives the preview badge. */
const actionKindLabel = computed<string>(() =>
  t(`settings.agents.customTools.action.kinds.${draft.value.action.kind}`)
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
    const { data } = await generateTeamCustomToolConfig({ teamId, prompt })
    // Replace the whole draft. The server returns a fully normalized config
    // (valid identifier name, clamped strings, discriminated-union action),
    // so it drops straight in. Clone the nested arrays/objects so the draft
    // doesn't share references with the response payload.
    draft.value = {
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      avatarSeed: data.avatarSeed,
      inputSchema: {
        fields: data.inputSchema.fields.map((field) => ({ ...field })),
      },
      outputSchema: {
        fields: data.outputSchema.fields.map((field) => ({ ...field })),
      },
      action: cloneAction(data.action),
    }
    generatedModel.value = data.model
    hasGenerated.value = true
  } catch (error) {
    console.error("[SettingsCustomTools] failed to generate config:", error)
    generateError.value = t("settings.agents.customTools.ai.generateError")
  } finally {
    isGenerating.value = false
  }
}

// ── External event channel ─────────────────────────────────────────────────

type OpenPayload = { toolId?: string } | "new" | undefined

const handleOpenEvent = (event: unknown): void => {
  const payload = event as OpenPayload
  let toolId: string | null = null
  if (
    payload &&
    typeof payload === "object" &&
    typeof payload.toolId === "string" &&
    payload.toolId.length > 0
  ) {
    toolId = payload.toolId
  }
  editingToolId.value = toolId
  draft.value = cloneDraft(editingTool.value)
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
  emitter.on("Dialog.CustomTools.Open", handleOpenEvent)
})
onBeforeUnmount(() => {
  emitter.off("Dialog.CustomTools.Open", handleOpenEvent)
})

// ── Save handler ───────────────────────────────────────────────────────────

const handleEditorSave = async (): Promise<void> => {
  if (!canSave.value) return
  const target = editingTool.value
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
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden overscroll-none"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          {{ dialogTitle }}
          <Badge v-if="statusBadgeKey === 'disabled'" variant="outline">
            {{ t("settings.agents.customTools.disabledBadge") }}
          </Badge>
          <Badge v-else-if="statusBadgeKey === 'archived'" variant="outline">
            {{ t("settings.agents.customTools.archivedBadge") }}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {{ t("settings.agents.customTools.sectionDescription") }}
        </DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeTab" class="min-h-0">
        <TabsList class="self-start">
          <TabsTrigger value="prompt">
            <IconSparkles />
            {{ t("settings.agents.customTools.ai.tabPrompt") }}
          </TabsTrigger>
          <TabsTrigger value="configure">
            {{ t("settings.agents.customTools.ai.tabConfigure") }}
          </TabsTrigger>
        </TabsList>

        <!-- ── Prompt tab — split view: input (left) + live preview (right) ── -->
        <TabsContent value="prompt" class="min-h-0">
          <div
            class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <!-- Left: prompt input. "Prompt only has the textarea + Generate". -->
            <div class="flex min-h-0 flex-col gap-3">
              <div class="flex flex-col gap-1">
                <Label
                  :for="`tool-ai-prompt-${editingTool?.id ?? 'new'}`"
                  class="text-sm font-medium"
                >
                  {{ t("settings.agents.customTools.ai.promptLabel") }}
                </Label>
                <p class="text-muted-foreground text-xs">
                  {{ t("settings.agents.customTools.ai.promptDescription") }}
                </p>
              </div>
              <Textarea
                :id="`tool-ai-prompt-${editingTool?.id ?? 'new'}`"
                v-model="aiPrompt"
                :placeholder="
                  t('settings.agents.customTools.ai.promptPlaceholder')
                "
                :maxlength="AI_PROMPT_MAX"
                :disabled="!canManage || isGenerating"
                class="min-h-40 flex-1 resize-none"
              />
              <p
                v-if="generateError"
                class="text-destructive flex items-center gap-1.5 text-xs"
              >
                <IconAlertTriangle class="size-3.5 shrink-0" />
                {{ generateError }}
              </p>
              <div class="flex items-center gap-2">
                <Button :disabled="!canGenerate" @click="handleGenerate">
                  <Spinner v-if="isGenerating" />
                  <IconSparkles v-else />
                  {{
                    isGenerating
                      ? t("settings.agents.customTools.ai.generating")
                      : hasGenerated
                        ? t("settings.agents.customTools.ai.regenerate")
                        : t("settings.agents.customTools.ai.generate")
                  }}
                </Button>
                <span
                  v-if="generatedModel && !isGenerating"
                  class="text-muted-foreground truncate text-xs"
                >
                  {{
                    t("settings.agents.customTools.ai.generatedBy", {
                      model: generatedModel,
                    })
                  }}
                </span>
              </div>
            </div>

            <!-- Right: read-only "anticipated configuration" rendered from draft. -->
            <div
              class="bg-muted/30 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border"
            >
              <div class="shrink-0 border-b px-4 py-2.5">
                <span class="text-sm font-medium">
                  {{ t("settings.agents.customTools.ai.previewTitle") }}
                </span>
              </div>
              <div
                v-if="!showPreview"
                class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
              >
                <IconSparkles class="text-muted-foreground size-7" />
                <p class="text-sm font-medium">
                  {{ t("settings.agents.customTools.ai.previewEmptyTitle") }}
                </p>
                <p class="text-muted-foreground max-w-xs text-xs">
                  {{ t("settings.agents.customTools.ai.previewEmptyHint") }}
                </p>
              </div>
              <OverlayScrollbarsWrapper v-else class="min-h-0 flex-1">
                <div class="flex flex-col gap-4 p-4">
                  <!-- Identity (avatar + display name + wire name) -->
                  <div class="flex items-center gap-3">
                    <div class="size-10 shrink-0 overflow-hidden rounded-full">
                      <Avatar
                        variant="marble"
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
                        {{ draft.displayName || draft.name || "—" }}
                      </p>
                      <p
                        v-if="draft.name"
                        class="text-muted-foreground truncate font-mono text-xs"
                      >
                        {{ draft.name }}
                      </p>
                    </div>
                  </div>

                  <!-- Description -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.agents.customTools.description.label") }}
                    </span>
                    <p class="text-foreground/90 text-xs whitespace-pre-wrap">
                      {{
                        draft.description ||
                        t("settings.agents.customTools.ai.previewNoDescription")
                      }}
                    </p>
                  </div>

                  <!-- Inputs -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.agents.customTools.ai.previewInputs") }}
                    </span>
                    <div
                      v-if="draft.inputSchema.fields.length > 0"
                      class="flex flex-col gap-1.5"
                    >
                      <div
                        v-for="(field, index) in draft.inputSchema.fields"
                        :key="`prev-in-${index}`"
                        class="bg-background rounded-md border p-2 text-xs"
                      >
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="font-mono font-medium">
                            {{ field.name || "—" }}
                          </span>
                          <Badge variant="outline" class="font-normal">
                            {{ field.type }}
                          </Badge>
                          <Badge
                            v-if="field.required"
                            variant="secondary"
                            class="font-normal"
                          >
                            {{
                              t("settings.agents.customTools.field.required")
                            }}
                          </Badge>
                        </div>
                        <p
                          v-if="field.description"
                          class="text-muted-foreground mt-0.5"
                        >
                          {{ field.description }}
                        </p>
                      </div>
                    </div>
                    <p v-else class="text-muted-foreground text-xs italic">
                      {{ t("settings.agents.customTools.ai.previewNoFields") }}
                    </p>
                  </div>

                  <!-- Outputs -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.agents.customTools.ai.previewOutputs") }}
                    </span>
                    <div
                      v-if="draft.outputSchema.fields.length > 0"
                      class="flex flex-col gap-1.5"
                    >
                      <div
                        v-for="(field, index) in draft.outputSchema.fields"
                        :key="`prev-out-${index}`"
                        class="bg-background rounded-md border p-2 text-xs"
                      >
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="font-mono font-medium">
                            {{ field.name || "—" }}
                          </span>
                          <Badge variant="outline" class="font-normal">
                            {{ field.type }}
                          </Badge>
                          <Badge
                            v-if="field.required"
                            variant="secondary"
                            class="font-normal"
                          >
                            {{
                              t("settings.agents.customTools.field.required")
                            }}
                          </Badge>
                        </div>
                        <p
                          v-if="field.description"
                          class="text-muted-foreground mt-0.5"
                        >
                          {{ field.description }}
                        </p>
                      </div>
                    </div>
                    <p v-else class="text-muted-foreground text-xs italic">
                      {{ t("settings.agents.customTools.ai.previewNoFields") }}
                    </p>
                  </div>

                  <!-- Action -->
                  <div class="flex flex-col gap-1.5">
                    <span
                      class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t("settings.agents.customTools.ai.previewAction") }}
                    </span>
                    <div>
                      <Badge variant="secondary" class="font-normal">
                        {{ actionKindLabel }}
                      </Badge>
                    </div>
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
                    <FieldLabel :for="`tool-name-${editingTool?.id ?? 'new'}`">
                      {{ t("settings.agents.customTools.name.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{ t("settings.agents.customTools.name.description") }}
                    </FieldDescription>
                  </FieldContent>
                  <Input
                    :id="`tool-name-${editingTool?.id ?? 'new'}`"
                    v-model="draft.name"
                    :placeholder="
                      t('settings.agents.customTools.name.placeholder')
                    "
                    :maxlength="bounds.name.max"
                    :disabled="!canManage"
                    class="font-mono"
                  />
                </Field>

                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel
                      :for="`tool-display-name-${editingTool?.id ?? 'new'}`"
                    >
                      {{ t("settings.agents.customTools.displayName.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{
                        t("settings.agents.customTools.displayName.description")
                      }}
                    </FieldDescription>
                  </FieldContent>
                  <Input
                    :id="`tool-display-name-${editingTool?.id ?? 'new'}`"
                    v-model="draft.displayName"
                    :placeholder="
                      t('settings.agents.customTools.displayName.placeholder')
                    "
                    :maxlength="bounds.displayName.max"
                    :disabled="!canManage"
                  />
                </Field>

                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel
                      :for="`tool-description-${editingTool?.id ?? 'new'}`"
                    >
                      {{ t("settings.agents.customTools.description.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{
                        t("settings.agents.customTools.description.description")
                      }}
                    </FieldDescription>
                  </FieldContent>
                  <Textarea
                    :id="`tool-description-${editingTool?.id ?? 'new'}`"
                    v-model="draft.description"
                    :placeholder="
                      t('settings.agents.customTools.description.placeholder')
                    "
                    :maxlength="bounds.description.max"
                    :disabled="!canManage"
                    rows="3"
                  />
                </Field>

                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel
                      :for="`tool-avatar-seed-${editingTool?.id ?? 'new'}`"
                    >
                      {{ t("settings.agents.customTools.avatarSeed.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{
                        t("settings.agents.customTools.avatarSeed.description")
                      }}
                    </FieldDescription>
                  </FieldContent>
                  <div class="flex items-center gap-3">
                    <div class="size-10 shrink-0 overflow-hidden rounded-full">
                      <Avatar
                        variant="marble"
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
                      :id="`tool-avatar-seed-${editingTool?.id ?? 'new'}`"
                      v-model="draft.avatarSeed"
                      :placeholder="
                        t('settings.agents.customTools.avatarSeed.placeholder')
                      "
                      :maxlength="bounds.avatarSeed.max"
                      :disabled="!canManage"
                      class="flex-1"
                    />
                  </div>
                </Field>
              </FieldSet>

              <FieldSeparator />

              <!-- ── Input schema ──────────────────────────────────────────── -->
              <FieldSet>
                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel>
                      {{ t("settings.agents.customTools.input.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{ t("settings.agents.customTools.input.description") }}
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <p
                  v-if="draft.inputSchema.fields.length === 0"
                  class="text-muted-foreground text-xs italic"
                >
                  {{ t("settings.agents.customTools.input.emptyHint") }}
                </p>

                <div
                  v-for="(field, index) in draft.inputSchema.fields"
                  :key="`in-${index}`"
                  class="bg-muted/40 grid gap-2 rounded-md border p-3"
                >
                  <div class="grid grid-cols-12 gap-2">
                    <Input
                      v-model="field.name"
                      :placeholder="
                        t('settings.agents.customTools.field.namePlaceholder')
                      "
                      :maxlength="bounds.fieldName.max"
                      :disabled="!canManage"
                      class="col-span-5 font-mono"
                    />
                    <Select v-model="field.type" :disabled="!canManage">
                      <SelectTrigger class="col-span-3 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">string</SelectItem>
                        <SelectItem value="number">number</SelectItem>
                        <SelectItem value="boolean">boolean</SelectItem>
                      </SelectContent>
                    </Select>
                    <div class="col-span-3 flex items-center gap-2">
                      <Switch
                        :id="`in-required-${index}`"
                        v-model="field.required"
                        :disabled="!canManage"
                      />
                      <Label :for="`in-required-${index}`" class="text-xs">
                        {{ t("settings.agents.customTools.field.required") }}
                      </Label>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="col-span-1 justify-self-end"
                      :disabled="!canManage"
                      @click="removeField('inputSchema', index)"
                    >
                      <IconTrash />
                    </Button>
                  </div>
                  <Input
                    v-model="field.description"
                    :placeholder="
                      t(
                        'settings.agents.customTools.field.descriptionPlaceholder'
                      )
                    "
                    :maxlength="bounds.fieldDescription.max"
                    :disabled="!canManage"
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  :disabled="
                    !canManage ||
                    draft.inputSchema.fields.length >= bounds.fieldsMax
                  "
                  @click="addField('inputSchema')"
                >
                  <IconCirclePlus />
                  {{ t("settings.agents.customTools.input.addField") }}
                </Button>
              </FieldSet>

              <FieldSeparator />

              <!-- ── Output schema ─────────────────────────────────────────── -->
              <FieldSet>
                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel>
                      {{ t("settings.agents.customTools.output.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{ t("settings.agents.customTools.output.description") }}
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <p
                  v-if="draft.outputSchema.fields.length === 0"
                  class="text-muted-foreground text-xs italic"
                >
                  {{ t("settings.agents.customTools.output.emptyHint") }}
                </p>

                <div
                  v-for="(field, index) in draft.outputSchema.fields"
                  :key="`out-${index}`"
                  class="bg-muted/40 grid gap-2 rounded-md border p-3"
                >
                  <div class="grid grid-cols-12 gap-2">
                    <Input
                      v-model="field.name"
                      :placeholder="
                        t('settings.agents.customTools.field.namePlaceholder')
                      "
                      :maxlength="bounds.fieldName.max"
                      :disabled="!canManage"
                      class="col-span-5 font-mono"
                    />
                    <Select v-model="field.type" :disabled="!canManage">
                      <SelectTrigger class="col-span-3 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">string</SelectItem>
                        <SelectItem value="number">number</SelectItem>
                        <SelectItem value="boolean">boolean</SelectItem>
                      </SelectContent>
                    </Select>
                    <div class="col-span-3 flex items-center gap-2">
                      <Switch
                        :id="`out-required-${index}`"
                        v-model="field.required"
                        :disabled="!canManage"
                      />
                      <Label :for="`out-required-${index}`" class="text-xs">
                        {{ t("settings.agents.customTools.field.required") }}
                      </Label>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="col-span-1 justify-self-end"
                      :disabled="!canManage"
                      @click="removeField('outputSchema', index)"
                    >
                      <IconTrash />
                    </Button>
                  </div>
                  <Input
                    v-model="field.description"
                    :placeholder="
                      t(
                        'settings.agents.customTools.field.descriptionPlaceholder'
                      )
                    "
                    :maxlength="bounds.fieldDescription.max"
                    :disabled="!canManage"
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  :disabled="
                    !canManage ||
                    draft.outputSchema.fields.length >= bounds.fieldsMax
                  "
                  @click="addField('outputSchema')"
                >
                  <IconCirclePlus />
                  {{ t("settings.agents.customTools.output.addField") }}
                </Button>
              </FieldSet>

              <FieldSeparator />

              <!-- ── Action (kind picker + per-kind sub-form) ──────────────── -->
              <FieldSet>
                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel>
                      {{ t("settings.agents.customTools.action.label") }}
                    </FieldLabel>
                    <FieldDescription>
                      {{ t("settings.agents.customTools.action.description") }}
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Field orientation="vertical">
                  <FieldContent>
                    <FieldLabel>
                      {{ t("settings.agents.customTools.action.kind") }}
                    </FieldLabel>
                  </FieldContent>
                  <Select
                    :model-value="draft.action.kind"
                    :disabled="!canManage"
                    @update:model-value="
                      (value) =>
                        setActionKind(
                          (value ?? 'constant') as (typeof actionKinds)[number]
                        )
                    "
                  >
                    <SelectTrigger class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="kind in actionKinds"
                        :key="kind"
                        :value="kind"
                      >
                        <div class="flex flex-col items-start gap-0.5">
                          <span>
                            {{
                              t(
                                `settings.agents.customTools.action.kinds.${kind}`
                              )
                            }}
                          </span>
                          <span class="text-muted-foreground text-xs">
                            {{
                              t(
                                `settings.agents.customTools.action.kindDescriptions.${kind}`
                              )
                            }}
                          </span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <!-- HTTP webhook sub-form -->
                <template v-if="draft.action.kind === 'httpWebhook'">
                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.url"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      v-model="draft.action.url"
                      :placeholder="
                        t(
                          'settings.agents.customTools.action.httpWebhook.urlPlaceholder'
                        )
                      "
                      :maxlength="bounds.httpUrl.max"
                      :disabled="!canManage"
                    />
                  </Field>

                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.method"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Select
                      v-model="draft.action.method"
                      :disabled="!canManage"
                    >
                      <SelectTrigger class="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.headers"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <div
                      v-for="(header, index) in draft.action.headers"
                      :key="`hdr-${index}`"
                      class="grid grid-cols-12 gap-2"
                    >
                      <Input
                        v-model="header.name"
                        :placeholder="
                          t(
                            'settings.agents.customTools.action.httpWebhook.headerName'
                          )
                        "
                        :maxlength="bounds.httpHeaderName.max"
                        :disabled="!canManage"
                        class="col-span-4 font-mono"
                      />
                      <Input
                        v-model="header.value"
                        :placeholder="
                          t(
                            'settings.agents.customTools.action.httpWebhook.headerValue'
                          )
                        "
                        :maxlength="bounds.httpHeaderValue.max"
                        :disabled="!canManage"
                        class="col-span-7"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        class="col-span-1 justify-self-end"
                        :disabled="!canManage"
                        @click="removeHttpHeader(index)"
                      >
                        <IconTrash />
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="!canManage"
                      @click="addHttpHeader"
                    >
                      <IconCirclePlus />
                      {{
                        t(
                          "settings.agents.customTools.action.httpWebhook.headers"
                        )
                      }}
                    </Button>
                  </Field>

                  <!-- Body template — own Field, own bodyHint, own Textarea. -->
                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.bodyTemplate"
                          )
                        }}
                      </FieldLabel>
                      <FieldDescription>
                        <!--
                      `{syntax}` is a Vue I18n named param bound to the
                      script-side `FIELD_INTERPOLATION_EXAMPLE` constant
                      (the literal double-brace marker). Inlining the
                      literal in the template would make Vue's parser
                      match the inner closing braces as the end of this
                      interpolation (TS1005); baking it into the locale
                      string would trip the i18n compiler's nested-
                      placeholder check (error code 9). The indirection
                      serves both layers.
                    -->
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.bodyTemplateHint",
                            { syntax: FIELD_INTERPOLATION_EXAMPLE }
                          )
                        }}
                      </FieldDescription>
                    </FieldContent>
                    <Textarea
                      v-model="draft.action.bodyTemplate"
                      :maxlength="bounds.httpBody.max"
                      :disabled="!canManage"
                      rows="4"
                      class="font-mono text-xs"
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.timeoutMs"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      v-model.number="draft.action.timeoutMs"
                      type="number"
                      :min="bounds.httpTimeoutMs.min"
                      :max="bounds.httpTimeoutMs.max"
                      :step="bounds.httpTimeoutMs.step"
                      :disabled="!canManage"
                      class="w-40"
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.httpWebhook.maxResponseBytes"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      v-model.number="draft.action.maxResponseBytes"
                      type="number"
                      :min="bounds.httpResponseBytes.min"
                      :max="bounds.httpResponseBytes.max"
                      :step="bounds.httpResponseBytes.step"
                      :disabled="!canManage"
                      class="w-40"
                    />
                  </Field>
                </template>

                <!-- Constant sub-form -->
                <template v-else-if="draft.action.kind === 'constant'">
                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t("settings.agents.customTools.action.constant.value")
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Textarea
                      v-model="draft.action.value"
                      :placeholder="
                        t(
                          'settings.agents.customTools.action.constant.valuePlaceholder',
                          { example: CONSTANT_VALUE_EXAMPLE }
                        )
                      "
                      :maxlength="bounds.constantValue.max"
                      :disabled="!canManage"
                      rows="4"
                      class="font-mono text-xs"
                    />
                  </Field>
                </template>

                <!-- Prompt template sub-form -->
                <template v-else-if="draft.action.kind === 'promptTemplate'">
                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.promptTemplate.prompt"
                          )
                        }}
                      </FieldLabel>
                      <FieldDescription>
                        <!-- See the bodyTemplateHint above for why this is an indirection. -->
                        {{
                          t(
                            "settings.agents.customTools.action.promptTemplate.promptHint",
                            { syntax: FIELD_INTERPOLATION_EXAMPLE }
                          )
                        }}
                      </FieldDescription>
                    </FieldContent>
                    <Textarea
                      v-model="draft.action.prompt"
                      :maxlength="bounds.promptTemplate.max"
                      :disabled="!canManage"
                      rows="6"
                    />
                  </Field>

                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.promptTemplate.model"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Select
                      :model-value="draft.action.model ?? '__follow__'"
                      :disabled="!canManage"
                      @update:model-value="
                        (value) => {
                          if (draft.action.kind !== 'promptTemplate') return
                          draft.action.model =
                            value === '__follow__' || !value
                              ? null
                              : (value as (typeof botModels)[number]['id'])
                        }
                      "
                    >
                      <SelectTrigger class="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__follow__">
                          {{
                            t(
                              "settings.agents.customTools.action.promptTemplate.modelNone"
                            )
                          }}
                        </SelectItem>
                        <SelectSeparator />
                        <SelectItem
                          v-for="model in botModels"
                          :key="model.id"
                          :value="model.id"
                        >
                          {{ model.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </template>

                <!-- Workspace search sub-form -->
                <template v-else-if="draft.action.kind === 'workspaceSearch'">
                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.workspaceSearch.scope"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Select
                      :model-value="draft.action.scope ?? '__any__'"
                      :disabled="!canManage"
                      @update:model-value="
                        (value) => {
                          if (draft.action.kind !== 'workspaceSearch') return
                          draft.action.scope =
                            value === '__any__' || !value
                              ? null
                              : (value as 'code' | 'write')
                        }
                      "
                    >
                      <SelectTrigger class="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">
                          {{
                            t(
                              "settings.agents.customTools.action.workspaceSearch.scopeAny"
                            )
                          }}
                        </SelectItem>
                        <SelectItem value="code">
                          {{
                            t(
                              "settings.agents.customTools.action.workspaceSearch.scopeCode"
                            )
                          }}
                        </SelectItem>
                        <SelectItem value="write">
                          {{
                            t(
                              "settings.agents.customTools.action.workspaceSearch.scopeWrite"
                            )
                          }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.workspaceSearch.defaultLimit"
                          )
                        }}
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      v-model.number="draft.action.defaultLimit"
                      type="number"
                      :min="bounds.workspaceSearchLimit.min"
                      :max="bounds.workspaceSearchLimit.max"
                      :step="bounds.workspaceSearchLimit.step"
                      :disabled="!canManage"
                      class="w-32"
                    />
                  </Field>

                  <Field orientation="vertical">
                    <FieldContent>
                      <FieldLabel>
                        {{
                          t(
                            "settings.agents.customTools.action.workspaceSearch.filterHint"
                          )
                        }}
                      </FieldLabel>
                      <FieldDescription>
                        {{
                          t(
                            "settings.agents.customTools.action.workspaceSearch.filterHintHelp"
                          )
                        }}
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      v-model="draft.action.filterHint"
                      :maxlength="bounds.workspaceSearchFilter.max"
                      :disabled="!canManage"
                    />
                  </Field>
                </template>
              </FieldSet>
            </FieldGroup>
          </OverlayScrollbarsWrapper>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isSaving">
            {{ t("common.cancel") }}
          </Button>
        </DialogClose>
        <Button :disabled="!canSave || isSaving" @click="handleEditorSave">
          <Spinner v-if="isSaving" />
          {{
            isNew ? t("settings.agents.customTools.create") : t("common.save")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

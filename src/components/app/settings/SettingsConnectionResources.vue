<script setup lang="ts">
import { useConnectionStatus } from "@/composables/useConnectionStatus"
import { useIntegrations } from "@/composables/useIntegrations"
import { CONNECTION_APPS } from "@/data/connectionApps"
import { IconBot, IconSettings, IconWorkflow, IconWrench } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import { computed, ref } from "vue"

const props = defineProps<{
  type: "agent" | "tool" | "workflow"
  canManage: boolean
  workflowRows?: {
    id: string
    name: string
    description: string
    enabled: boolean
    pending: boolean
    canConfigure: boolean
  }[]
}>()
const emit = defineEmits<{
  toggleWorkflow: [key: string, enabled: boolean]
  configureWorkflow: [key: string]
}>()
const { t } = useI18n()
const status = useConnectionStatus(true)
const store = useIntegrationsStore()
const { setEnabled } = useIntegrations()
const pending = ref(new Set<string>())
const rows = computed(() =>
  props.type === "workflow"
    ? (props.workflowRows ?? [])
    : store.integrations
        .filter(
          (i) =>
            i.type === props.type && i.source === "published" && i.installed
        )
        .map((i) => ({
          id: i.sourceKey ?? i.id,
          name: i.name,
          description: i.description,
          enabled: i.enabled,
          pending: pending.value.has(i.id),
          canConfigure: false,
        }))
)
const icon = computed(() =>
  props.type === "agent"
    ? IconBot
    : props.type === "workflow"
      ? IconWorkflow
      : IconWrench
)
const providerName = (key: string) =>
  CONNECTION_APPS.find(
    (app) => app.provider === status.providerFor(props.type, key)
  )?.name ?? ""
const toggle = async (id: string, enabled: boolean): Promise<void> => {
  if (props.type === "workflow") {
    emit("toggleWorkflow", id, enabled)
    return
  }
  if (pending.value.has(id)) return
  pending.value = new Set([...pending.value, id])
  try {
    await setEnabled({ type: props.type, sourceKey: id }, enabled)
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}
</script>

<template>
  <FieldSet>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>{{
          t(`settings.connectionResources.${type}Title`)
        }}</FieldLabel>
        <FieldDescription>{{
          t("settings.connectionResources.description")
        }}</FieldDescription>
      </FieldContent>
      <Button
        variant="outline"
        @click="emitter.emit('Dialog.Settings.Open', 'connections')"
      >
        <IconSettings data-icon="inline-start" />
        {{ t("settings.connectionResources.manage") }}
      </Button>
    </Field>
    <LoadingState v-if="status.isLoading.value || store.isLoading" />
    <p
      v-else-if="status.error.value || store.loadError"
      role="alert"
      class="text-destructive"
    >
      {{ status.error.value?.message ?? store.loadError }}
    </p>
    <template v-else>
      <Field v-for="row in rows" :key="row.id" orientation="horizontal">
        <FieldContent>
          <FieldLabel :for="`connection-${type}-${row.id}`">
            {{ row.name }}
            <Badge variant="outline">{{ providerName(row.id) }}</Badge>
            <Badge v-if="status.disabled(type, row.id)" variant="outline">
              {{ t("settings.agents.tools.disabledForTeam") }}
            </Badge>
            <Badge
              v-else-if="status.accountStatus(type, row.id)"
              variant="outline"
            >
              {{
                t(
                  `settings.connectionResources.account.${status.accountStatus(type, row.id)}`
                )
              }}
            </Badge>
          </FieldLabel>
          <FieldDescription>{{ row.description }}</FieldDescription>
          <FieldDescription v-if="status.accountStatus(type, row.id)">
            {{ t("settings.connectionResources.accountHint") }}
          </FieldDescription>
        </FieldContent>
        <div class="flex items-center gap-1">
          <TooltipProvider v-if="type === 'workflow'">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="
                    !canManage ||
                    !row.canConfigure ||
                    row.pending ||
                    status.disabled(type, row.id)
                  "
                  :aria-label="t('settings.workflows.configure')"
                  @click="emit('configureWorkflow', row.id)"
                >
                  <IconSettings />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{{
                t("settings.workflows.configure")
              }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch
            :id="`connection-${type}-${row.id}`"
            :model-value="row.enabled"
            :disabled="
              !canManage || row.pending || status.disabled(type, row.id)
            "
            @update:model-value="(value) => toggle(row.id, Boolean(value))"
          />
        </div>
      </Field>
      <Empty v-if="rows.length === 0" class="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Component :is="icon" /></EmptyMedia>
          <EmptyTitle>{{
            t(`settings.connectionResources.${type}Empty`)
          }}</EmptyTitle>
          <EmptyDescription>{{
            t("settings.connectionResources.emptyDescription")
          }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </template>
  </FieldSet>
</template>

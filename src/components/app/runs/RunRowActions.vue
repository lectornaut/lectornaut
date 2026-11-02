<script lang="ts" setup>
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { IconCheck, IconRepeat, IconTrash2, IconX } from "@/data/icons"
import type { IWorkflowRun } from "@/types/domain"
import { computed, ref } from "vue"

const props = defineProps<{ run: IWorkflowRun }>()

const { t } = useI18n()
const { canManage, workflows, reviewRun, runNow, removeRun } =
  useTeamWorkflows()

const isReview = computed(() => props.run.status === "awaiting_review")
/** "Run again" re-fires the parent workflow — only possible if it still exists. */
const workflowExists = computed(() =>
  workflows.value.some((w) => w.id === props.run.workflowId)
)

const busy = ref(false)
const deleteConfirmOpen = ref(false)
const rejectConfirmOpen = ref(false)

/** Serialize actions + swallow rejections (the composable already toasts). */
const wrap = async (fn: () => Promise<unknown>): Promise<void> => {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
  } catch {
    /* surfaced via toast in useTeamWorkflows */
  } finally {
    busy.value = false
  }
}

/**
 * Confirmed actions: hold the row lock but RETHROW (the composable already
 * toasts) so ConfirmAction stays open on failure and closes only on success.
 */
const locked = async (fn: () => Promise<unknown>): Promise<void> => {
  busy.value = true
  try {
    await fn()
  } finally {
    busy.value = false
  }
}

const onApprove = (): Promise<void> =>
  wrap(() => reviewRun(props.run.id, "approve"))
// Reject cancels the run and discards its staged edits for good (the server
// moves it to `cancelled`; it can't return to review), so it confirms first.
const onReject = (): Promise<void> =>
  locked(() => reviewRun(props.run.id, "reject"))
const onRunAgain = (): Promise<void> => wrap(() => runNow(props.run.workflowId))
const onDelete = (): Promise<void> => locked(() => removeRun(props.run.id))
</script>

<template>
  <div class="flex justify-end">
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <DataTableRowActionsButton
                :disabled="!canManage || busy"
                :loading="busy"
                :label="t('settings.workflows.actions')"
                :title="t('actions.moreOptions')"
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ t("actions.moreOptions") }}</TooltipContent>
          <DropdownMenuContent align="end" class="w-44">
            <template v-if="isReview">
              <DropdownMenuItem
                :disabled="!canManage || busy"
                data-hotkey="a"
                @click="onApprove"
              >
                <IconCheck />
                {{ t("settings.workflows.approve") }}
                <DropdownMenuShortcut>A</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                :disabled="!canManage || busy"
                data-hotkey="x"
                @click="rejectConfirmOpen = true"
              >
                <IconX />
                {{ t("settings.workflows.reject") }}
                <DropdownMenuShortcut>X</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </template>

            <DropdownMenuItem
              :disabled="!canManage || busy || !workflowExists"
              data-hotkey="r"
              @click="onRunAgain"
            >
              <IconRepeat />
              {{ t("settings.workflows.runAgain") }}
              <DropdownMenuShortcut>R</DropdownMenuShortcut>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              :disabled="!canManage || busy"
              data-hotkey="backspace delete"
              @click="deleteConfirmOpen = true"
            >
              <IconTrash2 />
              {{ t("settings.workflows.deleteRun") }}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>

    <ConfirmAction
      v-model:open="rejectConfirmOpen"
      :title="t('settings.workflows.rejectConfirmTitle')"
      :description="t('settings.workflows.rejectConfirmBody')"
      :action-label="t('settings.workflows.reject')"
      destructive
      :on-confirm="onReject"
    />

    <ConfirmAction
      v-model:open="deleteConfirmOpen"
      :title="t('settings.workflows.deleteRunConfirmTitle')"
      :description="t('settings.workflows.confirmDeleteRun')"
      :action-label="t('actions.delete')"
      destructive
      :on-confirm="onDelete"
    />
  </div>
</template>

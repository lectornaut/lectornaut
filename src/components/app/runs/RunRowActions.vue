<script lang="ts" setup>
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import {
  IconCheck,
  IconEllipsis,
  IconRepeat,
  IconTrash2,
  IconX,
} from "@/data/icons"
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
const confirmOpen = ref(false)

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

const onApprove = (): Promise<void> =>
  wrap(() => reviewRun(props.run.id, "approve"))
const onReject = (): Promise<void> =>
  wrap(() => reviewRun(props.run.id, "reject"))
const onRunAgain = (): Promise<void> => wrap(() => runNow(props.run.workflowId))
const onDelete = (): Promise<void> => wrap(() => removeRun(props.run.id))
</script>

<template>
  <div class="flex justify-end">
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                class="data-[state=open]:bg-accent"
                :disabled="!canManage"
                :title="t('actions.moreOptions')"
                @click.stop
              >
                <IconEllipsis />
                <span class="sr-only">{{
                  t("settings.workflows.actions")
                }}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ t("actions.moreOptions") }}</TooltipContent>
          <DropdownMenuContent align="end" class="w-44">
            <template v-if="isReview">
              <DropdownMenuItem
                :disabled="!canManage || busy"
                @click="onApprove"
              >
                <IconCheck />
                {{ t("settings.workflows.approve") }}
              </DropdownMenuItem>
              <DropdownMenuItem
                :disabled="!canManage || busy"
                @click="onReject"
              >
                <IconX />
                {{ t("settings.workflows.reject") }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </template>

            <DropdownMenuItem
              :disabled="!canManage || busy || !workflowExists"
              @click="onRunAgain"
            >
              <IconRepeat />
              {{ t("settings.workflows.runAgain") }}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              :disabled="!canManage || busy"
              @click="confirmOpen = true"
            >
              <IconTrash2 />
              {{ t("settings.workflows.deleteRun") }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>

    <AlertDialog v-model:open="confirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.workflows.deleteRun") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("settings.workflows.confirmDeleteRun") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("actions.cancel") }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="onDelete">
            {{ t("actions.delete") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

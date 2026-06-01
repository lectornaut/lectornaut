<script lang="ts" setup>
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { runStatusLabel, runStatusTextClass } from "@/data/workflowRunConstants"
import type { IWorkflowRun } from "@/types/domain"
import { computed } from "vue"

const props = defineProps<{ run: IWorkflowRun }>()

const { t } = useI18n()
const { canManage, reviewRun } = useTeamWorkflows()

const isReview = computed(() => props.run.status === "awaiting_review")

const fmtWhen = (ts: unknown): string =>
  (ts as { toDate?: () => Date })?.toDate?.()?.toLocaleString?.() ?? "—"

const usage = computed(() => props.run.usage ?? null)
const changes = computed(() => props.run.changes ?? [])
</script>

<template>
  <div class="flex items-center justify-end gap-1">
    <template v-if="isReview && canManage">
      <Button size="sm" variant="outline" @click="reviewRun(run.id, 'approve')">
        {{ t("settings.workflows.approve") }}
      </Button>
      <Button size="sm" variant="ghost" @click="reviewRun(run.id, 'reject')">
        {{ t("settings.workflows.reject") }}
      </Button>
    </template>

    <Popover>
      <PopoverTrigger as-child>
        <Button size="sm" variant="ghost">
          {{ t("settings.workflows.details") }}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        class="max-h-[28rem] w-96 overflow-y-auto text-sm"
      >
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span :class="runStatusTextClass(run.status)" class="font-medium">
              {{ runStatusLabel(run.status) }}
            </span>
            <span class="text-muted-foreground text-xs">
              {{ fmtWhen(run.queuedAt) }}
            </span>
          </div>

          <div
            v-if="usage"
            class="text-muted-foreground flex flex-wrap gap-x-3 text-xs"
          >
            <span v-if="usage.model">{{ usage.model }}</span>
            <span
              >{{
                (
                  (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
                ).toLocaleString()
              }}
              {{ t("settings.workflows.tokensWord") }}</span
            >
            <span>${{ (usage.estimatedCostUsd ?? 0).toFixed(4) }}</span>
          </div>

          <div v-if="changes.length > 0" class="flex flex-col gap-1">
            <span class="text-xs font-medium">
              {{ t("settings.workflows.changesWord") }} ({{ changes.length }})
            </span>
            <div class="overflow-hidden rounded-md border">
              <div
                v-for="(c, i) in changes"
                :key="i"
                class="flex items-start gap-2 border-b px-2 py-1.5 last:border-b-0"
              >
                <span
                  class="bg-muted shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase"
                  >{{ c.op }}</span
                >
                <span class="grow">
                  {{ c.summary }}
                  <span class="text-muted-foreground"
                    >({{ c.scope
                    }}<template v-if="c.nodeId">/{{ c.nodeId }}</template
                    >)</span
                  >
                  <span
                    v-if="c.sourceNodeId"
                    class="text-muted-foreground block text-[11px]"
                  >
                    {{
                      t("settings.workflows.citedFrom", { id: c.sourceNodeId })
                    }}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <p v-if="run.replyPreview" class="text-muted-foreground text-xs">
            {{ run.replyPreview }}
          </p>
          <p v-if="run.error" class="text-xs text-red-600 dark:text-red-400">
            {{ run.error }}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>

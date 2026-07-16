<script lang="ts" setup>
import { runStatusDotClass, runStatusLabel } from "@/data/workflowRunConstants"
import {
  IconArchive,
  IconBan,
  IconCircleCheck,
  IconMoreHorizontal,
  IconPencil,
  IconPlay,
  IconRotateCcw,
  IconTrash2,
} from "@/data/icons"
import type { IWorkflow } from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { computed } from "vue"

const props = defineProps<{
  workflow: IWorkflow
  isActive: boolean
  canManage: boolean
  isArchived?: boolean
}>()

const emit = defineEmits<{
  select: []
  runNow: []
  edit: []
  toggleEnabled: [enabled: boolean]
  archive: []
  restore: []
  remove: []
}>()

const { t } = useI18n()

const isCustom = computed(() => !props.workflow.presetKey)

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const minuteToTime = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`

const triggerSummary = computed<string>(() => {
  const tr = props.workflow.trigger
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
})

const lastRun = computed<string>(() => {
  const v = props.workflow.lastRunAt
  if (!(v instanceof Timestamp)) return ""
  const date = v.toDate()
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
})

const dotClass = computed(() =>
  props.workflow.lastRunStatus
    ? runStatusDotClass(props.workflow.lastRunStatus)
    : "bg-muted-foreground/40"
)

const toggleIcon = computed(() =>
  props.workflow.enabled ? IconBan : IconCircleCheck
)
</script>

<template>
  <SidebarMenuItem class="group/wf relative">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <SidebarMenuButton
          :is-active="isActive"
          class="h-auto items-start gap-2 py-2 pr-8"
          @click="emit('select')"
        >
          <span class="mt-1.5 size-1.5 shrink-0 rounded-md" :class="dotClass" />
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="flex items-center gap-2">
              <span class="truncate text-sm">{{ workflow.name }}</span>
              <Badge
                v-if="!workflow.enabled"
                variant="outline"
                class="shrink-0"
              >
                {{ t("settings.workflows.disabled") }}
              </Badge>
            </span>
            <span class="text-muted-foreground line-clamp-1 text-xs">
              {{ triggerSummary }}
              <template v-if="workflow.lastRunStatus">
                ·
                {{ runStatusLabel(workflow.lastRunStatus) }}
              </template>
            </span>
          </span>
          <span v-if="lastRun" class="text-muted-foreground shrink-0 text-xs">
            {{ lastRun }}
          </span>
        </SidebarMenuButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <template v-if="!isArchived">
          <ContextMenuItem :disabled="!canManage" @click="emit('runNow')">
            <IconPlay />
            {{ t("settings.workflows.runNow") }}
          </ContextMenuItem>
          <ContextMenuItem :disabled="!canManage" @click="emit('edit')">
            <IconPencil />
            {{ t("settings.workflows.edit") }}
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="!canManage"
            @click="emit('toggleEnabled', !workflow.enabled)"
          >
            <Component :is="toggleIcon" />
            {{
              workflow.enabled
                ? t("settings.workflows.disableAction")
                : t("settings.workflows.enableAction")
            }}
          </ContextMenuItem>
          <template v-if="isCustom">
            <ContextMenuSeparator />
            <ContextMenuItem :disabled="!canManage" @click="emit('archive')">
              <IconArchive />
              {{ t("settings.workflows.archive") }}
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              :disabled="!canManage"
              @click="emit('remove')"
            >
              <IconTrash2 />
              {{ t("settings.workflows.delete") }}
            </ContextMenuItem>
          </template>
        </template>
        <template v-else>
          <ContextMenuItem :disabled="!canManage" @click="emit('restore')">
            <IconRotateCcw />
            {{ t("settings.workflows.restore") }}
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            :disabled="!canManage"
            @click="emit('remove')"
          >
            <IconTrash2 />
            {{ t("settings.workflows.delete") }}
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                class="absolute top-2 right-2 opacity-0 group-hover/wf:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                @click.stop
              >
                <IconMoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ t("settings.workflows.actions") }}</TooltipContent>
          <DropdownMenuContent align="end" class="w-44">
            <template v-if="!isArchived">
              <DropdownMenuItem
                :disabled="!canManage"
                data-hotkey="r"
                @click="emit('runNow')"
              >
                <IconPlay />
                {{ t("settings.workflows.runNow") }}
                <DropdownMenuShortcut>R</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                :disabled="!canManage"
                data-hotkey="e"
                @click="emit('edit')"
              >
                <IconPencil />
                {{ t("settings.workflows.edit") }}
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                :disabled="!canManage"
                @click="emit('toggleEnabled', !workflow.enabled)"
              >
                <Component :is="toggleIcon" />
                {{
                  workflow.enabled
                    ? t("settings.workflows.disableAction")
                    : t("settings.workflows.enableAction")
                }}
              </DropdownMenuItem>
              <template v-if="isCustom">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  :disabled="!canManage"
                  data-hotkey="a"
                  @click="emit('archive')"
                >
                  <IconArchive />
                  {{ t("settings.workflows.archive") }}
                  <DropdownMenuShortcut>A</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  :disabled="!canManage"
                  data-hotkey="backspace delete"
                  @click="emit('remove')"
                >
                  <IconTrash2 />
                  {{ t("settings.workflows.delete") }}
                  <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
                </DropdownMenuItem>
              </template>
            </template>
            <template v-else>
              <DropdownMenuItem
                :disabled="!canManage"
                data-hotkey="a"
                @click="emit('restore')"
              >
                <IconRotateCcw />
                {{ t("settings.workflows.restore") }}
                <DropdownMenuShortcut>A</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                :disabled="!canManage"
                data-hotkey="backspace delete"
                @click="emit('remove')"
              >
                <IconTrash2 />
                {{ t("settings.workflows.delete") }}
                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
              </DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  </SidebarMenuItem>
</template>

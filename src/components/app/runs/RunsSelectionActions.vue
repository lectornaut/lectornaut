<script lang="ts" setup>
import type { RunRow } from "@/components/app/runs/runColumns"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { IconCheck, IconSquareX, IconTrash2, IconX } from "@/data/icons"
import type { Row, Table } from "@tanstack/vue-table"
import { computed, ref } from "vue"

// Bulk actions for the runs DataTable's footer selection chip — the runs-table
// counterpart to RunRowActions. Rendered inside `DropdownMenuContent` via the
// shared `#selection-actions` slot, so it emits menu items only (no wrapper).
//
// The slot content unmounts when the footer dropdown closes, so the destructive
// confirm uses `window.confirm` (synchronous, survives unmount) rather than an
// AlertDialog whose state would be torn down with the menu. The mutations are
// detached callables that toast globally, so an in-flight bulk op finishes even
// if this component unmounts; `clear()` acts on the parent-owned table ref.
const props = defineProps<{
  table: Table<RunRow>
  rows: Row<RunRow>[]
  count: number
}>()

const { t } = useI18n()
const { canManage, reviewRun, removeRun } = useTeamWorkflows()

const runs = computed(() => props.rows.map((r) => r.original))
// Approve/Reject only apply to runs awaiting review — operate on that subset and
// surface its size so a mixed selection makes clear how many will be affected.
const reviewable = computed(() =>
  runs.value.filter((r) => r.status === "awaiting_review")
)
const hasReviewable = computed(() => reviewable.value.length > 0)

const busy = ref(false)
const clear = () => props.table.resetRowSelection()

/** Serialize a mutation across ids; per-item errors are swallowed (the
 *  composable toasts each one), then the selection is cleared. */
const runSerial = async (
  ids: string[],
  fn: (id: string) => Promise<unknown>
): Promise<void> => {
  if (busy.value || ids.length === 0) return
  busy.value = true
  try {
    for (const id of ids) {
      try {
        await fn(id)
      } catch {
        /* surfaced via toast in useTeamWorkflows */
      }
    }
    clear()
  } finally {
    busy.value = false
  }
}

const onApprove = (): Promise<void> =>
  runSerial(
    reviewable.value.map((r) => r.id),
    (id) => reviewRun(id, "approve")
  )
const onReject = (): Promise<void> =>
  runSerial(
    reviewable.value.map((r) => r.id),
    (id) => reviewRun(id, "reject")
  )
const onDelete = (): void => {
  const ids = runs.value.map((r) => r.id)
  if (ids.length === 0) return
  const message =
    ids.length === 1
      ? t("settings.workflows.confirmDeleteRun")
      : t("settings.workflows.confirmDeleteRuns", { n: ids.length })
  if (typeof window !== "undefined" && !window.confirm(message)) return
  void runSerial(ids, (id) => removeRun(id))
}
</script>

<template>
  <DropdownMenuLabel class="text-muted-foreground tabular-nums">
    {{ t("components.dataTable.selectedCount", { count }) }}
  </DropdownMenuLabel>
  <DropdownMenuSeparator />

  <template v-if="hasReviewable">
    <DropdownMenuItem
      :disabled="!canManage || busy"
      data-hotkey="a"
      @click="onApprove"
    >
      <IconCheck />
      {{ t("settings.workflows.approve") }}
      <DropdownMenuShortcut class="tabular-nums">
        {{ reviewable.length }}
      </DropdownMenuShortcut>
      <DropdownMenuShortcut class="ml-0">A</DropdownMenuShortcut>
    </DropdownMenuItem>
    <DropdownMenuItem
      :disabled="!canManage || busy"
      data-hotkey="x"
      @click="onReject"
    >
      <IconX />
      {{ t("settings.workflows.reject") }}
      <DropdownMenuShortcut class="tabular-nums">
        {{ reviewable.length }}
      </DropdownMenuShortcut>
      <DropdownMenuShortcut class="ml-0">X</DropdownMenuShortcut>
    </DropdownMenuItem>
    <DropdownMenuSeparator />
  </template>

  <DropdownMenuItem
    variant="destructive"
    :disabled="!canManage || busy"
    data-hotkey="backspace delete"
    @click="onDelete"
  >
    <IconTrash2 />
    {{ t("actions.delete") }}
    <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
  </DropdownMenuItem>

  <DropdownMenuSeparator />

  <DropdownMenuItem :disabled="busy" data-hotkey="c" @click="clear">
    <IconSquareX />
    {{ t("components.dataTable.clearSelection") }}
    <DropdownMenuShortcut>C</DropdownMenuShortcut>
  </DropdownMenuItem>
</template>

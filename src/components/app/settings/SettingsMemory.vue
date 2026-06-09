<script lang="ts" setup>
import SettingsMemoryRowActions from "@/components/app/settings/SettingsMemoryRowActions.vue"
import DataTableColumnHeader from "@/components/table/DataTableColumnHeader.vue"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { useMemories } from "@/composables/useMemories"
import {
  IconAlertTriangle,
  IconArchive,
  IconLock,
  IconPin,
  IconPlus,
  IconRotateCcw,
  IconSparkles,
  IconTrash2,
  IconUsers,
  IconX,
} from "@/data/icons"
import type {
  IMemory,
  IMemoryCategory,
  IMemoryVisibility,
} from "@/schemas/memory"
import { useAuthStore } from "@/stores/authStore"
import { MEMORY_CATEGORIES } from "@lectornaut/shared/domain"
import type { Column, ColumnDef, Table as VueTable } from "@tanstack/vue-table"
import { Timestamp } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, h, reactive, ref } from "vue"
import { toast } from "vue-sonner"

const { t } = useI18n()

const {
  memories,
  isLoading,
  canManage,
  canPurge,
  memoryEnabled,
  isMutating,
  create,
  update,
  remove,
  setArchived,
  setPinned,
  setShared,
  purgeAll,
} = useMemories()

const { currentUser } = storeToRefs(useAuthStore())
const myUid = computed(() => currentUser.value?.uid ?? null)

// ── Formatting helpers ───────────────────────────────────────────────────────

const tsMillis = (value: IMemory["updatedAt"]): number =>
  value instanceof Timestamp ? value.toMillis() : 0

const formatRelative = (ts: number): string => {
  if (!ts) return "—"
  const diffMin = Math.floor((Date.now() - ts) / 60_000)
  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return useDateFormat(new Date(ts), "MMM D, YYYY").value
}

const categoryLabel = (c: IMemoryCategory): string =>
  t(`settings.memory.category.${c}`)

const visibilityLabel = (v: IMemoryVisibility): string =>
  v === "shared"
    ? t("settings.memory.visibilityShared")
    : t("settings.memory.visibilityPrivate")

// Importance is stored 0–100; the UI exposes 3 presets + pin (spec §15.4).
type ImportanceLevel = "low" | "normal" | "high"
const levelToValue: Record<ImportanceLevel, number> = {
  low: 25,
  normal: 50,
  high: 75,
}
const valueToLevel = (value: number): ImportanceLevel =>
  value <= 33 ? "low" : value <= 66 ? "normal" : "high"
const importanceLabel = (value: number): string =>
  t(`settings.memory.importance.${valueToLevel(value)}`)

// ── Filter option lists ──────────────────────────────────────────────────────

const visibilityOptions = computed(() => [
  {
    label: t("settings.memory.visibilityPrivate"),
    value: "private",
    icon: IconLock,
  },
  {
    label: t("settings.memory.visibilityShared"),
    value: "shared",
    icon: IconUsers,
  },
])

const categoryOptions = computed(() =>
  MEMORY_CATEGORIES.map((c) => ({ label: categoryLabel(c), value: c }))
)

const statusOptions = computed(() => [
  { label: t("settings.memory.statusActive"), value: "active" },
  {
    label: t("settings.memory.statusArchived"),
    value: "archived",
    icon: IconArchive,
  },
])

const importanceOptions = computed(() => [
  { label: t("settings.memory.importance.low"), value: "low" },
  { label: t("settings.memory.importance.normal"), value: "normal" },
  { label: t("settings.memory.importance.high"), value: "high" },
])

const toUnknownColumn = (column: Column<IMemory, unknown>) =>
  column as Column<unknown, unknown>

const canShareRow = (m: IMemory): boolean =>
  !!myUid.value && m.ownerUid === myUid.value

// ── Create / edit dialog state ───────────────────────────────────────────────

const formOpen = ref(false)
const formMode = ref<"create" | "edit">("create")
const formTarget = ref<IMemory | null>(null)
const form = reactive({
  content: "",
  summary: "",
  category: "context" as IMemoryCategory,
  importance: "normal" as ImportanceLevel,
  tags: "",
  shared: false,
})

const openCreate = () => {
  formMode.value = "create"
  formTarget.value = null
  form.content = ""
  form.summary = ""
  form.category = "context"
  form.importance = "normal"
  form.tags = ""
  form.shared = false
  formOpen.value = true
}

const openEdit = (memory: IMemory) => {
  formMode.value = "edit"
  formTarget.value = memory
  form.content = memory.content
  form.summary = memory.summary ?? ""
  form.category = memory.category
  form.importance = valueToLevel(memory.importance)
  form.tags = (memory.tags ?? []).join(", ")
  form.shared = memory.visibility === "shared"
  formOpen.value = true
}

const parseTags = (raw: string): string[] =>
  raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)

const submitForm = async () => {
  const content = form.content.trim()
  if (!content) return
  const tags = parseTags(form.tags)
  const importance = levelToValue[form.importance]
  const summary = form.summary.trim()

  try {
    if (formMode.value === "create") {
      const id = await create({
        content,
        summary: summary || undefined,
        tags: tags.length ? tags : undefined,
        category: form.category,
        importance,
        visibility: form.shared ? "shared" : "private",
      })
      if (id) toast.success(t("settings.memory.createSuccess"))
    } else if (formTarget.value) {
      await update(formTarget.value.id, {
        content,
        summary,
        tags,
        category: form.category,
        importance,
      })
      toast.success(t("settings.memory.updateSuccess"))
    }
    formOpen.value = false
    formTarget.value = null
  } catch (error) {
    console.error("[SettingsMemory] save failed:", error)
    toast.error(
      formMode.value === "create"
        ? t("settings.memory.createError")
        : t("settings.memory.updateError")
    )
  }
}

// ── Row action handlers ──────────────────────────────────────────────────────

const handleShare = async (memory: IMemory) => {
  try {
    await setShared(memory.id, memory.visibility !== "shared")
  } catch (error) {
    console.error("[SettingsMemory] share failed:", error)
    toast.error(t("settings.memory.updateError"))
  }
}

const handlePin = async (memory: IMemory) => {
  try {
    await setPinned(memory.id, memory.pinned !== true)
  } catch (error) {
    console.error("[SettingsMemory] pin failed:", error)
    toast.error(t("settings.memory.updateError"))
  }
}

const handleArchiveToggle = async (memory: IMemory) => {
  try {
    await setArchived(memory.id, memory.archived !== true)
  } catch (error) {
    console.error("[SettingsMemory] archive failed:", error)
    toast.error(t("settings.memory.updateError"))
  }
}

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IMemory | null>(null)

const openDelete = (memory: IMemory) => {
  deleteTarget.value = memory
  deleteDialogOpen.value = true
}

const submitDelete = async () => {
  const target = deleteTarget.value
  if (!target) return
  try {
    await remove(target.id)
    toast.success(t("settings.memory.deleteSuccess"))
  } catch (error) {
    console.error("[SettingsMemory] delete failed:", error)
    toast.error(t("settings.memory.deleteError"))
  }
  deleteDialogOpen.value = false
  deleteTarget.value = null
}

// ── Columns ──────────────────────────────────────────────────────────────────

const columns = computed<ColumnDef<IMemory>[]>(() => [
  {
    id: "select",
    header: ({ table }) =>
      h(Checkbox, {
        modelValue:
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate"),
        "onUpdate:modelValue": (value: unknown) =>
          table.toggleAllPageRowsSelected(!!value),
        ariaLabel: t("components.dataTable.selectAll"),
        class: "mr-2",
      }),
    cell: ({ row }) =>
      h(Checkbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (value: unknown) => row.toggleSelected(!!value),
        ariaLabel: t("components.dataTable.selectAll"),
        class: "mr-2",
      }),
    enablePinning: true,
    enableSorting: false,
    enableGrouping: false,
    enableHiding: false,
  },
  {
    id: "content",
    accessorFn: (row) => row.summary || row.content,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnContent"),
      }),
    cell: ({ row }) => {
      const m = row.original
      const primary = m.summary || m.content
      return h("div", { class: "flex max-w-md min-w-0 flex-col gap-0.5" }, [
        h("div", { class: "flex min-w-0 items-center gap-1.5" }, [
          m.pinned
            ? h(IconPin, { class: "text-muted-foreground size-3.5 shrink-0" })
            : null,
          m.visibility === "shared"
            ? h(IconUsers, { class: "text-muted-foreground size-3.5 shrink-0" })
            : null,
          h("span", { class: "truncate text-sm font-medium" }, primary),
        ]),
        m.summary
          ? h(
              "span",
              { class: "text-muted-foreground line-clamp-1 text-xs" },
              m.content
            )
          : null,
      ])
    },
    enableSorting: false,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "visibility",
    accessorFn: (row) => row.visibility,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnVisibility"),
      }),
    cell: ({ row }) => {
      const v = row.original.visibility
      return h(Badge, { variant: "outline", class: "gap-1" }, () => [
        h(v === "shared" ? IconUsers : IconLock),
        visibilityLabel(v),
      ])
    },
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.memory.filterVisibility"),
      filterOptions: visibilityOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "category",
    accessorFn: (row) => row.category,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnCategory"),
      }),
    cell: ({ row }) =>
      h(Badge, { variant: "secondary" }, () =>
        categoryLabel(row.original.category)
      ),
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.memory.filterCategory"),
      filterOptions: categoryOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "tags",
    accessorFn: (row) => (row.tags ?? []).join(" "),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnTags"),
      }),
    cell: ({ row }) => {
      const tags = row.original.tags ?? []
      if (tags.length === 0) {
        return h("span", { class: "text-muted-foreground" }, "—")
      }
      const shown = tags.slice(0, 3)
      const extra = tags.length - shown.length
      return h("div", { class: "flex max-w-[12rem] flex-wrap gap-1" }, [
        ...shown.map((tag) =>
          h(Badge, { variant: "outline", class: "max-w-full" }, () =>
            h("span", { class: "truncate" }, tag)
          )
        ),
        extra > 0
          ? h("span", { class: "text-muted-foreground text-xs" }, `+${extra}`)
          : null,
      ])
    },
    enableSorting: false,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "importance",
    accessorFn: (row) => row.importance,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnImportance"),
      }),
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-muted-foreground text-sm" },
        importanceLabel(row.original.importance)
      ),
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(valueToLevel(row.getValue(id) as number))
        : true,
    meta: {
      filterTitle: t("settings.memory.filterImportance"),
      filterOptions: importanceOptions.value,
    },
    enableSorting: true,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "status",
    accessorFn: (row) => (row.archived ? "archived" : "active"),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnStatus"),
      }),
    cell: ({ row }) =>
      row.original.archived
        ? h(Badge, { variant: "secondary", class: "gap-1" }, () => [
            h(IconArchive),
            t("settings.memory.statusArchived"),
          ])
        : h(Badge, { variant: "outline" }, () =>
            t("settings.memory.statusActive")
          ),
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.memory.filterStatus"),
      filterOptions: statusOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "updatedAt",
    accessorFn: (row) => tsMillis(row.updatedAt),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.memory.columnUpdated"),
      }),
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-muted-foreground tabular-nums" },
        formatRelative(tsMillis(row.original.updatedAt))
      ),
    sortingFn: "basic",
    enableSorting: true,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "actions",
    cell: ({ row }) =>
      h(SettingsMemoryRowActions, {
        memory: row.original,
        manageable: canManage.value,
        canShare: canShareRow(row.original),
        editable: memoryEnabled.value,
        onEdit: openEdit,
        onShare: handleShare,
        onPin: handlePin,
        onArchive: handleArchiveToggle,
        onDelete: openDelete,
      }),
    enablePinning: true,
    enableSorting: false,
    enableGrouping: false,
    enableHiding: false,
  },
])

// ── Selection bridge to bulk-actions row ─────────────────────────────────────

interface DataTableExpose {
  table: VueTable<IMemory>
}

const tableRef = ref<DataTableExpose | null>(null)

const selectedRows = computed(() => {
  const table = tableRef.value?.table
  if (!table) return []
  return table.getFilteredSelectedRowModel().rows
})

const selectedMemories = computed(() =>
  selectedRows.value.map((r) => r.original as IMemory)
)

const selectionCount = computed(() => selectedRows.value.length)

const selectionHasActive = computed(() =>
  selectedMemories.value.some((m) => m.archived !== true)
)
const selectionHasArchived = computed(() =>
  selectedMemories.value.some((m) => m.archived === true)
)

const clearSelection = () => tableRef.value?.table.resetRowSelection()

// ── Bulk actions ─────────────────────────────────────────────────────────────

const bulkBusy = ref(false)

const bulkArchive = async (archived: boolean) => {
  if (bulkBusy.value) return
  const targets = selectedMemories.value
    .filter((m) => (archived ? m.archived !== true : m.archived === true))
    .map((m) => m.id)
  if (targets.length === 0) return
  bulkBusy.value = true
  try {
    for (const id of targets) await setArchived(id, archived)
    clearSelection()
  } catch (error) {
    console.error("[SettingsMemory] bulk archive failed:", error)
    toast.error(t("settings.memory.updateError"))
  } finally {
    bulkBusy.value = false
  }
}

const bulkDeleteDialogOpen = ref(false)

const openBulkDelete = () => {
  if (selectedMemories.value.length === 0) return
  bulkDeleteDialogOpen.value = true
}

const submitBulkDelete = async () => {
  if (bulkBusy.value) return
  const targets = selectedMemories.value.map((m) => m.id)
  if (targets.length === 0) {
    bulkDeleteDialogOpen.value = false
    return
  }
  bulkBusy.value = true
  try {
    for (const id of targets) await remove(id)
    bulkDeleteDialogOpen.value = false
    clearSelection()
    toast.success(t("settings.memory.deleteSuccess"))
  } catch (error) {
    console.error("[SettingsMemory] bulk delete failed:", error)
    toast.error(t("settings.memory.deleteError"))
  } finally {
    bulkBusy.value = false
  }
}

// ── Purge all (admin governance) ─────────────────────────────────────────────

const purgeDialogOpen = ref(false)

const submitPurge = async () => {
  if (isMutating.value) return
  try {
    const deleted = await purgeAll()
    purgeDialogOpen.value = false
    clearSelection()
    toast.success(t("settings.memory.purgeSuccess", { count: deleted }))
  } catch (error) {
    console.error("[SettingsMemory] purge failed:", error)
    toast.error(t("settings.memory.purgeError"))
  }
}
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <!-- No-permission gate — mirrors SettingsSessions. Guests (no -->
        <!-- MANAGE_WORKSPACE_CONTENT) can't manage memories. -->
        <Field v-if="!canManage" orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("settings.memory.noPermissionTitle") }}
                </EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.memory.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.memory.memoriesLabel") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.memory.memoriesDescription") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex items-center gap-2">
              <Button
                v-if="canPurge && memories.length > 0"
                size="sm"
                variant="outline"
                :disabled="isMutating"
                @click="purgeDialogOpen = true"
              >
                <IconTrash2 />
                {{ t("settings.memory.purgeAll") }}
              </Button>
              <Button
                size="sm"
                :disabled="!memoryEnabled || isMutating"
                @click="openCreate"
              >
                <IconPlus />
                {{ t("settings.memory.newMemory") }}
              </Button>
            </div>
          </Field>

          <!-- Governance-only banner when the master toggle is off. -->
          <Field v-if="!memoryEnabled" orientation="horizontal">
            <FieldContent>
              <Empty class="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconSparkles />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ t("settings.memory.disabledTitle") }}
                  </EmptyTitle>
                  <EmptyDescription>
                    {{ t("settings.memory.disabledDescription") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <LoadingState
                v-if="isLoading && memories.length === 0"
                :label="$t('common.loading')"
              />
              <Empty
                v-else-if="memories.length === 0"
                class="border border-dashed"
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconSparkles />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ t("settings.memory.emptyTitle") }}
                  </EmptyTitle>
                  <EmptyDescription>
                    {{ t("settings.memory.emptyDescription") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              <DataTable
                v-else
                ref="tableRef"
                :data="memories"
                :columns="columns"
                :column-pinning="{ left: ['select'], right: ['actions'] }"
                class="overflow-clip rounded-xl border"
              >
                <template #selection-actions>
                  <DropdownMenuLabel class="text-muted-foreground tabular-nums">
                    {{
                      t("settings.memory.selectedCount", {
                        count: selectionCount,
                      })
                    }}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    v-if="selectionHasActive"
                    :disabled="bulkBusy || isMutating"
                    @click="bulkArchive(true)"
                  >
                    <IconArchive />
                    {{ t("settings.memory.bulkArchive") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="selectionHasArchived"
                    :disabled="bulkBusy || isMutating"
                    @click="bulkArchive(false)"
                  >
                    <IconRotateCcw />
                    {{ t("settings.memory.bulkRestore") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    :disabled="bulkBusy || isMutating"
                    @click="openBulkDelete"
                  >
                    <IconTrash2 />
                    {{ t("settings.memory.bulkDelete") }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    :disabled="bulkBusy"
                    @click="clearSelection"
                  >
                    <IconX />
                    {{ t("settings.memory.bulkClear") }}
                  </DropdownMenuItem>
                </template>
              </DataTable>
            </FieldContent>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>

    <!-- Create / edit dialog -->
    <Dialog v-model:open="formOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{
              formMode === "create"
                ? t("settings.memory.createTitle")
                : t("settings.memory.editTitle")
            }}
          </DialogTitle>
          <DialogDescription>
            {{ t("settings.memory.formHint") }}
          </DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitForm">
          <div class="grid gap-2">
            <Label for="memory-content">
              {{ t("settings.memory.fieldContent") }}
            </Label>
            <Textarea
              id="memory-content"
              v-model="form.content"
              :placeholder="t('settings.memory.fieldContentPlaceholder')"
              rows="4"
              :disabled="isMutating"
            />
          </div>

          <div class="grid gap-2">
            <Label for="memory-summary">
              {{ t("settings.memory.fieldSummary") }}
            </Label>
            <Input
              id="memory-summary"
              v-model="form.summary"
              :placeholder="t('settings.memory.fieldSummaryPlaceholder')"
              :disabled="isMutating"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-2">
              <Label for="memory-category">
                {{ t("settings.memory.fieldCategory") }}
              </Label>
              <Select
                id="memory-category"
                v-model="form.category"
                :disabled="isMutating"
              >
                <SelectTrigger>
                  <SelectValue>{{ categoryLabel(form.category) }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="option in categoryOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div class="grid gap-2">
              <Label for="memory-importance">
                {{ t("settings.memory.fieldImportance") }}
              </Label>
              <Select
                id="memory-importance"
                v-model="form.importance"
                :disabled="isMutating"
              >
                <SelectTrigger>
                  <SelectValue>
                    {{ t(`settings.memory.importance.${form.importance}`) }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="option in importanceOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="grid gap-2">
            <Label for="memory-tags">
              {{ t("settings.memory.fieldTags") }}
            </Label>
            <Input
              id="memory-tags"
              v-model="form.tags"
              :placeholder="t('settings.memory.fieldTagsPlaceholder')"
              :disabled="isMutating"
            />
          </div>

          <!-- Visibility is only set at creation; afterwards it's the -->
          <!-- owner-only share/unshare row action. -->
          <Field v-if="formMode === 'create'" orientation="horizontal">
            <FieldContent>
              <FieldLabel for="memory-shared">
                {{ t("settings.memory.fieldShared") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.memory.fieldSharedHint") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="memory-shared"
              :model-value="form.shared"
              :disabled="isMutating"
              @update:model-value="(value) => (form.shared = Boolean(value))"
            />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline" :disabled="isMutating">
              {{ t("actions.cancel") }}
            </Button>
          </DialogClose>
          <Button
            :disabled="isMutating || !form.content.trim()"
            @click="submitForm"
          >
            <Spinner v-if="isMutating" />
            {{ t("actions.save") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Single-row delete confirm -->
    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.memory.deleteTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("settings.memory.deleteConfirm") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isMutating">
            {{ t("actions.cancel") }}
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isMutating"
            @click.prevent="submitDelete"
          >
            <Spinner v-if="isMutating" />
            {{ t("actions.delete") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Bulk delete confirm -->
    <AlertDialog v-model:open="bulkDeleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.memory.bulkDeleteTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span class="text-foreground font-medium">
              {{
                t("settings.memory.selectedCount", { count: selectionCount })
              }}
            </span>
            —
            {{ t("settings.memory.bulkDeleteConfirm") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("actions.cancel") }}
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || selectionCount === 0"
            @click.prevent="submitBulkDelete"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("actions.delete") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Purge-all (admin governance) confirm -->
    <AlertDialog v-model:open="purgeDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.memory.purgeTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("settings.memory.purgeConfirm") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isMutating">
            {{ t("actions.cancel") }}
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isMutating"
            @click.prevent="submitPurge"
          >
            <Spinner v-if="isMutating" />
            {{ t("settings.memory.purgeAll") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

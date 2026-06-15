<script lang="ts" setup>
import DataTableColumnHeader from "@/components/table/DataTableColumnHeader.vue"
import SettingsSessionsRowActions from "@/components/app/settings/SettingsSessionsRowActions.vue"
import AppAvatar from "@/components/app/global/AppAvatar.vue"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import type { BotChatMode } from "@/composables/useFunctions"
import { useWorkspaceBotSessions } from "@/composables/useWorkspaceBotSessions"
import {
  IconAlertTriangle,
  IconArchive,
  IconGlobe,
  IconLock,
  IconMessagesSquare,
  IconRotateCcw,
  IconTrash2,
  IconUsers,
  IconX,
} from "@/data/icons"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IBotSession, IBotSessionVisibility } from "@/types/domain"
import { isUserMembership, type IMembership } from "@/types/membership"
import type { Column, ColumnDef, Table as VueTable } from "@tanstack/vue-table"
import { Timestamp } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, h, ref } from "vue"

const { t } = useI18n()

// ── Data + permission gate ───────────────────────────────────────────────────
//
// `useWorkspaceBotSessions` runs an *unfiltered* `botSessions` query and
// gates everything on `canManage` (team admin/owner via shared
// permissions). Non-admins receive an empty snapshot AND a UI gate —
// belt-and-suspenders against the Firestore rule path returning a
// non-empty list under some future rule edit.
const {
  sessions,
  isLoading,
  isMutating,
  canManage,
  rename: renameSession,
  archive: archiveSession,
  remove: removeSession,
} = useWorkspaceBotSessions()

// Team member directory — used to resolve `ownerUid` to a real name +
// avatar in the Owner column and to populate the Owner faceted filter
// with every workspace member instead of the user-relative
// "You / Shared with you" pair the old view had.
//
// The store exposes `teamMembers` (a flat list); we build a uid-keyed
// Map locally instead of reusing the store's identical computed (which
// isn't part of its public surface).
const { teamMembers } = storeToRefs(useMembershipStore())

// Agent-owned sessions (headless workflow runs) are filtered out upstream in
// `useWorkspaceBotSessions`, so every session reaching this view is a human
// chat (or an owner-less legacy doc). The owner map therefore only needs the
// team's user memberships.
const memberByUid = computed<Map<string, IMembership>>(
  () =>
    new Map(
      teamMembers.value.filter(isUserMembership).map((m) => [m.userId, m])
    )
)

const memberName = (uid: string | undefined): string => {
  const m = uid ? memberByUid.value.get(uid) : undefined
  return (
    m?.user?.displayName ||
    m?.user?.email ||
    t("settings.sessions.ownerUnknown")
  )
}

// ── Formatting helpers ───────────────────────────────────────────────────────

const tsMillis = (
  value: IBotSession["updatedAt"] | IBotSession["createdAt"]
): number => (value instanceof Timestamp ? value.toMillis() : 0)

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

const visibilityIcon = (v: IBotSessionVisibility) => {
  if (v === "shared") return IconUsers
  if (v === "public") return IconGlobe
  return IconLock
}

const visibilityLabel = (v: IBotSessionVisibility): string => {
  if (v === "shared") return t("ai.visibilityShared")
  if (v === "public") return t("ai.visibilityPublic")
  return t("ai.visibilityPrivate")
}

const modeLabel = (m?: BotChatMode | null): string => {
  if (m === "agent") return t("ai.agent")
  if (m === "manual") return t("ai.manual")
  if (m === "auto") return t("ai.auto")
  return "—"
}

// ── Filter option lists ──────────────────────────────────────────────────────

const visibilityOptions = computed(() => [
  { label: t("ai.visibilityPrivate"), value: "private", icon: IconLock },
  { label: t("ai.visibilityShared"), value: "shared", icon: IconUsers },
  { label: t("ai.visibilityPublic"), value: "public", icon: IconGlobe },
])

const modeOptions = computed(() => [
  { label: t("ai.auto"), value: "auto" },
  { label: t("ai.agent"), value: "agent" },
  { label: t("ai.manual"), value: "manual" },
])

const statusOptions = computed(() => [
  { label: t("settings.sessions.statusActive"), value: "active" },
  {
    label: t("settings.sessions.statusArchived"),
    value: "archived",
    icon: IconArchive,
  },
])

const attachmentOptions = computed(() => [
  { label: t("settings.sessions.attachmentYes"), value: "attached" },
  { label: t("settings.sessions.attachmentNo"), value: "standalone" },
])

// Owner filter — one entry per workspace member, sorted alphabetically.
// Populated from the membership store so filter chips match the names
// rendered in the column cell. Sessions whose owner is no longer a
// member (left the team / hard-deleted) collapse to a stable
// "unknown" bucket so admins can still find and clean them up.
const ownerOptions = computed(() => {
  const opts = teamMembers.value
    .filter(isUserMembership)
    .map((m) => ({
      label:
        m.user?.displayName ||
        m.user?.email ||
        t("settings.sessions.ownerUnknown"),
      value: m.userId,
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    )
  return [
    ...opts,
    { label: t("settings.sessions.ownerUnknown"), value: "__unknown__" },
  ]
})

const toUnknownColumn = (column: Column<IBotSession, unknown>) =>
  column as Column<unknown, unknown>

// ── Single-row dialog state ──────────────────────────────────────────────────

const renameDialogOpen = ref(false)
const renameTarget = ref<IBotSession | null>(null)
const renameInput = ref("")

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IBotSession | null>(null)

// ── Row-actions handlers ────────────────────────────────────────────────────

const openRename = (session: IBotSession) => {
  renameTarget.value = session
  renameInput.value = session.title ?? ""
  // Reka-ui's DialogContent autofocuses the first tabbable (the input) on open.
  renameDialogOpen.value = true
}

const handleRowArchiveToggle = (session: IBotSession) => {
  void archiveSession(session.id, !session.archivedAt)
}

const openDelete = (session: IBotSession) => {
  deleteTarget.value = session
  deleteDialogOpen.value = true
}

// ── Columns ──────────────────────────────────────────────────────────────────

const columns = computed<ColumnDef<IBotSession>[]>(() => [
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
    id: "title",
    accessorFn: (row) => row.title || t("ai.untitledSession"),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnTitle"),
      }),
    cell: ({ row }) => {
      const s = row.original
      return h("div", { class: "flex max-w-xs min-w-0 items-center gap-2" }, [
        h(
          "span",
          { class: "truncate font-medium" },
          s.title || t("ai.untitledSession")
        ),
        s.visibility !== "private"
          ? h(visibilityIcon(s.visibility), {
              class: "text-muted-foreground shrink-0",
            })
          : null,
      ])
    },
    enableSorting: true,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "preview",
    accessorFn: (row) => row.preview ?? "",
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnPreview"),
      }),
    cell: ({ row }) =>
      h(
        "span",
        {
          class:
            "text-muted-foreground line-clamp-1 block max-w-md truncate text-sm",
        },
        row.original.preview ?? "—"
      ),
    enableSorting: false,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "status",
    accessorFn: (row) => (row.archivedAt ? "archived" : "active"),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnStatus"),
      }),
    cell: ({ row }) =>
      row.original.archivedAt
        ? h(Badge, { variant: "secondary", class: "gap-1" }, () => [
            h(IconArchive),
            t("settings.sessions.statusArchived"),
          ])
        : h(Badge, { variant: "outline" }, () =>
            t("settings.sessions.statusActive")
          ),
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.sessions.filterStatus"),
      filterOptions: statusOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    // Owner column — resolves ownerUid to the member's display name +
    // avatar from the membership store. accessorFn returns the uid (not
    // the name) so faceted-filter values can match the member options
    // exactly. The cell renders an Item-style avatar + name pair, the
    // same shape SettingsMembers uses, so the two settings pages stay
    // visually consistent.
    id: "owner",
    accessorFn: (row) =>
      row.ownerUid && memberByUid.value.has(row.ownerUid)
        ? row.ownerUid
        : "__unknown__",
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnOwner"),
      }),
    cell: ({ row }) => {
      const uid = row.original.ownerUid
      const member = uid ? memberByUid.value.get(uid) : undefined
      const name = memberName(uid)
      return h("div", { class: "flex min-w-0 items-center gap-2" }, [
        h(AppAvatar, {
          class: "size-6 shrink-0",
          src: member?.user?.photoURL,
          name,
        }),
        h("span", { class: "truncate text-sm" }, name),
      ])
    },
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.sessions.filterOwner"),
      filterOptions: ownerOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "visibility",
    accessorFn: (row) => row.visibility,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnVisibility"),
      }),
    cell: ({ row }) => {
      const v = row.original.visibility
      return h(Badge, { variant: "outline", class: "gap-1" }, () => [
        h(visibilityIcon(v)),
        visibilityLabel(v),
      ])
    },
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.sessions.filterVisibility"),
      filterOptions: visibilityOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "mode",
    accessorFn: (row) => row.lastMode ?? "",
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnMode"),
      }),
    cell: ({ row }) => {
      const m = row.original.lastMode
      return m
        ? h(Badge, { variant: "secondary" }, () => modeLabel(m))
        : h("span", { class: "text-muted-foreground" }, "—")
    },
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.sessions.filterMode"),
      filterOptions: modeOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "attachment",
    accessorFn: (row) => (row.pinnedNodeKey ? "attached" : "standalone"),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnAttachment"),
      }),
    cell: ({ row }) =>
      row.original.pinnedNodeKey
        ? h(Badge, { variant: "outline" }, () =>
            t("settings.sessions.attachmentYes")
          )
        : h(
            "span",
            { class: "text-muted-foreground" },
            t("settings.sessions.attachmentNo")
          ),
    filterFn: (row, id, value: string[]) =>
      Array.isArray(value) && value.length > 0
        ? value.includes(row.getValue(id) as string)
        : true,
    meta: {
      filterTitle: t("settings.sessions.filterAttachment"),
      filterOptions: attachmentOptions.value,
    },
    enableSorting: true,
    enableGrouping: true,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "messages",
    accessorFn: (row) => row.messageCount ?? 0,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnMessages"),
      }),
    cell: ({ row }) =>
      h(
        "span",
        { class: "tabular-nums" },
        String(row.original.messageCount ?? 0)
      ),
    enableSorting: true,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "updatedAt",
    accessorFn: (row) => tsMillis(row.updatedAt),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnUpdated"),
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
    id: "createdAt",
    accessorFn: (row) => tsMillis(row.createdAt),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.sessions.columnCreated"),
      }),
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-muted-foreground tabular-nums" },
        formatRelative(tsMillis(row.original.createdAt))
      ),
    sortingFn: "basic",
    enableSorting: true,
    enableGrouping: false,
    enableHiding: true,
    enablePinning: false,
  },
  // Pinned-right row actions. Admins can act on any row, so we always
  // render the menu (no per-row ownership gate like the old user view).
  {
    id: "actions",
    cell: ({ row }) =>
      h(SettingsSessionsRowActions, {
        session: row.original,
        manageable: true,
        onRename: openRename,
        onArchive: handleRowArchiveToggle,
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
  table: VueTable<IBotSession>
}

const tableRef = ref<DataTableExpose | null>(null)

const selectedRows = computed(() => {
  const table = tableRef.value?.table
  if (!table) return []
  return table.getFilteredSelectedRowModel().rows
})

const selectedSessions = computed(() =>
  selectedRows.value.map((r) => r.original as IBotSession)
)

const selectionCount = computed(() => selectedRows.value.length)

// Admins can mutate any session, so "actionable" == the full selection.
// No per-row ownership filter needed.
const selectionHasActive = computed(() =>
  selectedSessions.value.some((s) => !s.archivedAt)
)
const selectionHasArchived = computed(() =>
  selectedSessions.value.some((s) => !!s.archivedAt)
)

const clearSelection = () => tableRef.value?.table.resetRowSelection()

// ── Bulk actions ─────────────────────────────────────────────────────────────

const bulkBusy = ref(false)

const bulkArchive = async (archived: boolean) => {
  if (bulkBusy.value) return
  const targets = selectedSessions.value
    .filter((s) => (archived ? !s.archivedAt : !!s.archivedAt))
    .map((s) => s.id)
  if (targets.length === 0) return
  bulkBusy.value = true
  try {
    for (const id of targets) {
      await archiveSession(id, archived)
    }
    clearSelection()
  } finally {
    bulkBusy.value = false
  }
}

const bulkDeleteDialogOpen = ref(false)

const openBulkDelete = () => {
  if (selectedSessions.value.length === 0) return
  bulkDeleteDialogOpen.value = true
}

const submitBulkDelete = async () => {
  if (bulkBusy.value) return
  const targets = selectedSessions.value.map((s) => s.id)
  if (targets.length === 0) {
    bulkDeleteDialogOpen.value = false
    return
  }
  bulkBusy.value = true
  try {
    for (const id of targets) {
      await removeSession(id)
    }
    bulkDeleteDialogOpen.value = false
    clearSelection()
  } finally {
    bulkBusy.value = false
  }
}

// ── Single-row dialog submit handlers ────────────────────────────────────────

const submitRename = async () => {
  const target = renameTarget.value
  if (!target) return
  const next = renameInput.value.trim()
  if (!next || next === (target.title ?? "")) {
    renameDialogOpen.value = false
    return
  }
  await renameSession(target.id, next)
  renameDialogOpen.value = false
  renameTarget.value = null
}

const submitDelete = async () => {
  const target = deleteTarget.value
  if (!target) return
  await removeSession(target.id)
  deleteDialogOpen.value = false
  deleteTarget.value = null
}
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <!-- No-permission empty state — mirrors `SettingsLogs.vue`'s gate -->
        <!-- so the two admin-only pages share a UX. The whole data area -->
        <!-- collapses to this empty when the current role lacks -->
        <!-- MANAGE_BOT_SESSIONS. -->
        <Field v-if="!canManage" orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("settings.sessions.noPermissionTitle") }}
                </EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.sessions.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ $t("settings.sessions.sessionsLabel") }}
              </FieldLabel>
              <FieldDescription>
                {{ $t("settings.sessions.sessionsDescription") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <LoadingState
                v-if="isLoading && sessions.length === 0"
                :label="$t('common.loading')"
              />
              <Empty
                v-else-if="sessions.length === 0"
                class="border border-dashed"
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconMessagesSquare />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ t("settings.sessions.emptyTitle") }}
                  </EmptyTitle>
                  <EmptyDescription>
                    {{ t("settings.sessions.emptyDescription") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              <DataTable
                v-else
                ref="tableRef"
                :data="sessions"
                :columns="columns"
                :column-pinning="{ left: ['select'], right: ['actions'] }"
                class="overflow-clip rounded-2xl border"
              >
                <!-- Bulk actions for the footer's selected-count chip. Admins -->
                <!-- can mutate any row, so the whole selection is actionable. -->
                <template #selection-actions>
                  <DropdownMenuLabel class="text-muted-foreground tabular-nums">
                    {{
                      t("settings.sessions.selectedCount", {
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
                    {{ t("settings.sessions.bulkArchive") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="selectionHasArchived"
                    :disabled="bulkBusy || isMutating"
                    @click="bulkArchive(false)"
                  >
                    <IconRotateCcw />
                    {{ t("settings.sessions.bulkRestore") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    :disabled="bulkBusy || isMutating"
                    @click="openBulkDelete"
                  >
                    <IconTrash2 />
                    {{ t("settings.sessions.bulkDelete") }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    :disabled="bulkBusy"
                    @click="clearSelection"
                  >
                    <IconX />
                    {{ t("settings.sessions.bulkClear") }}
                  </DropdownMenuItem>
                </template>
              </DataTable>
            </FieldContent>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>

    <!-- Rename dialog -->
    <Dialog v-model:open="renameDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("ai.renameChat") }}</DialogTitle>
          <DialogDescription>{{ t("ai.renameChatHint") }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-2" @submit.prevent="submitRename">
          <Label for="settings-sessions-rename-input">
            {{ t("ai.chatTitle") }}
          </Label>
          <Input
            id="settings-sessions-rename-input"
            v-model="renameInput"
            :placeholder="t('ai.chatTitlePlaceholder')"
            maxlength="120"
            :disabled="isMutating"
          />
        </form>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline" :disabled="isMutating">
              {{ t("actions.cancel") }}
              <Kbd>Esc</Kbd>
            </Button>
          </DialogClose>
          <Button
            data-dialog-action
            :disabled="isMutating || !renameInput.trim()"
            @click="submitRename"
          >
            <Spinner v-if="isMutating" />
            {{ t("actions.save") }}
            <Kbd>↩</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Single-row delete confirm -->
    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("ai.deleteChatTitle") }}</AlertDialogTitle>
          <AlertDialogDescription>
            <span class="text-foreground font-medium">
              {{ deleteTarget?.title || t("ai.thisChat") }}
            </span>
            {{ t("ai.deleteChatConfirm") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isMutating">
            {{ t("actions.cancel") }}
            <Kbd>Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isMutating"
            @click.prevent="submitDelete"
          >
            <Spinner v-if="isMutating" />
            {{ t("actions.delete") }}
            <Kbd>↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Bulk delete confirm -->
    <AlertDialog v-model:open="bulkDeleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.sessions.bulkDeleteTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span class="text-foreground font-medium">
              {{
                t("settings.sessions.selectedCount", {
                  count: selectionCount,
                })
              }}
            </span>
            —
            {{ t("settings.sessions.bulkDeleteConfirm") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("actions.cancel") }}
            <Kbd>Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || selectionCount === 0"
            @click.prevent="submitBulkDelete"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("actions.delete") }}
            <Kbd>↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

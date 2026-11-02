<script lang="ts" setup>
import { useWorkspaceBotSessions } from "@/composables/useWorkspaceBotSessions"
import { IconAlertTriangle, IconArchive, IconTrash2 } from "@/data/icons"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"
import { toast } from "vue-sonner"

const { t } = useI18n()

// Admin-scoped chat data controls. `useWorkspaceBotSessions` enforces
// the role gate AND runs the unfiltered workspace query, so this page
// can iterate `sessions` directly without re-checking permissions per
// row — the composable's `canManage` gate is the load-bearing check.
const {
  sessions,
  isLoading,
  canManage,
  isMutating,
  archive: archiveSession,
  remove: removeSession,
} = useWorkspaceBotSessions()

const totalCount = computed(() => sessions.value.length)
const activeCount = computed(
  () => sessions.value.filter((s) => !s.archivedAt).length
)

// Workspace-scoped bulk wipe: the typed phrase is the workspace being wiped.
const { currentWorkspace } = storeToRefs(useWorkspaceStore())

const bulkBusy = ref(false)

// Each per-chat call toasts its own failure and returns false; any failure (or
// anything escaping the loop) returns `false` so ConfirmAction stays open.

// ── Archive all team chats ──────────────────────────────────────────────────

const archiveDialogOpen = ref(false)

const openArchiveDialog = () => {
  if (activeCount.value === 0) return
  archiveDialogOpen.value = true
}

const submitArchiveAll = async () => {
  if (bulkBusy.value) return false
  // Snapshot active ids before mutating — the workspace listener
  // updates as each archive lands, which would otherwise reshuffle
  // the iteration target.
  const targets = sessions.value.filter((s) => !s.archivedAt).map((s) => s.id)
  if (targets.length === 0) return
  bulkBusy.value = true
  try {
    let failed = false
    for (const id of targets) {
      if (!(await archiveSession(id, true))) failed = true
    }
    if (failed) return false
  } catch (error) {
    console.error("[SettingsData] bulk archive failed:", error)
    toast.error(t("settings.data.archiveAll.error"))
    return false
  } finally {
    bulkBusy.value = false
  }
}

// ── Delete all team chats ───────────────────────────────────────────────────

const deleteDialogOpen = ref(false)

const openDeleteDialog = () => {
  if (totalCount.value === 0) return
  deleteDialogOpen.value = true
}

const submitDeleteAll = async () => {
  if (bulkBusy.value) return false
  const targets = sessions.value.map((s) => s.id)
  if (targets.length === 0) return
  bulkBusy.value = true
  try {
    let failed = false
    for (const id of targets) {
      if (!(await removeSession(id))) failed = true
    }
    if (failed) return false
  } catch (error) {
    console.error("[SettingsData] bulk delete failed:", error)
    toast.error(t("settings.data.deleteAll.error"))
    return false
  } finally {
    bulkBusy.value = false
  }
}

const isDisabled = computed(() => bulkBusy.value || isMutating.value)
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field v-if="!canManage" orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("settings.data.noPermissionTitle") }}
                </EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.data.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ t("settings.data.label") }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.data.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.data.archiveAll.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.data.archiveAll.description") }}
                <span class="tabular-nums">
                  ·
                  {{ t("settings.data.totalCount", { count: activeCount }) }}
                </span>
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="isDisabled || isLoading || activeCount === 0"
              @click="openArchiveDialog"
            >
              <IconArchive />
              {{ t("settings.data.archiveAll.action") }}
            </Button>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.data.deleteAll.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.data.deleteAll.description") }}
                <span class="tabular-nums">
                  ·
                  {{ t("settings.data.totalCount", { count: totalCount }) }}
                </span>
              </FieldDescription>
            </FieldContent>
            <Button
              variant="destructive"
              :disabled="isDisabled || isLoading || totalCount === 0"
              @click="openDeleteDialog"
            >
              <IconTrash2 />
              {{ t("settings.data.deleteAll.action") }}
            </Button>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>

    <ConfirmAction
      v-model:open="archiveDialogOpen"
      :title="t('settings.data.archiveAll.confirmTitle')"
      :description="
        t('settings.data.archiveAll.confirmBody', { count: activeCount })
      "
      :action-label="t('settings.data.archiveAll.label')"
      :disabled="activeCount === 0"
      :on-confirm="submitArchiveAll"
    />

    <ConfirmAction
      v-model:open="deleteDialogOpen"
      :title="t('settings.data.deleteAll.confirmTitle')"
      :description="
        t('settings.data.deleteAll.confirmBody', { count: totalCount })
      "
      :action-label="t('settings.data.deleteAll.label')"
      destructive
      :confirm-phrase="currentWorkspace?.name"
      :disabled="totalCount === 0"
      :on-confirm="submitDeleteAll"
    />
  </div>
</template>

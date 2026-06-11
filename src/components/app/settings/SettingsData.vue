<script lang="ts" setup>
import { useWorkspaceBotSessions } from "@/composables/useWorkspaceBotSessions"
import { IconAlertTriangle, IconArchive, IconTrash2 } from "@/data/icons"
import { computed, ref } from "vue"

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

const bulkBusy = ref(false)

// ── Archive all team chats ──────────────────────────────────────────────────

const archiveDialogOpen = ref(false)

const openArchiveDialog = () => {
  if (activeCount.value === 0) return
  archiveDialogOpen.value = true
}

const submitArchiveAll = async () => {
  if (bulkBusy.value) return
  // Snapshot active ids before mutating — the workspace listener
  // updates as each archive lands, which would otherwise reshuffle
  // the iteration target.
  const targets = sessions.value.filter((s) => !s.archivedAt).map((s) => s.id)
  if (targets.length === 0) {
    archiveDialogOpen.value = false
    return
  }
  bulkBusy.value = true
  try {
    for (const id of targets) {
      await archiveSession(id, true)
    }
    archiveDialogOpen.value = false
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
  if (bulkBusy.value) return
  const targets = sessions.value.map((s) => s.id)
  if (targets.length === 0) {
    deleteDialogOpen.value = false
    return
  }
  bulkBusy.value = true
  try {
    for (const id of targets) {
      await removeSession(id)
    }
    deleteDialogOpen.value = false
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

    <AlertDialog v-model:open="archiveDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.data.archiveAll.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.data.archiveAll.confirmBody", {
                count: activeCount,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("actions.cancel") }}
            <Kbd aria-hidden="true">Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || activeCount === 0"
            @click.prevent="submitArchiveAll"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.data.archiveAll.action") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.data.deleteAll.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.data.deleteAll.confirmBody", { count: totalCount })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("actions.cancel") }}
            <Kbd aria-hidden="true">Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || totalCount === 0"
            @click.prevent="submitDeleteAll"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.data.deleteAll.action") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

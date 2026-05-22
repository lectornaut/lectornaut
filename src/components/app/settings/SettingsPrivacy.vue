<script lang="ts" setup>
import { useBotChat } from "@/composables/useBotChat"
import { IconArchive, IconTrash2 } from "@/data/icons"
import { computed, ref } from "vue"

const { t } = useI18n()

// User-scoped privacy controls. Sources from `useBotChat()` — its
// `mySessions` and `archivedMySessions` refs are already filtered to
// `ownerUid == currentUid` via the per-user Firestore query, so there's
// no way to accidentally touch a chat the caller doesn't own.
const {
  mySessions,
  archivedMySessions,
  archiveSession,
  removeSession,
  isMutatingSession,
} = useBotChat()

const activeOwnedCount = computed(() => mySessions.value.length)
const archivedOwnedCount = computed(() => archivedMySessions.value.length)
const totalOwnedCount = computed(
  () => activeOwnedCount.value + archivedOwnedCount.value
)

// Local in-flight flag for the bulk loops. `isMutatingSession` from
// the composable flips per-call; we additionally track whether a
// *batch* is running so the page-level buttons stay disabled for the
// full sweep, not just between individual calls.
const bulkBusy = ref(false)

// ── Archive all my (active) chats ────────────────────────────────────────────

const archiveDialogOpen = ref(false)

const openArchiveDialog = () => {
  if (activeOwnedCount.value === 0) return
  archiveDialogOpen.value = true
}

const submitArchiveAll = async () => {
  if (bulkBusy.value) return
  // Snapshot ids before the loop — the underlying vuefire collection
  // mutates as each archive lands (the row moves from `mySessions`
  // into `archivedMySessions`), which would otherwise shift the
  // iteration target out from under us.
  const targets = mySessions.value.map((s) => s.id)
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

// ── Delete all my chats (active + archived) ─────────────────────────────────

const deleteDialogOpen = ref(false)

const openDeleteDialog = () => {
  if (totalOwnedCount.value === 0) return
  deleteDialogOpen.value = true
}

const submitDeleteAll = async () => {
  if (bulkBusy.value) return
  const targets = [
    ...mySessions.value.map((s) => s.id),
    ...archivedMySessions.value.map((s) => s.id),
  ]
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

const isDisabled = computed(() => bulkBusy.value || isMutatingSession.value)
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.privacy.label") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.privacy.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.privacy.archiveAll.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.privacy.archiveAll.description") }}
              <span class="tabular-nums">
                ·
                {{
                  t("settings.privacy.ownedCount", {
                    count: activeOwnedCount,
                  })
                }}
              </span>
            </FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            :disabled="isDisabled || activeOwnedCount === 0"
            @click="openArchiveDialog"
          >
            <IconArchive />
            {{ t("settings.privacy.archiveAll.action") }}
          </Button>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.privacy.deleteAll.label") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.privacy.deleteAll.description") }}
              <span class="tabular-nums">
                ·
                {{
                  t("settings.privacy.ownedCount", { count: totalOwnedCount })
                }}
              </span>
            </FieldDescription>
          </FieldContent>
          <Button
            variant="destructive"
            :disabled="isDisabled || totalOwnedCount === 0"
            @click="openDeleteDialog"
          >
            <IconTrash2 />
            {{ t("settings.privacy.deleteAll.action") }}
          </Button>
        </Field>
      </FieldSet>
    </FieldGroup>

    <AlertDialog v-model:open="archiveDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.privacy.archiveAll.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.privacy.archiveAll.confirmBody", {
                count: activeOwnedCount,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("actions.cancel") }}
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || activeOwnedCount === 0"
            @click.prevent="submitArchiveAll"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.privacy.archiveAll.action") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.privacy.deleteAll.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.privacy.deleteAll.confirmBody", {
                count: totalOwnedCount,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="bulkBusy">
            {{ t("actions.cancel") }}
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || totalOwnedCount === 0"
            @click.prevent="submitDeleteAll"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.privacy.deleteAll.action") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

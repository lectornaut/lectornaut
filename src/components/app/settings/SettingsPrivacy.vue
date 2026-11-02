<script lang="ts" setup>
import { useBotChat } from "@/composables/useBotChat"
import { useMemories } from "@/composables/useMemories"
import { IconArchive, IconTrash2 } from "@/data/icons"
import { computed, ref } from "vue"
import { toast } from "vue-sonner"

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
  if (bulkBusy.value) return false
  // Snapshot ids before the loop — the underlying reactive collection
  // mutates as each archive lands (the row moves from `mySessions`
  // into `archivedMySessions`), which would otherwise shift the
  // iteration target out from under us.
  const targets = mySessions.value.map((s) => s.id)
  if (targets.length === 0) return
  bulkBusy.value = true
  try {
    let failed = false
    for (const id of targets) {
      if (!(await archiveSession(id, true))) failed = true
    }
    if (failed) return false
  } catch (error) {
    console.error("[SettingsPrivacy] bulk archive chats failed:", error)
    toast.error(t("settings.privacy.archiveAll.error"))
    return false
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
  if (bulkBusy.value) return false
  const targets = [
    ...mySessions.value.map((s) => s.id),
    ...archivedMySessions.value.map((s) => s.id),
  ]
  if (targets.length === 0) return
  bulkBusy.value = true
  try {
    let failed = false
    for (const id of targets) {
      if (!(await removeSession(id))) failed = true
    }
    if (failed) return false
  } catch (error) {
    console.error("[SettingsPrivacy] bulk delete chats failed:", error)
    toast.error(t("settings.privacy.deleteAll.error"))
    return false
  } finally {
    bulkBusy.value = false
  }
}

const isDisabled = computed(() => bulkBusy.value || isMutatingSession.value)

// ── My private memories ──────────────────────────────────────────────────────
// `myPrivateMemories` is the caller's OWN private rows only — the composable
// derives it from the same per-user query that already backs the table, so
// these counts and the server callables share one privacy boundary: shared
// memories (mine or anyone else's) are never touched.
const {
  myPrivateMemories,
  archiveMyPrivate,
  purgeMyPrivate,
  isMutating: isMutatingMemories,
} = useMemories()

const activeMemoryCount = computed(
  () => myPrivateMemories.value.filter((m) => m.archived !== true).length
)
const totalMemoryCount = computed(() => myPrivateMemories.value.length)

const archiveMemoriesDialogOpen = ref(false)
const deleteMemoriesDialogOpen = ref(false)

const submitArchiveMemories = async () => {
  if (isMutatingMemories.value) return false
  try {
    const count = await archiveMyPrivate()
    toast.success(t("settings.privacy.archiveMemories.success", { count }))
  } catch (error) {
    console.error("[SettingsPrivacy] archive private memories failed:", error)
    toast.error(t("settings.privacy.archiveMemories.error"))
    return false
  }
}

const submitDeleteMemories = async () => {
  if (isMutatingMemories.value) return false
  try {
    const count = await purgeMyPrivate()
    toast.success(t("settings.privacy.deleteMemories.success", { count }))
  } catch (error) {
    console.error("[SettingsPrivacy] delete private memories failed:", error)
    toast.error(t("settings.privacy.deleteMemories.error"))
    return false
  }
}
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

        <FieldSeparator />

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.privacy.memoriesLabel") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.privacy.memoriesDescription") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.privacy.archiveMemories.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.privacy.archiveMemories.description") }}
              <span class="tabular-nums">
                ·
                {{
                  t("settings.privacy.memoryCount", {
                    count: activeMemoryCount,
                  })
                }}
              </span>
            </FieldDescription>
          </FieldContent>
          <Button
            variant="outline"
            :disabled="isMutatingMemories || activeMemoryCount === 0"
            @click="archiveMemoriesDialogOpen = true"
          >
            <IconArchive />
            {{ t("settings.privacy.archiveMemories.action") }}
          </Button>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.privacy.deleteMemories.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.privacy.deleteMemories.description") }}
              <span class="tabular-nums">
                ·
                {{
                  t("settings.privacy.memoryCount", {
                    count: totalMemoryCount,
                  })
                }}
              </span>
            </FieldDescription>
          </FieldContent>
          <Button
            variant="destructive"
            :disabled="isMutatingMemories || totalMemoryCount === 0"
            @click="deleteMemoriesDialogOpen = true"
          >
            <IconTrash2 />
            {{ t("settings.privacy.deleteMemories.action") }}
          </Button>
        </Field>
      </FieldSet>
    </FieldGroup>

    <ConfirmAction
      v-model:open="archiveDialogOpen"
      :title="t('settings.privacy.archiveAll.confirmTitle')"
      :description="
        t('settings.privacy.archiveAll.confirmBody', {
          count: activeOwnedCount,
        })
      "
      :action-label="t('settings.privacy.archiveAll.label')"
      :disabled="activeOwnedCount === 0"
      :on-confirm="submitArchiveAll"
    />

    <!-- User-scoped (own chats only): destructive, no typed phrase. -->
    <ConfirmAction
      v-model:open="deleteDialogOpen"
      :title="t('settings.privacy.deleteAll.confirmTitle')"
      :description="
        t('settings.privacy.deleteAll.confirmBody', {
          count: totalOwnedCount,
        })
      "
      :action-label="t('settings.privacy.deleteAll.label')"
      destructive
      :disabled="totalOwnedCount === 0"
      :on-confirm="submitDeleteAll"
    />

    <!-- Archive my private memories — reversible, restorable per-row. -->
    <ConfirmAction
      v-model:open="archiveMemoriesDialogOpen"
      :title="t('settings.privacy.archiveMemories.confirmTitle')"
      :description="
        t('settings.privacy.archiveMemories.confirmBody', {
          count: activeMemoryCount,
        })
      "
      :action-label="t('settings.privacy.archiveMemories.label')"
      :disabled="activeMemoryCount === 0"
      :on-confirm="submitArchiveMemories"
    />

    <ConfirmAction
      v-model:open="deleteMemoriesDialogOpen"
      :title="t('settings.privacy.deleteMemories.confirmTitle')"
      :description="
        t('settings.privacy.deleteMemories.confirmBody', {
          count: totalMemoryCount,
        })
      "
      :action-label="t('settings.privacy.deleteMemories.label')"
      destructive
      :disabled="totalMemoryCount === 0"
      :on-confirm="submitDeleteMemories"
    />
  </div>
</template>

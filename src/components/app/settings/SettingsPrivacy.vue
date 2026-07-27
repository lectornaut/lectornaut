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
  if (bulkBusy.value) return
  // Snapshot ids before the loop — the underlying reactive collection
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
  if (isMutatingMemories.value) return
  try {
    const count = await archiveMyPrivate()
    toast.success(t("settings.privacy.archiveMemories.success", { count }))
  } catch (error) {
    console.error("[SettingsPrivacy] archive private memories failed:", error)
    toast.error(t("settings.privacy.archiveMemories.error"))
  } finally {
    archiveMemoriesDialogOpen.value = false
  }
}

const submitDeleteMemories = async () => {
  if (isMutatingMemories.value) return
  try {
    const count = await purgeMyPrivate()
    toast.success(t("settings.privacy.deleteMemories.success", { count }))
  } catch (error) {
    console.error("[SettingsPrivacy] delete private memories failed:", error)
    toast.error(t("settings.privacy.deleteMemories.error"))
  } finally {
    deleteMemoriesDialogOpen.value = false
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
            <Kbd>Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || activeOwnedCount === 0"
            @click.prevent="submitArchiveAll"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.privacy.archiveAll.action") }}
            <Kbd>↩</Kbd>
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
            <Kbd>Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="bulkBusy || totalOwnedCount === 0"
            @click.prevent="submitDeleteAll"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.privacy.deleteAll.action") }}
            <Kbd>↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Archive my private memories — reversible, restorable per-row. -->
    <AlertDialog v-model:open="archiveMemoriesDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.privacy.archiveMemories.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.privacy.archiveMemories.confirmBody", {
                count: activeMemoryCount,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isMutatingMemories">
            {{ t("actions.cancel") }}
            <Kbd>Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isMutatingMemories || activeMemoryCount === 0"
            @click.prevent="submitArchiveMemories"
          >
            <Spinner v-if="isMutatingMemories" />
            {{ t("settings.privacy.archiveMemories.action") }}
            <Kbd>↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteMemoriesDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.privacy.deleteMemories.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.privacy.deleteMemories.confirmBody", {
                count: totalMemoryCount,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isMutatingMemories">
            {{ t("actions.cancel") }}
            <Kbd>Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="isMutatingMemories || totalMemoryCount === 0"
            @click.prevent="submitDeleteMemories"
          >
            <Spinner v-if="isMutatingMemories" />
            {{ t("settings.privacy.deleteMemories.action") }}
            <Kbd>↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

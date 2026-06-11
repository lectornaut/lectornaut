<script lang="ts" setup>
import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import { useNodes } from "@/composables/useNodes"
import {
  IconAlertTriangle,
  IconArchive,
  IconBox,
  IconTrash2,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { ROOT_PARENT_ID, type WorkspaceNodeScope } from "@/types/nodes"
import { storeToRefs } from "pinia"
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"

const { t } = useI18n()

// Admin gate — Storage uses its own `MANAGE_WORKSPACE_STORAGE`
// capability (owner/admin only). It's deliberately separate from
// `MANAGE_WORKSPACE_CONTENT` (which members hold for everyday document
// editing): bulk-wiping every code/write document at once is a
// destructive, admin-tier action that ordinary members must not perform.
const { currentTeamId, currentWorkspaceId } = storeToRefs(useAuthStore())
const { canManageWorkspaceStorage: canManage } =
  useCurrentTeamRole(currentTeamId)

const { listChildren, deleteNode, archiveNode } = useNodes()

// Per-scope reactive counts. We track top-level (`parentId === "root"`)
// nodes only — the delete cascade handles every level below, and archive
// intentionally does NOT cascade (it only marks the top-level node), so
// a per-tree count is the right unit for both actions.
//
// We track total (incl. already-archived) for the delete-all button and
// active (excl. archived) for the archive-all button — the archive
// callable throws `failed-precondition` on already-archived nodes, so
// the bulk loop must only target live ones.
const codeRootCount = ref(0)
const codeActiveCount = ref(0)
const writeRootCount = ref(0)
const writeActiveCount = ref(0)
const isLoadingCounts = ref(false)
const bulkBusy = ref(false)

const isReady = computed(
  () => !!currentTeamId.value && !!currentWorkspaceId.value
)

// One-shot fetch on mount + after each mutation. We could subscribe via
// onSnapshot, but the Storage page is a low-traffic admin tool, and
// `listChildren` is paginated — we'd need a special variant to count
// every page anyway. Manual refresh keeps the surface tiny.
//
// Single walk yields both totals — the delete button wants the full
// count (archived items still count toward the delete cascade) while
// the archive button wants the non-archived count (already-archived
// nodes can't be re-archived).
const refreshCount = async (
  scope: WorkspaceNodeScope
): Promise<{ total: number; active: number }> => {
  const teamId = currentTeamId.value
  const workspaceId = currentWorkspaceId.value
  if (!teamId || !workspaceId) return { total: 0, active: 0 }

  // Walk pages until we exhaust the listing. `listChildren` returns
  // `hasMore` so we know when to stop without an unbounded loop.
  let total = 0
  let active = 0
  let cursor: Awaited<ReturnType<typeof listChildren>>["lastDoc"] = null

  while (true) {
    const result = await listChildren(
      scope,
      teamId,
      workspaceId,
      ROOT_PARENT_ID,
      {
        includeArchived: true,
        startAfter: cursor ?? undefined,
      }
    )
    for (const node of result.nodes) {
      total += 1
      if (!node.isArchived) active += 1
    }
    if (!result.hasMore) break
    cursor = result.lastDoc
  }
  return { total, active }
}

const refreshAll = async () => {
  if (!isReady.value || !canManage.value) {
    codeRootCount.value = 0
    codeActiveCount.value = 0
    writeRootCount.value = 0
    writeActiveCount.value = 0
    return
  }
  isLoadingCounts.value = true
  try {
    const [code, write] = await Promise.all([
      refreshCount("code"),
      refreshCount("write"),
    ])
    codeRootCount.value = code.total
    codeActiveCount.value = code.active
    writeRootCount.value = write.total
    writeActiveCount.value = write.active
  } catch (error) {
    console.error("[SettingsStorage] refresh failed:", error)
    toast.error("Failed to read workspace contents.")
  } finally {
    isLoadingCounts.value = false
  }
}

// Re-fetch when the active workspace changes (e.g. admin switches
// workspaces from the side panel) or the role gate resolves.
watch([currentTeamId, currentWorkspaceId, canManage], () => {
  void refreshAll()
})

void refreshAll()

// ── Archive-all flow per scope ───────────────────────────────────────────────

const archiveCodesDialogOpen = ref(false)
const archiveWritesDialogOpen = ref(false)

const openArchiveDialog = (scope: WorkspaceNodeScope) => {
  if (scope === "code") {
    if (codeActiveCount.value === 0) return
    archiveCodesDialogOpen.value = true
  } else {
    if (writeActiveCount.value === 0) return
    archiveWritesDialogOpen.value = true
  }
}

const archiveAllInScope = async (scope: WorkspaceNodeScope) => {
  const teamId = currentTeamId.value
  const workspaceId = currentWorkspaceId.value
  if (!teamId || !workspaceId) return
  if (bulkBusy.value) return

  bulkBusy.value = true
  try {
    // Re-query first page each iteration — the archive callable drops a
    // node from the `includeArchived: false` listing, so any saved cursor
    // would point past freshly-archived items. The loop terminates
    // naturally once no active top-level nodes remain.
    while (true) {
      const result = await listChildren(
        scope,
        teamId,
        workspaceId,
        ROOT_PARENT_ID,
        {
          includeArchived: false,
        }
      )
      if (result.nodes.length === 0) break
      for (const node of result.nodes) {
        await archiveNode(scope, teamId, workspaceId, node.id)
      }
      if (!result.hasMore) break
    }
    toast.success(
      scope === "code"
        ? "All code documents archived."
        : "All write documents archived."
    )
  } catch (error) {
    console.error(`[SettingsStorage] bulk archive ${scope} failed:`, error)
    toast.error(
      scope === "code"
        ? "Failed to archive all code documents."
        : "Failed to archive all write documents."
    )
  } finally {
    bulkBusy.value = false
    archiveCodesDialogOpen.value = false
    archiveWritesDialogOpen.value = false
    await refreshAll()
  }
}

const submitArchiveCodes = () => archiveAllInScope("code")
const submitArchiveWrites = () => archiveAllInScope("write")

// ── Delete-all flow per scope ────────────────────────────────────────────────

const deleteCodesDialogOpen = ref(false)
const deleteWritesDialogOpen = ref(false)

const openDeleteDialog = (scope: WorkspaceNodeScope) => {
  if (scope === "code") {
    if (codeRootCount.value === 0) return
    deleteCodesDialogOpen.value = true
  } else {
    if (writeRootCount.value === 0) return
    deleteWritesDialogOpen.value = true
  }
}

const deleteAllInScope = async (scope: WorkspaceNodeScope) => {
  const teamId = currentTeamId.value
  const workspaceId = currentWorkspaceId.value
  if (!teamId || !workspaceId) return
  if (bulkBusy.value) return

  bulkBusy.value = true
  try {
    // Snapshot root ids one page at a time. The Cloud Function cascade
    // deletes descendants, so we only iterate top-level nodes. We
    // re-query between pages to avoid stale cursors — a delete in
    // page 1 can shift pagination of subsequent pages.
    while (true) {
      const result = await listChildren(
        scope,
        teamId,
        workspaceId,
        ROOT_PARENT_ID,
        {
          includeArchived: true,
        }
      )
      if (result.nodes.length === 0) break
      for (const node of result.nodes) {
        await deleteNode(scope, teamId, workspaceId, node.id)
      }
      // If the page didn't fill, we're done.
      if (!result.hasMore) break
    }
    toast.success(
      scope === "code"
        ? "All code documents deleted."
        : "All write documents deleted."
    )
  } catch (error) {
    console.error(`[SettingsStorage] bulk delete ${scope} failed:`, error)
    toast.error(
      scope === "code"
        ? "Failed to delete all code documents."
        : "Failed to delete all write documents."
    )
  } finally {
    bulkBusy.value = false
    deleteCodesDialogOpen.value = false
    deleteWritesDialogOpen.value = false
    await refreshAll()
  }
}

const submitDeleteCodes = () => deleteAllInScope("code")
const submitDeleteWrites = () => deleteAllInScope("write")

const isDisabled = computed(() => bulkBusy.value || isLoadingCounts.value)
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
                  {{ t("settings.storage.noPermissionTitle") }}
                </EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.storage.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ t("settings.storage.label") }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.storage.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.storage.archiveWrites.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.storage.archiveWrites.description") }}
                <span class="tabular-nums">
                  ·
                  {{
                    t("settings.storage.activeRootCount", {
                      count: writeActiveCount,
                    })
                  }}
                </span>
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="isDisabled || writeActiveCount === 0"
              @click="openArchiveDialog('write')"
            >
              <IconArchive />
              {{ t("settings.storage.archiveWrites.action") }}
            </Button>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.storage.deleteWrites.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.storage.deleteWrites.description") }}
                <span class="tabular-nums">
                  ·
                  {{
                    t("settings.storage.rootCount", {
                      count: writeRootCount,
                    })
                  }}
                </span>
              </FieldDescription>
            </FieldContent>
            <Button
              variant="destructive"
              :disabled="isDisabled || writeRootCount === 0"
              @click="openDeleteDialog('write')"
            >
              <IconBox />
              {{ t("settings.storage.deleteWrites.action") }}
            </Button>
          </Field>

          <FieldSeparator />

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.storage.archiveCodes.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.storage.archiveCodes.description") }}
                <span class="tabular-nums">
                  ·
                  {{
                    t("settings.storage.activeRootCount", {
                      count: codeActiveCount,
                    })
                  }}
                </span>
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              :disabled="isDisabled || codeActiveCount === 0"
              @click="openArchiveDialog('code')"
            >
              <IconArchive />
              {{ t("settings.storage.archiveCodes.action") }}
            </Button>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.storage.deleteCodes.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.storage.deleteCodes.description") }}
                <span class="tabular-nums">
                  ·
                  {{
                    t("settings.storage.rootCount", {
                      count: codeRootCount,
                    })
                  }}
                </span>
              </FieldDescription>
            </FieldContent>
            <Button
              variant="destructive"
              :disabled="isDisabled || codeRootCount === 0"
              @click="openDeleteDialog('code')"
            >
              <IconTrash2 />
              {{ t("settings.storage.deleteCodes.action") }}
            </Button>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>

    <AlertDialog v-model:open="archiveCodesDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.storage.archiveCodes.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.storage.archiveCodes.confirmBody", {
                count: codeActiveCount,
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
            :disabled="bulkBusy || codeActiveCount === 0"
            @click.prevent="submitArchiveCodes"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.storage.archiveCodes.action") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="archiveWritesDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.storage.archiveWrites.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.storage.archiveWrites.confirmBody", {
                count: writeActiveCount,
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
            :disabled="bulkBusy || writeActiveCount === 0"
            @click.prevent="submitArchiveWrites"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.storage.archiveWrites.action") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteCodesDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.storage.deleteCodes.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.storage.deleteCodes.confirmBody", {
                count: codeRootCount,
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
            :disabled="bulkBusy || codeRootCount === 0"
            @click.prevent="submitDeleteCodes"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.storage.deleteCodes.action") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteWritesDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.storage.deleteWrites.confirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.storage.deleteWrites.confirmBody", {
                count: writeRootCount,
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
            :disabled="bulkBusy || writeRootCount === 0"
            @click.prevent="submitDeleteWrites"
          >
            <Spinner v-if="bulkBusy" />
            {{ t("settings.storage.deleteWrites.action") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

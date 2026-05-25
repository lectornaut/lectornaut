import { useActiveTabIndicator } from "@/composables/useActiveTabIndicator"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import { subscribeAgentRelay } from "@/utils/collab/signaling"
import {
  createYjsCollab,
  type YjsCollabSession,
} from "@/utils/collab/yjsBinding"
import { storeToRefs } from "pinia"
import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type Ref,
  type ShallowRef,
} from "vue"
import { useI18n } from "vue-i18n"
import { useRoute, useRouter } from "vue-router"

export interface UseCollabPageOptions {
  scope: WorkspaceNodeScope
  basePath: string
  /**
   * Normalize file content for comparison (e.g. JSON normalization for
   * rich text). Defaults to identity.
   */
  normalizeContent?: (raw: string | null | undefined) => string
  /**
   * Called after a collab session is successfully created. Use to set up
   * editor-specific bindings (e.g. CodeMirror extensions, initial content).
   * Return an initial editor content string if it should differ from the
   * normalized file content.
   */
  onSessionCreated?: (
    session: YjsCollabSession,
    fileContent: string
  ) => string | void
  /**
   * Called when the collab session is about to be torn down (file switch
   * or unmount). Use to clean up editor-specific state.
   */
  onSessionDestroyed?: () => void
}

export interface UseCollabPageReturn {
  teamId: Ref<string | null>
  workspaceId: Ref<string | null>
  selectedNode: Ref<WorkspaceNode | null>
  selectedFile: Ref<WorkspaceNode | null>
  selectedFileId: Ref<string | null>
  editorContent: Ref<string>
  isDirty: Ref<boolean>
  isSaving: Ref<boolean>
  editorReadOnly: Ref<boolean>
  collabSession: ShallowRef<YjsCollabSession | null>
  collabRole: Ref<"editor" | "viewer" | null>
  collabError: Ref<string | null>
  collabReady: Ref<boolean>
  collabAwareness: Ref<import("y-protocols/awareness").Awareness | null>
  /**
   * New content from a server-relayed agent edit for `write` docs, to be
   * applied by the editor via setContent. Only set on the elected applier;
   * `code` docs apply internally to the Y.Text and never use this.
   */
  externalEditorContent: Ref<{ seq: number; content: string } | null>
  saveContent: () => Promise<void>
}

export function useCollabPage(
  options: UseCollabPageOptions
): UseCollabPageReturn {
  const { scope, basePath } = options
  const normalizeContent = options.normalizeContent ?? ((raw) => raw ?? "")

  const workspaceStore = useWorkspaceStore()
  const fileTreeStore = useFileTreeStore()
  const authStore = useAuthStore()
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()

  const { currentWorkspace } = storeToRefs(workspaceStore)
  const { currentUser, userProfile } = storeToRefs(authStore)

  const teamId = computed(() => currentWorkspace.value?.teamId ?? null)
  const workspaceId = computed(() => currentWorkspace.value?.id ?? null)
  const routeNodeId = computed(() => {
    const raw = (route.params as { nodeId?: string }).nodeId
    return typeof raw === "string" && raw.length ? raw : null
  })
  const selectedNodeId = computed(() => {
    if (!teamId.value || !workspaceId.value) return null
    return fileTreeStore.getSelectedNodeId(
      scope,
      teamId.value,
      workspaceId.value
    )
  })
  const isSyncingSelectionAndRoute = ref(false)

  const selectedNode = computed(() => {
    if (!teamId.value || !workspaceId.value) return null
    return fileTreeStore.getSelectedNode(scope, teamId.value, workspaceId.value)
  })

  const selectedFile = computed(() => {
    if (!selectedNode.value) return null
    if (selectedNode.value.type !== "file") return null
    if (selectedNode.value.isArchived) return null
    return selectedNode.value
  })
  const selectedFileId = computed(() => selectedFile.value?.id ?? null)

  // --- Collab state ---
  const editorContent = ref("")
  const isDirty = ref(false)
  const isSaving = ref(false)
  const collabSession = shallowRef<YjsCollabSession | null>(null)
  const collabRole = ref<"editor" | "viewer" | null>(null)
  const collabError = ref<string | null>(null)
  const collabReady = ref(false)
  const collabAwareness = computed(() => collabSession.value?.awareness ?? null)

  // Server-relayed agent edits. `relayUnsub` is torn down alongside the
  // session; `externalEditorContent` carries a `write`-doc edit out to the
  // editor (the applier only).
  let relayUnsub: (() => void) | null = null
  const externalEditorContent = ref<{ seq: number; content: string } | null>(
    null
  )

  const editorReadOnly = computed(() => {
    if (!selectedFile.value) return true
    return collabRole.value !== "editor"
  })

  // --- Tab indicator ---
  const tabIndicator = computed(() => {
    if (!selectedFile.value) return null

    if (isSaving.value) {
      return { label: t("states.syncing"), tone: "info" as const, spin: true }
    }
    if (collabError.value) {
      return { label: t("states.offline"), tone: "danger" as const }
    }
    if (isDirty.value) {
      return {
        label: t("common.unsavedChanges"),
        tone: "warning" as const,
        pulse: true,
      }
    }
    if (collabReady.value) {
      return { label: t("states.synced"), tone: "success" as const }
    }
    return null
  })
  useActiveTabIndicator(tabIndicator)

  // --- Route ↔ selection sync ---
  watch(
    [routeNodeId, teamId, workspaceId],
    async ([nodeIdFromRoute, currentTeamId, currentWorkspaceId]) => {
      if (
        !currentTeamId ||
        !currentWorkspaceId ||
        isSyncingSelectionAndRoute.value
      ) {
        return
      }

      isSyncingSelectionAndRoute.value = true
      try {
        if (!nodeIdFromRoute) {
          fileTreeStore.setSelectedNode(
            scope,
            currentTeamId,
            currentWorkspaceId,
            null
          )
          return
        }

        const node = await fileTreeStore.ensureNodeLoaded(
          scope,
          currentTeamId,
          currentWorkspaceId,
          nodeIdFromRoute
        )

        if (!node || node.isArchived) {
          fileTreeStore.setSelectedNode(
            scope,
            currentTeamId,
            currentWorkspaceId,
            null
          )
          await router.replace(basePath)
          return
        }

        fileTreeStore.setSelectedNode(
          scope,
          currentTeamId,
          currentWorkspaceId,
          nodeIdFromRoute
        )
      } finally {
        isSyncingSelectionAndRoute.value = false
      }
    },
    { immediate: true }
  )

  watch(
    [selectedNodeId, teamId, workspaceId],
    async ([nodeId, currentTeamId, currentWorkspaceId]) => {
      if (
        !currentTeamId ||
        !currentWorkspaceId ||
        isSyncingSelectionAndRoute.value
      ) {
        return
      }

      const targetPath = nodeId ? `${basePath}/${nodeId}` : basePath
      if (route.path === targetPath) {
        return
      }

      isSyncingSelectionAndRoute.value = true
      try {
        await router.replace(targetPath)
      } finally {
        isSyncingSelectionAndRoute.value = false
      }
    }
  )

  // --- Collab session lifecycle ---
  watch(
    [selectedFileId, teamId, workspaceId, currentUser],
    async (
      [fileId, currentTeamId, currentWorkspaceId, user],
      _oldValue,
      onCleanup
    ) => {
      const file = selectedFile.value
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })

      collabError.value = null
      collabReady.value = false
      collabRole.value = null
      editorContent.value = normalizeContent(file?.content)
      isDirty.value = false

      const previousSession = collabSession.value
      collabSession.value = null
      options.onSessionDestroyed?.()

      // Tear down the previous file's agent-relay subscription.
      relayUnsub?.()
      relayUnsub = null
      externalEditorContent.value = null

      if (previousSession) {
        await previousSession.destroy().catch((error) => {
          console.error("[collab] Failed to destroy previous session", error)
        })
      }

      if (!fileId || !file || !currentTeamId || !currentWorkspaceId || !user) {
        return
      }

      collabReady.value = false

      try {
        const session = await createYjsCollab({
          contentId: file.id,
          teamId: currentTeamId,
          workspaceId: currentWorkspaceId,
          scope,
          user: {
            uid: user.uid,
            displayName: userProfile.value?.displayName ?? user.displayName,
            photoURL: userProfile.value?.photoURL ?? user.photoURL,
          },
        })

        if (cancelled) {
          await session.destroy()
          return
        }

        const initialContent = options.onSessionCreated?.(
          session,
          file.content ?? ""
        )
        if (typeof initialContent === "string") {
          editorContent.value = initialContent
        }

        collabSession.value = session
        collabRole.value = session.role
        collabReady.value = true

        // Apply server-relayed agent edits live. The first emission is the
        // baseline (already reflected in the content we just opened), so we
        // skip it; later edits with a higher `seq` are applied by the elected
        // applier only — `code` straight into the Y.Text (propagates via the
        // mesh + snapshot save), `write` handed to the editor via setContent.
        let baselineSet = false
        let lastRelaySeq = Number.NEGATIVE_INFINITY
        relayUnsub = subscribeAgentRelay(
          file.id,
          (state) => {
            // First emission is the baseline — the relay doc as it stood when
            // we subscribed (possibly absent). It's already reflected in the
            // content we opened, so record its seq and don't apply it. Setting
            // the baseline BEFORE the null check is essential: when no relay
            // doc exists yet, the agent's first real edit must not be mistaken
            // for the baseline (which would silently swallow it).
            if (!baselineSet) {
              baselineSet = true
              lastRelaySeq = state?.seq ?? Number.NEGATIVE_INFINITY
              return
            }
            if (!state) return
            if (state.seq <= lastRelaySeq) return
            lastRelaySeq = state.seq
            if (!session.isAgentApplier()) return

            if (scope === "code") {
              const ytext = session.ydoc.getText("codemirror")
              session.ydoc.transact(() => {
                ytext.delete(0, ytext.length)
                if (state.content) ytext.insert(0, state.content)
              })
            } else {
              externalEditorContent.value = {
                seq: state.seq,
                content: state.content,
              }
            }
          },
          (error) => {
            console.error("[collab] agent relay subscription error", error)
          }
        )
      } catch (error) {
        if (cancelled) {
          return
        }

        const message =
          (error as Error).message || "Unable to join collaboration room."
        collabError.value = message
        collabReady.value = false
        showErrorToast("Collaboration unavailable", message)
      }
    },
    { immediate: true }
  )

  // --- Dirty tracking ---
  watch(editorContent, (value) => {
    if (!selectedFile.value) {
      isDirty.value = false
      return
    }
    isDirty.value =
      normalizeContent(value) !== normalizeContent(selectedFile.value.content)
  })

  // --- Save ---
  const saveContent = async () => {
    if (!selectedFile.value || !teamId.value || !workspaceId.value) return
    if (isSaving.value) return
    if (editorReadOnly.value) {
      showErrorToast(
        "Read-only",
        "You do not have permission to edit this file."
      )
      return
    }

    isSaving.value = true
    try {
      await fileTreeStore.saveFileContent(
        scope,
        teamId.value,
        workspaceId.value,
        selectedFile.value.id,
        editorContent.value
      )
      isDirty.value = false
      showSuccessToast("Saved")
    } catch (error) {
      const offline =
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (error as { code?: string }).code === "unavailable"

      if (offline) {
        showErrorToast(
          "Offline",
          "You're offline. Your local editor state is preserved; try saving again when connected."
        )
        return
      }

      showErrorToast("Failed to save", (error as Error).message)
    } finally {
      isSaving.value = false
    }
  }

  // --- Cleanup ---
  onBeforeUnmount(() => {
    relayUnsub?.()
    relayUnsub = null
    const session = collabSession.value
    collabSession.value = null
    if (!session) return

    void session.destroy().catch((error) => {
      console.error("[collab] Failed to destroy session on unmount", error)
    })
  })

  return {
    teamId,
    workspaceId,
    selectedNode,
    selectedFile,
    selectedFileId,
    editorContent,
    isDirty,
    isSaving,
    editorReadOnly,
    collabSession,
    collabRole,
    collabError,
    collabReady,
    collabAwareness,
    externalEditorContent,
    saveContent,
  }
}

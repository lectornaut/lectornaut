import { useActiveTabIndicator } from "@/composables/useActiveTabIndicator"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import type { CollabEditorAdapter } from "@/utils/collab/editorAdapter"
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
  /**
   * Force any pending debounced editor → `editorContent` emit to land NOW.
   * Wired to the editor component's `flush()`. Called at the top of
   * `saveContent` so a save started within the debounce window persists the
   * latest keystrokes instead of the stale debounced value.
   */
  flushPendingEdits?: () => void
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
   * Register the active editor's {@link CollabEditorAdapter} (or `null` on
   * teardown). The page's single conversation partner for live agent edits:
   * `useCollabPage` applies relayed edits through it instead of forking on
   * scope and reaching into the transport. Both the rich-text and code editors
   * register one; only the elected applier's `applyAgentEdit` actually writes.
   */
  registerEditorAdapter: (adapter: CollabEditorAdapter | null) => void
  /**
   * Adopt the editor's canonical serialization of the just-opened document as
   * the dirty baseline. Wired to the rich-text editor's one-shot `baseline`
   * event (see `adoptEditorBaseline` for the rationale).
   */
  adoptEditorBaseline: (value: string) => void
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
  // Canonical "last reconciled with server" content, normalized. Seeded from
  // `file.content` on open and advanced when an external content update lands
  // (agent relay or file-doc fallback) or when a local save succeeds. Drives
  // `isDirty` (vs. comparing directly to `selectedFile.content`, which would
  // mis-flag the editor as dirty whenever the bot updates the doc), and
  // doubles as the dedup key for external content writes.
  const lastSyncedContent = ref<string>("")
  const isDirty = ref(false)
  const isSaving = ref(false)
  const collabSession = shallowRef<YjsCollabSession | null>(null)
  const collabRole = ref<"editor" | "viewer" | null>(null)
  const collabError = ref<string | null>(null)
  const collabReady = ref(false)
  const collabAwareness = computed(() => collabSession.value?.awareness ?? null)

  // Server-relayed agent edits. `relayUnsub` is torn down alongside the
  // session; `editorAdapter` is the active editor's integration seam, swapped
  // in when an editor mounts and nulled on teardown.
  let relayUnsub: (() => void) | null = null
  const editorAdapter = shallowRef<CollabEditorAdapter | null>(null)
  const registerEditorAdapter = (adapter: CollabEditorAdapter | null): void => {
    editorAdapter.value = adapter
  }

  const editorReadOnly = computed(() => {
    if (!selectedFile.value) return true
    return collabRole.value !== "editor"
  })

  // Apply an external content update (from the agent relay or the file-doc
  // fallback below) through the active editor adapter — the page is blind to
  // whether the CRDT underneath is a Y.XmlFragment (Tiptap) or a Y.Text
  // (CodeMirror). Content-based dedup via `lastSyncedContent` makes the relay
  // and fallback paths idempotent: whichever fires first applies, the other
  // becomes a no-op.
  const applyExternalContent = (rawContent: string): void => {
    const adapter = editorAdapter.value
    if (!adapter) return

    const normalized = normalizeContent(rawContent)
    if (normalized === lastSyncedContent.value) return

    // Only the elected applier mutates Y per room — others receive the same
    // agent edit through the WebRTC mesh (their editor, and thus
    // `editorContent`, updates on its own). Both still advance
    // `lastSyncedContent` to the new baseline below: without it a mesh-driven
    // change reads as a local edit and flips `isDirty` true — a spurious
    // "unsaved" indicator plus an enabled Save that would re-write the agent's
    // content.
    if (adapter.applierStatus()) {
      adapter.applyAgentEdit(rawContent)
    }

    lastSyncedContent.value = normalized
  }

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
      const seedContent = normalizeContent(file?.content)
      editorContent.value = seedContent
      lastSyncedContent.value = seedContent
      isDirty.value = false

      const previousSession = collabSession.value
      collabSession.value = null
      options.onSessionDestroyed?.()

      // Tear down the previous file's agent-relay subscription and drop the
      // previous editor's adapter (the new editor re-registers on mount).
      relayUnsub?.()
      relayUnsub = null
      editorAdapter.value = null

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
          lastSyncedContent.value = normalizeContent(initialContent)
        }

        collabSession.value = session
        collabRole.value = session.role
        collabReady.value = true

        // Apply server-relayed agent edits live. The first emission is the
        // baseline (already reflected in the content we just opened), so we
        // skip it; later edits with a higher `seq` route through
        // `applyExternalContent`, which handles applier election and dedup.
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
            applyExternalContent(state.content)
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

  // --- Live-update fallback ---
  // When `file.content` updates server-side (e.g., the bot called
  // `updateNodeContent`) and the user has no pending local edits, push the
  // new content into the editor without waiting for the agent relay. The
  // relay (signaling/.../agentRelay/state) is the primary path, but its
  // listener can drop or arrive late; without this watcher the editor stays
  // stale until a refresh re-seeds Y.Text from the (now-current) file doc.
  // `applyExternalContent` dedups via `lastSyncedContent`, so this co-exists
  // safely with the relay path — whichever fires first applies.
  // Intentionally no `isDirty` gate: the dirty flag is a UI signal (drives
  // the save button), not a load-bearing safety check — the relay path
  // doesn't honor it either, and the content-based dedup inside
  // `applyExternalContent` is the real double-apply guard. Concurrent-edit
  // clobbering would need a proper CRDT-aware merge, out of scope here.
  watch(
    () => selectedFile.value?.content,
    (next) => {
      if (next == null) return
      if (!collabSession.value || !collabReady.value) return
      applyExternalContent(next)
    }
  )

  // --- Dirty tracking ---
  // Compare against `lastSyncedContent` (the last canonical save point we've
  // reconciled with), not `selectedFile.content` directly. The two diverge
  // whenever the bot updates the file: `selectedFile.content` jumps to the
  // new server state immediately, while `lastSyncedContent` only advances
  // when we actually apply the change locally. Comparing to the moving server
  // value would mis-flag a freshly-bot-edited (but un-applied) editor as
  // "unsaved" and let a stale-overwrite save through.
  watch(editorContent, (value) => {
    if (!selectedFile.value) {
      isDirty.value = false
      return
    }
    isDirty.value = normalizeContent(value) !== lastSyncedContent.value
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

    // Land any pending debounced editor emit synchronously so we persist the
    // freshest content, not a value lagging by one debounce interval.
    options.flushPendingEdits?.()

    isSaving.value = true
    try {
      await fileTreeStore.saveFileContent(
        scope,
        teamId.value,
        workspaceId.value,
        selectedFile.value.id,
        editorContent.value
      )
      lastSyncedContent.value = normalizeContent(editorContent.value)
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

  // --- Editor-reported baseline ---
  // An editor re-serializes the content it loads into its OWN canonical form,
  // which can differ byte-for-byte from the stored `content` even though the
  // documents are identical. The mismatch is invisible for `code` (raw text
  // round-trips, and `onSessionCreated` already reseeds `lastSyncedContent`
  // from `getText()`), but real for `write`: an agent edit persists
  // `markdownToTiptapJson(...)` output, NOT the editor's `getJSON()`, so when
  // Tiptap reopens the doc and re-emits its canonical serialization the editor
  // looks dirty on open with no user input.
  //
  // The rich-text editor can't report its canonical form at session-creation
  // time (it mounts only after `collabReady`), so it fires a one-shot event
  // once created. Treat that as the sync baseline — the `write` analogue of the
  // `onSessionCreated` → `getText()` reseed the code editor does synchronously.
  // Fires once per open (the editor is keyed by file id), before any user
  // interaction, so it can't swallow a genuine edit. Saving heals the doc: the
  // persisted `content` then IS the editor's canonical form.
  const adoptEditorBaseline = (value: string) => {
    if (!selectedFile.value) return
    const normalized = normalizeContent(value)
    lastSyncedContent.value = normalized
    isDirty.value = normalizeContent(editorContent.value) !== normalized
  }

  // --- Cleanup ---
  onBeforeUnmount(() => {
    relayUnsub?.()
    relayUnsub = null
    editorAdapter.value = null
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
    registerEditorAdapter,
    adoptEditorBaseline,
    saveContent,
  }
}

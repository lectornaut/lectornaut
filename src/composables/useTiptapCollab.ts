import type { AnyExtension } from "@tiptap/core"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import type { Awareness } from "y-protocols/awareness"
import type { Doc as YDoc } from "yjs"

interface CollaborationProvider {
  awareness: Awareness
  on: (event: string, listener: () => void) => void
  off: (event: string, listener: () => void) => void
}

export interface TiptapCollabResult {
  /** Tiptap extensions for collaborative editing (Collaboration + CollaborationCaret) */
  extensions: AnyExtension[]
  /** The collaboration provider wrapper (for external use if needed) */
  provider: CollaborationProvider
}

/**
 * Creates a minimal collaboration provider that wraps an Awareness instance.
 *
 * Tiptap's Collaboration extension expects a provider that emits a "synced"
 * event. Since the Y.Doc snapshot is pre-loaded before the editor mounts,
 * the doc is always synced at construction time — so "synced" fires
 * immediately via queueMicrotask.
 */
function createCollaborationProvider(
  awareness: Awareness
): CollaborationProvider {
  const syncedListeners = new Set<() => void>()

  const scheduleSynced = (listener: () => void) => {
    queueMicrotask(() => {
      if (syncedListeners.has(listener)) {
        listener()
      }
    })
  }

  return {
    awareness,
    on: (event, listener) => {
      if (event !== "synced") {
        return
      }
      syncedListeners.add(listener)
      scheduleSynced(listener)
    },
    off: (event, listener) => {
      if (event !== "synced") {
        return
      }
      syncedListeners.delete(listener)
    },
  }
}

/**
 * Resolves the collaboration user info from awareness local state for
 * use with CollaborationCaret.
 */
function getCollaborationUser(awareness: Awareness): Record<string, unknown> {
  const localState = awareness.getLocalState() as {
    user?: {
      [key: string]: unknown
      name?: unknown
      color?: unknown
    }
  } | null

  const currentUser = localState?.user ?? {}

  const name =
    typeof localState?.user?.name === "string" &&
    localState.user.name.trim().length
      ? localState.user.name.trim()
      : "Anonymous"

  const color =
    typeof localState?.user?.color === "string" &&
    localState.user.color.trim().length
      ? localState.user.color
      : "#3b82f6"

  return {
    ...currentUser,
    name,
    color,
  }
}

/**
 * Creates Tiptap-specific collaborative editing extensions from a Yjs
 * document and awareness instance. Sets up the Collaboration extension
 * (using the "tiptap" shared XML fragment) and CollaborationCaret for
 * cursor/selection presence.
 */
export function useTiptapCollab(
  ydoc: YDoc,
  awareness: Awareness
): TiptapCollabResult {
  const provider = createCollaborationProvider(awareness)

  const extensions: AnyExtension[] = [
    Collaboration.configure({
      document: ydoc,
      field: "tiptap",
      provider,
    }),
    CollaborationCaret.configure({
      provider,
      user: getCollaborationUser(awareness),
    }),
  ]

  return {
    extensions,
    provider,
  }
}

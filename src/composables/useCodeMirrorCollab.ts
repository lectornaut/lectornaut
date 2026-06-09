import {
  CODEMIRROR_COLLAB_FIELD,
  createCodeMirrorEditorAdapter,
  type CollabEditorAdapter,
} from "@/utils/collab/editorAdapter"
import type { YjsCollabSession } from "@/utils/collab/yjsBinding"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { yCollab } from "y-codemirror.next"
import * as Y from "yjs"

export interface CodeMirrorCollabResult {
  /** CodeMirror extensions for collaborative editing (yCollab + optional read-only) */
  extensions: Extension[]
  /** The collaborative Y.Text shared type */
  ytext: Y.Text
  /** Current plain-text content of the Y.Text */
  getText: () => string
  /**
   * The editor-integration seam for live agent edits — `useCollabPage` applies
   * server-relayed edits through this instead of writing the Y.Text directly.
   */
  adapter: CollabEditorAdapter
  /**
   * Tears down the UndoManager, detaching its observers from the Y.Text/doc.
   * Call this when the session is destroyed (e.g. on file switch) — the
   * EditorView's own teardown disposes the yCollab plugin, but the UndoManager
   * is created here and must be released here too, or its observers linger on
   * the doc until the doc itself is destroyed.
   */
  destroy: () => void
}

/**
 * Creates CodeMirror-specific collaborative editing bindings from a
 * YjsCollabSession. Handles Y.Text creation, UndoManager setup, yCollab
 * extension, and optional read-only mode for viewers.
 *
 * If the document has no snapshot and `initialContent` is provided, it will
 * be inserted into the Y.Text.
 */
export function useCodeMirrorCollab(
  session: YjsCollabSession,
  initialContent?: string
): CodeMirrorCollabResult {
  const ytext = session.ydoc.getText(CODEMIRROR_COLLAB_FIELD)

  if (!session.hasSnapshot && initialContent && ytext.length === 0) {
    ytext.insert(0, initialContent)
  }

  const undoManager = new Y.UndoManager(ytext)
  const extensions: Extension[] = [
    yCollab(ytext, session.awareness, { undoManager }),
  ]

  if (session.role === "viewer") {
    extensions.push(EditorView.editable.of(false))
  }

  const adapter = createCodeMirrorEditorAdapter({
    ydoc: session.ydoc,
    isApplier: session.isAgentApplier,
  })

  return {
    extensions,
    ytext,
    getText: () => ytext.toString(),
    adapter,
    destroy: () => undoManager.destroy(),
  }
}

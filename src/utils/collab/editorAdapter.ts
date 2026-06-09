import { TIPTAP_COLLAB_FIELD } from "@/composables/useTiptapCollab"
import type { JSONContent } from "@tiptap/core"
import type { Schema } from "@tiptap/pm/model"
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap"
import * as Y from "yjs"

/**
 * The single editor-integration seam for live agent edits. `useCollabPage`
 * talks to THIS interface instead of forking on scope and reaching into the
 * transport: a `write` doc and a `code` doc each supply an adapter, and the
 * page is blind to whether the CRDT underneath is a `Y.XmlFragment` (Tiptap)
 * or a `Y.Text` (CodeMirror).
 *
 * Two real scopes (`"write"` | `"code"`) justify the seam — it is not a
 * hypothetical port with one implementation.
 */
export interface CollabEditorAdapter {
  /**
   * Write a server-relayed agent edit into the editor's CRDT representation so
   * the edit — not the human's unsaved draft — becomes the document's source of
   * truth; the editor binding then reconciles the view, the mesh peers, and the
   * snapshot from it. The caller gates this on {@link CollabEditorAdapter.applierStatus}
   * so only one peer per room mutates Y.
   */
  applyAgentEdit: (content: string) => void
  /**
   * Whether THIS client is the elected applier for the room. Only the applier
   * mutates Y; every other peer receives the same agent edit through the WebRTC
   * mesh and must not double-apply it.
   */
  applierStatus: () => boolean
}

/**
 * The Y.Doc text field the CodeMirror `yCollab` binding renders from. Kept next
 * to the adapter that writes it so the write and the binding can't drift.
 */
export const CODEMIRROR_COLLAB_FIELD = "codemirror"

export interface CodeMirrorEditorAdapterOptions {
  ydoc: Y.Doc
  /** Whether this client is the elected applier (see `session.isAgentApplier`). */
  isApplier: () => boolean
}

/**
 * The `code`-scope adapter. Replaces the agent edit's plain text into the shared
 * `Y.Text` wholesale (delete-all + insert) — the write that previously lived
 * inline in `useCollabPage`. The raw-content equality guard keeps an
 * already-current Y.Text from emitting a redundant transaction.
 */
export function createCodeMirrorEditorAdapter(
  options: CodeMirrorEditorAdapterOptions
): CollabEditorAdapter {
  const { ydoc, isApplier } = options

  return {
    applierStatus: isApplier,
    applyAgentEdit: (content) => {
      const ytext = ydoc.getText(CODEMIRROR_COLLAB_FIELD)
      if (ytext.toString() === content) {
        return
      }
      ydoc.transact(() => {
        ytext.delete(0, ytext.length)
        if (content) {
          ytext.insert(0, content)
        }
      })
    },
  }
}

export interface TiptapEditorAdapterOptions {
  ydoc: Y.Doc
  /** Whether this client is the elected applier (see `session.isAgentApplier`). */
  isApplier: () => boolean
  /** The live editor's ProseMirror schema; agent JSON is mapped through it. */
  schema: Schema
  /** Parse a stored/agent content string into ProseMirror JSON. */
  parseContent: (raw: string) => JSONContent
  /**
   * Editor-bound post-write step (e.g. `migrateMathStrings(editor)`). Runs after
   * the fragment write so the live editor can normalize what just landed.
   */
  afterApply?: () => void
}

/**
 * The `write`-scope adapter. Writes the agent edit straight into the shared
 * `Y.XmlFragment` Tiptap's Collaboration extension renders from (a minimal diff
 * via `prosemirrorJSONToYXmlFragment`) rather than calling `setContent`. A bare
 * `setContent` only repaints the ProseMirror view; the y-sync binding would push
 * the human's stale draft back on its next observe tick and the agent edit would
 * "flash" and revert. Mutating the CRDT itself makes the agent edit win. This is
 * the write that previously lived in `TextEditor.vue`, so the editor no longer
 * needs to know about `Y.XmlFragment`.
 */
export function createTiptapEditorAdapter(
  options: TiptapEditorAdapterOptions
): CollabEditorAdapter {
  const { ydoc, isApplier, schema, parseContent, afterApply } = options

  return {
    applierStatus: isApplier,
    applyAgentEdit: (content) => {
      try {
        const fragment = ydoc.getXmlFragment(TIPTAP_COLLAB_FIELD)
        ydoc.transact(() => {
          prosemirrorJSONToYXmlFragment(schema, parseContent(content), fragment)
        })
        afterApply?.()
      } catch (error) {
        console.error("[collab] Failed to apply external content:", error)
      }
    },
  }
}

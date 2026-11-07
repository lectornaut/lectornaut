/**
 * Markdown ⇄ Tiptap (ProseMirror) JSON for `write` nodes, on the official
 * `@tiptap/markdown` MarkdownManager.
 *
 * Agents author content as markdown (far more reliable for an LLM than the
 * nested ProseMirror tree) and read nodes back as markdown, so the forward and
 * reverse directions must agree: both run through the same extension set,
 * whose own `parseMarkdown`/`renderMarkdown` specs define the format (GFM
 * tables, task lists, `$math$`, `:::details` blocks, ...).
 *
 * The extension list mirrors every NODE the editor (`TextEditor.vue`) can
 * store, minus editor-only UI (collab, drag handle, TOC, ...). Unregistered
 * marks (colors, font styles, sub/superscript) degrade to their plain text;
 * an unregistered node would be dropped, so keep this list in step with the
 * editor when adding a block type.
 *
 * Emoji serialize as `:shortcode:` but have no markdown parser upstream; the
 * editor's `healEmojiShortcodes` converts them back on open / agent apply.
 */
import { getSchema, type JSONContent } from "@tiptap/core"
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details"
import { Emoji } from "@tiptap/extension-emoji"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Mathematics } from "@tiptap/extension-mathematics"
import { TableKit } from "@tiptap/extension-table"
import { MarkdownManager } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"

const extensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
  Details,
  DetailsSummary,
  DetailsContent,
  Mathematics,
  Emoji,
  Highlight,
  Image,
]
const markdown = new MarkdownManager({ extensions })
const schema = getSchema(extensions)

/** What the editor treats as an empty document. */
const emptyDoc = (): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph" }],
})

/**
 * Convert markdown to a Tiptap doc. Always returns a valid `{type:"doc"}` with
 * at least one block; unparseable input becomes a single text paragraph so a
 * malformed snippet can never brick the document.
 */
export function markdownToTiptapDoc(source: string): JSONContent {
  if (typeof source !== "string" || !source.trim()) return emptyDoc()
  try {
    const doc = markdown.parse(source)
    return doc.content?.length ? doc : emptyDoc()
  } catch {
    return {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: source }] },
      ],
    }
  }
}

/**
 * Throw if the parsed tree breaks the editor schema (e.g. a bare `:::details`
 * without its `:::detailsSummary`/`:::detailsContent` children), so agent
 * writes fail loudly with a fixable message instead of storing a doc the
 * editor can't open.
 */
export function assertValidTiptapDoc(doc: JSONContent): void {
  schema.nodeFromJSON(doc).check()
}

/** Markdown → the JSON-stringified doc `write` nodes persist in `content`. */
export function markdownToTiptapJson(source: string): string {
  return JSON.stringify(markdownToTiptapDoc(source))
}

/**
 * Inverse of `markdownToTiptapJson`. A non-JSON string (legacy plain-text
 * node) reads back unchanged; anything else that fails renders as "".
 */
export function tiptapJsonToMarkdown(json: string): string {
  if (typeof json !== "string" || !json.trim()) return ""
  let doc: JSONContent
  try {
    doc = JSON.parse(json) as JSONContent
  } catch {
    return json
  }
  if (!doc || typeof doc !== "object") return ""
  try {
    return markdown.serialize(doc).trim()
  } catch {
    return ""
  }
}

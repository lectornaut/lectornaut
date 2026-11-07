import type { Editor } from "@tiptap/core"
import { Extension } from "@tiptap/core"
import { PluginKey, type EditorState } from "@tiptap/pm/state"
import Suggestion from "@tiptap/suggestion"
import type { Component } from "vue"
import {
  createSuggestionPanelRender,
  type SuggestionPanelState,
} from "./suggestionPanel"

export interface SlashCommandItem {
  id: string
  title: string
  description?: string
  group: string
  icon?: Component
  /** Markdown shortcut that produces the same block, shown as a hint. */
  shortcut?: string
  keywords?: string[]
  enabled?: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

export type SlashCommandPanelState = SuggestionPanelState<SlashCommandItem>

export interface SlashCommandOptions {
  items: SlashCommandItem[]
  onChange?: (state: SlashCommandPanelState | null) => void
}

const slashSuggestionKey = new PluginKey("text-editor-slash-command")

const isCodeContext = (state: EditorState, from: number): boolean => {
  const resolved = state.doc.resolve(Math.max(from, 0))

  if (resolved.parent.type.spec.code) {
    return true
  }

  return resolved.marks().some((mark) => mark.type.name === "code")
}

const canOpenSlash = (state: EditorState, from: number): boolean => {
  const charBefore =
    from > 0 ? state.doc.textBetween(from - 1, from, "\n", "\n") : ""

  if (charBefore && !/\s/.test(charBefore)) {
    return false
  }

  const lastEightChars = state.doc.textBetween(
    Math.max(0, from - 8),
    from,
    "\n",
    "\n"
  )

  return !/https?:$/i.test(lastEightChars)
}

/**
 * Lower is better: title prefix, then any title word, then a keyword prefix,
 * then a description/group substring. -1 = no match.
 */
const matchRank = (item: SlashCommandItem, query: string): number => {
  const title = item.title.toLowerCase()
  if (title.startsWith(query)) return 0
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 1
  if (item.keywords?.some((keyword) => keyword.startsWith(query))) return 2
  const rest = `${item.description ?? ""} ${item.group}`.toLowerCase()
  return rest.includes(query) ? 3 : -1
}

export const createSlashCommandExtension = ({
  items,
  onChange,
}: SlashCommandOptions) =>
  Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          pluginKey: slashSuggestionKey,
          editor: this.editor,
          char: "/",
          // Titles have spaces ("Bullet list"); the panel closes itself once
          // a spaced query stops matching anything.
          allowSpaces: true,
          allow: ({ state, range }) =>
            !isCodeContext(state, range.from) &&
            canOpenSlash(state, range.from),
          items: ({ query }) => {
            const available = items.filter(
              (item) => item.enabled?.(this.editor) ?? true
            )
            const normalized = query.trim().toLowerCase()
            if (!normalized) return available

            return available
              .map((item) => ({ item, rank: matchRank(item, normalized) }))
              .filter(({ rank }) => rank >= 0)
              .sort((a, b) => a.rank - b.rank)
              .map(({ item }) => item)
          },
          command: ({ editor: activeEditor, range, props }) => {
            activeEditor.chain().focus().deleteRange(range).run()
            props.run(activeEditor)
          },
          render: createSuggestionPanelRender<
            SlashCommandItem,
            SlashCommandItem
          >({
            pluginKey: slashSuggestionKey,
            toPanelItem: (item) => item,
            onChange,
          }),
        }),
      ]
    },
  })

import type { EmojiItem } from "@tiptap/extension-emoji"
import { EmojiSuggestionPluginKey } from "@tiptap/extension-emoji"
import type { SuggestionOptions } from "@tiptap/suggestion"
import {
  createSuggestionPanelRender,
  type SuggestionPanelState,
} from "./suggestionPanel"

/**
 * Panel wiring for the official Emoji extension's `:` suggestion.
 *
 * The extension ships the suggestion mechanics (char, plugin key, insert
 * command, schema gate) as defaults; this factory supplies only `items` and
 * `render`, sharing the slash menu's panel behaviour and TextEditorCommandPanel.
 */

export interface EmojiPanelItem {
  id: string
  title: string
  description?: string
  group: string
}

export type EmojiPanelState = SuggestionPanelState<EmojiPanelItem>

export interface EmojiSuggestionOptions {
  emojis: EmojiItem[]
  onChange?: (state: EmojiPanelState | null) => void
}

const MAX_RESULTS = 8

const toPanelItem = (item: EmojiItem): EmojiPanelItem => ({
  id: item.name,
  title: `${item.emoji ?? ""} ${item.name}`.trim(),
  description: item.shortcodes.map((code) => `:${code}:`).join(" "),
  group: item.group ?? "Emoji",
})

export const createEmojiSuggestion = ({
  emojis,
  onChange,
}: EmojiSuggestionOptions): Omit<SuggestionOptions<EmojiItem>, "editor"> => ({
  items: ({ query }) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized.length) {
      return []
    }

    return emojis
      .filter((item) => {
        const haystack = [item.name, ...item.shortcodes, ...(item.tags ?? [])]
          .join(" ")
          .toLowerCase()

        return haystack.includes(normalized)
      })
      .slice(0, MAX_RESULTS)
  },
  render: createSuggestionPanelRender<EmojiItem, EmojiPanelItem>({
    pluginKey: EmojiSuggestionPluginKey,
    toPanelItem,
    // The extension's default insert command reads `props` as node attrs.
    choose: (command, item) => command({ name: item.name } as EmojiItem),
    hideWhenEmpty: true,
    onChange,
  }),
})

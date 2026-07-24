import type { EmojiItem } from "@tiptap/extension-emoji"
import { EmojiSuggestionPluginKey } from "@tiptap/extension-emoji"
import { exitSuggestion, type SuggestionOptions } from "@tiptap/suggestion"

/**
 * Panel wiring for the official Emoji extension's `:` suggestion.
 *
 * The extension ships the suggestion mechanics (char, plugin key, insert
 * command, schema gate) as defaults; this factory supplies only `items` and
 * `render`, projecting the suggestion lifecycle into the same state shape the
 * slash-command panel consumes, so both popups share TextEditorCommandPanel.
 */

export interface EmojiPanelItem {
  id: string
  title: string
  description?: string
  group: string
}

export interface EmojiPanelState {
  items: EmojiPanelItem[]
  selectedIndex: number
  clientRect: DOMRect | null
  execute: (index: number) => void
}

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
}: EmojiSuggestionOptions): Omit<SuggestionOptions<EmojiItem>, "editor"> => {
  let currentItems: EmojiItem[] = []
  let currentCommand: ((item: EmojiItem) => void) | null = null
  let selectedIndex = 0
  let currentClientRect: DOMRect | null = null

  const emitState = () => {
    if (!currentItems.length) {
      onChange?.(null)
      return
    }

    onChange?.({
      items: currentItems.map(toPanelItem),
      selectedIndex,
      clientRect: currentClientRect,
      execute: (index: number) => {
        const target = currentItems[index]
        if (!target || !currentCommand) {
          return
        }

        // The extension's default insert command reads `props` as node attrs.
        currentCommand({ name: target.name } as EmojiItem)
      },
    })
  }

  const hidePanel = () => {
    currentItems = []
    currentCommand = null
    currentClientRect = null
    selectedIndex = 0
    onChange?.(null)
  }

  return {
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
    render: () => ({
      onStart: (props) => {
        currentItems = props.items
        currentCommand = props.command
        selectedIndex = 0
        currentClientRect = props.clientRect?.() ?? null
        emitState()
      },
      onUpdate: (props) => {
        currentItems = props.items
        currentCommand = props.command
        selectedIndex = Math.min(
          selectedIndex,
          Math.max(currentItems.length - 1, 0)
        )
        currentClientRect = props.clientRect?.() ?? null
        emitState()
      },
      onKeyDown: ({ event, view }) => {
        if (!currentItems.length) {
          return false
        }

        if (event.key === "ArrowDown") {
          event.preventDefault()
          selectedIndex = (selectedIndex + 1) % currentItems.length
          emitState()
          return true
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          selectedIndex =
            (selectedIndex + currentItems.length - 1) % currentItems.length
          emitState()
          return true
        }

        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          const selected = currentItems[selectedIndex]
          if (selected && currentCommand) {
            currentCommand({ name: selected.name } as EmojiItem)
          }
          return true
        }

        if (event.key === "Escape") {
          event.preventDefault()
          exitSuggestion(view, EmojiSuggestionPluginKey)
          hidePanel()
          return true
        }

        return false
      },
      onExit: () => {
        hidePanel()
      },
    }),
  }
}

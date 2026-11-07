import type { PluginKey } from "@tiptap/pm/state"
import {
  exitSuggestion,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion"

/** What TextEditorCommandPanel renders for a live suggestion. */
export interface SuggestionPanelState<I> {
  items: I[]
  selectedIndex: number
  /** Live caret rect; re-read on every reposition so the panel follows it. */
  getRect: () => DOMRect | null
  execute: (index: number) => void
  /** Pointer hover moves the same selection Enter acts on. */
  hover: (index: number) => void
}

interface SuggestionPanelOptions<T, I> {
  pluginKey: PluginKey
  toPanelItem: (item: T) => I
  /** How a chosen item is applied (defaults to the suggestion's command). */
  choose?: (command: (item: T) => void, item: T) => void
  onChange?: (state: SuggestionPanelState<I> | null) => void
  /** Hide instead of showing an empty state when nothing matches. */
  hideWhenEmpty?: boolean
}

/**
 * Shared `render` for the slash and emoji suggestions: ↑/↓ wrap, Enter/Tab
 * choose, Esc closes, and one selected index that keys and hover both drive,
 * reset to the top whenever the query changes.
 */
export const createSuggestionPanelRender =
  <T, I>({
    pluginKey,
    toPanelItem,
    choose = (command, item) => command(item),
    onChange,
    hideWhenEmpty = false,
  }: SuggestionPanelOptions<T, I>): NonNullable<
    SuggestionOptions<T>["render"]
  > =>
  () => {
    let props: SuggestionProps<T> | null = null
    let selectedIndex = 0

    const emit = () => {
      const current = props
      if (!current || (hideWhenEmpty && !current.items.length)) {
        onChange?.(null)
        return
      }
      onChange?.({
        items: current.items.map(toPanelItem),
        selectedIndex,
        getRect: () => current.clientRect?.() ?? null,
        execute: (index) => {
          const item = current.items[index]
          if (item) choose(current.command, item)
        },
        hover: (index) => {
          if (index === selectedIndex) return
          selectedIndex = index
          emit()
        },
      })
    }

    const move = (delta: number) => {
      const count = props?.items.length ?? 0
      if (!count) return
      selectedIndex = (selectedIndex + delta + count) % count
      emit()
    }

    return {
      // Tiptap ≥3.33 calls onStart/onUpdate once with `loading: true` and no
      // items before the fetch resolves; keep showing the previous results
      // instead of flashing (or acting on) that empty placeholder.
      onStart: (next) => {
        props = next
        selectedIndex = 0
        if (!next.loading) emit()
      },
      onUpdate: (next) => {
        if (next.loading) return
        if (next.query !== props?.query) selectedIndex = 0
        props = next
        // No match and the query already holds a space: that's prose, not a
        // command search. Close (after this update) rather than linger empty.
        if (!next.items.length && /\s/.test(next.query)) {
          onChange?.(null)
          queueMicrotask(() => exitSuggestion(next.editor.view, pluginKey))
          return
        }
        emit()
      },
      onKeyDown: ({ event, view }) => {
        if (event.key === "Escape") {
          exitSuggestion(view, pluginKey)
          return true
        }
        if (!props?.items.length) return false

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          move(event.key === "ArrowDown" ? 1 : -1)
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          const item = props.items[selectedIndex]
          if (item) choose(props.command, item)
          return true
        }
        return false
      },
      onExit: () => {
        props = null
        selectedIndex = 0
        onChange?.(null)
      },
    }
  }

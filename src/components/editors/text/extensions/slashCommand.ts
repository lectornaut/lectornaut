import type { Editor } from "@tiptap/core"
import { Extension } from "@tiptap/core"
import { PluginKey, type EditorState } from "@tiptap/pm/state"
import Suggestion, { exitSuggestion } from "@tiptap/suggestion"

export interface SlashCommandItem {
  id: string
  title: string
  description?: string
  group: string
  keywords?: string[]
  enabled?: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

export interface SlashCommandPanelState {
  query: string
  items: SlashCommandItem[]
  selectedIndex: number
  clientRect: DOMRect | null
  execute: (index: number) => void
}

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

  if (/https?:$/i.test(lastEightChars)) {
    return false
  }

  return true
}

export const createSlashCommandExtension = ({
  items,
  onChange,
}: SlashCommandOptions) => {
  let currentItems: SlashCommandItem[] = []
  let currentCommand: ((item: SlashCommandItem) => void) | null = null
  let selectedIndex = 0
  let currentClientRect: DOMRect | null = null
  let currentQuery = ""

  const emitState = (query: string) => {
    onChange?.({
      query,
      items: currentItems,
      selectedIndex,
      clientRect: currentClientRect,
      execute: (index: number) => {
        const target = currentItems[index]
        if (!target || !currentCommand) {
          return
        }

        currentCommand(target)
      },
    })
  }

  const hidePanel = () => {
    currentItems = []
    currentCommand = null
    currentClientRect = null
    selectedIndex = 0
    currentQuery = ""
    onChange?.(null)
  }

  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          pluginKey: slashSuggestionKey,
          editor: this.editor,
          char: "/",
          allow: ({ state, range }) =>
            !isCodeContext(state, range.from) &&
            canOpenSlash(state, range.from),
          items: ({ query }) => {
            const normalized = query.trim().toLowerCase()

            const available = items.filter(
              (item) => item.enabled?.(this.editor) ?? true
            )
            if (!normalized.length) {
              return available.slice(0, 20)
            }

            return available
              .filter((item) => {
                const haystack = [
                  item.title,
                  item.description ?? "",
                  ...(item.keywords ?? []),
                  item.group,
                ]
                  .join(" ")
                  .toLowerCase()

                return haystack.includes(normalized)
              })
              .slice(0, 20)
          },
          command: ({ editor: activeEditor, range, props }) => {
            activeEditor.chain().focus().deleteRange(range).run()
            props.run(activeEditor)
          },
          render: () => ({
            onStart: (props) => {
              currentItems = props.items
              currentCommand = props.command
              selectedIndex = 0
              currentClientRect = props.clientRect?.() ?? null
              currentQuery = props.query
              emitState(props.query)
            },
            onUpdate: (props) => {
              currentItems = props.items
              currentCommand = props.command
              selectedIndex = Math.min(
                selectedIndex,
                Math.max(currentItems.length - 1, 0)
              )
              currentClientRect = props.clientRect?.() ?? null
              currentQuery = props.query
              emitState(props.query)
            },
            onKeyDown: ({ event, view }) => {
              if (!currentItems.length) {
                return false
              }

              if (event.key === "ArrowDown") {
                event.preventDefault()
                selectedIndex = (selectedIndex + 1) % currentItems.length
                emitState(currentQuery)
                return true
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                selectedIndex =
                  (selectedIndex + currentItems.length - 1) %
                  currentItems.length
                emitState(currentQuery)
                return true
              }

              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault()
                const selected = currentItems[selectedIndex]
                if (selected) {
                  currentCommand?.(selected)
                }
                return true
              }

              if (event.key === "Escape") {
                event.preventDefault()
                exitSuggestion(view, slashSuggestionKey)
                hidePanel()
                return true
              }

              return false
            },
            onExit: () => {
              hidePanel()
            },
          }),
        }),
      ]
    },
  })
}

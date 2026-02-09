import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

const SHORTCODE_MAP: Record<string, string> = {
  smile: "😄",
  smiley: "😄",
  thumbsup: "👍",
  "+1": "👍",
  heart: "❤️",
  fire: "🔥",
  rocket: "🚀",
  eyes: "👀",
  tada: "🎉",
  party: "🎉",
  check: "✅",
  white_check_mark: "✅",
  x: "❌",
  cross: "❌",
  cross_mark: "❌",
  grin: "😁",
  joy: "😂",
  wink: "😉",
  wave: "👋",
  clap: "👏",
  ok: "👌",
  hundred: "💯",
}

const EMOTICON_MAP: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /(^|\s):\)$/, emoji: "🙂" },
  { pattern: /(^|\s):\($/, emoji: "🙁" },
  { pattern: /(^|\s)<3$/, emoji: "❤️" },
]

const SHORTCODE_PATTERN = /(^|\s):([a-z0-9_+-]+):$/i
const REPLACEMENT_PLUGIN_KEY = "emoji-replacer"

const isCodeContext = (state: EditorState, start: number): boolean => {
  const $from = state.doc.resolve(Math.max(start, 0))

  if ($from.parent.type.spec.code) {
    return true
  }

  if (state.storedMarks?.some((mark) => mark.type.name === "code")) {
    return true
  }

  return $from.marks().some((mark) => mark.type.name === "code")
}

const getReplacementMatch = (
  textBeforeWithInput: string
): { fullMatch: string; replacement: string } | null => {
  const shortcodeMatch = textBeforeWithInput.match(SHORTCODE_PATTERN)
  if (shortcodeMatch?.[0]) {
    const shortcode = shortcodeMatch[2]?.toLowerCase()
    const emoji = shortcode ? SHORTCODE_MAP[shortcode] : null

    if (emoji) {
      const fullMatch = shortcodeMatch[0]
      const hasLeadingSpace = fullMatch.startsWith(" ")
      return {
        fullMatch,
        replacement: `${hasLeadingSpace ? " " : ""}${emoji}`,
      }
    }
  }

  for (const { pattern, emoji } of EMOTICON_MAP) {
    const emoticonMatch = textBeforeWithInput.match(pattern)
    if (!emoticonMatch?.[0]) {
      continue
    }

    const fullMatch = emoticonMatch[0]
    const hasLeadingSpace = fullMatch.startsWith(" ")
    return {
      fullMatch,
      replacement: `${hasLeadingSpace ? " " : ""}${emoji}`,
    }
  }

  return null
}

const applyReplacementIfNeeded = (
  view: EditorView,
  from: number,
  to: number,
  text: string
): boolean => {
  const { state } = view

  if (isCodeContext(state, from)) {
    return false
  }

  const $from = state.doc.resolve(from)
  if (!$from.parent.isTextblock) {
    return false
  }

  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    ""
  )
  const candidate = `${textBefore}${text}`
  const replacementMatch = getReplacementMatch(candidate)

  if (!replacementMatch) {
    return false
  }

  const existingPartLength = replacementMatch.fullMatch.length - text.length
  const replaceFrom = from - existingPartLength

  if (replaceFrom < 0) {
    return false
  }

  const tr = state.tr.insertText(replacementMatch.replacement, replaceFrom, to)
  view.dispatch(tr)
  return true
}

export const EmojiReplacer = Extension.create({
  name: "emojiReplacer",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey(REPLACEMENT_PLUGIN_KEY),
        props: {
          handleTextInput: (view, from, to, text) =>
            applyReplacementIfNeeded(view, from, to, text),
        },
      }),
    ]
  },
})

export { SHORTCODE_MAP }

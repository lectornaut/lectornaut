import type { Editor } from "@tiptap/core"
import { shortcodeToEmoji } from "@tiptap/extension-emoji"

/**
 * One-shot content normalization: convert literal `:shortcode:` text into
 * emoji nodes. Agents write shortcodes (the markdown converter serializes
 * emoji nodes as `:name:`), so healing on open and after each applied agent
 * edit closes the round trip — the sibling of `migrateMathStrings`.
 *
 * Only shortcodes present in the configured emoji dataset convert; anything
 * else (":8080:", ":not-a-thing:") stays literal text. Code blocks and
 * code-marked text are skipped.
 */
const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi

export const healEmojiShortcodes = (editor: Editor): void => {
  const { state } = editor
  const emojiType = state.schema.nodes.emoji
  const knownEmojis = editor.storage.emoji?.emojis
  if (!emojiType || !knownEmojis?.length) {
    return
  }

  const replacements: Array<{ from: number; to: number; name: string }> = []

  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) {
      return
    }
    if (parent?.type.spec.code) {
      return
    }
    if (node.marks.some((mark) => mark.type.name === "code")) {
      return
    }

    for (const match of node.text.matchAll(SHORTCODE_RE)) {
      const item = shortcodeToEmoji(match[1].toLowerCase(), knownEmojis)
      if (!item || match.index === undefined) {
        continue
      }

      const from = pos + match.index
      replacements.push({
        from,
        to: from + match[0].length,
        name: item.name,
      })
    }
  })

  if (!replacements.length) {
    return
  }

  // Apply back-to-front so earlier positions stay valid without remapping.
  const tr = state.tr
  for (const { from, to, name } of replacements.reverse()) {
    tr.replaceWith(from, to, emojiType.create({ name }))
  }
  editor.view.dispatch(tr)
}

/**
 * Minimal Markdown ⇄ Tiptap (ProseMirror) JSON converters.
 *
 * Forward (`markdownToTiptapJson`): agents author content as markdown and we
 * convert it to the JSON shape `write` nodes persist. Reverse
 * (`tiptapJsonToMarkdown`): render a stored doc back to markdown so an agent
 * can READ a node in the same format it WRITES (see `readNode`), enabling a
 * lossless read → edit → overwrite loop.
 *
 * Workspace `write` nodes persist their editor state as JSON-stringified
 * ProseMirror (`{type:"doc",content:[…]}`, StarterKit schema). Agents author
 * content as markdown — far more reliable for an LLM than hand-writing the
 * nested ProseMirror tree — and this converter turns that markdown into the
 * exact JSON shape the Tiptap editor seeds from (`TextEditor.vue`'s
 * `setContent`). `code` nodes are NOT converted (they store raw source).
 *
 * Scope: the common blocks an agent emits — headings, paragraphs, bullet /
 * ordered lists, fenced code blocks, blockquotes, horizontal rules — plus
 * inline bold / italic / code / links. Anything unrecognized degrades to a
 * plain paragraph rather than throwing, so a malformed snippet can never
 * brick the document. This is deliberately not a CommonMark-complete parser
 * (no nested lists, tables, or reference links); it covers what agents
 * actually produce and stays small enough to audit.
 */

// ─── Tiptap node/mark shapes (StarterKit) ────────────────────────────────────

interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

const EMPTY_DOC: TiptapNode = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

// ─── Inline parsing ──────────────────────────────────────────────────────────

// Ordered by precedence: inline code first (its contents are literal, so we
// must not parse emphasis inside it), then links, then bold, then italic.
const INLINE_PATTERN =
  /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/
const LINK_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)\)$/

/**
 * Turn one line of markdown into an array of Tiptap text nodes with marks.
 * Empty input yields an empty array (caller decides whether to emit an
 * empty paragraph). Nesting (bold-in-italic etc.) is intentionally not
 * supported — each token carries a single mark.
 */
function parseInline(input: string): TiptapNode[] {
  const out: TiptapNode[] = []
  let rest = input

  const pushText = (text: string, marks?: TiptapMark[]) => {
    if (!text) return
    out.push(
      marks?.length ? { type: "text", text, marks } : { type: "text", text }
    )
  }

  while (rest.length > 0) {
    const match = rest.match(INLINE_PATTERN)
    if (!match || match.index === undefined) {
      pushText(rest)
      break
    }

    // Plain text before the matched token.
    if (match.index > 0) pushText(rest.slice(0, match.index))

    const token = match[0]
    if (token.startsWith("`")) {
      pushText(token.slice(1, -1), [{ type: "code" }])
    } else if (token.startsWith("[")) {
      const link = token.match(LINK_PATTERN)
      if (link) {
        pushText(link[1], [{ type: "link", attrs: { href: link[2] } }])
      } else {
        pushText(token)
      }
    } else if (token.startsWith("**") || token.startsWith("__")) {
      pushText(token.slice(2, -2), [{ type: "bold" }])
    } else {
      pushText(token.slice(1, -1), [{ type: "italic" }])
    }

    rest = rest.slice(match.index + token.length)
  }

  return out
}

function paragraph(text: string): TiptapNode {
  const inline = parseInline(text)
  return inline.length
    ? { type: "paragraph", content: inline }
    : { type: "paragraph" }
}

// ─── Block parsing ───────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/
const BULLET_RE = /^[-*+]\s+(.*)$/
const ORDERED_RE = /^(\d+)\.\s+(.*)$/
const BLOCKQUOTE_RE = /^>\s?(.*)$/
const FENCE_RE = /^```(\w+)?\s*$/
const FENCE_CLOSE_RE = /^```\s*$/

function listItem(text: string): TiptapNode {
  return { type: "listItem", content: [paragraph(text)] }
}

/**
 * Convert a markdown string to a Tiptap document node. Always returns a
 * valid `{type:"doc"}` with at least one block (an empty paragraph for
 * blank input), matching what the editor treats as an empty document.
 */
export function markdownToTiptapDoc(markdown: string): TiptapNode {
  const source = typeof markdown === "string" ? markdown : ""
  if (!source.trim()) return EMPTY_DOC

  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const blocks: TiptapNode[] = []
  let i = 0

  // Buffer for grouping consecutive plain lines into one paragraph.
  let paragraphBuf: string[] = []
  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return
    blocks.push(paragraph(paragraphBuf.join(" ").trim()))
    paragraphBuf = []
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Fenced code block — consume until the closing fence.
    const fence = trimmed.match(FENCE_RE)
    if (fence) {
      flushParagraph()
      const language = fence[1] ?? null
      const code: string[] = []
      i += 1
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i].trim())) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // skip closing fence (or run off the end)
      blocks.push({
        type: "codeBlock",
        attrs: { language },
        content: code.length ? [{ type: "text", text: code.join("\n") }] : [],
      })
      continue
    }

    if (trimmed === "") {
      flushParagraph()
      i += 1
      continue
    }

    if (HR_RE.test(trimmed)) {
      flushParagraph()
      blocks.push({ type: "horizontalRule" })
      i += 1
      continue
    }

    const heading = trimmed.match(HEADING_RE)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      const inline = parseInline(heading[2].trim())
      blocks.push({
        type: "heading",
        attrs: { level },
        content: inline.length ? inline : [],
      })
      i += 1
      continue
    }

    if (BULLET_RE.test(trimmed)) {
      flushParagraph()
      const items: TiptapNode[] = []
      while (i < lines.length) {
        const m = lines[i].trim().match(BULLET_RE)
        if (!m) break
        items.push(listItem(m[1]))
        i += 1
      }
      blocks.push({ type: "bulletList", content: items })
      continue
    }

    if (ORDERED_RE.test(trimmed)) {
      flushParagraph()
      const items: TiptapNode[] = []
      let start: number | null = null
      while (i < lines.length) {
        const m = lines[i].trim().match(ORDERED_RE)
        if (!m) break
        if (start === null) start = Number.parseInt(m[1], 10) || 1
        items.push(listItem(m[2]))
        i += 1
      }
      blocks.push({
        type: "orderedList",
        attrs: { start: start ?? 1 },
        content: items,
      })
      continue
    }

    if (BLOCKQUOTE_RE.test(trimmed)) {
      flushParagraph()
      const quoteLines: string[] = []
      while (i < lines.length) {
        const m = lines[i].trim().match(BLOCKQUOTE_RE)
        if (!m) break
        quoteLines.push(m[1])
        i += 1
      }
      blocks.push({
        type: "blockquote",
        content: [paragraph(quoteLines.join(" ").trim())],
      })
      continue
    }

    // Default: accumulate into the current paragraph (markdown soft-wrap).
    paragraphBuf.push(trimmed)
    i += 1
  }

  flushParagraph()

  return blocks.length ? { type: "doc", content: blocks } : EMPTY_DOC
}

/**
 * Convert markdown to the JSON-stringified Tiptap doc that `write` nodes
 * persist in their `content` field.
 */
export function markdownToTiptapJson(markdown: string): string {
  return JSON.stringify(markdownToTiptapDoc(markdown))
}

// ─── Tiptap → Markdown (inverse) ─────────────────────────────────────────────
//
// Renders a stored doc back to markdown. Symmetric with the forward converter
// (same StarterKit block/mark set), but it must also tolerate shapes the real
// editor produces that the forward parser never emits — nested lists, hard
// breaks, strikethrough, and any unknown node. Anything unrecognized degrades
// to its text content rather than throwing, so reading can never fail on an
// unexpected document.

function serializeMarks(text: string, marks?: TiptapMark[]): string {
  if (!text) return ""
  if (!marks?.length) return text
  let out = text
  for (const mark of marks) {
    switch (mark.type) {
      case "code":
        out = "`" + out + "`"
        break
      case "bold":
        out = `**${out}**`
        break
      case "italic":
        out = `*${out}*`
        break
      case "strike":
        out = `~~${out}~~`
        break
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : ""
        if (href) out = `[${out}](${href})`
        break
      }
      // Unknown marks (e.g. underline) pass through as plain text.
    }
  }
  return out
}

function serializeInline(nodes: TiptapNode[] | undefined): string {
  if (!Array.isArray(nodes)) return ""
  let out = ""
  for (const node of nodes) {
    if (node.type === "text") {
      out += serializeMarks(node.text ?? "", node.marks)
    } else if (node.type === "hardBreak") {
      out += "\n"
    } else if (Array.isArray(node.content)) {
      out += serializeInline(node.content)
    } else if (typeof node.text === "string") {
      out += node.text
    }
  }
  return out
}

function serializeList(
  list: TiptapNode,
  depth: number,
  ordered: boolean
): string {
  const items = Array.isArray(list.content) ? list.content : []
  const indent = "  ".repeat(depth)
  const start = ordered ? Number(list.attrs?.start) || 1 : 1
  const lines: string[] = []
  items.forEach((item, index) => {
    const marker = ordered ? `${start + index}. ` : "- "
    const blocks = Array.isArray(item.content) ? item.content : []
    let first = true
    for (const block of blocks) {
      if (block.type === "bulletList" || block.type === "orderedList") {
        lines.push(
          serializeList(block, depth + 1, block.type === "orderedList")
        )
        continue
      }
      const text = serializeBlock(block, depth)
      if (first) {
        lines.push(`${indent}${marker}${text}`)
        first = false
      } else {
        // Continuation block under the same item — align past the marker.
        lines.push(`${indent}  ${text}`)
      }
    }
    if (first) lines.push(`${indent}${marker}`) // empty item
  })
  return lines.join("\n")
}

function serializeBlock(node: TiptapNode, depth: number): string {
  switch (node.type) {
    case "paragraph":
      return serializeInline(node.content)
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      return `${"#".repeat(level)} ${serializeInline(node.content)}`.trimEnd()
    }
    case "codeBlock": {
      const language =
        typeof node.attrs?.language === "string" ? node.attrs.language : ""
      return "```" + language + "\n" + serializeInline(node.content) + "\n```"
    }
    case "blockquote": {
      const inner = serializeChildren(node.content, depth)
      return inner
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n")
    }
    case "horizontalRule":
      return "---"
    case "bulletList":
      return serializeList(node, depth, false)
    case "orderedList":
      return serializeList(node, depth, true)
    case "listItem":
      // Normally consumed by serializeList; reachable only for a stray item.
      return serializeChildren(node.content, depth)
    default:
      // Unknown block: recurse into children, else fall back to its text.
      if (Array.isArray(node.content)) {
        return serializeChildren(node.content, depth)
      }
      return node.text ?? ""
  }
}

function serializeChildren(
  content: TiptapNode[] | undefined,
  depth: number
): string {
  if (!Array.isArray(content)) return ""
  return content
    .map((node) => serializeBlock(node, depth))
    .filter((block) => block.length > 0)
    .join("\n\n")
}

/**
 * Render a Tiptap doc node to markdown. Best-effort for non-doc input
 * (extracts text) so a malformed or legacy value never throws.
 */
export function tiptapDocToMarkdown(
  doc: TiptapNode | null | undefined
): string {
  if (!doc || typeof doc !== "object") return ""
  if (doc.type !== "doc" || !Array.isArray(doc.content)) {
    return serializeInline(doc.content) || (doc.text ?? "")
  }
  return serializeChildren(doc.content, 0).trim()
}

/**
 * Inverse of `markdownToTiptapJson`: turn the JSON-stringified Tiptap doc a
 * `write` node persists back into markdown. A non-JSON string is returned
 * unchanged — defensive against a legacy node that stored plain text, which
 * should read back as-is rather than getting mangled.
 */
export function tiptapJsonToMarkdown(json: string): string {
  if (typeof json !== "string" || !json.trim()) return ""
  let doc: TiptapNode
  try {
    doc = JSON.parse(json) as TiptapNode
  } catch {
    return json
  }
  return tiptapDocToMarkdown(doc)
}

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
 * ordered / task lists (nested via 2-space indentation, `- [x]` GFM boxes),
 * fenced code blocks, blockquotes, horizontal rules, images — plus inline
 * bold / italic / code / links. Anything unrecognized degrades to a plain
 * paragraph rather than throwing, so a malformed snippet can never brick the
 * document. This is deliberately not a CommonMark-complete parser (no tables
 * or reference links); it covers what agents actually produce and stays small
 * enough to audit.
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
  /(`[^`]+`)|(!?\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/
const LINK_PATTERN = /^!?\[([^\]]+)\]\(([^)\s]+)\)$/

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
    } else if (token.startsWith("[") || token.startsWith("![")) {
      // Mid-paragraph images degrade to a link on the alt text — the editor's
      // Image node is block-level, so it can't live inside a paragraph.
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
// A line that is exactly one image (optional title ignored). The editor's
// Image node is block-level, so images only convert when they stand alone;
// a mid-paragraph image degrades to a link on its alt text (see parseInline).
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/
// One regex for every list line: leading indent, then a bullet or ordered
// marker. A GFM task box (`[ ]` / `[x]`) is peeled off the text afterwards.
const LIST_LINE_RE = /^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/
const TASK_BOX_RE = /^\[([ xX])\]\s*(.*)$/
const BLOCKQUOTE_RE = /^>\s?(.*)$/
const FENCE_RE = /^```(\w+)?\s*$/
const FENCE_CLOSE_RE = /^```\s*$/

type ListKind = "bullet" | "ordered" | "task"

const LIST_TYPE: Record<ListKind, string> = {
  bullet: "bulletList",
  ordered: "orderedList",
  task: "taskList",
}

function makeItem(kind: ListKind, checked: boolean, text: string): TiptapNode {
  return kind === "task"
    ? { type: "taskItem", attrs: { checked }, content: [paragraph(text)] }
    : { type: "listItem", content: [paragraph(text)] }
}

/**
 * Parse a run of consecutive list lines (until a blank or non-list line) into
 * one or more list nodes, honoring indentation for nesting. Any consistent
 * indent step works (our serializer emits 2 spaces; tabs count as 2). A
 * same-level marker-kind switch (`-` → `- [x]` → `1.`) closes the open list
 * and starts a sibling of the new kind, mirroring how markdown renders it.
 */
function parseListBlock(
  lines: string[],
  startIndex: number
): { nodes: TiptapNode[]; next: number } {
  const rootNodes: TiptapNode[] = []
  interface OpenList {
    list: TiptapNode
    indent: number
    kind: ListKind
    container: TiptapNode[]
  }
  const stack: OpenList[] = []
  let i = startIndex

  while (i < lines.length) {
    const match = lines[i].match(LIST_LINE_RE)
    if (!match) break

    const indent = match[1].replace(/\t/g, "  ").length
    const ordered = match[3] !== undefined
    const task = match[4].match(TASK_BOX_RE)
    const kind: ListKind = task ? "task" : ordered ? "ordered" : "bullet"
    const text = task ? task[2] : match[4]
    const checked = task ? task[1].toLowerCase() === "x" : false

    // Dedent: close lists deeper than this line.
    while (stack.length && indent < stack[stack.length - 1].indent) {
      stack.pop()
    }

    let top = stack[stack.length - 1]
    if (!top || indent > top.indent) {
      // First list, or a deeper level: nest inside the last item of the
      // current list (after its paragraph), or at the root.
      let container = rootNodes
      if (top) {
        const items = top.list.content ?? (top.list.content = [])
        const lastItem = items[items.length - 1]
        if (lastItem) {
          container = lastItem.content ?? (lastItem.content = [])
        }
      }
      top = { list: openList(kind, match[3]), indent, kind, container }
      container.push(top.list)
      stack.push(top)
    } else if (top.kind !== kind) {
      // Same level, different marker: sibling list in the same container.
      stack.pop()
      top = {
        list: openList(kind, match[3]),
        indent,
        kind,
        container: top.container,
      }
      top.container.push(top.list)
      stack.push(top)
    }

    top.list.content?.push(makeItem(kind, checked, text))
    i += 1
  }

  return { nodes: rootNodes, next: i }
}

function openList(
  kind: ListKind,
  orderedStart: string | undefined
): TiptapNode {
  const node: TiptapNode = { type: LIST_TYPE[kind], content: [] }
  if (kind === "ordered") {
    node.attrs = { start: Number.parseInt(orderedStart ?? "1", 10) || 1 }
  }
  return node
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

    const image = trimmed.match(IMAGE_RE)
    if (image) {
      flushParagraph()
      blocks.push({
        type: "image",
        attrs: { src: image[2], alt: image[1] || null },
      })
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

    if (LIST_LINE_RE.test(line)) {
      flushParagraph()
      const { nodes, next } = parseListBlock(lines, i)
      blocks.push(...nodes)
      i = next
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
// (same StarterKit block/mark set plus task lists and nesting), but it must
// also tolerate shapes the real editor produces that the forward parser never
// emits — hard breaks, strikethrough, and any unknown node. Anything
// unrecognized degrades to its text content rather than throwing, so reading
// can never fail on an unexpected document.

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
    } else if (node.type === "emoji") {
      // Editor emoji nodes carry only a shortcode name; emit GitHub-style
      // `:name:` (matching the extension's own renderMarkdown), which agents
      // read and write back as literal text — stable across round trips.
      const name = typeof node.attrs?.name === "string" ? node.attrs.name : ""
      if (name) out += `:${name}:`
    } else if (Array.isArray(node.content)) {
      out += serializeInline(node.content)
    } else if (typeof node.text === "string") {
      out += node.text
    }
  }
  return out
}

const NESTED_LIST_KIND: Record<string, ListKind> = {
  bulletList: "bullet",
  orderedList: "ordered",
  taskList: "task",
}

function serializeList(
  list: TiptapNode,
  depth: number,
  kind: ListKind
): string {
  const items = Array.isArray(list.content) ? list.content : []
  const indent = "  ".repeat(depth)
  const start = kind === "ordered" ? Number(list.attrs?.start) || 1 : 1
  const lines: string[] = []
  items.forEach((item, index) => {
    const marker =
      kind === "ordered"
        ? `${start + index}. `
        : kind === "task"
          ? item.attrs?.checked === true
            ? "- [x] "
            : "- [ ] "
          : "- "
    const blocks = Array.isArray(item.content) ? item.content : []
    let first = true
    for (const block of blocks) {
      const nestedKind = NESTED_LIST_KIND[block.type ?? ""]
      if (nestedKind) {
        lines.push(serializeList(block, depth + 1, nestedKind))
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
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : ""
      if (!src) return ""
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : ""
      return `![${alt}](${src})`
    }
    case "bulletList":
      return serializeList(node, depth, "bullet")
    case "orderedList":
      return serializeList(node, depth, "ordered")
    case "taskList":
      return serializeList(node, depth, "task")
    case "listItem":
    case "taskItem":
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

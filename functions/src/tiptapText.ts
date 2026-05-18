/**
 * Extract plain text from a Tiptap/ProseMirror JSON document, falling back
 * to the input string when the content isn't an unambiguously Tiptap-
 * shaped document.
 *
 * Workspace `write` nodes persist their editor state as a JSON-stringified
 * ProseMirror tree (e.g. `{"type":"doc","content":[{"type":"heading",...]}`).
 * Feeding that JSON directly to an embedder or summarizer dilutes the
 * semantic signal with structural noise (`type`, `attrs`, marks, etc.),
 * which hurts retrieval recall and summary quality. This helper flattens
 * the tree to a plain-text string by collecting every `text` leaf under
 * a Tiptap document root.
 *
 * Why the strict root-shape check (`type === "doc"`): the same `content`
 * field on `code` nodes holds raw source files, which can legitimately
 * include JSON (package.json, tsconfig.json, OpenAPI specs, etc.). A
 * looser "walk any JSON tree for text leaves" extractor would silently
 * substitute a single `text` property's value for the whole file when a
 * code file happens to contain one. Requiring the Tiptap doc discriminator
 * at the root keeps this helper safe to call on every node, regardless
 * of scope — non-Tiptap content (source code, plain markdown, raw JSON,
 * anything without the `{type:"doc",...}` shape) passes through unchanged.
 */
export function extractPlainText(maybeJson: string): string {
  if (!maybeJson) return ""

  const trimmed = maybeJson.trim()
  // Cheap pre-filter — Tiptap docs are objects, not arrays or primitives.
  // Anything that doesn't start with `{` can't be a Tiptap root, so skip
  // the JSON.parse round-trip entirely.
  if (!trimmed.startsWith("{")) return maybeJson

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return maybeJson
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return maybeJson
  }

  // Strict discriminator. ProseMirror/Tiptap always emits this root shape;
  // other JSON-shaped payloads (config files, API responses, etc.) won't
  // match and will be returned untouched.
  if ((parsed as { type?: unknown }).type !== "doc") return maybeJson

  const out: string[] = []
  walk(parsed, out)

  // Tiptap doc with no text content (e.g. an empty editor state). Return
  // empty string — the *intent* is empty, not "we couldn't extract".
  // Callers (embed trigger, summarizer) handle empty content explicitly.
  return out.join(" ").replace(/\s+/g, " ").trim()
}

function walk(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return
  }
  const obj = node as Record<string, unknown>
  if (typeof obj.text === "string") out.push(obj.text)
  if (Array.isArray(obj.content)) walk(obj.content, out)
}

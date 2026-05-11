<script lang="ts" setup>
import {
  BotChatContextKey,
  type BotChatMessage,
  type BotChatSegment,
} from "@/composables/useBotChat"
import MarkdownRender, {
  getMarkdown,
  parseMarkdownToStructure,
} from "markstream-vue"
import {
  IconAiFill,
  IconCopy,
  IconPenLine,
  IconReply,
  IconTrash,
} from "@/data/icons"
import Avatar from "vue-boring-avatars"
import { inject } from "vue"
import "markstream-vue/index.css"
import "katex/dist/katex.min.css"

const isDark = usePreferredDark()

const botChat = inject(BotChatContextKey)
const messages = computed(() => botChat?.messages.value ?? [])
const isSending = computed(() => botChat?.isSending.value ?? false)
const sessionId = computed(() => botChat?.sessionId.value ?? null)

// While streaming, `useBotChat` pushes an empty agent placeholder before
// chunks arrive and mutates its `.content` / `.segments` in place. Hide
// that empty bubble until at least one chunk lands (text OR tool call).
const tailIsEmptyAgent = computed(() => {
  const last = messages.value[messages.value.length - 1]
  if (last?.role !== "agent") return false
  if (last.content.length > 0) return false
  if ((last.segments?.length ?? 0) > 0) return false
  return true
})
const displayMessages = computed(() =>
  tailIsEmptyAgent.value ? messages.value.slice(0, -1) : messages.value
)
// Drive the "Thinking…" indicator off a *broader* condition than the
// empty-placeholder check above. There are two distinct gaps where the
// agent is generating but has no in-flight output to render:
//
//   • Initial turn — empty placeholder pushed by `sendMessage`, no
//     chunks yet (covered by `tailIsEmptyAgent`).
//   • Resumed turn — `respondToInterrupt` (and any post-tool-result gap
//     before the next text chunk) keeps streaming into the *same* agent
//     message that already has visible segments. The bubble isn't
//     empty, but the tail is a *completed* tool (output filled, not
//     paused for input), so nothing is moving on screen until the model
//     emits its next text/tool.
//
// The indicator hides as soon as the tail flips "active": a streaming
// text segment (chunks mutating it in place) or a still-running tool
// (output undefined — its card already shows a running spinner, no
// need to double up).
const tailAwaitingNewChunk = computed(() => {
  const last = messages.value[messages.value.length - 1]
  if (last?.role !== "agent") return false
  const segments = last.segments
  if (!segments || segments.length === 0) return last.content.length === 0
  const tail = segments[segments.length - 1]
  if (tail.kind !== "tool") return false
  return tail.tool.output !== undefined && !tail.tool.isInterrupt
})
const showThinking = computed(
  () => isSending.value && tailAwaitingNewChunk.value
)

// Shared markdown-it instance for every bubble in this view. `getMarkdown`
// memoizes by id, so this is a cheap lookup, not a fresh parser each call.
const md = getMarkdown("chat-message")

// Parse each bubble into a list of "blocks" — text blocks become
// markstream node trees, tool blocks become tool-call cards. Two
// rendering paths converge here:
//
//   • Agent message WITH segments → walk segments in order, each text
//     segment becomes one parsed-markdown block, each tool segment
//     becomes one tool-card block. Order matters: the model may emit
//     prose, then call a tool, then continue prose — and the UI must
//     reflect that flow.
//
//   • Agent message WITHOUT segments (legacy text-only chats and user
//     messages) → single markdown block parsed from `message.content`.
//
// Streaming-tail markdown gets `final: false` (parser tolerates
// half-open code fences / links). All other markdown is finalised so
// the renderer can skip re-diffing on subsequent chunks.
//
// Memoize finalised parses by (message, segment-text) pair. Without a
// cache, every streaming chunk re-runs `parseMarkdownToStructure` for
// every text block in every message — O(history × segments) per token.
// The streaming tail is the one exception: its content mutates in place
// while the message identity stays constant, so the tail must always
// re-parse. `WeakMap` keyed on the message object lets finalized parses
// drop automatically when the messages array is replaced (session
// switch / Firestore reconcile), no manual eviction needed.
type ParsedNodes = ReturnType<typeof parseMarkdownToStructure>

interface TextBlock {
  kind: "text"
  id: string
  nodes: ParsedNodes
  final: boolean
}
interface ToolBlock {
  kind: "tool"
  id: string
  segment: Extract<BotChatSegment, { kind: "tool" }>
}
type RenderedBlock = TextBlock | ToolBlock

// Per-message map: text-segment-content → parsed nodes. Keying on the
// segment's text string means once a text segment finalises (no longer
// the streaming tail), its parse is reused on every subsequent render.
// We rebuild the inner map for each message but the outer WeakMap
// survives across renders, so finalised parses persist.
const parseCacheByMessage = new WeakMap<
  BotChatMessage,
  Map<string, ParsedNodes>
>()

const getCachedParse = (
  message: BotChatMessage,
  text: string,
  isStreamingTail: boolean
): ParsedNodes => {
  if (isStreamingTail) {
    // Streaming tail: never cache (text mutates per chunk), use partial
    // parse mode so the parser tolerates unclosed fences/links/etc.
    return parseMarkdownToStructure(text, md, { final: false })
  }
  let inner = parseCacheByMessage.get(message)
  if (!inner) {
    inner = new Map()
    parseCacheByMessage.set(message, inner)
  }
  let nodes = inner.get(text)
  if (!nodes) {
    nodes = parseMarkdownToStructure(text, md, { final: true })
    inner.set(text, nodes)
  }
  return nodes
}

const renderedMessages = computed(() =>
  displayMessages.value.map((message, messageIndex) => {
    const isLastMessage = messageIndex === displayMessages.value.length - 1
    const blocks: RenderedBlock[] = []

    if (
      message.role === "agent" &&
      message.segments &&
      message.segments.length > 0
    ) {
      // Identify which (if any) text segment is the active streaming
      // tail. Only the very last text segment of the very last message
      // can be streaming — and only while `isSending` is true.
      let lastTextIndex = -1
      for (let i = message.segments.length - 1; i >= 0; i--) {
        if (message.segments[i].kind === "text") {
          lastTextIndex = i
          break
        }
      }
      message.segments.forEach((segment, segIndex) => {
        if (segment.kind === "text") {
          const isStreamingTail =
            isSending.value && isLastMessage && segIndex === lastTextIndex
          blocks.push({
            kind: "text",
            id: `${message.id}-text-${segIndex}`,
            nodes: getCachedParse(message, segment.text, isStreamingTail),
            final: !isStreamingTail,
          })
        } else {
          // Tool segment — `tool.ref` (when present) is the most stable
          // key; falls back to index. Either way, mutation of `output`
          // happens in place on the same segment object, so Vue's
          // child-component instance stays put across the running→done
          // transition.
          blocks.push({
            kind: "tool",
            id: `${message.id}-tool-${segment.tool.ref ?? segIndex}`,
            segment,
          })
        }
      })
    } else {
      // No segments — single markdown block over `content`. Covers user
      // messages (always) and agent messages from before tool support
      // existed (legacy data and pure text turns).
      const isStreamingTail =
        isSending.value && isLastMessage && message.role === "agent"
      blocks.push({
        kind: "text",
        id: `${message.id}-content`,
        nodes: getCachedParse(message, message.content, isStreamingTail),
        final: !isStreamingTail,
      })
    }

    return { message, blocks }
  })
)

// ── Auto-scroll to latest message ─────────────────────────────────────
//
// Stickiness rule: while the user is at the bottom, every new turn,
// streaming chunk, and the thinking indicator should auto-scroll. The
// moment they scroll up to read history, we leave them alone — and
// resume the moment they scroll back to the bottom.
const scrollEl = ref<HTMLElement | null>(null)
const contentEl = ref<HTMLElement | null>(null)

// Small bottom offset so sub-pixel layout shifts (font metrics, image
// loads) don't drop us out of the "at bottom" state.
const { arrivedState } = useScroll(scrollEl, {
  offset: { bottom: 4 },
})

// Mirror `arrivedState.bottom` directly. We deliberately don't use
// `directions.top` here: when content shrinks (e.g., the thinking
// indicator is replaced by the first chunk), the browser clamps
// `scrollTop` and fires a scroll event with a negative delta, which
// `useScroll` reports as `directions.top: true` — a false positive that
// would un-stick us mid-stream. `arrivedState.bottom` stays stable
// across content shrink (we're still at the bottom after clamping) and
// content grow (no scroll event fires), so it only flips false on a
// real user scroll-up.
const stickToBottom = ref(true)
watch(
  () => arrivedState.bottom,
  (atBottom) => {
    stickToBottom.value = atBottom
  }
)

// Switching sessions resets stickiness — a freshly opened chat should
// always land at the latest turn, regardless of where the previous
// session was scrolled.
watch(sessionId, () => {
  stickToBottom.value = true
})

const scrollToBottom = () => {
  const el = scrollEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

const onScrollReady = (el: HTMLElement) => {
  scrollEl.value = el
  // Catch the case where messages were already populated before OS
  // finished its deferred init (e.g., direct nav to /bot/:id where
  // `selectSession` resolved while the wrapper was still warming up).
  nextTick(() => {
    if (stickToBottom.value) scrollToBottom()
  })
}

// ResizeObserver fires whenever the message column's height changes —
// new turns, streaming chunks, and the thinking indicator's
// appearance/disappearance all surface through it. Watching DOM size
// directly (instead of `messages`) also covers height shifts that don't
// correspond to a data mutation: images decoding, code blocks reflowing
// after Shiki highlights, etc.
useResizeObserver(contentEl, () => {
  if (!stickToBottom.value) return
  scrollToBottom()
})
</script>

<template>
  <OverlayScrollbarsWrapper @scroll-ready="onScrollReady">
    <div
      v-if="messages.length === 0 && !isSending"
      class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm"
    >
      <IconAiFill class="size-8 opacity-60" />
      <p>Ask anything to get started.</p>
    </div>
    <div v-else ref="contentEl" class="mt-auto grid grid-cols-1 gap-2">
      <ContextMenu
        v-for="({ message, blocks }, index) in renderedMessages"
        :key="message.id"
      >
        <ContextMenuTrigger>
          <div class="flex items-end gap-2 p-2">
            <Avatar
              v-if="message.role === 'user'"
              variant="beam"
              :name="`Agent ${index + 1}`"
              :colors="[
                'var(--color-chart-1)',
                'var(--color-chart-2)',
                'var(--color-chart-3)',
                'var(--color-chart-4)',
                'var(--color-chart-5)',
              ]"
              class="sticky bottom-0 size-5"
            />
            <div
              :class="[
                'markdown-bubble flex w-max flex-col px-2 py-1 text-sm whitespace-pre-wrap',
                {
                  'bg-secondary text-secondary-foreground rounded-lg rounded-bl-xs':
                    message.role === 'user',
                },
                {
                  'rounded-lg': message.role === 'agent',
                },
              ]"
            >
              <template v-for="block in blocks" :key="block.id">
                <MarkdownRender
                  v-if="block.kind === 'text'"
                  custom-id="chat"
                  :is-dark="isDark"
                  :code-block-props="{
                    theme: { light: 'vitesse-light', dark: 'vitesse-dark' },
                  }"
                  :nodes="block.nodes"
                  :final="block.final"
                />
                <BotChatToolCall
                  v-else
                  :tool="block.segment.tool"
                  :message-id="message.id"
                />
              </template>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem>
              <IconCopy />
              Copy
            </ContextMenuItem>
            <ContextMenuItem>
              <IconReply />
              Reply
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem v-if="message.role === 'user'">
              <IconPenLine />
              Edit
            </ContextMenuItem>
            <ContextMenuItem>
              <IconTrash />
              Delete
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <div
        v-if="showThinking"
        class="text-muted-foreground flex items-center gap-2 px-6 pb-4 text-xs"
      >
        <span
          class="bg-muted-foreground inline-block size-1.5 animate-pulse rounded-full"
        />
        <span>Thinking...</span>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>

<style scoped>
/* markstream-vue injects a `.markstream-vue` wrapper that re-defines every
   `--ms-*` typography variable on itself, shadowing anything we set on the
   bubble parent. We push our overrides onto that wrapper directly via
   `:deep()` so they actually win the cascade — and we keep everything in
   `em` units so the bubble's `text-sm` stays the source of truth for
   sizing (the rhythm scales if the bubble's font-size ever changes). */
.markdown-bubble :deep(.markstream-vue) {
  /* ── Animations ───────────────────────────────────────────────────
     Disable every transition/animation in the markstream subtree.
     During streaming the per-token fade-in (`.text-node-stream-delta`,
     `.inline-code-stream-delta` — each ~0.28s) fires on every chunk,
     queuing dozens of concurrent compositor animations and burning
     ~5ms/token in style work for a fade most users never notice.
     The two `--*-fade-duration` vars are *not* set by the library's
     defaults (they fall through to a `.28s` literal in `var()`
     fallbacks), so we must zero them explicitly alongside the
     `--ms-duration-*` set. */
  --ms-duration-fast: 0s;
  --ms-duration-standard: 0s;
  --ms-duration-emphasis: 0s;
  --ms-duration-overlay: 0s;
  --ms-duration-stream: 0s;
  --ms-duration-slow: 0s;
  --stream-update-fade-duration: 0s;
  --fade-duration: 0s;

  /* ── Body ─────────────────────────────────────────────────────────
     1.65 leading hits the chat sweet spot — looser than 1.5 (which
     feels cramped at small sizes) but tighter than the library's 1.75
     default (which wastes vertical space inside a bubble). */
  --ms-text-body: 1em;
  --ms-leading-body: 1.65;
  --ms-flow-paragraph-y: 0.85em;

  /* ── Headings ─────────────────────────────────────────────────────
     Stronger size *and* weight contrast between levels so a quick scan
     reveals structure. h4–h6 stay at body size but lean on weight to
     avoid headings smaller than the prose under them. */
  --ms-text-h1: 1.5em;
  --ms-text-h2: 1.3em;
  --ms-text-h3: 1.15em;
  --ms-text-h4: 1.05em;
  --ms-text-h5: 1em;
  --ms-text-h6: 1em;
  --ms-weight-h1: 700;
  --ms-weight-h2: 650;
  --ms-weight-h3: 600;
  --ms-weight-h4: 600;
  --ms-leading-h1: 1.25;
  --ms-leading-h2: 1.3;
  --ms-leading-h3: 1.4;

  /* More breathing room *above* headings (visual section break) and
     tighter *below* (group the heading with the content it titles). */
  --ms-flow-heading-1-mt: 1em;
  --ms-flow-heading-1-mb: 0.4em;
  --ms-flow-heading-2-mt: 0.9em;
  --ms-flow-heading-2-mb: 0.35em;
  --ms-flow-heading-3-mt: 0.8em;
  --ms-flow-heading-3-mb: 0.3em;
  --ms-flow-heading-4-mt: 0.7em;
  --ms-flow-heading-4-mb: 0.25em;
  --ms-flow-heading-5-mt: 0.6em;
  --ms-flow-heading-5-mb: 0.2em;
  --ms-flow-heading-6-mt: 0.6em;
  --ms-flow-heading-6-mb: 0.2em;

  /* ── Lists / quotes / code / tables / hr ──────────────────────────
     All anchored to the same 0.75–1em rhythm so a paragraph next to a
     list next to a quote reads as one continuous flow. */
  --ms-flow-list-y: 0.75em;
  --ms-flow-list-item-y: 0.3em;
  --ms-flow-list-indent: 1.4em;
  --ms-flow-blockquote-y: 0.85em;
  --ms-flow-blockquote-indent: 1em;
  --ms-flow-codeblock-y: 0.85em;
  --ms-flow-table-y: 0.85em;
  --ms-flow-hr-y: 1em;
}

/* Strip the leading/trailing margins so the first heading's `margin-top`
   and the last paragraph's `margin-bottom` don't blow past the bubble's
   padding. The library already sets `.paragraph-node { margin: 0 }` but
   `.heading-node` and other block nodes keep theirs — this universal
   reset covers all of them. */
.markdown-bubble :deep(.markstream-vue > *:first-child),
.markdown-bubble :deep(.markstream-vue *:first-child) {
  margin-top: 0;
}
.markdown-bubble :deep(.markstream-vue > *:last-child),
.markdown-bubble :deep(.markstream-vue *:last-child) {
  margin-bottom: 0;
}

/* `text-wrap: pretty` avoids orphaned single-word last lines in
   paragraphs; `balance` evens out short multi-line headings. Both are
   no-ops on browsers without support, so they're safe to apply
   unconditionally. */
.markdown-bubble :deep(.paragraph-node) {
  text-wrap: pretty;
}
.markdown-bubble :deep(.heading-node) {
  text-wrap: balance;
  letter-spacing: -0.01em;
}

/* Inline code gets bumped from the library default of 0.8125em to
   0.875em — at our small bubble size, 0.8125em rendered noticeably
   smaller than surrounding prose and was hard to read. */
.markdown-bubble :deep(.inline-code) {
  font-size: 0.875em;
}

/* List items render their own paragraph wrapper which gets the global
   paragraph margin. Inside a tight list, that doubles spacing. Drop
   inner-paragraph margins so list-item spacing comes solely from
   `--ms-flow-list-item-y`. (Note: the library already does this via
   `li .paragraph-node { margin: 0 }`, but we keep the rule in case the
   library's selector specificity shifts in a future release.) */
.markdown-bubble :deep(.list-item .paragraph-node) {
  margin-top: 0;
  margin-bottom: 0;
}

/* ── Performance ───────────────────────────────────────────────────
   Layout containment isolates each bubble's layout & paint work from
   its neighbours. When the streaming tail's height grows, the browser
   only re-lays-out *that* bubble's subtree — prior bubbles are skipped
   entirely. Without `contain`, every chunk invalidates the full chat
   column, so streaming gets jankier as history grows. */
.markdown-bubble {
  contain: layout style;
}

/* Belt-and-suspenders animation kill — universal selector with
   `!important` is heavy-handed but guarantees no library rule sneaks
   past the `--ms-duration-*` / `--*-fade-duration` overrides. Scoped
   tightly to the markstream subtree so unrelated app animations
   (sidebars, dialogs, the thinking dot) are unaffected. */
.markdown-bubble :deep(.markstream-vue),
.markdown-bubble :deep(.markstream-vue *),
.markdown-bubble :deep(.markstream-vue *::before),
.markdown-bubble :deep(.markstream-vue *::after) {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
</style>

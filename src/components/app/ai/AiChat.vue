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
import { IconAiFill, IconCopy, IconReply } from "@/data/icons"
import { toast } from "vue-sonner"
import { useAuthStore } from "@/stores/authStore"
import Avatar from "vue-boring-avatars"
import { inject } from "vue"
import "markstream-vue/index.css"
import "katex/dist/katex.min.css"

const isDark = usePreferredDark()
const { t } = useI18n()

const botChat = inject(BotChatContextKey)
const messages = computed(() => botChat?.messages.value ?? [])
const isSending = computed(() => botChat?.isSending.value ?? false)
const sessionId = computed(() => botChat?.sessionId.value ?? null)

// Avatar seed for a user turn. `vue-boring-avatars` is a deterministic
// hash of the `name` string, so feeding it the *real* sender uid gives
// every human a distinct, stable avatar — and crucially, the right one
// for the right message in shared/public chats where multiple admins
// can post into the same session.
//
// Resolution order (per message):
//   1. `message.authorUid` — server-stamped on every user turn in
//      `FirestoreBotSessionStore.save()`. The most accurate signal.
//   2. Session owner uid — fallback for legacy messages saved before
//      authorship tracking existed. Imperfect (it'll wrongly attribute
//      admin turns to the owner in old shared chats), but better than
//      a single shared avatar for everyone.
//   3. Current user uid — used for the brief window before the very
//      first server save, when neither `authorUid` nor `activeSession`
//      is populated yet.
//   4. Literal "User" — defensive fallback so the avatar component
//      never receives an empty string (which would hash to a
//      degenerate same-everywhere avatar).
const authStore = useAuthStore()
const messageAvatarSeed = (message: BotChatMessage): string =>
  message.authorUid ??
  botChat?.activeSession.value?.ownerUid ??
  authStore.currentUser?.uid ??
  "User"

// ── Copy / Reply (context menu actions) ──────────────────────────────────
//
// Both actions read `message.content` — for agent turns this is the
// running text concatenation built up in `useBotChat.appendText`, i.e.
// the prose without tool-call payloads. That's the natural plain-text
// view of the bubble: copying or quoting it gives the user the words,
// not the JSON the model emitted to fetch a file. Tool segments stay
// where they belong — inline cards in the bubble.
const { copy: copyToClipboard } = useClipboard({ legacy: true })

const handleCopyMessage = async (message: BotChatMessage) => {
  const text = message.content
  if (!text) return
  await copyToClipboard(text)
  toast.success(t("ai.messageCopied"))
}

// Markdown blockquote: every line prefixed with "> ". An empty line
// keeps its prefix so the quoted block reads as one contiguous quote
// in the rendered bubble — without it, markdown-it would split the
// quote at the gap and the second half would render as a normal
// paragraph.
const blockquote = (text: string): string =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")

const handleReplyMessage = (message: BotChatMessage) => {
  if (!botChat) return
  const text = message.content
  if (!text) return
  botChat.pendingComposerDraft.value = blockquote(text)
}

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
// Pin-to-bottom is delegated to CSS scroll anchoring. A 1px sentinel
// (`.scroll-anchor`) sits at the end of the message list with
// `overflow-anchor: auto`; every other element in the list has
// `overflow-anchor: none`. The browser's scroll-anchoring algorithm
// then only has the sentinel to lock onto — content growing *above*
// it shifts the sentinel down, and the browser scrolls the container
// to keep the sentinel at the same spot relative to the viewport. Net
// effect: while the sentinel is on screen, scroll follows new
// content; when the user scrolls up, the sentinel leaves the
// viewport, anchoring suspends, and their position is preserved.
// Stickiness emerges from the rules — no `stickToBottom` to track,
// no scroll-direction heuristics to guard against false positives.
//
// Safari doesn't implement scroll anchoring (`overflow-anchor` is a
// no-op there). We feature-detect and wire up a ResizeObserver
// fallback that mirrors the CSS semantics: re-pin only when the
// anchor is still in view.
const scrollEl = ref<HTMLElement | null>(null)
const contentEl = ref<HTMLElement | null>(null)
const anchorEl = ref<HTMLElement | null>(null)

const scrollToAnchor = () => {
  anchorEl.value?.scrollIntoView({ block: "end" })
}

const onScrollReady = (el: HTMLElement) => {
  scrollEl.value = el
  // CSS anchoring only takes effect once the sentinel is on screen,
  // so we land there explicitly on first paint. Also covers direct
  // navigations (e.g. /bot/:id) where messages were populated before
  // the wrapper finished its deferred init.
  nextTick(scrollToAnchor)
}

// Switching sessions: drop in at the new session's latest turn.
watch(sessionId, () => {
  nextTick(scrollToAnchor)
})

const supportsScrollAnchoring =
  typeof CSS !== "undefined" && CSS.supports("overflow-anchor: auto")

if (!supportsScrollAnchoring) {
  // ── Safari fallback ─────────────────────────────────────────────────
  // `scrollend` (Chrome 114+, Firefox 109+, Safari 18.2+) fires once
  // when a scroll operation settles — both user wheel/touch motion
  // and our own programmatic `scrollIntoView`. On each fire we
  // recompute whether the user is parked within 4px of the bottom;
  // the buffer absorbs sub-pixel font-metric / image-load shifts.
  // ResizeObserver covers content growth: if we're pinned when
  // content grows, re-pin via `scrollToAnchor`.
  //
  // Caveat: `pinned` only updates when scrolling *settles*, so a
  // token streaming in during an in-flight scroll-up can briefly
  // re-pin against the user before they release. The window is
  // short (typical scroll completes in <200ms), but if it shows up
  // in usage data, swap back to `useIntersectionObserver` on
  // `anchorEl` — it updates state mid-scroll, at the cost of an
  // extra observer.
  const pinned = ref(true)
  useEventListener(scrollEl, "scrollend", () => {
    const s = scrollEl.value
    if (!s) return
    pinned.value = s.scrollHeight - s.scrollTop - s.clientHeight <= 4
  })
  useResizeObserver(contentEl, () => {
    if (pinned.value) scrollToAnchor()
  })
}
</script>

<template>
  <OverlayScrollbarsWrapper @scroll-ready="onScrollReady">
    <div
      v-if="messages.length === 0 && !isSending"
      class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm"
    >
      <IconAiFill class="size-8 opacity-60" />
      <p>{{ t("ai.chatEmpty") }}</p>
    </div>
    <div
      v-else
      ref="contentEl"
      class="messages-list mt-auto grid grid-cols-1 gap-2 p-2"
    >
      <ContextMenu
        v-for="{ message, blocks } in renderedMessages"
        :key="message.id"
      >
        <ContextMenuTrigger>
          <div class="flex items-end gap-2 p-2">
            <Avatar
              v-if="message.role === 'user'"
              variant="beam"
              :name="messageAvatarSeed(message)"
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
          <ContextMenuItem
            :disabled="!message.content"
            @select="handleCopyMessage(message)"
          >
            <IconCopy />
            {{ t("actions.copy") }}
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="!message.content"
            @select="handleReplyMessage(message)"
          >
            <IconReply />
            {{ t("ai.reply") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div
        v-if="showThinking"
        class="text-muted-foreground flex items-center gap-2 px-6 pb-4 text-xs"
      >
        <span
          class="bg-muted-foreground inline-block size-1.5 animate-pulse rounded-full"
        />
        <span>{{ t("ai.thinking") }}</span>
      </div>
      <!-- Scroll-anchor sentinel — see comment in <script setup>.
           Must be the final child so the browser locks onto it. -->
      <div ref="anchorEl" aria-hidden="true" class="scroll-anchor" />
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

/* ── Width / overflow ───────────────────────────────────────────────
   `w-max` (Tailwind `width: max-content`) gives bubbles their natural
   content-sized silhouette — short messages stay short, long ones
   grow. Without an upper bound, a single unbreakable token (URL,
   hash, long inline code, KaTeX run, tool-output row) lets the
   bubble grow past the column and produces a horizontal scroll on
   the OverlayScrollbars viewport even when nothing visibly clips.
   Capping at `max-width: 100%` keeps the natural sizing intact while
   binding the bubble to its row.

   The cap only binds because of `min-width: 0`: flex items default
   to `min-width: auto` ("don't shrink below intrinsic content"), and
   that default silently overrides `max-width` — the bubble would
   refuse the cap because content would have to overflow. Resetting
   to 0 releases the constraint.

   `overflow-wrap: anywhere` is the final piece: with `max-width`
   active, long tokens have to break somewhere to stay inside. The
   `anywhere` value (vs `break-word`) only breaks mid-token when no
   other break point fits, so normal prose still wraps on spaces.
   Code blocks (`white-space: pre`) ignore `overflow-wrap` and scroll
   themselves via markstream's `pre` styles — no double-handling.

   ── Performance ───────────────────────────────────────────────────
   `contain: layout style` isolates each bubble's layout & paint from
   its neighbours. When the streaming tail's height grows, the
   browser only re-lays-out *that* bubble's subtree — prior bubbles
   are skipped. Without `contain`, every chunk invalidates the full
   chat column, so streaming gets jankier as history grows. */
.markdown-bubble {
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
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

/* ── Auto-scroll via CSS scroll anchoring ──────────────────────────
   Browsers run scroll anchoring by default — when content above the
   viewport changes, they pick an in-view element and adjust scroll
   so it stays visually put. We invert that for chat: disable
   anchoring on every descendant of the message list, then re-enable
   it only on a 1px sentinel pinned to the bottom. Now the algorithm
   can *only* pick the sentinel — and as new content grows above it,
   the browser scrolls to keep the sentinel on screen, effectively
   tailing the latest message. When the user scrolls up, the sentinel
   leaves the viewport, no anchor is available, anchoring suspends,
   and the user's scroll position is preserved.

   Safari (no `overflow-anchor` support) falls through to the JS
   fallback wired up in <script setup>. */
.messages-list,
.messages-list :deep(*) {
  overflow-anchor: none;
}
.scroll-anchor {
  overflow-anchor: auto;
  height: 1px;
}

/* ── Grid-track width binding ──────────────────────────────────────
   `grid-cols-1` resolves to `grid-template-columns: minmax(0, 1fr)`,
   which *should* clamp the column to the container width. It doesn't
   in practice, because grid items default to `min-width: auto` — the
   item refuses to shrink below intrinsic content, the column grows
   with it, and the OverlayScrollbars viewport gets a horizontal
   scroll. The actual grid child is reka-ui's
   `[data-slot="context-menu-trigger"]` (ContextMenuRoot renders no
   DOM), so we pin both the direct child *and* the trigger to
   `min-width: 0`. The `> *` rule alone covers most cases; the
   `:deep()` selector is belt-and-suspenders in case reka-ui ever
   adds an intermediate wrapper. */
.messages-list > *,
.messages-list :deep([data-slot="context-menu-trigger"]) {
  min-width: 0;
  max-width: 100%;
}
</style>

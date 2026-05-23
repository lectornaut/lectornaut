<script lang="ts" setup>
import {
  BotChatContextKey,
  type BotChatMessage,
  type BotChatSegment,
} from "@/composables/useBotChat"
import { IconAiFill, IconCopy, IconReply } from "@/data/icons"
import { toast } from "vue-sonner"
import { useAuthStore } from "@/stores/authStore"
import Avatar from "vue-boring-avatars"
import { inject } from "vue"

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

// Each bubble flattens to an ordered list of "blocks" — text blocks
// become markdown, tool blocks become tool-call cards. The model may
// emit prose, then a tool, then continue prose, and the UI mirrors
// that flow.
//
// Streaming-tail text gets `final: false` so the underlying renderer
// turns on smooth pacing + typewriter + tolerant parsing for half-open
// code fences / links. Everything else is `final: true`, which trips
// fade-in and skips pacing. The dynamic switch is handled inside
// `AppMarkdown` based on the `final` prop — see that wrapper for the
// streaming/history matrix.
//
// `AppMarkdown` reads `content` directly: the renderer internally
// memoizes parses by content identity, so passing the same string
// across renders re-uses the prior parse without our own cache.
interface TextBlock {
  kind: "text"
  id: string
  text: string
  final: boolean
}
interface ToolBlock {
  kind: "tool"
  id: string
  segment: Extract<BotChatSegment, { kind: "tool" }>
}
type RenderedBlock = TextBlock | ToolBlock

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
            text: segment.text,
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
        text: message.content,
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
    <Empty v-if="messages.length === 0 && !isSending" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconAiFill />
        </EmptyMedia>
        <EmptyTitle>{{ t("ai.chatEmpty") }}</EmptyTitle>
      </EmptyHeader>
    </Empty>
    <div
      v-else
      ref="contentEl"
      class="messages-list mt-auto grid grid-cols-1 p-2"
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
                'markdown-bubble flex flex-col gap-2 text-sm',
                {
                  'bg-destructive/25 max-w-2/3 rounded-lg rounded-bl-xs p-2':
                    message.role === 'user',
                },
                {
                  'w-full': message.role === 'agent',
                },
              ]"
            >
              <template v-for="block in blocks" :key="block.id">
                <AppMarkdown
                  v-if="block.kind === 'text'"
                  surface="chat"
                  :content="block.text"
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
/* Typography, animation, and node-level rules for the markstream
 * subtree live in `AppMarkdown.vue` and key off `[data-custom-id="chat"]`.
 * What stays here is bubble-shape stuff: width clamping, overflow,
 * containment, and the auto-scroll anchor sentinel rules. */

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

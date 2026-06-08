<script lang="ts" setup>
import {
  BotChatContextKey,
  type BotChatMessage,
  type BotChatSegment,
} from "@/composables/useBotChat"
import { useReadAloud } from "@/composables/useReadAloud"
import {
  IconAiFill,
  IconCheck,
  IconCopy,
  IconPause,
  IconPlay,
  IconReply,
  IconSquare,
  IconVolume2,
} from "@/data/icons"
import { toast } from "vue-sonner"
import { useAuthStore } from "@/stores/authStore"
import { inject } from "vue"

const { t } = useI18n()

const botChat = inject(BotChatContextKey)
const messages = computed(() => botChat?.messages.value ?? [])
const isSending = computed(() => botChat?.isSending.value ?? false)

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

// Is this user turn authored by the *current* logged-in viewer? Drives
// right-alignment: your own messages sit on the right (avatar on the
// right), while everyone else — other admins posting into a shared chat,
// and the agent — stays on the left. The familiar iMessage/Slack split.
//
// We compare against `messageAvatarSeed` rather than re-deriving the
// author so alignment and avatar identity can never drift apart: a bubble
// pinned to the right always carries *your* avatar. The seed's own
// fallback chain also lands the right answer in the pre-first-save window
// (no `authorUid`/`ownerUid` yet ⇒ resolves to the current uid ⇒ own).
const isOwnMessage = (message: BotChatMessage): boolean =>
  message.role === "user" &&
  messageAvatarSeed(message) === authStore.currentUser?.uid

// ── Copy / Reply (context menu actions) ──────────────────────────────────
//
// Both actions read `message.content` — for agent turns this is the
// running text concatenation built up in `useBotChat.appendText`, i.e.
// the prose without tool-call payloads. That's the natural plain-text
// view of the bubble: copying or quoting it gives the user the words,
// not the JSON the model emitted to fetch a file. Tool segments stay
// where they belong — inline cards in the bubble.
const { copy: copyToClipboard, copied: justCopied } = useClipboard({
  legacy: true,
})

// `useClipboard` exposes one shared `copied` flag that self-resets after a
// short window (~1.5s). The hover bar's copy button swaps to a check while
// it's set — but that flag is component-wide, so on its own it would also
// flash a check on whichever *other* bubble you hover during the window.
// Pair it with the id of the last-copied message to scope the swap to the
// one bubble that was actually copied.
const lastCopiedMessageId = ref<string | null>(null)
const isCopied = (messageId: string): boolean =>
  justCopied.value && lastCopiedMessageId.value === messageId

// The model's reasoning is folded into `<thinking>…</thinking>` blocks
// inside `content` (rendered as a collapsible disclosure). Copying or
// quoting a message should carry the answer, not the chain-of-thought —
// strip those blocks (including a half-open block while streaming).
const THINKING_BLOCK_RE = /<thinking\b[^>]*>[\s\S]*?(?:<\/thinking\s*>\s*|$)/gi
const stripThinking = (text: string): string =>
  text.replace(THINKING_BLOCK_RE, "").trim()

const handleCopyMessage = async (message: BotChatMessage) => {
  const text = stripThinking(message.content)
  if (!text) return
  await copyToClipboard(text)
  lastCopiedMessageId.value = message.id
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
  const text = stripThinking(message.content)
  if (!text) return
  botChat.pendingComposerDraft.value = blockquote(text)
}

// ── Read aloud (Web Speech API) ───────────────────────────────────────────
//
// Reads the same plain-text view as Copy/Reply — `stripThinking(content)`,
// so the synthesizer speaks the answer, never the model's <thinking> blocks
// or tool-call JSON. The speech state is an app-wide singleton (only one
// message reads at a time); see `useReadAloud`. `isSpeaking`/`isPaused` are
// per-message predicates that drive the context-menu's three states.
const {
  isAvailable: isReadAloudAvailable,
  isSpeaking,
  isPaused,
  readAloud,
  pause: pauseReadAloud,
  resume: resumeReadAloud,
  stop: stopReadAloud,
} = useReadAloud()

const handleReadAloud = (message: BotChatMessage) => {
  const text = stripThinking(message.content)
  if (!text) return
  readAloud(message.id, text)
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
</script>

<template>
  <OverlayScrollbarsWrapper>
    <Empty v-if="messages.length === 0 && !isSending" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconAiFill />
        </EmptyMedia>
        <EmptyTitle>{{ t("ai.chatEmpty") }}</EmptyTitle>
      </EmptyHeader>
    </Empty>
    <div v-else class="messages-list mt-auto grid grid-cols-1 px-2 py-4">
      <ContextMenu
        v-for="{ message, blocks } in renderedMessages"
        :key="message.id"
      >
        <ContextMenuTrigger class="group relative">
          <div
            :class="[
              'flex items-end gap-2 px-2 pb-8',
              { 'flex-row-reverse': isOwnMessage(message) },
            ]"
          >
            <AppAvatar
              v-if="message.role === 'user' && !isOwnMessage(message)"
              variant="beam"
              :name="messageAvatarSeed(message)"
              class="sticky bottom-0 size-5 shrink-0"
            />
            <div
              :class="[
                'markdown-bubble flex flex-col gap-2 text-sm',
                message.role === 'user' && [
                  'bg-destructive/25 max-w-2/3 rounded-lg p-2',
                  isOwnMessage(message) ? 'rounded-br-xs' : 'rounded-bl-xs',
                ],
                message.role === 'agent' && 'w-full',
              ]"
            >
              <template v-for="block in blocks" :key="block.id">
                <AppMarkdown
                  v-if="block.kind === 'text'"
                  surface="chat"
                  :content="block.text"
                  :final="block.final"
                  class="select-auto"
                />
                <BotChatToolCall
                  v-else
                  :tool="block.segment.tool"
                  :message-id="message.id"
                />
              </template>
            </div>
          </div>
          <!-- Hover action bar — the same actions as the context menu, surfaced
               on hover for discoverability (right-click is easy to miss). It
               calls the identical handlers and reuses the identical i18n
               labels, so the two entry points can never drift; only the
               presentation differs (a floating segmented `ButtonGroup` of
               icon-only buttons vs. menu rows). Tooltips name each icon. -->
          <div
            :class="[
              'pointer-events-none absolute bottom-1 z-10 flex items-center gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100',
              isOwnMessage(message) ? 'right-2' : 'left-2',
            ]"
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    :disabled="!message.content"
                    :aria-label="t('actions.copy')"
                    @click="handleCopyMessage(message)"
                  >
                    <IconCheck v-if="isCopied(message.id)" class="size-3!" />
                    <IconCopy v-else class="size-3!" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {{
                    isCopied(message.id)
                      ? t("ai.messageCopied")
                      : t("actions.copy")
                  }}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    :disabled="!message.content"
                    :aria-label="t('ai.reply')"
                    @click="handleReplyMessage(message)"
                  >
                    <IconReply class="size-3!" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t("ai.reply") }}</TooltipContent>
              </Tooltip>

              <!-- Read aloud — same three states as the context menu: idle ⇒
                     a single "Read aloud" button; active (playing OR paused) ⇒
                     a play/pause toggle + Stop. Hidden when the browser lacks
                     SpeechSynthesis. -->
              <template v-if="isReadAloudAvailable">
                <template v-if="isSpeaking(message.id) || isPaused(message.id)">
                  <Tooltip v-if="isSpeaking(message.id)">
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        :aria-label="t('ai.readAloudPause')"
                        @click="pauseReadAloud()"
                      >
                        <IconPause class="size-3!" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("ai.readAloudPause") }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-else>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        :aria-label="t('ai.readAloudResume')"
                        @click="resumeReadAloud()"
                      >
                        <IconPlay class="size-3!" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("ai.readAloudResume") }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        :aria-label="t('ai.readAloudStop')"
                        @click="stopReadAloud()"
                      >
                        <IconSquare class="size-3!" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("ai.readAloudStop") }}
                    </TooltipContent>
                  </Tooltip>
                </template>
                <Tooltip v-else>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      :disabled="!message.content"
                      :aria-label="t('ai.readAloud')"
                      @click="handleReadAloud(message)"
                    >
                      <IconVolume2 class="size-3!" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t("ai.readAloud") }}</TooltipContent>
                </Tooltip>
              </template>
            </TooltipProvider>
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

          <!-- Read aloud (Web Speech API). A single "Read aloud" row when
               idle; while a read is active (playing OR paused) it splits
               into two inline controls — a play/pause toggle + Stop. Hidden
               entirely when the browser lacks SpeechSynthesis. -->
          <template v-if="isReadAloudAvailable">
            <ContextMenuSeparator />
            <div
              v-if="isSpeaking(message.id) || isPaused(message.id)"
              class="flex gap-1"
            >
              <ContextMenuItem
                v-if="isSpeaking(message.id)"
                class="flex-1 justify-center"
                @select="pauseReadAloud()"
              >
                <IconPause />
                {{ t("ai.readAloudPause") }}
              </ContextMenuItem>
              <ContextMenuItem
                v-else
                class="flex-1 justify-center"
                @select="resumeReadAloud()"
              >
                <IconPlay />
                {{ t("ai.readAloudResume") }}
              </ContextMenuItem>
              <ContextMenuItem
                class="flex-1 justify-center"
                @select="stopReadAloud()"
              >
                <IconSquare />
                {{ t("ai.readAloudStop") }}
              </ContextMenuItem>
            </div>
            <ContextMenuItem
              v-else
              :disabled="!message.content"
              @select="handleReadAloud(message)"
            >
              <IconVolume2 />
              {{ t("ai.readAloud") }}
            </ContextMenuItem>
          </template>
        </ContextMenuContent>
      </ContextMenu>
      <div
        v-if="showThinking"
        class="text-muted-foreground flex items-center gap-2 px-3 py-6 text-xs"
      >
        <span
          class="bg-muted-foreground inline-block size-2 animate-pulse rounded-full"
        />
        <span>{{ t("ai.thinking") }}</span>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>

<style scoped>
/* Typography, animation, and node-level rules for the markstream
 * subtree live in `AppMarkdown.vue` and key off `[data-custom-id="chat"]`.
 * What stays here is bubble-shape stuff: width clamping, overflow,
 * and containment. */

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

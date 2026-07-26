<script lang="ts" setup>
import {
  BotChatContextKey,
  type BotChatMessage,
  type BotChatSegment,
} from "@/composables/useBotChat"
import { useCopy } from "@/composables/useCopy"
import { useReadAloud } from "@/composables/useReadAloud"
import {
  IconAi,
  IconCheck,
  IconCopy,
  IconPause,
  IconPlay,
  IconReply,
  IconSquare,
  IconVolume2,
} from "@/data/icons"
import { resolveAttachmentIcon } from "@/helpers/node-attachments"
import { splitUploadedFileLabels } from "@lectornaut/shared/domain"
import { toast } from "vue-sonner"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { isUserMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { inject } from "vue"

const { t } = useI18n()

const botChat = inject(BotChatContextKey)
const messages = computed(() => botChat?.messages.value ?? [])
const isSending = computed(() => botChat?.isSending.value ?? false)

// Remount the scroller per session: `MessageScrollerProvider` applies
// `defaultScrollPosition` (land at the end) and seeds its turn-anchor
// bookkeeping only at mount, while `selectSession` swaps `messages` in
// place — without the key a switch would keep the old session's scroll
// offset and anchor state. A brand-new chat flips "draft" → real id at
// first send, before any chunk streams, so the one remount it causes is
// pre-stream and invisible.
const scrollerSessionKey = computed(() => botChat?.sessionId.value ?? "draft")

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

// ── Group chat (shared sessions with multiple humans) ────────────────────
//
// A session becomes a group chat once its user turns carry more than one
// distinct human author — admins posting into the same shared/public chat.
// In that mode, other people's turns get a `MessageHeader` naming the
// sender; the anonymous avatar blob alone distinguishes people but doesn't
// identify them. Own turns stay header-less (they're right-aligned and
// yours), and 1:1 chats show no headers at all. Agent turns get no header
// either: only the session-level `activeAgent` is known, and stamping the
// *currently selected* agent's name onto historical turns would mislabel
// them after a mid-session agent switch.
const { teamMembers } = storeToRefs(useMembershipStore())
const memberNamesByUid = computed(() => {
  const names = new Map<string, string>()
  for (const member of teamMembers.value) {
    if (!isUserMembership(member)) continue
    const name = member.user?.displayName || member.user?.email
    if (name) names.set(member.userId, name)
  }
  return names
})

const isGroupChat = computed(() => {
  const authors = new Set<string>()
  for (const message of messages.value) {
    if (message.role === "user") authors.add(messageAvatarSeed(message))
  }
  return authors.size > 1
})

// Sender line above a bubble, or null for "no header". A departed member
// (no roster entry) resolves to null too — their identity blob still marks
// the turn as someone else's, we just can't name them.
const messageSenderName = (message: BotChatMessage): string | null => {
  if (!isGroupChat.value || message.role !== "user" || isOwnMessage(message))
    return null
  return memberNamesByUid.value.get(messageAvatarSeed(message)) ?? null
}

// Same-sender runs — the `MessageGroup` idea from the kit, applied
// per-message. Wrapping runs in an actual `MessageGroup` div would break
// the scroller: the engine walks `MessageScrollerContent`'s DIRECT children
// for `data-scroll-anchor`, so anchors inside a group wrapper would be
// missed and new-turn placement would stop working. Instead each message
// learns whether it starts/ends a run: the header renders once per run and
// the avatar renders on the run's last message (earlier members keep an
// empty spacer for alignment, per the kit's Group pattern).
const senderKey = (message: BotChatMessage): string =>
  message.role === "user" ? `user:${messageAvatarSeed(message)}` : "agent"

// ── Copy / Reply (context menu actions) ──────────────────────────────────
//
// Both actions read `message.content` — for agent turns this is the
// running text concatenation built up by the stream reducer
// (`applyStreamChunk` in `@/helpers/botChatStream`), i.e.
// the prose without tool-call payloads. That's the natural plain-text
// view of the bubble: copying or quoting it gives the user the words,
// not the JSON the model emitted to fetch a file. Tool segments stay
// where they belong — inline cards in the bubble.
const { copy: copyToClipboard, copied: justCopied } = useCopy()

// `useCopy` exposes one shared `copied` flag that self-resets after a
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

// The plain-text view of a bubble, shared by Copy / Reply / Read aloud.
// Agent turns shed their <thinking> blocks; user turns shed the server's
// `[Uploaded file …]` labels — those render as attachment chips, and
// copying/quoting/reading should carry the user's words, not the markers.
const messagePlainText = (message: BotChatMessage): string =>
  message.role === "user"
    ? splitUploadedFileLabels(message.content).text
    : stripThinking(message.content)

const handleCopyMessage = async (message: BotChatMessage) => {
  const text = messagePlainText(message)
  if (!text) return
  await copyToClipboard(text)
  lastCopiedMessageId.value = message.id
  toast.success(t("ai.messageCopied"))
}

// Reply stages the message's plain text as the composer's reply context —
// shown as a banner above the input and folded into the next send as a
// quoted blockquote (see `AiChatComposer`). We store the raw stripped text;
// the composer owns the blockquote formatting at send time.
const handleReplyMessage = (message: BotChatMessage) => {
  if (!botChat) return
  const text = messagePlainText(message)
  if (!text) return
  botChat.replyContext.value = text
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
  const text = messagePlainText(message)
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
    const previous = displayMessages.value[messageIndex - 1]
    const next = displayMessages.value[messageIndex + 1]
    const isRunStart = !previous || senderKey(previous) !== senderKey(message)
    const isRunEnd = !next || senderKey(next) !== senderKey(message)
    const blocks: RenderedBlock[] = []
    // File names parsed out of a user turn's `[Uploaded file …]` labels —
    // rendered as attachment chips above the text instead of raw markers.
    let attachments: string[] = []

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
      let text = message.content
      if (message.role === "user") {
        const split = splitUploadedFileLabels(text)
        text = split.text
        attachments = split.attachments
      }
      const isStreamingTail =
        isSending.value && isLastMessage && message.role === "agent"
      // An attachment-only user turn skips the empty markdown block so the
      // bubble's flex gap doesn't open up under the chips.
      if (text || message.role === "agent") {
        blocks.push({
          kind: "text",
          id: `${message.id}-content`,
          text,
          final: !isStreamingTail,
        })
      }
    }

    return { message, blocks, attachments, isRunStart, isRunEnd }
  })
)
</script>

<template>
  <Empty v-if="messages.length === 0 && !isSending" class="flex-1">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <IconAi />
      </EmptyMedia>
      <EmptyTitle>{{ t("ai.chatEmpty") }}</EmptyTitle>
    </EmptyHeader>
  </Empty>
  <!-- `MessageScroller` owns all scroll behavior: lands at the end on
       mount, follows the streamed tail only while the reader is pinned
       to the bottom (scrolling up opts out — no forced auto-follow),
       preserves the viewport on history prepends, and surfaces a
       jump-to-latest button. The chat surface keeps this engine instead
       of the generic ScrollContainer because it must own the raw
       viewport element; if streaming ever feels janky again, drop
       `auto-scroll` first. -->
  <MessageScrollerProvider v-else :key="scrollerSessionKey" auto-scroll>
    <MessageScroller>
      <MessageScrollerViewport>
        <MessageScrollerContent
          class="messages-list container mx-auto max-w-4xl p-2"
        >
          <MessageScrollerItem
            v-for="{
              message,
              blocks,
              attachments,
              isRunStart,
              isRunEnd,
            } in renderedMessages"
            :key="message.id"
            :message-id="message.id"
            :scroll-anchor="message.role === 'user'"
          >
            <ContextMenu>
              <ContextMenuTrigger class="group relative block">
                <Message :align="isOwnMessage(message) ? 'end' : 'start'">
                  <template
                    v-if="message.role === 'user' && !isOwnMessage(message)"
                  >
                    <MessageAvatar
                      v-if="isRunEnd"
                      class="sticky bottom-0 min-w-0 bg-transparent"
                    >
                      <AppAvatar
                        variant="beam"
                        :name="messageAvatarSeed(message)"
                        class="size-5"
                      />
                    </MessageAvatar>
                    <!-- Earlier messages of a same-sender run keep an empty
                         avatar spacer so their bubbles stay aligned with the
                         avatar on the run's last message. -->
                    <MessageAvatar v-else class="w-5 min-w-0 bg-transparent" />
                  </template>
                  <MessageContent>
                    <MessageHeader
                      v-if="isRunStart && messageSenderName(message)"
                    >
                      {{ messageSenderName(message) }}
                    </MessageHeader>
                    <!-- Error turns (server-side graceful fallbacks, persisted
                         with `status: "error"`) render as a framed destructive
                         bubble instead of the agent's full-width ghost — the
                         contained shape is what distinguishes "the turn failed"
                         from a normal reply at a glance. -->
                    <Bubble
                      :variant="
                        message.status === 'error'
                          ? 'destructive'
                          : message.role === 'agent'
                            ? 'ghost'
                            : isOwnMessage(message)
                              ? 'tinted'
                              : 'muted'
                      "
                      :class="
                        message.role === 'agent' &&
                        message.status !== 'error' &&
                        'w-full'
                      "
                    >
                      <BubbleContent
                        :class="[
                          'markdown-bubble flex flex-col gap-2',
                          message.role === 'agent' &&
                            message.status !== 'error' &&
                            'w-full',
                        ]"
                      >
                        <!-- Files sent with the turn — the same Attachment
                             card as the sidebar's attachments list, parsed
                             back out of the server's `[Uploaded file …]`
                             labels. Only the display name survives in the
                             message, so the icon resolves from it. -->
                        <AttachmentGroup
                          v-if="attachments.length"
                          class="max-w-full"
                        >
                          <Attachment
                            v-for="(name, index) in attachments"
                            :key="`${index}:${name}`"
                            size="sm"
                          >
                            <AttachmentMedia>
                              <Component
                                :is="
                                  resolveAttachmentIcon({
                                    originalName: name,
                                  })
                                "
                              />
                            </AttachmentMedia>
                            <AttachmentContent>
                              <AttachmentTitle>{{ name }}</AttachmentTitle>
                            </AttachmentContent>
                          </Attachment>
                        </AttachmentGroup>
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
                      </BubbleContent>
                    </Bubble>
                    <!-- Hover action bar — the same actions as the context
                         menu, surfaced on hover for discoverability
                         (right-click is easy to miss). Identical handlers and
                         i18n labels, so the two entry points can never drift.
                         `MessageFooter` keeps the actions in-flow (no overlap
                         with tall content) and follows the message side on
                         align="end" rows. Revealed on hover, on keyboard
                         focus, and while this message is being read aloud (so
                         the pause/stop controls stay reachable). -->
                    <MessageFooter
                      :class="[
                        'pointer-events-none gap-1 opacity-0 transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
                        (isSpeaking(message.id) || isPaused(message.id)) &&
                          'pointer-events-auto opacity-100',
                      ]"
                    >
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              :aria-label="t('actions.copy')"
                              :disabled="!message.content"
                              @click="handleCopyMessage(message)"
                            >
                              <IconCheck
                                v-if="isCopied(message.id)"
                                class="size-3!"
                              />
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
                              :aria-label="t('ai.reply')"
                              :disabled="!message.content"
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
                          <template
                            v-if="
                              isSpeaking(message.id) || isPaused(message.id)
                            "
                          >
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
                                :aria-label="t('ai.readAloud')"
                                :disabled="!message.content"
                                @click="handleReadAloud(message)"
                              >
                                <IconVolume2 class="size-3!" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{{
                              t("ai.readAloud")
                            }}</TooltipContent>
                          </Tooltip>
                        </template>
                      </TooltipProvider>
                    </MessageFooter>
                  </MessageContent>
                </Message>
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
          </MessageScrollerItem>
          <Marker v-if="showThinking" role="status" class="px-3 py-6">
            <MarkerContent class="shimmer">
              {{ t("ai.thinking") }}
            </MarkerContent>
          </Marker>
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton direction="end" />
      <!-- Transcript outline — a tick rail on the right edge that tracks
           the reader's position (the tick for `currentAnchorId` lights up)
           and expands on hover into a jump menu over the user turns. Must
           sit inside the provider: it injects the scroller context. -->
      <div class="absolute top-1/2 right-0.75 z-10 -translate-y-1/2">
        <BotChatOutline />
      </div>
    </MessageScroller>
  </MessageScrollerProvider>
</template>

<style scoped>
/* Typography, animation, and node-level rules for the markstream
 * subtree live in `AppMarkdown.vue` and key off `[data-custom-id="chat"]`.
 * What stays here is bubble-shape stuff the shadcn Bubble doesn't
 * cover: token wrapping and layout containment. Width clamping
 * (`w-fit max-w-full min-w-0`) now comes from `BubbleContent` itself. */

/* `overflow-wrap: anywhere` — BubbleContent ships `wrap-break-word`
   (`break-word`), but only `anywhere` factors mid-token break points
   into flex min-content sizing, which is what stops an unbreakable
   token (URL, hash, KaTeX run) from widening the bubble past the
   viewport. Normal prose still wraps on spaces; code blocks
   (`white-space: pre`) ignore it and scroll themselves.

   `contain: layout style` isolates each bubble's layout from its
   neighbours: when the streaming tail grows, only that bubble's
   subtree re-lays-out. Without it, every chunk invalidates the full
   chat column, so streaming gets jankier as history grows. */
.markdown-bubble {
  overflow-wrap: anywhere;
  contain: layout style;
}

/* reka-ui's ContextMenuRoot renders no DOM, so the scroller item's
   direct child is `[data-slot="context-menu-trigger"]`. Pin it so a
   wide bubble can never stretch the row past the viewport (flex items
   default to `min-width: auto` and refuse to shrink below intrinsic
   content). */
.messages-list :deep([data-slot="context-menu-trigger"]) {
  min-width: 0;
  max-width: 100%;
}
</style>

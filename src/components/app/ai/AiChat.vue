<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
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
// chunks arrive and mutates its `.content` in place. Hide that empty
// bubble until at least one chunk lands, and use the same condition to
// drive the "Thinking…" indicator (it disappears the moment text starts
// flowing into the bubble).
const tailIsEmptyAgent = computed(() => {
  const last = messages.value[messages.value.length - 1]
  return last?.role === "agent" && last.content.length === 0
})
const displayMessages = computed(() =>
  tailIsEmptyAgent.value ? messages.value.slice(0, -1) : messages.value
)
const showThinking = computed(() => isSending.value && tailIsEmptyAgent.value)

// Shared markdown-it instance for every bubble in this view. `getMarkdown`
// memoizes by id, so this is a cheap lookup, not a fresh parser each call.
const md = getMarkdown("chat-message")

// Parse each bubble into a markstream node tree. Only the actively
// streaming agent tail gets `final: false` — that keeps the parser from
// committing half-open code fences/links while chunks are still arriving.
// Every other bubble is finalised, so its tree is stable and the renderer
// can skip re-diffing on subsequent chunks.
const renderedMessages = computed(() =>
  displayMessages.value.map((message, index) => {
    const isStreamingTail =
      isSending.value &&
      index === displayMessages.value.length - 1 &&
      message.role === "agent"
    const final = !isStreamingTail
    return {
      message,
      nodes: parseMarkdownToStructure(message.content, md, { final }),
      final,
    }
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
    <div v-else ref="contentEl" class="mt-auto grid grid-cols-1">
      <ContextMenu
        v-for="({ message, nodes, final }, index) in renderedMessages"
        :key="index"
      >
        <ContextMenuTrigger>
          <div
            class="flex items-end gap-2 p-6"
            :class="{
              'flex-row-reverse': message.role === 'user',
            }"
          >
            <Avatar
              variant="beam"
              :name="`Agent ${index + 1}`"
              :colors="[
                'var(--color-chart-1)',
                'var(--color-chart-2)',
                'var(--color-chart-3)',
                'var(--color-chart-4)',
                'var(--color-chart-5)',
              ]"
              class="sticky bottom-0 size-8 border-4 border-transparent"
            />
            <div
              :class="[
                'markdown-bubble flex w-max max-w-3/4 flex-col px-3 py-2 text-sm whitespace-pre-wrap',
                message.role === 'user'
                  ? 'bg-muted text-muted-foreground ml-auto rounded-lg rounded-br-xs'
                  : 'bg-secondary text-secondary-foreground mr-auto rounded-lg rounded-bl-xs',
              ]"
            >
              <MarkdownRender
                :custom-id="`chat-${index}`"
                :is-dark="isDark"
                :code-block-props="{
                  theme: { light: 'vitesse-light', dark: 'vitesse-dark' },
                }"
                :nodes="nodes"
                :final="final"
              />
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
   `:deep()` so they actually win the cascade — and we keep them in `em`
   units so the bubble's `text-sm` stays the source of truth for sizing. */
.markdown-bubble :deep(.markstream-vue) {
  --ms-text-body: 1em;
  --ms-leading-body: 1.5;
  --ms-flow-paragraph-y: 1rem;
  --ms-text-h1: 1.5rem;
  --ms-text-h2: 1.3rem;
  --ms-text-h3: 1.15rem;
  --ms-text-h4: 1em;
  --ms-text-h5: 1em;
  --ms-text-h6: 1em;
  --ms-flow-heading-1-mt: 0.5rem;
  --ms-flow-heading-1-mb: 0.25rem;
  --ms-flow-heading-2-mt: 0.5rem;
  --ms-flow-heading-2-mb: 0.25rem;
  --ms-flow-heading-3-mt: 0.5rem;
  --ms-flow-heading-3-mb: 0.25rem;
  --ms-flow-heading-4-mt: 0.5rem;
  --ms-flow-heading-4-mb: 0.25rem;
  --ms-flow-heading-5-mt: 0.5rem;
  --ms-flow-heading-5-mb: 0.25rem;
  --ms-flow-heading-6-mt: 0.5rem;
  --ms-flow-heading-6-mb: 0.25rem;
}

/* Strip the leading/trailing margins so the first heading's `margin-top`
   and the last paragraph's `margin-bottom` don't blow past the bubble's
   `py-2`. The library already sets `.paragraph-node { margin: 0 }` but
   `.heading-N` selectors keep their margins — these resets cover both. */
.markdown-bubble :deep(.markstream-vue *:first-child) {
  margin-top: 0;
}
.markdown-bubble :deep(.markstream-vue *:last-child) {
  margin-bottom: 0;
}
</style>

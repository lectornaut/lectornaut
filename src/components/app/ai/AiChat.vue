<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import {
  IconAiFill,
  IconCopy,
  IconPenLine,
  IconReply,
  IconTrash,
} from "@/data/icons"
import Avatar from "vue-boring-avatars"
import { inject } from "vue"

const botChat = inject(BotChatContextKey)
const messages = computed(() => botChat?.messages.value ?? [])
const isSending = computed(() => botChat?.isSending.value ?? false)
</script>

<template>
  <OverlayScrollbarsWrapper>
    <div
      v-if="messages.length === 0 && !isSending"
      class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm"
    >
      <IconAiFill class="size-8 opacity-60" />
      <p>Ask anything to get started.</p>
    </div>
    <div v-else class="grid grid-cols-1">
      <ContextMenu v-for="(message, index) in messages" :key="index">
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
                'flex w-max max-w-3/4 flex-col px-3 py-2 text-sm whitespace-pre-wrap',
                message.role === 'user'
                  ? 'bg-muted text-muted-foreground ml-auto'
                  : 'bg-secondary text-secondary-foreground',
              ]"
            >
              {{ message.content }}
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
        v-if="isSending"
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

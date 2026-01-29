<script setup lang="ts">
import {
  IconBookmark,
  IconCheck,
  IconCheckCircle,
  IconCircle,
  IconInbox,
  IconMail,
  IconSparkles,
  IconTrash,
} from "@/data/icons"
import { type INotification } from "@/types"
import { computed } from "vue"
import { useRouter } from "vue-router"

const props = defineProps<{
  notification: INotification
}>()

const emit = defineEmits<{
  (e: "mark-read", id: string): void
  (e: "mark-unread", id: string): void
  (e: "mark-done", id: string): void
  (e: "mark-saved", id: string): void
  (e: "mark-inbox", id: string): void
  (e: "delete", id: string): void
}>()

const router = useRouter()

const typeIcon = computed(() => {
  switch (props.notification.type) {
    case "welcome":
      return IconSparkles
    case "invitation":
      return IconMail
    default:
      return IconCircle
  }
})

const handleClick = () => {
  if (props.notification.read === false) {
    emit("mark-read", props.notification.id)
  }
  if (props.notification.url) {
    router.push(props.notification.url)
  }
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Item
        size="sm"
        class="group w-full gap-2"
        as-child
        @click.stop="handleClick"
      >
        <RouterLink :to="notification.url" target="_blank">
          <ItemMedia variant="icon" class="text-muted-foreground relative">
            <Component :is="typeIcon" />
            <span
              v-if="notification.read === false"
              class="bg-primary ring-accent absolute -top-1 -left-1 flex size-2.5 rounded-full ring-2"
            ></span>
          </ItemMedia>
          <ItemContent class="gap-0.5 truncate">
            <ItemTitle class="line-clamp-1 truncate">
              {{ notification.title }}
            </ItemTitle>
            <ItemDescription class="line-clamp-1 truncate text-xs">
              {{ notification.description }}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ButtonGroup class="hidden group-hover:flex">
              <TooltipProvider>
                <ButtonGroup>
                  <Tooltip v-if="notification.read === false">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click.stop="emit('mark-read', notification.id)"
                      >
                        <IconCheckCircle />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent> Mark as read </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="notification.read === true">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click.stop="emit('mark-unread', notification.id)"
                      >
                        <IconCircle />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent> Mark as unread </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
                <ButtonGroup>
                  <Tooltip v-if="notification.status !== 'inbox'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click.stop="emit('mark-inbox', notification.id)"
                      >
                        <IconInbox />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent> Move to Inbox </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="notification.status !== 'saved'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click.stop="emit('mark-saved', notification.id)"
                      >
                        <IconBookmark />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent> Save </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="notification.status !== 'done'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click.stop="emit('mark-done', notification.id)"
                      >
                        <IconCheck />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent> Mark as done </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
              </TooltipProvider>
            </ButtonGroup>
            <span
              class="text-muted-foreground flex text-[10px] tabular-nums group-hover:hidden"
            >
              {{
                new Intl.DateTimeFormat("en-US", {
                  hour: "numeric",
                  minute: "numeric",
                  month: "short",
                  day: "numeric",
                }).format(notification.createdAt)
              }}
            </span>
          </ItemActions>
        </RouterLink>
      </Item>
    </ContextMenuTrigger>
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        Mark as
      </ContextMenuLabel>
      <ContextMenuRadioGroup
        :model-value="notification.read ? 'read' : 'unread'"
        @update:model-value="
          (val) => {
            if (val === 'read') emit('mark-read', notification.id)
            if (val === 'unread') emit('mark-unread', notification.id)
          }
        "
      >
        <ContextMenuRadioItem value="read"> Read </ContextMenuRadioItem>
        <ContextMenuRadioItem value="unread"> Unread </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
      <ContextMenuSeparator />
      <ContextMenuLabel class="text-muted-foreground text-xs">
        Move to
      </ContextMenuLabel>
      <ContextMenuRadioGroup
        :model-value="notification.status"
        @update:model-value="
          (val) => {
            if (val === 'inbox') emit('mark-inbox', notification.id)
            if (val === 'saved') emit('mark-saved', notification.id)
            if (val === 'done') emit('mark-done', notification.id)
          }
        "
      >
        <ContextMenuRadioItem value="inbox"> Inbox </ContextMenuRadioItem>
        <ContextMenuRadioItem value="saved"> Save </ContextMenuRadioItem>
        <ContextMenuRadioItem value="done"> Done </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
      <ContextMenuSeparator />
      <ContextMenuItem @click="emit('delete', notification.id)">
        <IconTrash />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

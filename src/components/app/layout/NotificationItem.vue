<script setup lang="ts">
import {
  IconBookmark,
  IconCheck,
  IconCircle,
  IconEye,
  IconEyeOff,
  IconInbox,
  IconMail,
  IconSparkles,
  IconSquareDashedMousePointer,
  IconSquareMousePointer,
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

const timeAgo = useTimeAgo(() => props.notification.createdAt)

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
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click.stop="
                          notification.read
                            ? emit('mark-unread', notification.id)
                            : emit('mark-read', notification.id)
                        "
                      >
                        <IconEyeOff v-if="notification.read" />
                        <IconEye v-else />
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
              class="text-muted-foreground/50 flex text-xs group-hover:hidden"
            >
              {{ timeAgo }}
            </span>
          </ItemActions>
        </RouterLink>
      </Item>
    </ContextMenuTrigger>
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuSub>
        <ContextMenuItem as-child>
          <ContextMenuSubTrigger>
            <IconSquareMousePointer />
            Move to
          </ContextMenuSubTrigger>
        </ContextMenuItem>
        <ContextMenuSubContent>
          <ContextMenuItem @click="emit('mark-inbox', notification.id)">
            <IconInbox />
            Inbox
          </ContextMenuItem>
          <ContextMenuItem @click="emit('mark-saved', notification.id)">
            <IconBookmark />
            Saved
          </ContextMenuItem>
          <ContextMenuItem @click="emit('mark-done', notification.id)">
            <IconCheck />
            Done
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuItem as-child>
          <ContextMenuSubTrigger>
            <IconSquareDashedMousePointer />
            Mark as
          </ContextMenuSubTrigger>
        </ContextMenuItem>
        <ContextMenuSubContent>
          <ContextMenuItem @click="emit('mark-read', notification.id)">
            <IconEye />
            Read
          </ContextMenuItem>
          <ContextMenuItem @click="emit('mark-unread', notification.id)">
            <IconEyeOff />
            Unread
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem @click="emit('delete', notification.id)">
        <IconTrash />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

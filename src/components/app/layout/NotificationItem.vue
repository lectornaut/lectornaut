<script setup lang="ts">
import {
  IconBookmark,
  IconCheck,
  IconCheckCircle,
  IconChevronRight,
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

const computedVariant = computed(() => {
  switch (props.notification.status) {
    case "saved":
      return "muted"
    case "done":
      return "muted"
    default:
      return "default"
  }
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Item size="sm" :variant="computedVariant" as-child>
        <RouterLink
          :to="notification.url"
          target="_blank"
          class="group relative flex w-full"
        >
          <ItemMedia variant="icon" class="text-muted-foreground relative">
            <Component :is="typeIcon" />
            <span
              v-if="notification.read === false"
              class="bg-primary ring-accent absolute -top-1 -right-1 flex size-2 rounded-full ring-2"
            ></span>
          </ItemMedia>
          <ItemContent class="gap-0.5 truncate">
            <ItemTitle v-if="notification.status === 'inbox'" class="truncate">
              {{ notification.title }}
            </ItemTitle>
            <ItemDescription class="truncate text-xs">
              {{ notification.description }}
            </ItemDescription>
            <span
              v-if="notification.status !== 'inbox'"
              class="text-muted-foreground text-[10px] tabular-nums"
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
            <!-- Hover Actions -->
            <ButtonGroup
              class="bg-background absolute top-1 right-1 hidden rounded-xl p-1 shadow-md group-hover:flex"
            >
              <TooltipProvider>
                <ButtonGroup>
                  <Tooltip v-if="notification.read === false">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="sm"
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
                        size="sm"
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
                        size="sm"
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
                        size="sm"
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
                        size="sm"
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
          </ItemContent>
          <ItemActions>
            <Button variant="ghost" size="icon-sm" @click.stop="handleClick">
              <IconChevronRight />
            </Button>
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
      <ContextMenuItem
        class="text-destructive focus:bg-destructive focus:text-destructive-foreground"
        @click="emit('delete', notification.id)"
      >
        <IconTrash />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

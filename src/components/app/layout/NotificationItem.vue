<script setup lang="ts">
import {
  IconBookmark,
  IconCheck,
  IconCircle,
  IconEye,
  IconEyeOff,
  IconInbox,
  IconInfo,
  IconMail,
  IconSparkles,
  IconSquareDashedMousePointer,
  IconSquareMousePointer,
  IconTrash,
  IconUserRoundMinus,
  IconUserRoundPlus,
  IconWorkflow,
} from "@/data/icons"
import { type INotification } from "@/types/notification"

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
  (e: "click"): void
}>()

const router = useRouter()

const timeAgo = useTimeAgo(() => props.notification.createdAt)

const typeIcon = computed(() => {
  switch (props.notification.type) {
    case "user.welcome":
      return IconSparkles
    case "invitation.received":
      return IconMail
    case "invitation.declined":
      return IconInfo
    case "member.joined":
      return IconUserRoundPlus
    case "member.removed":
      return IconUserRoundMinus
    case "workflow.run":
      return IconWorkflow
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
  emit("click")
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Item
        class="group @container/notification-item"
        size="xs"
        as-child
        @click.prevent.stop="handleClick"
      >
        <RouterLink :to="notification.url">
          <ItemMedia variant="icon" class="text-muted-foreground relative">
            <Component :is="typeIcon" />
            <span
              v-if="notification.read === false"
              class="bg-primary ring-sidebar absolute -top-1 -left-1 flex size-2 rounded-full ring-2"
            ></span>
          </ItemMedia>
          <ItemContent
            class="min-w-0 basis-[calc(100%-2rem)] @min-[360px]/notification-item:basis-0"
          >
            <ItemTitle
              class="block w-full truncate"
              :title="notification.title"
            >
              {{ notification.title }}
            </ItemTitle>
            <ItemDescription class="text-xs">
              {{ notification.description }}
            </ItemDescription>
          </ItemContent>
          <ItemActions class="ml-auto grid shrink-0">
            <ButtonGroup
              class="pointer-events-none col-start-1 row-start-1 justify-self-end opacity-0 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
            >
              <TooltipProvider>
                <ButtonGroup>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="secondary"
                        size="icon-lg"
                        :aria-label="
                          $t(
                            notification.read
                              ? 'components.notificationItem.tooltips.markUnread'
                              : 'components.notificationItem.contextMenu.read'
                          )
                        "
                        @click.prevent.stop="
                          notification.read
                            ? emit('mark-unread', notification.id)
                            : emit('mark-read', notification.id)
                        "
                      >
                        <IconEyeOff v-if="notification.read" />
                        <IconEye v-else />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        $t(
                          notification.read
                            ? "components.notificationItem.tooltips.markUnread"
                            : "components.notificationItem.contextMenu.read"
                        )
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="notification.status !== 'inbox'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="secondary"
                        size="icon-lg"
                        :aria-label="
                          $t('components.notificationItem.tooltips.moveToInbox')
                        "
                        @click.prevent.stop="
                          emit('mark-inbox', notification.id)
                        "
                      >
                        <IconInbox />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        $t("components.notificationItem.tooltips.moveToInbox")
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="notification.status !== 'saved'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="secondary"
                        size="icon-lg"
                        :aria-label="
                          $t('components.notificationItem.tooltips.save')
                        "
                        @click.prevent.stop="
                          emit('mark-saved', notification.id)
                        "
                      >
                        <IconBookmark />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ $t("components.notificationItem.tooltips.save") }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="notification.status !== 'done'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="secondary"
                        size="icon-lg"
                        :aria-label="
                          $t('components.notificationItem.tooltips.markDone')
                        "
                        @click.prevent.stop="emit('mark-done', notification.id)"
                      >
                        <IconCheck />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ $t("components.notificationItem.tooltips.markDone") }}
                    </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
              </TooltipProvider>
            </ButtonGroup>
            <span
              class="text-muted-foreground/50 pointer-events-none col-start-1 row-start-1 min-w-28 truncate text-right text-xs transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 motion-reduce:transition-none [@media(hover:none)]:opacity-0"
            >
              {{ timeAgo }}
            </span>
          </ItemActions>
        </RouterLink>
      </Item>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuSub>
        <ContextMenuItem as-child>
          <ContextMenuSubTrigger>
            <IconSquareMousePointer />
            {{ $t("components.notificationItem.contextMenu.moveTo") }}
          </ContextMenuSubTrigger>
        </ContextMenuItem>
        <ContextMenuSubContent>
          <ContextMenuItem @click="emit('mark-inbox', notification.id)">
            <IconInbox />
            {{ $t("components.notificationItem.contextMenu.inbox") }}
          </ContextMenuItem>
          <ContextMenuItem @click="emit('mark-saved', notification.id)">
            <IconBookmark />
            {{ $t("components.notificationItem.contextMenu.saved") }}
          </ContextMenuItem>
          <ContextMenuItem @click="emit('mark-done', notification.id)">
            <IconCheck />
            {{ $t("components.notificationItem.contextMenu.done") }}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuItem as-child>
          <ContextMenuSubTrigger>
            <IconSquareDashedMousePointer />
            {{ $t("components.notificationItem.contextMenu.markAs") }}
          </ContextMenuSubTrigger>
        </ContextMenuItem>
        <ContextMenuSubContent>
          <ContextMenuItem @click="emit('mark-read', notification.id)">
            <IconEye />
            {{ $t("components.notificationItem.contextMenu.read") }}
          </ContextMenuItem>
          <ContextMenuItem @click="emit('mark-unread', notification.id)">
            <IconEyeOff />
            {{ $t("components.notificationItem.contextMenu.unread") }}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem @click="emit('delete', notification.id)">
        <IconTrash />
        {{ $t("components.notificationItem.contextMenu.delete") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

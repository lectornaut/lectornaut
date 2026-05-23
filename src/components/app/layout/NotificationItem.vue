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
      <Item class="group" size="xs" as-child @click.prevent.stop="handleClick">
        <RouterLink :to="notification.url">
          <ItemMedia variant="icon" class="text-muted-foreground relative">
            <Component :is="typeIcon" />
            <span
              v-if="notification.read === false"
              class="bg-primary ring-accent size-2.5ring-2 absolute -top-1 -left-1 flex"
            ></span>
          </ItemMedia>
          <ItemContent class="gap-0.5 truncate">
            <ItemTitle class="line-clamp-1 truncate">
              {{ notification.title }}
            </ItemTitle>
            <ItemDescription class="truncate text-xs">
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
                        $t("components.notificationItem.tooltips.markUnread")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
                <ButtonGroup>
                  <Tooltip v-if="notification.status !== 'inbox'">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
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
                        variant="outline"
                        size="icon-sm"
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
                        variant="outline"
                        size="icon-sm"
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
              class="text-muted-foreground/50 flex text-xs group-hover:hidden"
            >
              {{ timeAgo }}
            </span>
          </ItemActions>
        </RouterLink>
      </Item>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-auto">
      <ContextMenuSub>
        <ContextMenuItem as-child>
          <ContextMenuSubTrigger>
            <IconSquareMousePointer />
            {{ $t("components.notificationItem.contextMenu.moveTo") }}
          </ContextMenuSubTrigger>
        </ContextMenuItem>
        <ContextMenuSubContent class="w-auto">
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
        <ContextMenuSubContent class="w-auto">
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

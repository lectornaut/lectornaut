<script lang="ts" setup>
import { useNotifications } from "@/composables/useNotifications"
import {
  IconBell,
  IconBookmark,
  IconCheck,
  IconCheckCheck,
  IconEye,
  IconEyeOff,
  IconInbox,
  IconLoader2,
  IconMoreHorizontal,
  IconPin,
  IconPinOff,
  IconSquareDashedMousePointer,
  IconSquareMousePointer,
  IconTrash,
} from "@/data/icons"
import type { INotificationStatus } from "@/types/notification"

type OverlayScrollbarsWrapperRef = ComponentPublicInstance<{
  getScrollElement: () => HTMLElement | undefined
}>

const {
  notifications,
  isLoading,
  unreadCount,
  inboxUnreadCount,
  savedUnreadCount,
  doneUnreadCount,
  loadMore,
  markAsRead,
  markAsUnread,
  markAsInbox,
  markAsSaved,
  markAsDone,
  markAllRead,
  markAllUnread,
  markAllInbox,
  markAllSaved,
  markAllDone,
  deleteNotification,
  deleteAllNotifications,
} = useNotifications()

const scrollableContainer = useTemplateRef<OverlayScrollbarsWrapperRef>(
  "scrollableContainer"
)
const activeTab = ref<INotificationStatus>("inbox")
const isDocked = ref(false)
const isPopoverOpen = ref(false)

const filteredNotifications = computed(() => {
  return notifications.value.filter((n) => {
    if (activeTab.value === "inbox") {
      return n.status === "inbox"
    }
    if (activeTab.value === "saved") {
      return n.status === "saved"
    }
    if (activeTab.value === "done") {
      return n.status === "done"
    }
    return false
  })
})

// Infinite scroll
useInfiniteScroll(
  () => scrollableContainer.value?.getScrollElement(),
  () => {
    loadMore()
  },
  {
    distance: 10,
    canLoadMore: () => !isLoading.value && notifications.value.length >= 20,
  }
)
</script>

<template>
  <Popover v-model:open="isPopoverOpen">
    <PopoverTrigger as-child>
      <Button
        id="tour-tasks-notifications"
        variant="ghost"
        :size="unreadCount > 0 ? 'sm' : 'icon-sm'"
      >
        <IconBell />
        <Badge
          v-if="unreadCount > 0"
          variant="secondary"
          class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square h-4 px-1"
        >
          {{ unreadCount }}
        </Badge>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="mx-2 w-auto p-2">
      <Tabs v-model="activeTab" default-value="inbox">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="icon" @click="isDocked = !isDocked">
              <IconPin v-if="!isDocked" />
              <IconPinOff v-else />
            </Button>
            <span class="font-semibold">Notifications</span>
          </div>
          <TabsList>
            <TabsTrigger value="inbox">
              <IconInbox />
              Inbox
              <Badge
                v-if="inboxUnreadCount > 0"
                variant="secondary"
                class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square px-1"
              >
                {{ inboxUnreadCount }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="saved">
              <IconBookmark />
              Saved
              <Badge
                v-if="savedUnreadCount > 0"
                variant="secondary"
                class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square px-1"
              >
                {{ savedUnreadCount }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="done">
              <IconCheck />
              Done
              <Badge
                v-if="doneUnreadCount > 0"
                variant="secondary"
                class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square px-1"
              >
                {{ doneUnreadCount }}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>
        <OverlayScrollbarsWrapper
          ref="scrollableContainer"
          class="bg-sidebar aspect-square w-md"
        >
          <Empty
            v-if="filteredNotifications.length === 0 && !isLoading"
            class="h-full"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconBell />
              </EmptyMedia>
              <EmptyTitle> No notifications </EmptyTitle>
              <EmptyDescription>
                You have no notifications at this time.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <ItemGroup v-else class="gap-2">
            <NotificationItem
              v-for="notification in filteredNotifications"
              :key="notification.id"
              :notification="notification"
              @mark-read="markAsRead"
              @mark-unread="markAsUnread"
              @mark-inbox="markAsInbox"
              @mark-saved="markAsSaved"
              @mark-done="markAsDone"
              @delete="deleteNotification"
              @click="isPopoverOpen = false"
            />
            <!-- Loading / Infinite Scroll Trigger -->
            <div class="flex justify-center p-4">
              <IconLoader2
                v-if="isLoading"
                class="text-muted-foreground animate-spin"
              />
            </div>
          </ItemGroup>
        </OverlayScrollbarsWrapper>
        <div class="flex items-center justify-between">
          <div>
            <ButtonGroup>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="secondary" size="icon">
                    <IconMoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent class="w-46">
                  <DropdownMenuSub>
                    <DropdownMenuItem as-child>
                      <DropdownMenuSubTrigger>
                        <IconSquareMousePointer />
                        Move all to
                      </DropdownMenuSubTrigger>
                    </DropdownMenuItem>
                    <DropdownMenuSubContent class="w-46">
                      <DropdownMenuItem @click="markAllInbox(activeTab)">
                        <IconInbox />
                        Inbox
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="markAllSaved(activeTab)">
                        <IconBookmark />
                        Saved
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="markAllDone(activeTab)">
                        <IconCheck />
                        Done
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuItem as-child>
                      <DropdownMenuSubTrigger>
                        <IconSquareDashedMousePointer />
                        Mark all as
                      </DropdownMenuSubTrigger>
                    </DropdownMenuItem>
                    <DropdownMenuSubContent class="w-46">
                      <DropdownMenuItem @click="markAllRead(activeTab)">
                        <IconEye />
                        Read
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="markAllUnread(activeTab)">
                        <IconEyeOff />
                        Unread
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="deleteAllNotifications(activeTab)">
                    <IconTrash />
                    Delete all
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </div>
          <div>
            <Button
              variant="secondary"
              :disabled="
                (activeTab === 'inbox' && inboxUnreadCount === 0) ||
                (activeTab === 'saved' && savedUnreadCount === 0) ||
                (activeTab === 'done' && doneUnreadCount === 0)
              "
              @click="markAllRead(activeTab)"
            >
              <IconCheckCheck />
              Mark all read
            </Button>
          </div>
        </div>
      </Tabs>
    </PopoverContent>
  </Popover>
  <Teleport v-if="isDocked" defer to="#left-dock" :disabled="!isDocked">
    <OverlayScrollbarsWrapper>
      <div class="grid size-full w-full min-w-64 grid-cols-1">
        <div
          class="size-full bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
        >
          Sample Content
        </div>
      </div>
    </OverlayScrollbarsWrapper>
  </Teleport>
</template>

<script lang="ts" setup>
import { useNotifications } from "@/composables/useNotifications"
import {
  IconBell,
  IconBookmark,
  IconCheck,
  IconCheckCheck,
  IconInbox,
  IconLoader2,
  IconMoreHorizontal,
  IconPin,
  IconPinOff,
} from "@/data/icons"
import type { INotificationStatus } from "@/types"
import { useIntersectionObserver } from "@vueuse/core"
import { computed, ref } from "vue"

defineProps<{
  iconDisplay?: "icon" | "text"
}>()

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

const loadMoreTrigger = ref(null)
const activeTab = ref<INotificationStatus>("inbox")
const isDocked = ref(false)

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

// Infinite scroll trigger
useIntersectionObserver(loadMoreTrigger, (entries) => {
  const entry = entries[0]
  if (
    entry?.isIntersecting &&
    !isLoading.value &&
    notifications.value.length >= 20
  ) {
    loadMore()
  }
})
</script>

<template>
  <Popover id="tour-tasks-notifications" :modal="false">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        :size="iconDisplay === 'text' || unreadCount > 0 ? 'sm' : 'icon-sm'"
      >
        <IconBell />
        <Badge
          v-if="unreadCount > 0"
          variant="secondary"
          class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square px-1"
        >
          {{ unreadCount }}
        </Badge>
        <template v-if="iconDisplay === 'text'"> Notifications </template>
      </Button>
    </PopoverTrigger>
    <PopoverContent side="bottom" class="mx-2 w-auto p-2">
      <Tabs v-model="activeTab" default-value="inbox">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              @click="isDocked = !isDocked"
            >
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
          class="bg-sidebar aspect-square w-md rounded-md p-2"
        >
          <Empty
            v-if="filteredNotifications.length === 0 && !isLoading"
            class="h-full"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconBell class="text-muted-foreground size-6" />
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
            />
            <!-- Loading / Infinite Scroll Trigger -->
            <div ref="loadMoreTrigger" class="flex justify-center p-4">
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
              <DropdownMenu :modal="false">
                <DropdownMenuTrigger as-child>
                  <Button variant="secondary" size="icon-sm">
                    <IconMoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" class="w-52">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      Move all to
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem @click="markAllInbox(activeTab)">
                        Inbox
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="markAllSaved(activeTab)">
                        Saved
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="markAllDone(activeTab)">
                        Done
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      Mark all as
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem @click="markAllRead(activeTab)">
                        Read
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="markAllUnread(activeTab)">
                        Unread
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="deleteAllNotifications(activeTab)">
                    Delete all
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </div>
          <div>
            <Button
              variant="ghost"
              size="sm"
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
    Coming Soon
  </Teleport>
</template>

<script lang="ts" setup>
import { useNotifications } from "@/composables/useNotifications"
import {
  IconBell,
  IconBookmark,
  IconCheck,
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

const bulkActionLabel = (status: INotificationStatus) => {
  if (status === "inbox") {
    return "Mark all saved"
  }
  if (status === "saved") {
    return "Mark all done"
  }
  if (status === "done") {
    return "Mark all inbox"
  }
}

const bulkAction = (status: INotificationStatus) => {
  if (status === "inbox") {
    markAllSaved(status)
  }
  if (status === "saved") {
    markAllDone(status)
  }
  if (status === "done") {
    markAllInbox(status)
  }
}
</script>

<template>
  <NavigationMenu id="tour-tasks-notifications">
    <NavigationMenuList class="gap-2">
      <NavigationMenuItem>
        <NavigationMenuTrigger
          class="h-8 bg-transparent px-3"
          :class="{ 'gap-2': iconDisplay === 'text' || unreadCount > 0 }"
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
        </NavigationMenuTrigger>
        <NavigationMenuContent>
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
              class="bg-secondary aspect-square w-md rounded-md p-2"
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
                <template
                  v-for="notification in filteredNotifications"
                  :key="notification.id"
                >
                  <NotificationItem
                    :notification="notification"
                    @mark-read="markAsRead"
                    @mark-unread="markAsUnread"
                    @mark-inbox="markAsInbox"
                    @mark-saved="markAsSaved"
                    @mark-done="markAsDone"
                    @delete="deleteNotification"
                  />
                </template>
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
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="
                    (activeTab === 'inbox' && inboxUnreadCount === 0) ||
                    (activeTab === 'saved' && savedUnreadCount === 0) ||
                    (activeTab === 'done' && doneUnreadCount === 0)
                  "
                  @click="markAllRead(activeTab)"
                >
                  Mark all read
                </Button>
              </div>
              <div>
                <ButtonGroup>
                  <Button
                    variant="secondary"
                    size="sm"
                    @click="bulkAction(activeTab)"
                  >
                    {{ bulkActionLabel(activeTab) }}
                  </Button>
                  <ButtonGroupSeparator />
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="secondary" size="icon-sm">
                        <IconMoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top" class="w-52">
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
                      <DropdownMenuItem
                        class="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                        @click="deleteAllNotifications(activeTab)"
                      >
                        Delete all
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ButtonGroup>
              </div>
            </div>
          </Tabs>
        </NavigationMenuContent>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
  <Teleport v-if="isDocked" defer to="#left-dock" :disabled="!isDocked">
    Coming Soon
  </Teleport>
</template>

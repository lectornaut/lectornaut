<script lang="ts" setup>
import { useNotifications } from "@/composables/useNotifications"
import {
  IconBell,
  IconBookmark,
  IconBookmarkCheck,
  IconCheck,
  IconCheckCheck,
  IconCheckCircle,
  IconInbox,
  IconLoader2,
  IconPin,
  IconPinOff,
} from "@/data/icons"

defineProps<{
  iconDisplay?: "icon" | "text"
}>()

const {
  notifications,
  isLoading,
  unreadCount,
  loadMore,
  markAsRead,
  markAsUnread,
  markAsDone,
  markAsSaved,
  markAllRead,
  markAllDone,
  markAllSaved,
} = useNotifications()

const loadMoreTrigger = ref(null)
const activeTab = ref("inbox")
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
                </TabsTrigger>
                <TabsTrigger value="saved">
                  <IconBookmark />
                  Saved
                </TabsTrigger>
                <TabsTrigger value="done">
                  <IconCheck />
                  Done
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
                    @mark-done="markAsDone"
                    @mark-saved="markAsSaved"
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
                  :disabled="unreadCount === 0"
                  @click="markAllRead"
                >
                  <IconCheckCircle />
                  Mark all read
                </Button>
              </div>
              <div>
                <TabsContent value="inbox">
                  <Button variant="ghost" size="sm" @click="markAllDone">
                    <IconCheckCheck />
                    Mark all as done
                  </Button>
                </TabsContent>
                <TabsContent value="saved">
                  <Button variant="ghost" size="sm" @click="markAllDone">
                    <IconCheckCheck />
                    Mark all as done
                  </Button>
                </TabsContent>
                <TabsContent value="done">
                  <Button variant="ghost" size="sm" @click="markAllSaved">
                    <IconBookmarkCheck />
                    Mark all as saved
                  </Button>
                </TabsContent>
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

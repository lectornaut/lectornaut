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
import { useThemeStore } from "@/stores/themeStore"
import { emitter } from "@/modules/mitt"
import { createReusableTemplate } from "@vueuse/core"

const { t } = useI18n()

type ScrollContainerRef = ComponentPublicInstance<{
  getScrollElement: () => HTMLElement | undefined
}>

const {
  notifications,
  isLoading,
  isLoadingMore,
  hasMore,
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

const scrollableContainer = useTemplateRef<ScrollContainerRef>(
  "scrollableContainer"
)
const activeTab = ref<INotificationStatus>("inbox")
const themeStore = useThemeStore()
const isDocked = computed({
  get: () => themeStore.themeSettings.leftDockPinned,
  set: (value: boolean) => {
    if (value) themeStore.themeSettings.leftDockOpen = true
    themeStore.themeSettings.leftDockPinned = value
  },
})
const isPopoverOpen = ref(false)
const [DefineNotificationsPanel, NotificationsPanel] = createReusableTemplate()
const dockedNotifications = useTemplateRef<HTMLElement>("dockedNotifications")
const popoverOpen = computed({
  get: () => !isDocked.value && isPopoverOpen.value,
  set: (open: boolean) => {
    if (isDocked.value) {
      if (open) {
        emitter.emit("Dock.Left.Toggle")
      }
      return
    }
    isPopoverOpen.value = open
  },
})

watch(isDocked, async (docked) => {
  isPopoverOpen.value = !docked
  await nextTick()
  if (docked && themeStore.themeSettings.leftDockOpen) {
    dockedNotifications.value?.focus()
  }
})

watch(
  () => themeStore.themeSettings.leftDockOpen,
  async (open) => {
    if (!open || !isDocked.value) return
    await nextTick()
    dockedNotifications.value?.focus()
  }
)

const toggleNotifications = () => {
  if (!isDocked.value) {
    isPopoverOpen.value = !isPopoverOpen.value
  } else {
    emitter.emit("Dock.Left.Toggle")
  }
}

onMounted(() => emitter.on("Dialog.Notifications.Toggle", toggleNotifications))
onUnmounted(() =>
  emitter.off("Dialog.Notifications.Toggle", toggleNotifications)
)

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
    // Precise gate: only invoke loadMore when the server confirmed
    // there's another page AND we're not already fetching one. Falls
    // back to the prior length-based heuristic until the listener's
    // first emission populates `hasMore`.
    canLoadMore: () =>
      hasMore.value &&
      !isLoading.value &&
      !isLoadingMore.value &&
      notifications.value.length >= 20,
  }
)
</script>

<template>
  <DefineNotificationsPanel>
    <Tabs
      v-model="activeTab"
      default-value="inbox"
      class="@container/notifications min-h-0 min-w-0"
      :class="{ 'h-full': isDocked }"
    >
      <div class="flex min-w-0 items-center justify-between gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0"
            :aria-label="t(isDocked ? 'actions.unpin' : 'actions.pin')"
            @click="isDocked = !isDocked"
          >
            <IconPin v-if="!isDocked" />
            <IconPinOff v-else />
          </Button>
          <span class="truncate font-semibold">
            {{ t("components.notifications.title") }}
          </span>
        </div>
        <TabsList class="bg-input/50 h-9! p-0">
          <TabsTrigger
            value="inbox"
            :aria-label="t('components.notifications.inbox')"
            class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
          >
            <IconInbox />
            <span class="hidden @min-[480px]/notifications:inline">
              {{ t("components.notifications.inbox") }}
            </span>
            <Badge
              v-if="inboxUnreadCount > 0"
              variant="secondary"
              class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square px-1"
            >
              {{ inboxUnreadCount }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="saved"
            :aria-label="t('components.notifications.saved')"
            class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
          >
            <IconBookmark />
            <span class="hidden @min-[480px]/notifications:inline">
              {{ t("components.notifications.saved") }}
            </span>
            <Badge
              v-if="savedUnreadCount > 0"
              variant="secondary"
              class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square px-1"
            >
              {{ savedUnreadCount }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="done"
            :aria-label="t('components.notifications.done')"
            class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
          >
            <IconCheck />
            <span class="hidden @min-[480px]/notifications:inline">
              {{ t("components.notifications.done") }}
            </span>
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
      <ScrollContainer
        ref="scrollableContainer"
        class="bg-sidebar rounded-2xl p-2"
        :class="isDocked ? 'min-h-0 flex-1' : 'aspect-square'"
      >
        <Empty
          v-if="filteredNotifications.length === 0 && !isLoading"
          class="h-full"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconBell />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("components.notifications.emptyTitle") }}
            </EmptyTitle>
            <EmptyDescription>
              {{ t("components.notifications.emptyDescription") }}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <ItemGroup v-else class="gap-0!">
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
              v-if="isLoading || isLoadingMore"
              class="text-muted-foreground animate-spin"
            />
          </div>
        </ItemGroup>
      </ScrollContainer>
      <div class="flex items-center justify-between">
        <div>
          <ButtonGroup>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="secondary" size="icon">
                  <IconMoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuSub>
                  <DropdownMenuItem as-child>
                    <DropdownMenuSubTrigger>
                      <IconSquareMousePointer />
                      {{ t("components.notifications.moveAllTo") }}
                    </DropdownMenuSubTrigger>
                  </DropdownMenuItem>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      data-hotkey="i"
                      @click="markAllInbox(activeTab)"
                    >
                      <IconInbox />
                      {{ t("components.notifications.inbox") }}
                      <DropdownMenuShortcut>I</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-hotkey="s"
                      @click="markAllSaved(activeTab)"
                    >
                      <IconBookmark />
                      {{ t("components.notifications.saved") }}
                      <DropdownMenuShortcut>S</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-hotkey="d"
                      @click="markAllDone(activeTab)"
                    >
                      <IconCheck />
                      {{ t("components.notifications.done") }}
                      <DropdownMenuShortcut>D</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuItem as-child>
                    <DropdownMenuSubTrigger>
                      <IconSquareDashedMousePointer />
                      {{ t("components.notifications.markAllAs") }}
                    </DropdownMenuSubTrigger>
                  </DropdownMenuItem>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      data-hotkey="r"
                      @click="markAllRead(activeTab)"
                    >
                      <IconEye />
                      {{ t("components.notifications.read") }}
                      <DropdownMenuShortcut>R</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-hotkey="u"
                      @click="markAllUnread(activeTab)"
                    >
                      <IconEyeOff />
                      {{ t("components.notifications.unread") }}
                      <DropdownMenuShortcut>U</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-hotkey="backspace delete"
                  @click="deleteAllNotifications(activeTab)"
                >
                  <IconTrash />
                  {{ t("components.notifications.deleteAll") }}
                  <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
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
            {{ t("components.notifications.markAllRead") }}
          </Button>
        </div>
      </div>
    </Tabs>
  </DefineNotificationsPanel>
  <Popover v-model:open="popoverOpen">
    <PopoverTrigger as-child>
      <Button
        id="tour-tasks-notifications"
        variant="outline"
        :size="unreadCount > 0 ? 'sm' : 'icon-sm'"
        :aria-label="t('components.notifications.title')"
      >
        <IconBell />
        <Badge
          v-if="unreadCount > 0"
          variant="secondary"
          class="bg-sidebar-primary text-sidebar-primary-foreground aspect-square h-4 rounded-3xl px-1"
        >
          {{ unreadCount }}
        </Badge>
      </Button>
    </PopoverTrigger>
    <PopoverContent
      v-if="!isDocked"
      class="mx-2 w-lg max-w-[calc(100vw-1rem)] p-2"
      @close-auto-focus="
        (event) => {
          if (isDocked) event.preventDefault()
        }
      "
    >
      <NotificationsPanel />
    </PopoverContent>
  </Popover>
  <Teleport v-if="isDocked" defer to="#left-dock">
    <div
      ref="dockedNotifications"
      role="region"
      :aria-label="t('components.notifications.title')"
      tabindex="-1"
      class="flex size-full min-h-0 min-w-0 flex-col p-2 outline-none"
    >
      <NotificationsPanel />
    </div>
  </Teleport>
</template>

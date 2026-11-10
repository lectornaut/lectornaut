<script lang="ts" setup>
import { useShortcutKeys } from "@/composables/useShortcutKeys"
import { IconArrowLeft, IconArrowRight, IconTrash } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useTabsStore } from "@/stores/tabsStore"
import { storeToRefs } from "pinia"

const router = useRouter()
const { t } = useI18n()

const tabsStore = useTabsStore()
const { recentlyClosed } = storeToRefs(tabsStore)
const reopenLastKeys = useShortcutKeys("Tabs.ReopenLast")
</script>

<template>
  <!-- ponytail: the card replaces the per-button tooltips; both on one
       trigger would stack. Router history isn't enumerable, so "history"
       here is the closed-tab stack the tab bar already keeps. -->
  <HoverCard :open-delay="500" :close-delay="100">
    <HoverCardTrigger as-child>
      <ButtonGroup>
        <Button
          :aria-label="t('tabs.goBack')"
          variant="ghost"
          size="icon-sm"
          @click="router.go(-1)"
        >
          <IconArrowLeft />
        </Button>
        <Button
          :aria-label="t('tabs.goForward')"
          variant="ghost"
          size="icon-sm"
          @click="router.go(1)"
        >
          <IconArrowRight />
        </Button>
      </ButtonGroup>
    </HoverCardTrigger>
    <HoverCardContent
      side="bottom"
      align="start"
      :side-offset="8"
      class="flex w-64 flex-col gap-1 p-1"
    >
      <div class="flex items-center justify-between gap-2 px-3 py-1.5">
        <span class="text-muted-foreground text-xs font-medium">
          {{ t("tabs.recentClosedTabs") }}
        </span>
        <KbdGroup v-if="recentlyClosed.length && reopenLastKeys?.length">
          <Kbd v-for="key in reopenLastKeys" :key="key">{{ key }}</Kbd>
        </KbdGroup>
      </div>
      <p
        v-if="recentlyClosed.length === 0"
        class="text-muted-foreground px-3 pb-2 text-sm"
      >
        {{ t("tabs.recentlyClosedEmpty") }}
      </p>
      <template v-else>
        <ScrollContainer class="max-h-72">
          <Button
            v-for="tab in recentlyClosed"
            :key="tab.id + tab.fullPath"
            variant="ghost"
            size="sm"
            class="w-full justify-start"
            @click="emitter.emit('Tabs.Reopen', tab)"
          >
            <TabIcon :full-path="tab.fullPath" />
            <span class="min-w-0 truncate">{{ tab.name }}</span>
          </Button>
        </ScrollContainer>
        <Separator />
        <Button
          variant="ghost"
          size="sm"
          class="w-full justify-start"
          @click="tabsStore.clearRecentlyClosed()"
        >
          <IconTrash />
          {{ t("tabs.clearRecent") }}
        </Button>
      </template>
    </HoverCardContent>
  </HoverCard>
</template>

<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { useBotSessionFilter } from "@/composables/useBotSessionFilter"
import { IconHistory, IconPlus, IconSearch, IconX } from "@/data/icons"
import type { IBotSession } from "@/types/domain"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import { Timestamp } from "firebase/firestore"
import { computed, provide, watch } from "vue"

const props = defineProps<{
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  node: WorkspaceNode
}>()

const { t } = useI18n()

// Each inspector sidebar gets its own bot chat context so the Bot tab's
// per-node session is independent from the page-level chat on /bot and
// the quick-ask sheet in AiAsk. Provided to children only; the rest of
// the app's BotChatContext injections are unaffected.
const inspectorBotChat = useBotChat()
provide(BotChatContextKey, inspectorBotChat)

// Filter state lives alongside the per-node bot chat so the inspector's
// history dropdown can apply search + filter without leaking into the
// /bot page's filter state.
const filter = useBotSessionFilter()

// Bind the chat to whichever node the inspector is showing. Re-fires on
// node switch so each file has its own conversation.
watch(
  () => props.node.id,
  async (nodeId) => {
    await inspectorBotChat.selectOrCreateNodeSession({
      scope: props.scope,
      nodeId,
    })
  },
  { immediate: true }
)

// Sessions pinned to the inspected node — what the History dropdown
// renders. Each session doc carries `pinnedNodeKey =
// "${ownerUid}:${scope}:${nodeId}"`; matching by suffix avoids needing
// the current uid here (we already know any entry in `mySessions` is
// ours, because `mySessions` is owner-scoped at the Firestore query
// level).
const nodeSessions = computed<IBotSession[]>(() => {
  const suffix = `:${props.scope}:${props.node.id}`
  const candidates = inspectorBotChat.mySessions.value.filter((s) =>
    s.pinnedNodeKey?.endsWith(suffix)
  )
  return filter.filter(candidates)
})

const activeSessionId = computed(() => inspectorBotChat.sessionId.value)

const formatRelative = (date: Date | null): string => {
  if (!date) return ""
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const sessionDate = (session: IBotSession): Date | null => {
  const value = session.updatedAt
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  return null
}

const onSelectNodeSession = async (id: string) => {
  // `selectSession` rehydrates attached chips from the loaded
  // session's `contextNodes` field, so the inspected node stays
  // attached as the user moves between pinned chats for the same
  // file without manual re-attaching.
  await inspectorBotChat.selectSession(id)
}

const onNewNodeChat = () => {
  inspectorBotChat.startNewPinnedNodeSession({
    scope: props.scope,
    nodeId: props.node.id,
  })
}
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col gap-2">
    <ButtonGroup class="mx-2 w-auto">
      <Button
        variant="outline"
        size="sm"
        class="grow justify-start"
        :title="t('ai.newChatHint')"
        @click="onNewNodeChat"
      >
        <IconPlus />
        <span>{{ t("ai.newChat") }}</span>
      </Button>
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="icon-sm"
                  :title="t('ai.botHistoryHint')"
                >
                  <IconHistory />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {{ t("ai.botHistory") }}
            </TooltipContent>
            <!-- `overflow-y-hidden` overrides DropdownMenuContent's -->
            <!-- default `overflow-y-auto` so the search header stays -->
            <!-- pinned while ScrollContainer handles the -->
            <!-- list scroll. `@open-auto-focus.prevent` stops the -->
            <!-- menu from auto-focusing the first checkbox item, -->
            <!-- which would otherwise highlight a session under the -->
            <!-- search input on open. -->
            <DropdownMenuContent class="w-72 p-0" align="end">
              <div class="border-b p-2">
                <InputGroup>
                  <InputGroupAddon>
                    <IconSearch />
                  </InputGroupAddon>
                  <!-- `@keydown.stop` keeps printable keystrokes -->
                  <!-- from reaching the menu's typeahead matcher, -->
                  <!-- which would otherwise hijack the search. -->
                  <InputGroupInput
                    v-model="filter.state.search"
                    :placeholder="t('ai.searchChats')"
                    class="text-xs"
                    @keydown.stop
                  />
                  <!-- Clear-search + filter menu live in a single -->
                  <!-- trailing addon. The clear button conditionally -->
                  <!-- renders (only when there's a search query); the -->
                  <!-- filter menu is always available so the user can -->
                  <!-- change filters even with no search text. -->
                  <InputGroupAddon align="inline-end" class="gap-1">
                    <Tooltip v-if="filter.state.search">
                      <TooltipTrigger as-child>
                        <InputGroupButton
                          size="icon-xs"
                          @click="filter.state.search = ''"
                        >
                          <IconX />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ t("ai.searchClear") }}
                      </TooltipContent>
                    </Tooltip>
                    <BotSessionFilterMenu
                      :filter="filter"
                      hide-node-attached-option
                      hide-sharing-option
                    />
                  </InputGroupAddon>
                </InputGroup>
              </div>
              <ScrollContainer>
                <Empty v-if="nodeSessions.length === 0" class="p-6">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconHistory />
                    </EmptyMedia>
                    <EmptyTitle>
                      {{
                        filter.isActive.value
                          ? t("ai.filterNoResults")
                          : t("ai.botHistoryEmpty")
                      }}
                    </EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent v-if="filter.isActive.value">
                    <Button variant="ghost" size="sm" @click="filter.reset()">
                      {{ t("ai.filterReset") }}
                    </Button>
                  </EmptyContent>
                </Empty>
                <div v-else class="flex flex-col p-2">
                  <DropdownMenuCheckboxItem
                    v-for="item in nodeSessions"
                    :key="item.id"
                    :model-value="item.id === activeSessionId"
                    @update:model-value="
                      (checked) => {
                        if (checked) onSelectNodeSession(item.id)
                      }
                    "
                  >
                    <span class="flex min-w-0 grow flex-col gap-0.5">
                      <span class="flex items-baseline justify-between gap-2">
                        <span>
                          {{ item.title || t("ai.newChat") }}
                        </span>
                        <span class="text-muted-foreground shrink-0 text-xs">
                          {{ formatRelative(sessionDate(item)) }}
                        </span>
                      </span>
                      <span
                        v-if="item.preview"
                        class="text-muted-foreground line-clamp-1 text-xs"
                      >
                        {{ item.preview }}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                </div>
              </ScrollContainer>
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      </TooltipProvider>
    </ButtonGroup>
    <AiChatShell />
  </div>
</template>

<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { useBotSessionFilter } from "@/composables/useBotSessionFilter"
import {
  IconHistory,
  IconMessageCircleMore,
  IconPlus,
  IconSearch,
  IconX,
} from "@/data/icons"
import type { IBotSession } from "@/types/domain"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import { Timestamp } from "firebase/firestore"
import { computed, provide, watch } from "vue"

const props = defineProps<{
  teamId: string | null
  workspaceId: string | null
  scope: WorkspaceNodeScope
  node: WorkspaceNode | null
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
// node switch so each file has its own conversation; clears when no node
// is selected so a stale chat doesn't leak across selections.
watch(
  () => props.node?.id ?? null,
  async (nodeId) => {
    if (!nodeId || !props.node) {
      inspectorBotChat.startNewSession()
      return
    }
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
  if (!props.node) return []
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
  if (!props.node) return
  inspectorBotChat.startNewPinnedNodeSession({
    scope: props.scope,
    nodeId: props.node.id,
  })
}
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <Tabs default-value="details" class="size-full min-h-0 min-w-0 gap-0">
      <TabsList class="bg-transparent p-2">
        <TabsTrigger
          value="details"
          class="data-[state=active]:bg-muted p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          {{ t("inspector.tabs.details") }}
        </TabsTrigger>
        <TabsTrigger
          value="attachments"
          class="data-[state=active]:bg-muted p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          {{ t("inspector.tabs.attachments") }}
        </TabsTrigger>
        <TabsTrigger
          value="activity"
          class="data-[state=active]:bg-muted p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          {{ t("inspector.tabs.activity") }}
        </TabsTrigger>
        <TabsTrigger
          value="bot"
          class="data-[state=active]:bg-muted p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          {{ t("ai.bot") }}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeDetails :node="node" />
      </TabsContent>

      <TabsContent
        value="attachments"
        class="size-full h-0 min-h-0 min-w-0 grow"
      >
        <NodeAttachments
          :team-id="teamId"
          :workspace-id="workspaceId"
          :scope="scope"
          :node="node"
        />
      </TabsContent>

      <TabsContent value="activity" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeActivityLog
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :document-id="node.id"
        />
        <div v-else class="p-4">
          <div>{{ t("inspector.activity.empty") }}</div>
        </div>
      </TabsContent>

      <TabsContent
        value="bot"
        class="flex h-0 min-h-0 min-w-0 grow flex-col gap-0"
      >
        <template v-if="teamId && workspaceId && node">
          <!-- Toolbar: History (dropdown with search + checkbox-marked -->
          <!-- list) + filter dropdown + new-chat button. Sticky at the -->
          <!-- top so the chat shell underneath gets the rest of the -->
          <!-- height. Checkbox items show the active session via their -->
          <!-- check indicator; controlled `model-value` keeps -->
          <!-- `activeSessionId` as the source of truth (the "uncheck" -->
          <!-- event is ignored so clicking the already-active session -->
          <!-- doesn't deselect it). -->
          <div class="flex items-center gap-1 border-b p-2">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="sm"
                  :title="t('ai.botHistoryHint')"
                >
                  <IconHistory />
                  <span>{{ t("ai.botHistory") }}</span>
                  <span
                    v-if="nodeSessions.length > 0"
                    class="bg-muted text-muted-foreground rounded px-1 text-xs font-medium"
                  >
                    {{ nodeSessions.length }}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <!-- `overflow-y-hidden` overrides DropdownMenuContent's -->
              <!-- default `overflow-y-auto` so the search header stays -->
              <!-- pinned while OverlayScrollbarsWrapper handles the -->
              <!-- list scroll. `@open-auto-focus.prevent` stops the -->
              <!-- menu from auto-focusing the first checkbox item, -->
              <!-- which would otherwise highlight a session under the -->
              <!-- search input on open. -->
              <DropdownMenuContent
                class="flex max-h-96 w-72 flex-col gap-0 overflow-y-hidden p-0"
                align="start"
                @open-auto-focus.prevent
              >
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
                <OverlayScrollbarsWrapper>
                  <div v-if="nodeSessions.length === 0" class="p-6 text-center">
                    <p class="text-muted-foreground text-xs">
                      {{
                        filter.isActive.value
                          ? t("ai.filterNoResults")
                          : t("ai.botHistoryEmpty")
                      }}
                    </p>
                    <Button
                      v-if="filter.isActive.value"
                      variant="ghost"
                      size="sm"
                      class="mt-2"
                      @click="filter.reset()"
                    >
                      {{ t("ai.filterReset") }}
                    </Button>
                  </div>
                  <div v-else class="flex flex-col p-1">
                    <DropdownMenuCheckboxItem
                      v-for="item in nodeSessions"
                      :key="item.id"
                      :model-value="item.id === activeSessionId"
                      class="items-start py-2"
                      @update:model-value="
                        (checked) => {
                          if (checked) onSelectNodeSession(item.id)
                        }
                      "
                    >
                      <IconMessageCircleMore class="text-muted-foreground" />
                      <span class="flex min-w-0 grow flex-col gap-0.5">
                        <span class="flex items-baseline justify-between gap-2">
                          <span class="truncate text-xs">
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
                </OverlayScrollbarsWrapper>
              </DropdownMenuContent>
            </DropdownMenu>

            <div class="grow" />

            <Button
              variant="default"
              size="sm"
              :title="t('ai.newChatHint')"
              @click="onNewNodeChat"
            >
              <IconPlus />
              <span>{{ t("ai.newChat") }}</span>
            </Button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col">
            <AiChatShell />
          </div>
        </template>
        <div v-else class="text-muted-foreground p-4 text-xs">
          {{ t("ai.botEmpty") }}
        </div>
      </TabsContent>
    </Tabs>
  </Sidebar>
</template>

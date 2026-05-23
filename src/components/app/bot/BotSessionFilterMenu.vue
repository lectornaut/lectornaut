<script lang="ts" setup>
import {
  BOT_CHAT_MODE_VALUES,
  BOT_CHAT_VISIBILITY_VALUES,
  BOT_SESSION_GROUP_BY_VALUES,
  BOT_SESSION_SORT_BY_VALUES,
  type BotSessionGroupBy,
  type BotSessionSortBy,
  useBotSessionFilter,
} from "@/composables/useBotSessionFilter"
import { IconListFilter } from "@/data/icons"
import type { IBotSessionVisibility } from "@/types/domain"

const props = defineProps<{
  filter: ReturnType<typeof useBotSessionFilter>
  /**
   * When true, the "Has attached node" checkbox is hidden — the
   * inspector tab implicitly restricts results to node-attached
   * sessions, so surfacing the toggle there would be confusing.
   */
  hideNodeAttachedOption?: boolean
  /**
   * When true, the "Shared with me" checkbox is hidden — used in
   * contexts where sharing filter doesn't make sense (e.g., the
   * inspector's per-node chats are always owned by the caller).
   */
  hideSharingOption?: boolean
}>()

const { t } = useI18n()

const modeLabel = (m: (typeof BOT_CHAT_MODE_VALUES)[number]): string => {
  if (m === "auto") return t("ai.auto")
  if (m === "agent") return t("ai.agent")
  return t("ai.manual")
}

const visibilityLabel = (v: IBotSessionVisibility): string => {
  if (v === "private") return t("ai.visibilityPrivate")
  if (v === "shared") return t("ai.visibilityShared")
  return t("ai.visibilityPublic")
}

const groupByLabel = (g: BotSessionGroupBy): string => {
  if (g === "none") return t("ai.groupByNone")
  if (g === "date") return t("ai.groupByDate")
  return t("ai.groupByVisibility")
}

const sortByLabel = (s: BotSessionSortBy): string => {
  if (s === "recency") return t("ai.sortByRecency")
  if (s === "created") return t("ai.sortByCreated")
  return t("ai.sortByAlphabetical")
}

// The active-filter dot is anchored to the trigger so users can tell
// at a glance whether something is filtering the list out — the
// `filter.isActive` ref is true for any non-default state.
const showActiveDot = props.filter.isActive

// `DropdownMenuCheckboxItem` activates close-on-select by default;
// calling `event.preventDefault()` in the `select` handler keeps the
// menu open so users can toggle multiple options without re-opening
// the trigger between each click.
const keepMenuOpen = (event: Event) => {
  event.preventDefault()
}
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <InputGroupButton
              size="icon-xs"
              class="data-[state=open]:bg-accent relative"
            >
              <IconListFilter />
              <span
                v-if="showActiveDot"
                class="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full"
                aria-hidden="true"
              />
            </InputGroupButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ t("ai.filterSessions") }}</TooltipContent>
        <DropdownMenuContent align="end" class="w-auto">
          <DropdownMenuLabel class="flex items-center justify-between gap-2">
            {{ t("ai.filterSessions") }}
            <Badge
              v-if="filter.isActive.value"
              variant="ghost"
              @click.stop="filter.reset()"
            >
              {{ t("ai.filterReset") }}
            </Badge>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuCheckboxItem
            v-if="!hideSharingOption"
            :model-value="filter.state.onlyShared"
            @update:model-value="(v) => filter.setOnlyShared(!!v)"
            @select="keepMenuOpen"
          >
            {{ t("ai.filterOnlyShared") }}
          </DropdownMenuCheckboxItem>

          <DropdownMenuCheckboxItem
            v-if="!hideNodeAttachedOption"
            :model-value="filter.state.onlyNodeAttached"
            @update:model-value="(v) => filter.setOnlyNodeAttached(!!v)"
            @select="keepMenuOpen"
          >
            {{ t("ai.filterOnlyNodeAttached") }}
          </DropdownMenuCheckboxItem>

          <DropdownMenuSeparator
            v-if="!hideSharingOption || !hideNodeAttachedOption"
          />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{{
              t("ai.filterMode")
            }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="w-44">
              <DropdownMenuCheckboxItem
                v-for="m in BOT_CHAT_MODE_VALUES"
                :key="m"
                :model-value="filter.state.modes.has(m)"
                @update:model-value="filter.toggleMode(m)"
                @select="keepMenuOpen"
              >
                {{ modeLabel(m) }}
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {{ t("ai.filterVisibility") }}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="w-44">
              <DropdownMenuCheckboxItem
                v-for="v in BOT_CHAT_VISIBILITY_VALUES"
                :key="v"
                :model-value="filter.state.visibilities.has(v)"
                @update:model-value="filter.toggleVisibility(v)"
                @select="keepMenuOpen"
              >
                {{ visibilityLabel(v) }}
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <!-- View options: groupBy + sortBy use `DropdownMenuRadioGroup` -->
          <!-- so the radio items handle mutual-exclusion for us. Unlike -->
          <!-- the checkbox items above they close the menu by default, -->
          <!-- so we don't reuse `keepMenuOpen` here — picking a sort/group -->
          <!-- is a one-and-done choice. -->
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {{ t("ai.groupBy") }}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="w-44">
              <DropdownMenuRadioGroup
                :model-value="filter.state.groupBy"
                @update:model-value="
                  (v) => filter.setGroupBy(v as BotSessionGroupBy)
                "
              >
                <DropdownMenuRadioItem
                  v-for="g in BOT_SESSION_GROUP_BY_VALUES"
                  :key="g"
                  :value="g"
                >
                  {{ groupByLabel(g) }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {{ t("ai.sortBy") }}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="w-44">
              <DropdownMenuRadioGroup
                :model-value="filter.state.sortBy"
                @update:model-value="
                  (v) => filter.setSortBy(v as BotSessionSortBy)
                "
              >
                <DropdownMenuRadioItem
                  v-for="s in BOT_SESSION_SORT_BY_VALUES"
                  :key="s"
                  :value="s"
                >
                  {{ sortByLabel(s) }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>

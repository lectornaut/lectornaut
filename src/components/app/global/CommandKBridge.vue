<script lang="ts" setup>
import { useCommand } from "@/components/ui/command"
import { useFilter } from "reka-ui"

/**
 * Renderless bridge into the Command component's provided filter context.
 * Both jobs are impossible from outside the <Command> subtree, and neither
 * touches `src/components/ui/*` — `useCommand` is the exported context API.
 *
 *  1. Mirror the internal search term out via `v-model:query`, so CommandK
 *     can swap between the curated highlights view and the full searchable
 *     set without owning the input.
 *  2. Re-score the filter when that swap mounts items late: Command.vue only
 *     filters on search-term *changes*, so items mounted after a keystroke
 *     (the highlights → everything switch on the first character) would all
 *     render unfiltered until the next keystroke. Watching the item registry
 *     size and re-running the same `contains` scoring closes that gap.
 */

const query = defineModel<string>("query", { default: "" })

const { allItems, allGroups, filterState } = useCommand()

watch(
  () => filterState.search,
  (search) => {
    query.value = search
  },
  { immediate: true }
)

// Same scoring as Command.vue's `filterItems`. `flush: "post"` so the
// newly-mounted items have registered themselves before we re-score.
const { contains } = useFilter({ sensitivity: "base" })

watch(
  () => allItems.value.size,
  () => {
    if (!filterState.search) return

    filterState.filtered.groups = new Set()
    let itemCount = 0

    for (const [id, value] of allItems.value) {
      const score = contains(value, filterState.search) ? 1 : 0
      filterState.filtered.items.set(id, score)
      if (score) itemCount++
    }

    for (const [groupId, group] of allGroups.value) {
      for (const itemId of group) {
        if ((filterState.filtered.items.get(itemId) ?? 0) > 0) {
          filterState.filtered.groups.add(groupId)
          break
        }
      }
    }

    filterState.filtered.count = itemCount
  },
  { flush: "post" }
)
</script>

<template>
  <slot />
</template>

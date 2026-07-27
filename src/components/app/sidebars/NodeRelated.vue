<script lang="ts" setup>
/**
 * NodeRelated — inspector sidebar tab that surfaces other workspace
 * nodes similar to the currently-open one.
 *
 * Calls the `findRelatedNodes` callable (`functions/src/botLink.ts`),
 * which reuses the source node's stored embedding as the query vector
 * — no embed call at lookup time, so the panel is cheap to refresh.
 * The server applies the same `0.55` cosine cutoff as
 * `searchWorkspaceNodes`, so an unrelated workspace produces an empty
 * list, not a list of distant noise.
 *
 * Per-node lifecycle: re-fetches whenever `node.id` changes (the
 * sidebar stays mounted across nodes, so a watch is the correct
 * trigger). A manual Refresh button is exposed in the header for the
 * case where the embedding was still pending on first open — the
 * embed-on-write trigger has a small lag after a content edit.
 *
 * Click target: each row is a RouterLink to the source's `/code/` or
 * `/write/` page for the matching scope. Folders aren't routable
 * targets in this app (only files have editor pages), so a folder
 * result is rendered without a link wrapper but still surfaces the
 * scope + name so the user can navigate manually via the tree.
 */

import { findRelatedNodes } from "@/composables/useFunctions"
import {
  IconAlertTriangle,
  IconFile,
  IconFolder,
  IconLink,
  IconRefreshCcw,
} from "@/data/icons"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import { computed, ref, toRefs, watch } from "vue"

interface RelatedResult {
  scope: "code" | "write"
  nodeId: string
  name: string
  type: "folder" | "file"
  snippet: string
  distance?: number
}

const props = defineProps<{
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  node: WorkspaceNode
}>()

const { teamId, workspaceId, scope, node } = toRefs(props)
const { t } = useI18n()

const results = ref<RelatedResult[]>([])
const truncated = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
/**
 * `loaded` separates the empty list returned by a successful query
 * from the "haven't queried yet" pre-first-fetch state. Without it,
 * the empty-state copy would flash for the brief window between mount
 * and the watcher firing.
 */
const loaded = ref(false)

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await findRelatedNodes({
      teamId: teamId.value,
      workspaceId: workspaceId.value,
      scope: scope.value,
      nodeId: node.value.id,
      // Default to cross-scope so users see related items even when the
      // closest matches live in the OTHER scope (e.g. a 'write' spec
      // doc and its 'code' implementation file).
      searchScope: "both",
      limit: 5,
    })
    results.value = data.results
    truncated.value = data.truncated
    loaded.value = true
  } catch (err) {
    // Friendly message; the server logs the detail.
    error.value =
      err instanceof Error ? err.message : t("inspector.related.errorFallback")
  } finally {
    loading.value = false
  }
}

// Re-fetch on node switch — the inspector reuses this component
// across nodes by changing `node`, not by remounting.
watch(
  () => node.value.id,
  () => {
    void load()
  },
  { immediate: true }
)

const scopeBadge = (s: "code" | "write") =>
  s === "code"
    ? t("ai.toolCall.search.scopeCode")
    : t("ai.toolCall.search.scopeWrite")

/**
 * Folders aren't routable (only files have editor pages), so wrap
 * file rows in a RouterLink and folder rows in a plain div. The
 * route shape matches the page definitions in `pages/write.vue` and
 * `pages/code.vue` — `/${scope}/${nodeId}`.
 */
const routeFor = (r: RelatedResult): string | null =>
  r.type === "folder" ? null : `/${r.scope}/${r.nodeId}`

const isEmpty = computed(
  () =>
    loaded.value && !loading.value && !error.value && results.value.length === 0
)
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col gap-2">
    <div class="flex items-center justify-between gap-2 px-2">
      <span class="text-muted-foreground text-xs font-medium uppercase">
        {{ t("inspector.related.title") }}
      </span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              :disabled="loading"
              @click="load"
            >
              <Spinner v-if="loading" />
              <IconRefreshCcw v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("actions.refresh") }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <ScrollContainer class="min-h-0 grow">
      <div class="flex flex-col gap-2 px-2 pb-2">
        <!-- Error state — covers the rare callable failure (permission,
             network). The Refresh button above stays usable. -->
        <div v-if="error" class="space-y-2 rounded border p-2">
          <div class="text-destructive flex items-start gap-2 text-xs">
            <IconAlertTriangle />
            <span>{{ error }}</span>
          </div>

          <Button variant="secondary" :disabled="loading" @click="load">
            <IconRefreshCcw />
            {{ t("actions.retry") }}
          </Button>
        </div>

        <!-- Empty state — the embedding may still be pending on a
             brand-new file (the embed-on-write trigger runs async after
             the doc write); the user can hit Refresh to retry. -->
        <Empty v-else-if="isEmpty" class="rounded-xl border border-dashed p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLink />
            </EmptyMedia>
            <EmptyTitle>{{ t("inspector.related.empty") }}</EmptyTitle>
            <EmptyDescription>
              {{ t("inspector.related.emptyHint") }}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <!-- Loaded results — file rows become RouterLinks, folder rows
             stay non-routable (no editor page for folders). -->
        <ItemGroup v-else-if="results.length > 0">
          <template
            v-for="result in results"
            :key="`${result.scope}:${result.nodeId}`"
          >
            <RouterLink
              v-if="routeFor(result)"
              :to="routeFor(result)!"
              class="block"
            >
              <Item variant="outline" size="xs">
                <ItemMedia variant="icon">
                  <IconFile class="text-muted-foreground" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle class="break-all">{{ result.name }}</ItemTitle>
                  <ItemDescription v-if="result.snippet" class="text-xs">
                    {{ result.snippet }}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary">{{
                    scopeBadge(result.scope)
                  }}</Badge>
                </ItemActions>
              </Item>
            </RouterLink>
            <Item v-else variant="outline" size="xs">
              <ItemMedia variant="icon">
                <IconFolder class="text-muted-foreground" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle class="break-all">{{ result.name }}</ItemTitle>
                <ItemDescription v-if="result.snippet" class="text-xs">
                  {{ result.snippet }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">{{
                  scopeBadge(result.scope)
                }}</Badge>
              </ItemActions>
            </Item>
          </template>
        </ItemGroup>

        <!-- Initial blank-then-loading window: render nothing if we
             haven't loaded yet (the header spinner already signals
             progress). Skipping the panel-wide loading card keeps the
             panel from "flashing" empty states on every node switch. -->
        <div v-else-if="loading" class="text-muted-foreground text-xs">
          {{ t("inspector.related.loading") }}
        </div>

        <div
          v-if="truncated && results.length > 0"
          class="text-muted-foreground pt-1 text-xs"
        >
          {{ t("inspector.related.truncated") }}
        </div>
      </div>
    </ScrollContainer>
  </div>
</template>

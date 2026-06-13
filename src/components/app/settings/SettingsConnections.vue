<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import {
  useConnections,
  type ConnectionAppRow,
} from "@/composables/useConnections"
import {
  CONNECTION_CATEGORIES,
  type ConnectionAppDescriptor,
  type ConnectionCategory,
} from "@/data/connectionApps"
import {
  IconApps,
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconDownload,
  IconInfo,
  IconLink,
  IconListFilter,
  IconMoreHorizontal,
  IconSearch,
  IconTrash,
  IconUnlink,
  IconX,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import type { ConnectionProvider } from "@lectornaut/shared/domain"
import { computed, nextTick, ref } from "vue"

/**
 * SettingsConnections — installable apps backed by external accounts
 * (docs/connections-feature.prompt.md). Moved out of SettingsIntegrations:
 * connections are credentialed third-party links, not catalog membership,
 * and unlike that page this one is NOT admin-walled — linking an account is
 * a MEMBER action. Only the Install/Uninstall app buttons are admin-gated
 * (disabled with a tooltip, mirroring SettingsTools' "New tool" CTA).
 *
 * Layout: an `ItemGroup` grid of app cards — provider logo in `ItemMedia`,
 * copy in `ItemContent`, the info + admin install/uninstall actions in
 * `ItemActions`, and (while installed) the signed-in member's own account
 * link in a full-width `ItemFooter` (status + Connect / Reconnect /
 * Disconnect).
 *
 * The info button opens `SettingsConnectionInfo` (mounted below,
 * page-scoped) via the `Dialog.ConnectionInfo.Open` mitt event — tabs for
 * the app's tools/permissions, the connected-accounts roster, and the
 * Owner/Admin settings tab carrying the team-wide kill switch. While that
 * switch is OFF (`row.disabled`) the card shows a Disabled badge and the
 * member footer swaps Connect/Reconnect for an explanatory line — only
 * Disconnect stays (members can always pull their own credentials).
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

const connections = useConnections()
// Top-level refs so the template auto-unwraps them (nested refs on a plain
// object aren't unwrapped in templates).
const connectionRows = connections.rows
const canManage = connections.canManage

// ── Tabs + search + category filter ────────────────────────────────────────
// Page-local — deliberately no composable (three facets, one consumer;
// useWorkflowFilter-style extraction earns its keep at several facets shared
// across surfaces). The UI mirrors the house filter conventions
// (WorkflowFilterMenu/BotSessionFilterMenu + their InputGroup hosts): search
// input with a clear button, the category menu as a trailing addon with
// checkbox items that keep the menu open, an active dot on the trigger, a
// Reset badge in the label. Facets AND together, outermost first: the
// Discover/Installed tab (Discover = full catalog, Installed = the team's
// installed subset), then categories (empty selection = all; selected ones
// OR together — an app matching ANY selected category stays visible), then
// search, matching name or description.

// The two CARD tabs are stamped from ONE card template: a `v-for` over
// CARD_TABS emits a TabsContent per tab, each rendering its own slice from
// `rowsByTab`. The third tab — Manage — is its own TabsContent (a sortable
// table, not cards), so it sits outside this loop. The panels know their
// tab statically, so no `activeTab` state exists — the Tabs root runs
// uncontrolled via `default-value`. The tab is a primary nav control, NOT
// part of `isFilterActive`/Reset: the selected trigger is its own
// always-visible indicator, and Reset yanking someone off a tab would
// conflate navigation with filtering.
const CARD_TABS = ["discover", "installed"] as const
type CardTab = (typeof CARD_TABS)[number]

const searchQuery = ref("")

// Collapsed-by-default search (the precedents' toolbar pattern): a compact
// icon button stands in for the field; clicking mounts the input and focuses
// it. Blur collapses it back ONLY while empty — a non-empty query keeps the
// field (and its clear button) visible so the active narrowing stays
// explained.
const searchExpanded = ref(false)
const expandSearch = (): void => {
  searchExpanded.value = true
  // The input mounts via v-if, so focus on the next tick. Focus by id rather
  // than a template ref: InputGroupInput wraps Input, and neither exposes
  // the underlying <input> to a parent ref.
  nextTick(() => document.getElementById("connections-search")?.focus())
}
const onSearchBlur = (): void => {
  if (!searchQuery.value.trim()) searchExpanded.value = false
}
const selectedCategories = ref<Set<ConnectionCategory>>(new Set())
// Any non-default state — drives the trigger dot AND what Reset clears,
// search included (useWorkflowFilter.isActive precedent).
const isFilterActive = computed(
  () => selectedCategories.value.size > 0 || searchQuery.value.trim().length > 0
)

// Reassign the Set (don't mutate) so the `rowsByTab` computed re-runs —
// same idiom as `pending` below.
const toggleCategory = (category: ConnectionCategory): void => {
  const next = new Set(selectedCategories.value)
  if (next.has(category)) next.delete(category)
  else next.add(category)
  selectedCategories.value = next
}
const resetFilters = (): void => {
  searchQuery.value = ""
  selectedCategories.value = new Set()
}

/** Exhaustive on purpose — a new CONNECTION_CATEGORIES value won't compile
 * until it gets a label key here (and copy in en.json). */
const CATEGORY_LABEL_KEYS: Record<ConnectionCategory, string> = {
  "ai-integrations": "settings.connections.categories.aiIntegrations",
  "link-previews": "settings.connections.categories.linkPreviews",
  "database-sync": "settings.connections.categories.databaseSync",
  automations: "settings.connections.categories.automations",
}
const categoryLabel = (category: ConnectionCategory): string =>
  t(CATEGORY_LABEL_KEYS[category])

// "Installed tab + nothing installed" gets its own empty-state copy —
// steering a team with zero installs toward "adjust your filters" would be
// wrong; installing is the fix. Checked against the UNFILTERED rows so an
// active search can't misattribute the cause.
const hasInstalledApps = computed(() =>
  connectionRows.value.some((row) => row.installed)
)

// Categories + search — the predicate BOTH tab panels share; each panel
// layers its own tab narrowing in `rowsByTab` below.
const matchesFilters = (row: ConnectionAppRow): boolean => {
  const query = searchQuery.value.trim().toLowerCase()
  if (
    selectedCategories.value.size > 0 &&
    !row.app.categories.some((category) =>
      selectedCategories.value.has(category)
    )
  ) {
    return false
  }
  if (
    query.length > 0 &&
    !row.app.name.toLowerCase().includes(query) &&
    !row.app.description.toLowerCase().includes(query)
  ) {
    return false
  }
  return true
}

const rowsByTab = computed<Record<CardTab, ConnectionAppRow[]>>(() => ({
  discover: connectionRows.value.filter(matchesFilters),
  installed: connectionRows.value.filter(
    (row) => row.installed && matchesFilters(row)
  ),
}))

// ── Manage tab (sortable table) ────────────────────────────────────────────
// One row per catalog app — the same population as Discover (the Status
// column carries the installed distinction) and the same search/category
// toolbar narrowing. Sorting mirrors the SettingsGroups/SettingsWorkspaces
// hand-rolled three-state cycle (asc → desc → off); "off" falls back to
// catalog order.

// `disabled` only exists while installed (the kill switch), so the three
// states are mutually exclusive.
type ConnectionRowStatus = "installed" | "disabled" | "notInstalled"
const rowStatus = (row: ConnectionAppRow): ConnectionRowStatus =>
  row.disabled ? "disabled" : row.installed ? "installed" : "notInstalled"

const STATUS_LABEL_KEYS: Record<ConnectionRowStatus, string> = {
  installed: "settings.connections.statusInstalled",
  disabled: "settings.connections.disabledBadge",
  notInstalled: "settings.connections.statusNotInstalled",
}
const statusLabel = (row: ConnectionAppRow): string =>
  t(STATUS_LABEL_KEYS[rowStatus(row)])

const STATUS_BADGE_VARIANTS = {
  installed: "secondary",
  disabled: "outline",
  notInstalled: "ghost",
} as const
const statusBadgeVariant = (row: ConnectionAppRow) =>
  STATUS_BADGE_VARIANTS[rowStatus(row)]

type SortDirection = "asc" | "desc" | null
type ManageSortKey = "name" | "status" | "accounts" | "installed"

const manageSortKey = ref<ManageSortKey | null>(null)
const manageSortDirection = ref<SortDirection>(null)

const toggleManageSort = (key: ManageSortKey): void => {
  if (manageSortKey.value === key) {
    if (manageSortDirection.value === "asc") {
      manageSortDirection.value = "desc"
    } else if (manageSortDirection.value === "desc") {
      manageSortKey.value = null
      manageSortDirection.value = null
    } else {
      manageSortDirection.value = "asc"
    }
  } else {
    manageSortKey.value = key
    manageSortDirection.value = "asc"
  }
}

// Ascending = not installed → disabled → installed.
const STATUS_RANK: Record<ConnectionRowStatus, number> = {
  notInstalled: 0,
  disabled: 1,
  installed: 2,
}
const installedAtMs = (row: ConnectionAppRow): number =>
  row.connection?.createdAt?.toDate?.()?.getTime() || 0

const sortedManageRows = computed(() => {
  const rows = rowsByTab.value.discover
  if (!manageSortKey.value || !manageSortDirection.value) return rows

  const sorted = [...rows]
  const direction = manageSortDirection.value === "asc" ? 1 : -1

  sorted.sort((a, b) => {
    if (manageSortKey.value === "name") {
      return a.app.name.localeCompare(b.app.name) * direction
    } else if (manageSortKey.value === "status") {
      return (STATUS_RANK[rowStatus(a)] - STATUS_RANK[rowStatus(b)]) * direction
    } else if (manageSortKey.value === "accounts") {
      return (a.bindingCount - b.bindingCount) * direction
    } else if (manageSortKey.value === "installed") {
      return (installedAtMs(a) - installedAtMs(b)) * direction
    }
    return 0
  })

  return sorted
})

const formatInstalledAt = (row: ConnectionAppRow): string => {
  const date = row.connection?.createdAt?.toDate?.()
  return date ? useDateFormat(date, "MMM D, YYYY").value : "—"
}

// The card footer's Connect/Disconnect visibility rules, extracted so the
// Manage menu and the cards can't drift. Connect covers first link AND
// reconnect (needs_reauth / scope upgrade); none of it while the kill
// switch is on — the server rejects new grants, so don't pose a doomed
// consent popup. Disconnect stays available in EVERY state while a binding
// exists (incl. disabled / needs_reauth): pulling your own credentials must
// never be harder than granting them.
const showConnectAction = (row: ConnectionAppRow): boolean =>
  row.installed &&
  !row.disabled &&
  (!row.myBinding ||
    row.myBinding.status === "needs_reauth" ||
    row.needsScopeUpgrade)
const showDisconnectAction = (row: ConnectionAppRow): boolean =>
  row.installed &&
  row.myBinding !== null &&
  (row.disabled || row.myBinding.status !== "needs_reauth")

/** Any of the row's verbs in flight — drives the Manage trigger spinner. */
const isRowPending = (provider: ConnectionProvider): boolean =>
  isPendingId(appActionId(provider)) ||
  isPendingId(toggleActionId(provider)) ||
  isBindingPending(provider)

// ── Kill switch from the Manage row menu ───────────────────────────────────
// The same "Enabled for the team" toggle as the info dialog's Settings tab,
// inline as a menu item. `setDisabled` is callable-applied (not optimistic),
// so the dialog's `pendingDisabled` idiom holds the INTENDED value for
// instant Switch feedback — keyed per provider here since the table has a
// row per app. Reverts on error (toasted inside useConnections), clears on
// settle; reassign the Map (don't mutate) so reads re-run.
const pendingDisabledByProvider = ref<Map<ConnectionProvider, boolean>>(
  new Map()
)
const isTeamEnabled = (row: ConnectionAppRow): boolean =>
  !(pendingDisabledByProvider.value.get(row.app.provider) ?? row.disabled)

const handleSetDisabled = (row: ConnectionAppRow, enabled: boolean): void => {
  const provider = row.app.provider
  const next = new Map(pendingDisabledByProvider.value)
  next.set(provider, !enabled)
  pendingDisabledByProvider.value = next
  void runLocked(toggleActionId(provider), async () => {
    try {
      await connections.setDisabled(provider, !enabled)
    } finally {
      const settled = new Map(pendingDisabledByProvider.value)
      settled.delete(provider)
      pendingDisabledByProvider.value = settled
    }
  })
}

// `DropdownMenuCheckboxItem` closes the menu on select by default; preventing
// keeps it open so several categories can be toggled in one visit (house
// filter-menu idiom).
const keepMenuOpen = (event: Event): void => {
  event.preventDefault()
}

// ── Per-row in-flight lockout ──────────────────────────────────────────────
// Reassign the Set (don't mutate) so reactive `:disabled` reads re-run —
// same idiom as SettingsIntegrations. App actions (`app:*`) lock
// independently of binding actions; the two binding verbs get DISTINCT ids
// (`connect:*` / `disconnect:*`) so each button spins only for its own verb
// — in the scope-upgrade state Reconnect and Disconnect render side by side
// — while `isBindingPending` still mutually excludes them per provider.
const pending = ref<Set<string>>(new Set())
const isPendingId = (id: string): boolean => pending.value.has(id)

const appActionId = (provider: ConnectionProvider): string => `app:${provider}`
/** Kill-switch toggle (Manage row menu) — locks independently of `app:*`. */
const toggleActionId = (provider: ConnectionProvider): string =>
  `toggle:${provider}`
const connectActionId = (provider: ConnectionProvider): string =>
  `connect:${provider}`
const disconnectActionId = (provider: ConnectionProvider): string =>
  `disconnect:${provider}`
/** Either binding verb in flight — disables BOTH footer buttons. */
const isBindingPending = (provider: ConnectionProvider): boolean =>
  isPendingId(connectActionId(provider)) ||
  isPendingId(disconnectActionId(provider))

const runLocked = async (id: string, action: () => Promise<void>) => {
  if (pending.value.has(id)) return
  pending.value = new Set(pending.value).add(id)
  try {
    await action()
  } catch {
    // Toasted inside useConnections; the row just unlocks.
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}

// ── Destructive-action confirms ────────────────────────────────────────────
// Uninstall and disconnect revoke real Google grants (uninstall: EVERY
// member's binding on the team), so both detour through an AlertDialog.
// Page-level `useConfirmationDialog` singletons (the SettingsWorkspaces
// pattern) rather than per-row dialogs inside the card v-for: the card
// panels AND the Manage table both trigger them, and per-row instances
// would unmount with their TabsContent. The composable snapshots the item
// and microtask-defers clearing it, so AlertDialogAction's auto-close on
// the same click can't race confirm() into a no-op.
const uninstallDialog = useConfirmationDialog<ConnectionAppDescriptor>()
const disconnectDialog = useConfirmationDialog<ConnectionAppDescriptor>()

const handleAppAction = (
  app: ConnectionAppDescriptor,
  installed: boolean
): void => {
  if (installed) {
    uninstallDialog.open(app)
    return
  }
  void runLocked(appActionId(app.provider), () =>
    connections.install(app.provider)
  )
}

const handleUninstallConfirmed = (): Promise<void> =>
  uninstallDialog.confirm((app) =>
    runLocked(appActionId(app.provider), () =>
      connections.uninstall(app.provider)
    )
  )

// "connect" covers first link AND reconnect (needs_reauth / scope upgrade) —
// same popup flow; the server overwrites the binding. The promise spans the
// whole OAuth handoff (sign-in + consent in another window, then the server
// code exchange), so the lock — and the spinner it drives — can run a while.
const handleConnect = (provider: ConnectionProvider): void => {
  if (isBindingPending(provider)) return
  void runLocked(connectActionId(provider), () => connections.connect(provider))
}

const handleDisconnectConfirmed = (): Promise<void> =>
  disconnectDialog.confirm((app) => {
    if (isBindingPending(app.provider)) return Promise.resolve()
    return runLocked(disconnectActionId(app.provider), () =>
      connections.disconnect(app.provider)
    )
  })

const openInfoDialog = (provider: ConnectionProvider): void => {
  emitter.emit("Dialog.ConnectionInfo.Open", { provider })
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <FieldGroup>
      <!-- min-w-0 kills the fieldset UA default `min-inline-size:
         min-content`, which otherwise floors this page's width at the
         Manage table's intrinsic width and pans the whole settings dialog
         horizontally (DataTable pages avoid it via their own min-w-0
         wrappers — same recipe). The table then scrolls INSIDE the Table
         primitive's own overflow-x-auto container when it can't fit. -->
      <FieldSet class="min-w-0">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.connections.label") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.connections.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <!-- Discover/Installed/Manage tabs wrap the toolbar-plus-grid
           region. The toolbar row: TabsList on the left; on the right the
           collapsed search-input pattern from the workflows/sessions
           toolbars — a compact icon pair that expands into the field on
           click (filling the row's remaining width) and collapses back on
           empty blur (DOM order matches visual/tab order; the trailing
           addon keeps a stable key so the filter menu instance survives the
           toggle). Below, ONE card template stamps a TabsContent per card
           tab (`v-for` over CARD_TABS) — Discover lists the full catalog,
           Installed its installed subset — and Manage is its own
           TabsContent: the Discover population again, as a sortable table
           with a per-row actions menu. All three narrow through the shared
           search/category predicate. -->
        <Tabs default-value="discover" orientation="horizontal">
          <div class="flex items-center justify-between gap-2">
            <TabsList class="grid grid-cols-3 rounded-full!">
              <TabsTrigger value="discover">
                {{ t("settings.connections.tabDiscover") }}
              </TabsTrigger>
              <TabsTrigger value="installed">
                {{ t("settings.connections.tabInstalled") }}
              </TabsTrigger>
              <TabsTrigger value="manage">
                {{ t("settings.connections.tabManage") }}
              </TabsTrigger>
            </TabsList>
            <InputGroup
              class="border-border border"
              :class="searchExpanded ? 'max-w-64' : 'w-auto'"
            >
              <!-- Collapsed: tooltipped button standing in for the search field. -->
              <InputGroupAddon v-if="!searchExpanded" key="search-compact">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton size="icon-xs" @click="expandSearch">
                        <IconSearch />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>{{ t("ai.search") }}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </InputGroupAddon>

              <!-- Expanded: the real field. `@blur` collapses it back, but only
             when empty (see `onSearchBlur`). -->
              <InputGroupAddon v-if="searchExpanded" key="search-icon">
                <IconSearch />
              </InputGroupAddon>
              <InputGroupInput
                v-if="searchExpanded"
                id="connections-search"
                key="search-input"
                v-model="searchQuery"
                :placeholder="t('settings.connections.searchPlaceholder')"
                @blur="onSearchBlur"
              />

              <InputGroupAddon key="search-trailing" align="inline-end">
                <!-- `@mousedown.prevent` keeps the input focused through the
               clear click so typing can resume immediately (and the
               unbroken focus means no collapse-by-blur mid-clear). -->
                <TooltipProvider v-if="searchExpanded && searchQuery">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        @mousedown.prevent
                        @click="searchQuery = ''"
                      >
                        <IconX />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>{{ t("ai.searchClear") }}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <DropdownMenu>
                      <TooltipTrigger as-child>
                        <DropdownMenuTrigger as-child>
                          <InputGroupButton
                            size="icon-xs"
                            class="data-[state=open]:bg-accent relative"
                            :aria-label="
                              t('settings.connections.filterByCategory')
                            "
                          >
                            <IconListFilter />
                            <span
                              v-if="isFilterActive"
                              class="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full"
                              aria-hidden="true"
                            />
                          </InputGroupButton>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ t("settings.connections.filterByCategory") }}
                      </TooltipContent>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel
                          class="flex items-center justify-between gap-2"
                        >
                          {{ t("settings.connections.filterByCategory") }}
                          <Badge
                            v-if="isFilterActive"
                            variant="ghost"
                            @click.stop="resetFilters()"
                          >
                            {{ t("ai.filterReset") }}
                          </Badge>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                          v-for="category in CONNECTION_CATEGORIES"
                          :key="category"
                          :model-value="selectedCategories.has(category)"
                          @update:model-value="toggleCategory(category)"
                          @select="keepMenuOpen"
                        >
                          {{ categoryLabel(category) }}
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Tooltip>
                </TooltipProvider>
              </InputGroupAddon>
            </InputGroup>
          </div>

          <TabsContent v-for="tab in CARD_TABS" :key="tab" :value="tab">
            <!-- Reachable three ways: a search with no hits, a category
               selection the catalog can't satisfy once taxonomy and apps
               drift apart, or the Installed tab on a team with nothing
               installed — that last cause gets its own copy (the fix is
               installing, not loosening filters). -->
            <Empty
              v-if="rowsByTab[tab].length === 0"
              class="border border-dashed"
            >
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconListFilter />
                </EmptyMedia>
                <EmptyTitle>
                  {{
                    tab === "installed" && !hasInstalledApps
                      ? t("settings.connections.installedEmpty")
                      : t("settings.connections.filterEmpty")
                  }}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>

            <ItemGroup
              v-else
              class="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3"
            >
              <template v-for="row in rowsByTab[tab]" :key="row.app.provider">
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <component :is="row.app.logo" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle class="flex items-center gap-1.5">
                      {{ row.app.name }}
                      <!-- Kill switch is on — agents lose the app's tools and new
                     connects are rejected until an admin re-enables it. -->
                      <Badge v-if="row.disabled" variant="outline">
                        {{ t("settings.connections.disabledBadge") }}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription>{{ row.app.description }}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            :aria-label="t('settings.connections.infoButton')"
                            @click="openInfoDialog(row.app.provider)"
                          >
                            <IconInfo />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{ t("settings.connections.infoButton") }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <span class="inline-block">
                            <Button
                              :variant="row.installed ? 'outline' : 'default'"
                              size="sm"
                              :disabled="
                                !canManage ||
                                isPendingId(appActionId(row.app.provider))
                              "
                              @click="handleAppAction(row.app, row.installed)"
                            >
                              <Spinner
                                v-if="
                                  isPendingId(appActionId(row.app.provider))
                                "
                              />
                              {{
                                row.installed
                                  ? t("settings.connections.uninstallApp")
                                  : t("settings.connections.installApp")
                              }}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent v-if="!canManage">
                          {{ t("settings.connections.permissionRequired") }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </ItemActions>
                  <!-- The signed-in member's own account link (member action,
                 deliberately NOT admin-gated). -->
                  <ItemFooter
                    v-if="row.installed"
                    class="bg-secondary rounded-2xl p-4"
                  >
                    <div class="flex flex-col">
                      <span class="text-sm">
                        <!-- The OAuth handoff runs in another window (GIS popup /
                       system browser) and only settles once the user finishes
                       consenting — say so instead of a stale "isn't
                       connected" while the button spinner runs. -->
                        <template
                          v-if="isPendingId(connectActionId(row.app.provider))"
                        >
                          {{ t("settings.connections.connecting") }}
                        </template>
                        <!-- Disabled leads: any Connect the other states would
                       offer is rejected server-side anyway. -->
                        <template v-else-if="row.disabled">
                          {{ t("settings.connections.disabledByAdmin") }}
                        </template>
                        <template v-else-if="!row.myBinding">
                          {{ t("settings.connections.notConnected") }}
                        </template>
                        <template
                          v-else-if="row.myBinding.status === 'needs_reauth'"
                        >
                          {{ t("settings.connections.needsReauth") }}
                        </template>
                        <template v-else-if="row.myBinding.email">
                          {{
                            t("settings.connections.connectedAs", {
                              email: row.myBinding.email,
                            })
                          }}
                        </template>
                        <template v-else>
                          {{ t("settings.connections.connected") }}
                        </template>
                      </span>
                      <span class="text-muted-foreground text-sm">
                        {{
                          t(
                            "settings.connections.membersConnected",
                            row.bindingCount
                          )
                        }}
                      </span>
                      <!-- Connected under an older, narrower grant (e.g. a P1
                     read-only Google Calendar binding after the P2 write
                     upgrade) — only a fresh consent popup can widen it. -->
                      <span
                        v-if="
                          row.needsScopeUpgrade &&
                          !row.disabled &&
                          !isPendingId(connectActionId(row.app.provider))
                        "
                        class="text-muted-foreground text-sm"
                      >
                        {{ t("settings.connections.scopeUpgradeHint") }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <!-- Visibility rules live in showConnectAction /
                     showDisconnectAction (shared with the Manage table's
                     actions menu). -->
                      <Button
                        v-if="showConnectAction(row)"
                        variant="outline"
                        size="sm"
                        :disabled="isBindingPending(row.app.provider)"
                        @click="handleConnect(row.app.provider)"
                      >
                        <Spinner
                          v-if="isPendingId(connectActionId(row.app.provider))"
                        />
                        {{
                          row.myBinding
                            ? t("settings.connections.reconnect")
                            : t("settings.connections.connect")
                        }}
                      </Button>
                      <Button
                        v-if="showDisconnectAction(row)"
                        variant="outline"
                        size="sm"
                        :disabled="isBindingPending(row.app.provider)"
                        @click="disconnectDialog.open(row.app)"
                      >
                        <Spinner
                          v-if="
                            isPendingId(disconnectActionId(row.app.provider))
                          "
                        />
                        {{ t("settings.connections.disconnect") }}
                      </Button>
                    </div>
                  </ItemFooter>
                </Item>
              </template>
            </ItemGroup>
          </TabsContent>

          <!-- ── Manage tab: the catalog as a sortable table ─────────────
             Same population as Discover (Status carries the installed
             distinction), same toolbar narrowing; sorting + actions-menu
             anatomy mirror SettingsGroups/SettingsWorkspaces. -->
          <TabsContent value="manage" class="min-w-0">
            <div class="min-w-0 overflow-clip rounded-2xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-1/6">
                      <Button variant="ghost" @click="toggleManageSort('name')">
                        {{ t("settings.connections.columnApp") }}
                        <IconArrowUp
                          v-if="
                            manageSortKey === 'name' &&
                            manageSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            manageSortKey === 'name' &&
                            manageSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/6">
                      <Button
                        variant="ghost"
                        @click="toggleManageSort('status')"
                      >
                        {{ t("settings.connections.columnStatus") }}
                        <IconArrowUp
                          v-if="
                            manageSortKey === 'status' &&
                            manageSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            manageSortKey === 'status' &&
                            manageSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/6">
                      {{ t("settings.connections.columnCategories") }}
                    </TableHead>
                    <TableHead class="w-1/6">
                      <Button
                        variant="ghost"
                        @click="toggleManageSort('accounts')"
                      >
                        {{ t("settings.connections.columnAccounts") }}
                        <IconArrowUp
                          v-if="
                            manageSortKey === 'accounts' &&
                            manageSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            manageSortKey === 'accounts' &&
                            manageSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/6">
                      <Button
                        variant="ghost"
                        @click="toggleManageSort('installed')"
                      >
                        {{ t("settings.connections.info.installedOnLabel") }}
                        <IconArrowUp
                          v-if="
                            manageSortKey === 'installed' &&
                            manageSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            manageSortKey === 'installed' &&
                            manageSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/6 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="row in sortedManageRows"
                    :key="row.app.provider"
                  >
                    <TableCell>
                      <Item class="group p-0" size="xs">
                        <ItemMedia variant="icon">
                          <component :is="row.app.logo" />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{{ row.app.name }}</ItemTitle>
                          <ItemDescription class="text-xs">
                            {{ row.app.description }}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </TableCell>
                    <TableCell>
                      <Badge :variant="statusBadgeVariant(row)">
                        {{ statusLabel(row) }}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div class="flex flex-wrap gap-1">
                        <Badge
                          v-for="category in row.app.categories"
                          :key="category"
                          variant="outline"
                        >
                          {{ categoryLabel(category) }}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                      {{
                        row.installed
                          ? t(
                              "settings.connections.membersConnected",
                              row.bindingCount
                            )
                          : "—"
                      }}
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                      {{ formatInstalledAt(row) }}
                    </TableCell>
                    <TableCell class="text-right">
                      <DropdownMenu>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <DropdownMenuTrigger as-child>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  :disabled="isRowPending(row.app.provider)"
                                >
                                  <Spinner
                                    v-if="isRowPending(row.app.provider)"
                                  />
                                  <IconMoreHorizontal v-else />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                data-hotkey="i"
                                @click="openInfoDialog(row.app.provider)"
                              >
                                <IconInfo />
                                {{ t("settings.connections.infoButton") }}
                                <DropdownMenuShortcut>I</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <!-- Admin-gated, with the reason on hover —
                                 the workspaces table's disabled-item-in-a-
                                 tooltip pattern. -->
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <div>
                                    <DropdownMenuItem
                                      :disabled="!canManage"
                                      data-hotkey="u"
                                      @click="
                                        handleAppAction(row.app, row.installed)
                                      "
                                    >
                                      <IconTrash v-if="row.installed" />
                                      <IconDownload v-else />
                                      {{
                                        row.installed
                                          ? t(
                                              "settings.connections.uninstallApp"
                                            )
                                          : t("settings.connections.installApp")
                                      }}
                                      <DropdownMenuShortcut>
                                        U
                                      </DropdownMenuShortcut>
                                    </DropdownMenuItem>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent v-if="!canManage">
                                  {{
                                    t("settings.connections.permissionRequired")
                                  }}
                                </TooltipContent>
                              </Tooltip>
                              <!-- The team-wide kill switch, inline (the
                                 info dialog's Settings tab toggle). Only
                                 while installed — the status lives on the
                                 connection doc. `as-child` renders the item
                                 AS the label, so clicking anywhere on the
                                 row activates the Switch via for/id;
                                 `@select.prevent` keeps the menu open so
                                 the flip is visible. -->
                              <Tooltip v-if="row.installed">
                                <TooltipTrigger as-child>
                                  <div>
                                    <DropdownMenuItem
                                      as-child
                                      :disabled="!canManage"
                                      @select.prevent
                                    >
                                      <label
                                        :for="`team-enabled-${row.app.provider}`"
                                      >
                                        <IconApps />
                                        {{
                                          t(
                                            "settings.connections.info.enabledLabel"
                                          )
                                        }}
                                        <Switch
                                          :id="`team-enabled-${row.app.provider}`"
                                          class="ml-auto"
                                          :model-value="isTeamEnabled(row)"
                                          :disabled="
                                            !canManage ||
                                            isPendingId(
                                              toggleActionId(row.app.provider)
                                            )
                                          "
                                          @update:model-value="
                                            (value) =>
                                              handleSetDisabled(row, !!value)
                                          "
                                        />
                                      </label>
                                    </DropdownMenuItem>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent v-if="!canManage">
                                  {{
                                    t("settings.connections.permissionRequired")
                                  }}
                                </TooltipContent>
                              </Tooltip>
                              <!-- Member binding verbs — same visibility
                                 rules as the card footer. -->
                              <template
                                v-if="
                                  showConnectAction(row) ||
                                  showDisconnectAction(row)
                                "
                              >
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  v-if="showConnectAction(row)"
                                  data-hotkey="c"
                                  @click="handleConnect(row.app.provider)"
                                >
                                  <IconLink />
                                  {{
                                    row.myBinding
                                      ? t("settings.connections.reconnect")
                                      : t("settings.connections.connect")
                                  }}
                                  <DropdownMenuShortcut>C</DropdownMenuShortcut>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  v-if="showDisconnectAction(row)"
                                  data-hotkey="x"
                                  @click="disconnectDialog.open(row.app)"
                                >
                                  <IconUnlink />
                                  {{ t("settings.connections.disconnect") }}
                                  <DropdownMenuShortcut>X</DropdownMenuShortcut>
                                </DropdownMenuItem>
                              </template>
                            </DropdownMenuContent>
                            <TooltipContent>
                              {{ t("settings.connections.actions") }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="sortedManageRows.length === 0">
                    <TableCell colspan="6">
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconListFilter />
                          </EmptyMedia>
                          <EmptyTitle>
                            {{ t("settings.connections.filterEmpty") }}
                          </EmptyTitle>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </FieldSet>
    </FieldGroup>

    <!-- Confirm dialogs for the two grant-revoking actions — page-level
         singletons (driven by useConfirmationDialog) because the card
         panels AND the Manage table both open them; per-row instances
         would unmount with their TabsContent. The composable's `.value`s
         are explicit: nested refs on a plain object don't auto-unwrap in
         templates. -->
    <AlertDialog
      :open="uninstallDialog.isOpen.value"
      @update:open="
        (open) => {
          if (!open) uninstallDialog.close()
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.connections.uninstallConfirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.connections.uninstallConfirmBody", {
                name: uninstallDialog.item.value?.name ?? "",
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {{ t("actions.cancel") }}<Kbd aria-hidden="true">Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction @click="handleUninstallConfirmed()">
            {{ t("settings.connections.uninstallApp") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog
      :open="disconnectDialog.isOpen.value"
      @update:open="
        (open) => {
          if (!open) disconnectDialog.close()
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("settings.connections.disconnectConfirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("settings.connections.disconnectConfirmBody", {
                name: disconnectDialog.item.value?.name ?? "",
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {{ t("actions.cancel") }}<Kbd aria-hidden="true">Esc</Kbd>
          </AlertDialogCancel>
          <AlertDialogAction @click="handleDisconnectConfirmed()">
            {{ t("settings.connections.disconnect") }}
            <Kbd aria-hidden="true">↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Page-scoped on purpose (vs the layout-mounted SettingsCustomTools):
         only this page opens it, and scoping keeps useConnections' listeners
         + GIS preload off every unrelated session. -->
    <SettingsConnectionInfo />
  </div>
  <SettingsRestricted v-else />
</template>

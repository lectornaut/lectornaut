/**
 * useCommandPalette — assembles the ⌘K palette's content from every actionable
 * surface of the app, in one derive-only composable (CommandK.vue stays
 * presentational).
 *
 * Sources composed, each reusing the single source that already describes it:
 *   - the curated `shortcuts.ts` commands-context categories (mitt events)
 *   - "Go to" navigation from `defaultMenu`
 *   - "Create" intents from `useCreateActions` (permission/feature gated)
 *   - tab actions + open / recently-closed tabs (the `Tabs.*` mitt bridge)
 *   - workspace / team switching (`useWorkspaceActions` / `useTeamActions`)
 *   - every settings panel from `defaultSettingsTabs` (team tiers role-gated)
 *
 * Groups marked `highlight` form the curated empty-query view; the rest only
 * surface while searching. Display keys honor user overrides via the same
 * resolution as `useShortcutKeys`. Tab-action key hints only show on desktop,
 * where `useGlobalHotkeys` actually registers them — the *commands* work on
 * web too, since the `Tabs.*` mitt handlers are platform-independent.
 */

import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useCopy } from "@/composables/useCopy"
import { useCreateActions } from "@/composables/useCreateActions"
import { isTauri } from "@/composables/usePlatform"
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconCircleX,
  IconCopy,
  IconGalleryHorizontalEnd,
  IconHistory,
  IconPlus,
  IconSquarePen,
  IconSquareX,
  IconX,
} from "@/data/icons"
import { defaultMenu, defaultSettingsTabs } from "@/helpers/defaults"
import {
  getFilteredShortcuts,
  getHotkeyCombos,
  getShortcutById,
  getShortcutDisplayKeys,
  getShortcutId,
  hotkeyToDisplayKeys,
  sequenceToDisplayKeys,
  type Shortcut,
} from "@/helpers/shortcuts"
import { isDefaultRoute } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useShortcutsStore } from "@/stores/shortcutsStore"
import { useTabsStore } from "@/stores/tabsStore"
import { storeToRefs } from "pinia"
import { computed, type Component, type ComputedRef } from "vue"
import { useRoute, useRouter } from "vue-router"
import { toast } from "vue-sonner"

export interface PaletteCommand {
  /** Stable, globally-unique listbox value (namespaced per source). */
  id: string
  /** Breadcrumb-style label path (1–2 segments). */
  label: string[]
  icon?: Component
  /** Render an AppAvatar instead of an icon (workspace / team rows). */
  avatar?: { src?: string | null; name: string }
  /** Display keys for the first bound combo, user-override aware. */
  keys?: string[] | null
  /**
   * Extra search terms. Rendered into the item as visually-hidden text:
   * the Command filter matches against an item's `textContent`, so this is
   * how aliases ("dark mode", "sign out") become searchable.
   */
  keywords?: string
  run: () => void
}

export interface PaletteGroup {
  id: string
  heading: string
  /** Part of the curated empty-query view; others are search-only. */
  highlight: boolean
  commands: PaletteCommand[]
}

/**
 * Palette group display order. Static `shortcuts.ts` categories keep their
 * `shortcut:<id>` namespace; groups not listed here sort to the end.
 */
const GROUP_ORDER: readonly string[] = [
  "shortcut:general",
  "navigate",
  "create",
  "tabs",
  "workspaces",
  "teams",
  "settings",
  "shortcut:layout",
  "shortcut:appearance",
  "shortcut:account",
]

/**
 * Static `shortcuts.ts` category ids that are search-only: shown while typing,
 * but kept OUT of the curated empty-query highlights. Appearance (theme
 * switching) is rarely why you open the palette, so it surfaces only on search.
 */
const SEARCH_ONLY_SHORTCUT_CATEGORIES = new Set(["appearance"])

export function useCommandPalette(): { groups: ComputedRef<PaletteGroup[]> } {
  const { t } = useI18n()
  const router = useRouter()
  const route = useRoute()

  const { shortcutOverrides } = storeToRefs(useShortcutsStore())

  const tabsStore = useTabsStore()
  const { tabs, activeTabId, activeTab, recentlyClosed } =
    storeToRefs(tabsStore)

  const { workspaces, currentWorkspace, switchWorkspace } =
    useWorkspaceActions()
  const { memberships, currentTeam, switchTeam } = useTeamActions()
  const { canViewTeamSettings } = useCanViewTeamSettings()
  const { groups: createActionGroups } = useCreateActions()

  // ==========================================================================
  // Key display helpers (same override resolution as `useShortcutKeys`,
  // inlined as plain functions so list mapping stays cheap)
  // ==========================================================================

  const displayKeys = (shortcut: Shortcut): string[] | null => {
    const override = shortcutOverrides.value?.[getShortcutId(shortcut)]
    if (override) {
      const combo = getHotkeyCombos(override)[0]
      if (combo) return hotkeyToDisplayKeys(combo)
    }
    // No override: the canonical display (explicit `keys`, else derived from
    // `hotkeys`). First combo only — the palette shows a single key hint.
    return getShortcutDisplayKeys(shortcut)[0] ?? null
  }

  /** Keys for a `shortcuts.ts` entry looked up by its stable id. */
  const keysById = (shortcutId: string): string[] | null => {
    const shortcut = getShortcutById(shortcutId)
    return shortcut ? displayKeys(shortcut) : null
  }

  /** Tab hotkeys are only registered on desktop — hide the hints elsewhere. */
  const tabActionKeys = (shortcutId: string): string[] | null =>
    isTauri.value ? keysById(shortcutId) : null

  // ==========================================================================
  // Static `shortcuts.ts` categories — the curated highlights
  // ==========================================================================

  const staticGroups = computed<PaletteGroup[]>(() =>
    getFilteredShortcuts({ context: "commands", isDesktop: isTauri.value }).map(
      (category) => ({
        id: `shortcut:${category.id}`,
        heading: category.title,
        highlight: !SEARCH_ONLY_SHORTCUT_CATEGORIES.has(category.id),
        commands: category.shortcuts.map((shortcut) => ({
          id: `shortcut:${getShortcutId(shortcut)}`,
          label: shortcut.description,
          icon: shortcut.icon,
          keys: displayKeys(shortcut),
          keywords: shortcut.tags.join(" "),
          run: () => emitter.emit(shortcut.event, shortcut.parameters),
        })),
      })
    )
  )

  // ==========================================================================
  // "Go to" — sidebar destinations from `defaultMenu`. Navigates the
  // current tab; the route ⇄ tab sync reuses or opens tabs as usual.
  // ==========================================================================

  const navigationGroup = computed<PaletteGroup>(() => ({
    id: "navigate",
    heading: t("components.global.commandK.groups.navigate"),
    highlight: true,
    commands: defaultMenu.map((item) => ({
      id: `navigate:${item.url}`,
      label: [item.title],
      icon: item.icon as Component,
      keys: sequenceToDisplayKeys(item.sequence),
      keywords: `go to open page ${item.action}`,
      run: () => {
        void router.push(item.url)
      },
    })),
  }))

  // ==========================================================================
  // "Create" — the sidebar Create-New intents, minus the ones the current
  // role / feature toggles disable (a palette hides what you can't do)
  // ==========================================================================

  const createGroup = computed<PaletteGroup>(() => ({
    id: "create",
    heading: t("actions.create"),
    highlight: true,
    commands: createActionGroups.value
      .flatMap((group) => group.actions)
      .filter((action) => !action.disabled)
      .map((action) => ({
        id: `create:${action.id}`,
        label: [t("actions.create"), action.label],
        icon: action.icon,
        keys: sequenceToDisplayKeys(action.sequence),
        keywords: "create new add",
        run: () => {
          void action.run()
        },
      })),
  }))

  // ==========================================================================
  // Tabs — strip actions plus live switch/reopen targets. Gated on an active
  // workspace: the `Tabs.*` listeners live in the tab strip, which only
  // mounts inside MainLayout.
  // ==========================================================================

  const { copy } = useCopy()

  const copyCurrentUrl = async () => {
    const url =
      typeof window === "undefined"
        ? route.fullPath
        : new URL(route.fullPath, window.location.origin).href
    try {
      await copy(url)
      toast.success(t("components.global.commandK.urlCopied"))
    } catch {
      // Clipboard unavailable — nothing actionable to surface.
    }
  }

  const tabsGroup = computed<PaletteGroup>(() => {
    const heading = t("components.global.commandK.groups.tabs")
    if (!currentWorkspace.value) {
      return { id: "tabs", heading, highlight: false, commands: [] }
    }

    const activeIsEditable = activeTab.value
      ? !isDefaultRoute(activeTab.value)
      : false
    const hasClosableOthers = tabs.value.some(
      (tab) => tab.id !== activeTabId.value && !tab.pinned
    )
    const hasClosable = tabs.value.some((tab) => !tab.pinned)

    const commands: PaletteCommand[] = [
      {
        id: "tabs:add",
        label: [t("tabs.newTab")],
        icon: IconPlus,
        keys: tabActionKeys("Tabs.Add"),
        keywords: "tab open create",
        run: () => emitter.emit("Tabs.Add"),
      },
    ]

    if (recentlyClosed.value.length > 0) {
      commands.push({
        id: "tabs:reopen-last",
        label: [t("tabs.reopenLast")],
        icon: IconHistory,
        keys: tabActionKeys("Tabs.ReopenLast"),
        keywords: "tab restore undo history",
        run: () => emitter.emit("Tabs.ReopenLast"),
      })
    }

    if (activeTab.value && !activeTab.value.pinned) {
      commands.push({
        id: "tabs:close",
        label: [t("components.global.commandK.closeTab")],
        icon: IconX,
        keys: tabActionKeys("Tabs.Close"),
        keywords: "tab remove",
        run: () => emitter.emit("Tabs.Close"),
      })
    }
    if (hasClosableOthers) {
      commands.push({
        id: "tabs:close-others",
        label: [t("tabs.closeOthers")],
        icon: IconSquareX,
        keys: tabActionKeys("Tabs.Close.Others"),
        keywords: "tab remove",
        run: () => emitter.emit("Tabs.Close.Others"),
      })
    }
    if (hasClosable) {
      commands.push({
        id: "tabs:close-all",
        label: [t("tabs.closeAll")],
        icon: IconCircleX,
        keys: tabActionKeys("Tabs.Close.All"),
        keywords: "tab remove clear",
        run: () => emitter.emit("Tabs.Close.All"),
      })
    }
    if (activeIsEditable) {
      commands.push(
        {
          id: "tabs:duplicate",
          label: [t("tabs.duplicate")],
          icon: IconCopy,
          keys: tabActionKeys("Tabs.Duplicate"),
          keywords: "tab copy clone",
          run: () => emitter.emit("Tabs.Duplicate"),
        },
        {
          id: "tabs:rename",
          label: [t("tabs.rename")],
          icon: IconSquarePen,
          keys: tabActionKeys("Tabs.Rename"),
          keywords: "tab edit name",
          run: () => emitter.emit("Tabs.Rename"),
        }
      )
    }

    commands.push({
      id: "tabs:copy-url",
      label: [t("actions.copyURL")],
      icon: IconCopy,
      keywords: "copy link share url address clipboard",
      run: () => {
        void copyCurrentUrl()
      },
    })

    for (const tab of tabs.value) {
      if (tab.id === activeTabId.value) continue
      commands.push({
        id: `tabs:select:${tab.id}`,
        label: [t("components.global.commandK.switchTab"), tab.name],
        icon: IconGalleryHorizontalEnd,
        keywords: "tab switch go jump",
        run: () => emitter.emit("Tabs.Select", tab.id),
      })
    }

    for (const tab of recentlyClosed.value) {
      commands.push({
        id: `tabs:reopen:${tab.id}:${tab.fullPath}`,
        label: [t("components.global.commandK.reopenTab"), tab.name],
        icon: IconHistory,
        keywords: "tab restore closed history",
        run: () => emitter.emit("Tabs.Reopen", tab),
      })
    }

    return { id: "tabs", heading, highlight: false, commands }
  })

  // ==========================================================================
  // Workspaces / Teams — live switch targets (the current one is omitted)
  // ==========================================================================

  const workspacesGroup = computed<PaletteGroup>(() => ({
    id: "workspaces",
    heading: t("components.global.commandK.groups.workspaces"),
    highlight: false,
    commands: workspaces.value
      .filter((workspace) => workspace.id !== currentWorkspace.value?.id)
      .map((workspace) => ({
        id: `workspace:${workspace.id}`,
        label: [
          t("components.global.commandK.switchWorkspace"),
          workspace.name,
        ],
        avatar: { src: workspace.photoURL, name: workspace.name },
        keywords: "workspace switch go open",
        run: () => {
          void switchWorkspace(workspace.id)
        },
      })),
  }))

  const teamsGroup = computed<PaletteGroup>(() => ({
    id: "teams",
    heading: t("components.global.commandK.groups.teams"),
    highlight: false,
    commands: memberships.value
      .filter((membership) => membership.team.id !== currentTeam.value?.id)
      .map((membership) => ({
        id: `team:${membership.team.id}`,
        label: [
          t("components.global.commandK.switchTeam"),
          membership.team.name,
        ],
        avatar: { src: membership.team.photoURL, name: membership.team.name },
        keywords: "team switch go open organization",
        run: () => {
          void switchTeam(membership.team.id)
        },
      })),
  }))

  // ==========================================================================
  // Settings — one command per panel, derived from the same catalog the
  // Settings dialog renders (`defaultSettingsTabs`), so new panels appear
  // here automatically. Team-tier sections are gated like the dialog gates
  // them (guests get a permission wall there, so don't offer the door).
  // `preferences` is skipped: the General category's "Settings" entry
  // (⌘,) already opens it.
  // ==========================================================================

  const settingsGroup = computed<PaletteGroup>(() => {
    const heading = t("components.global.commandK.groups.settings")
    const sections = defaultSettingsTabs.filter(
      (section) =>
        section.id === "general" ||
        section.id === "workspace" ||
        canViewTeamSettings.value
    )
    return {
      id: "settings",
      heading,
      highlight: false,
      commands: sections.flatMap((section) =>
        section.links
          .filter((link) => link.id !== "preferences")
          .map((link) => ({
            id: `settings:${link.id}`,
            label: [heading, t(link.name)],
            icon: link.icon as Component,
            keys: keysById(`Dialog.Settings.Open::${link.id}`),
            keywords: `settings ${t(link.description)}`,
            run: () => emitter.emit("Dialog.Settings.Open", link.id),
          }))
      ),
    }
  })

  // ==========================================================================
  // Assembly
  // ==========================================================================

  const groups = computed<PaletteGroup[]>(() => {
    const orderOf = (id: string) => {
      const index = GROUP_ORDER.indexOf(id)
      return index === -1 ? GROUP_ORDER.length : index
    }
    return [
      ...staticGroups.value,
      navigationGroup.value,
      createGroup.value,
      tabsGroup.value,
      workspacesGroup.value,
      teamsGroup.value,
      settingsGroup.value,
    ]
      .filter((group) => group.commands.length > 0)
      .sort((a, b) => orderOf(a.id) - orderOf(b.id))
  })

  return { groups }
}

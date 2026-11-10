<script lang="ts" setup>
import { hasUnsavedSettings } from "@/components/app/settings/SettingsUnsavedBar.vue"
import { SIDEBAR_WIDTH_ICON } from "@/components/ui/sidebar/utils"
import type { SplitterPanel } from "reka-ui"
import { useDismissGuard } from "@/composables/useDismissGuard"
import { defaultSettingsTab, defaultSettingsTabs } from "@/helpers/defaults"
import { emitter, listenForMainWindowIntents } from "@/modules/mitt"

const { t } = useI18n()

const settingsTabIds = defaultSettingsTabs.flatMap((section) =>
  section.links.map((link) => link.id)
)
const settingsTabSet = new Set<string>(settingsTabIds)
const resolvedDefaultTab = (() => {
  const normalizedDefaultTab = defaultSettingsTab.trim().toLowerCase()
  if (settingsTabSet.has(normalizedDefaultTab)) return normalizedDefaultTab
  return settingsTabIds[0] ?? "preferences"
})()

const normalizeSettingsTab = (raw?: string | null): string => {
  if (!raw) return resolvedDefaultTab

  const normalizedInput = raw.trim().toLowerCase()
  if (!normalizedInput) return resolvedDefaultTab
  return settingsTabSet.has(normalizedInput)
    ? normalizedInput
    : resolvedDefaultTab
}

// Dialog state
const openSettings = ref(false)
const activeTab = ref(normalizeSettingsTab(defaultSettingsTab))

const unlistenMainWindowIntents = listenForMainWindowIntents()
onBeforeUnmount(() => {
  void unlistenMainWindowIntents.then((unlisten) => unlisten())
})

// Staged edits live in the active tab and die when it unmounts, so both
// dismissing the dialog and switching tabs ask first.
const guard = useDismissGuard(openSettings, () => hasUnsavedSettings.value)

const selectTab = (tab: string | number) => {
  const next = normalizeSettingsTab(String(tab))
  if (next === activeTab.value) return
  guard.request(() => (activeTab.value = next))
}

const onOpenSettings = (event: unknown) => {
  openSettings.value = true
  selectTab(event as string)
}

// Pair to "Dialog.Settings.Open" — lets any settings sub-page close the
// dialog as it navigates away (e.g. SettingsSessions opening a chat).
const onCloseSettings = () => {
  openSettings.value = false
}

emitter.on("Dialog.Settings.Open", onOpenSettings)
emitter.on("Dialog.Settings.Close", onCloseSettings)
onBeforeUnmount(() => {
  emitter.off("Dialog.Settings.Open", onOpenSettings)
  emitter.off("Dialog.Settings.Close", onCloseSettings)
})

const activeTabConfig = computed(() => {
  for (const nav of defaultSettingsTabs) {
    const link = nav.links.find((link) => link.id === activeTab.value)
    if (link) return link
  }
  return null
})

const fallbackTabConfig = computed(() => {
  for (const nav of defaultSettingsTabs) {
    const link = nav.links.find((link) => link.id === "appearance")
    if (link) return link
  }
  for (const nav of defaultSettingsTabs) {
    if (nav.links[0]) return nav.links[0]
  }
  return null
})

const resolvedTabConfig = computed(
  () => activeTabConfig.value ?? fallbackTabConfig.value
)

// Sidebar collapses to an icon rail. Panel sizes are % of the panel group, but
// the rail is a fixed SIDEBAR_WIDTH_ICON (2rem button + p-2 group), so convert
// it against the group's width. The group fills DialogContent, which is
// `w-3/4` of the window — derived from the window (known on first render)
// rather than measured, so a remount restores a saved rail exactly instead of
// mis-reading it against an unmeasured fallback. Keep DIALOG_WIDTH_RATIO in
// step with DialogContent's width class.
const DIALOG_WIDTH_RATIO = 0.75
const sidebarPanel = ref<InstanceType<typeof SplitterPanel>>()
const sidebarCollapsed = computed(() => !!sidebarPanel.value?.isCollapsed)
const { width: windowWidth } = useWindowSize()

const railPercent = computed(() => {
  const rootFontSize =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const railPx = Number.parseFloat(SIDEBAR_WIDTH_ICON) * rootFontSize
  return (railPx / (windowWidth.value * DIALOG_WIDTH_RATIO)) * 100
})

// When the dialog resizes, reka snaps a collapsed panel whose collapsed-size
// moved to minSize (see MainLayout's syncPanelCollapsed); re-pin it to the rail.
watch(railPercent, (size) => {
  if (sidebarCollapsed.value)
    void nextTick(() => sidebarPanel.value?.resize(size))
})

const toggleSidebar = () =>
  sidebarCollapsed.value
    ? sidebarPanel.value?.expand()
    : sidebarPanel.value?.collapse()

// The dialog would focus its first tabbable (the resize handle); land on the
// active tab instead so arrow keys move between tabs straight away.
const focusActiveTab = (event: Event) => {
  const tab = (event.target as HTMLElement | null)?.querySelector<HTMLElement>(
    '[role="tab"][data-state="active"]'
  )
  if (!tab) return
  event.preventDefault()
  tab.focus()
}

// Centre each settings page (ScrollContainer > page root) like the app pages do.
const tabContentClass =
  "overflow-auto overscroll-none scroll-smooth h-full *:*:container *:*:mx-auto *:*:max-w-4xl"
</script>

<template>
  <Dialog :open="openSettings" @update:open="guard.onOpenChange">
    <DialogContent
      class="size-3/4 max-h-3/4! max-w-3/4! overflow-auto overscroll-none scroll-smooth p-0"
      @open-auto-focus="focusActiveTab"
    >
      <Tabs
        :model-value="activeTab"
        :default-value="activeTab"
        class="flex size-full flex-col overflow-auto overscroll-none scroll-smooth"
        orientation="vertical"
        @update:model-value="selectTab"
      >
        <!-- `open` mirrors the panel so SidebarMenuButton tooltips show on the
             rail; the panel's isCollapsed is the single source of truth. -->
        <SidebarProvider
          :open="!sidebarCollapsed"
          class="h-full min-h-auto overflow-auto overscroll-none scroll-smooth"
        >
          <!-- Sizes are % of the dialog; the save key changed when they moved
               off px so old px layouts aren't read back as percentages. -->
          <ResizablePanelGroup
            direction="horizontal"
            auto-save-id="settings-sidebar-layout"
          >
            <ResizablePanel
              ref="sidebarPanel"
              collapsible
              :min-size="15"
              :default-size="25"
              :max-size="35"
              :collapsed-size="railPercent"
            >
              <!-- ponytail: collapsible="none" + hand-set group/data-collapsible
                   instead of collapsible="icon", whose fixed container and
                   mobile Sheet don't fit inside a dialog. Every sidebar child
                   still restyles itself off group-data-[collapsible=icon]. -->
              <Sidebar
                collapsible="none"
                class="group size-full"
                :data-collapsible="sidebarCollapsed ? 'icon' : ''"
              >
                <TabsList class="contents">
                  <SidebarContent>
                    <!-- Classic (always-shown) scrollbars take ~6px of the 3rem
                         rail and push the icons off-centre; hide it there. -->
                    <ScrollContainer
                      class="group-data-[collapsible=icon]:no-scrollbar!"
                    >
                      <SidebarGroup
                        v-for="navigation in defaultSettingsTabs"
                        :key="navigation.id"
                      >
                        <SidebarGroupLabel>
                          {{ t(navigation.title) }}
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                          <SidebarMenu>
                            <SidebarMenuItem
                              v-for="item in navigation.links"
                              :key="item.id"
                            >
                              <TabsTrigger
                                :value="item.id"
                                as-child
                                class="data-[state=active]:bg-sidebar-accent text-secondary-foreground data-[state=active]:text-sidebar-accent-foreground data-[state=active]:shadow-none!"
                              >
                                <SidebarMenuButton
                                  :is-active="item.id === activeTab"
                                  :tooltip="t(item.name)"
                                  class="justify-start"
                                >
                                  <Component :is="item.icon" />
                                  <span>{{ t(item.name) }}</span>
                                </SidebarMenuButton>
                              </TabsTrigger>
                            </SidebarMenuItem>
                          </SidebarMenu>
                        </SidebarGroupContent>
                      </SidebarGroup>
                    </ScrollContainer>
                  </SidebarContent>
                </TabsList>
              </Sidebar>
            </ResizablePanel>
            <LayoutResizeHandle class="bg-border" @dblclick="toggleSidebar" />
            <ResizablePanel class="@container flex min-w-0 flex-col">
              <DialogHeader class="container mx-auto p-6">
                <DialogTitle>{{
                  t(resolvedTabConfig?.name ?? "")
                }}</DialogTitle>
                <DialogDescription>
                  {{ t(resolvedTabConfig?.description ?? "") }}
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <TabsContent :class="tabContentClass" value="preferences">
                <ScrollContainer>
                  <SettingsPreferences />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="account">
                <ScrollContainer>
                  <SettingsAccount />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="privacy">
                <ScrollContainer>
                  <SettingsPrivacy />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="appearance">
                <ScrollContainer>
                  <SettingsAppearance />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="models">
                <ScrollContainer>
                  <SettingsAi />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="tools">
                <ScrollContainer>
                  <SettingsTools />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="agents">
                <ScrollContainer>
                  <SettingsAgents />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="workflows">
                <ScrollContainer>
                  <SettingsWorkflows />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="integrations">
                <ScrollContainer>
                  <SettingsIntegrations />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="runs">
                <ScrollContainer>
                  <SettingsRuns />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="sessions">
                <ScrollContainer>
                  <SettingsSessions />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="memory">
                <ScrollContainer>
                  <SettingsMemory />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="storage">
                <ScrollContainer>
                  <SettingsStorage />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="data">
                <ScrollContainer>
                  <SettingsData />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="notifications">
                <ScrollContainer>
                  <SettingsNotifications />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="members">
                <ScrollContainer>
                  <SettingsMembers />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="groups">
                <ScrollContainer>
                  <SettingsGroups />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="connections">
                <ScrollContainer>
                  <SettingsConnections />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="overview">
                <ScrollContainer>
                  <SettingsOverview />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="teams">
                <ScrollContainer>
                  <SettingsTeams />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="workspaces">
                <ScrollContainer>
                  <SettingsWorkspaces />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="billing">
                <ScrollContainer>
                  <SettingsBilling />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="usage">
                <ScrollContainer>
                  <SettingsUsage />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="plans">
                <ScrollContainer>
                  <SettingsPlans />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="security">
                <ScrollContainer>
                  <SettingsSecurity />
                </ScrollContainer>
              </TabsContent>
              <TabsContent :class="tabContentClass" value="logs">
                <ScrollContainer>
                  <SettingsLogs />
                </ScrollContainer>
              </TabsContent>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarProvider>
      </Tabs>
    </DialogContent>
  </Dialog>

  <ConfirmAction
    v-model:open="guard.confirmOpen.value"
    :title="t('common.discardChangesTitle')"
    :description="t('common.discardChangesDescription')"
    :action-label="t('common.discard')"
    :cancel-label="t('common.keepEditing')"
    destructive
    :on-confirm="guard.discard"
  />
</template>

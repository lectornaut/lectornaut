<script lang="ts" setup>
import { defaultSettingsTab, defaultSettingsTabs } from "@/helpers/defaults"
import { emitter } from "@/modules/mitt"

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

emitter.on("Dialog.Settings.Open", (event) => {
  activeTab.value = normalizeSettingsTab(event as string)
  openSettings.value = true
})

// Pair to "Dialog.Settings.Open" — lets any settings sub-page close the
// dialog as it navigates away (e.g. SettingsSessions opening a chat).
emitter.on("Dialog.Settings.Close", () => {
  openSettings.value = false
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

const tabContentClass = "overflow-auto overscroll-none scroll-smooth h-full"
</script>

<template>
  <Dialog v-model:open="openSettings">
    <DialogContent
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! overflow-auto overscroll-none scroll-smooth p-0"
    >
      <Tabs
        v-model="activeTab"
        :default-value="activeTab"
        class="flex size-full flex-col overflow-auto overscroll-none scroll-smooth"
        orientation="vertical"
      >
        <SidebarProvider
          :default-open="true"
          class="h-full min-h-auto overflow-auto overscroll-none scroll-smooth"
        >
          <Sidebar collapsible="none">
            <TabsList class="contents">
              <SidebarContent>
                <OverlayScrollbarsWrapper>
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
                </OverlayScrollbarsWrapper>
              </SidebarContent>
            </TabsList>
          </Sidebar>
          <Separator orientation="vertical" />
          <div class="container mx-auto flex grow flex-col">
            <DialogHeader class="m-6">
              <DialogTitle>{{ t(resolvedTabConfig?.name ?? "") }}</DialogTitle>
              <DialogDescription>
                {{ t(resolvedTabConfig?.description ?? "") }}
              </DialogDescription>
            </DialogHeader>
            <Separator />
            <TabsContent :class="tabContentClass" value="preferences">
              <OverlayScrollbarsWrapper>
                <SettingsPreferences />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="account">
              <OverlayScrollbarsWrapper>
                <SettingsAccount />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="privacy">
              <OverlayScrollbarsWrapper>
                <SettingsPrivacy />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="appearance">
              <OverlayScrollbarsWrapper>
                <SettingsAppearance />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="models">
              <OverlayScrollbarsWrapper>
                <SettingsAi />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="tools">
              <OverlayScrollbarsWrapper>
                <SettingsTools />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="agents">
              <OverlayScrollbarsWrapper>
                <SettingsAgents />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="workflows">
              <OverlayScrollbarsWrapper>
                <SettingsWorkflows />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="integrations">
              <OverlayScrollbarsWrapper>
                <SettingsIntegrations />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="runs">
              <OverlayScrollbarsWrapper>
                <SettingsRuns />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="sessions">
              <OverlayScrollbarsWrapper>
                <SettingsSessions />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="storage">
              <OverlayScrollbarsWrapper>
                <SettingsStorage />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="data">
              <OverlayScrollbarsWrapper>
                <SettingsData />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="notifications">
              <OverlayScrollbarsWrapper>
                <SettingsNotifications />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="members">
              <OverlayScrollbarsWrapper>
                <SettingsMembers />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="overview">
              <OverlayScrollbarsWrapper>
                <SettingsOverview />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="teams">
              <OverlayScrollbarsWrapper>
                <SettingsTeams />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="workspaces">
              <OverlayScrollbarsWrapper>
                <SettingsWorkspaces />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="billing">
              <OverlayScrollbarsWrapper>
                <SettingsBilling />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="plans">
              <OverlayScrollbarsWrapper>
                <SettingsPlans />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="security">
              <OverlayScrollbarsWrapper>
                <SettingsSecurity />
              </OverlayScrollbarsWrapper>
            </TabsContent>
            <TabsContent :class="tabContentClass" value="logs">
              <OverlayScrollbarsWrapper>
                <SettingsLogs />
              </OverlayScrollbarsWrapper>
            </TabsContent>
          </div>
        </SidebarProvider>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>

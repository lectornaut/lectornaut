<script lang="ts" setup>
import { defaultSettingsTabs } from "@/helpers/defaults"
import { normalizeSettingsTab } from "@/helpers/settingsTabs"

type SettingsContentMode = "dialog" | "page"

const props = withDefaults(
  defineProps<{
    mode?: SettingsContentMode
  }>(),
  {
    mode: "dialog",
  }
)

const activeTabModel = defineModel<string>("activeTab")

const setActiveTab = (value: string): void => {
  activeTabModel.value = normalizeSettingsTab(value)
}

const activeTab = computed({
  get: () => normalizeSettingsTab(activeTabModel.value),
  set: (value: string) => setActiveTab(value),
})

watch(
  () => activeTabModel.value,
  (value) => {
    const normalizedTab = normalizeSettingsTab(value)
    if (value !== normalizedTab) {
      activeTabModel.value = normalizedTab
    }
  },
  { immediate: true }
)

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

const { t } = useI18n()

const tabContentClass = "overflow-auto overscroll-none scroll-smooth h-full"
</script>

<template>
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
                        class="data-[state=active]:bg-sidebar-accent text-secondary-foreground data-[state=active]:text-sidebar-accent-foreground data-[state=active]:shadow-none"
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

      <div class="flex grow flex-col">
        <DialogHeader v-if="props.mode === 'dialog'" class="m-6">
          <DialogTitle>{{ t(resolvedTabConfig?.name ?? "") }}</DialogTitle>
          <DialogDescription>
            {{ t(resolvedTabConfig?.description ?? "") }}
          </DialogDescription>
        </DialogHeader>
        <header v-else class="m-6 space-y-1">
          <h1 class="text-lg leading-none font-semibold">
            {{ t(resolvedTabConfig?.name ?? "") }}
          </h1>
          <p class="text-muted-foreground text-sm">
            {{ t(resolvedTabConfig?.description ?? "") }}
          </p>
        </header>

        <Separator />

        <TabsContent :class="tabContentClass" value="preferences">
          Sample content for preferences tab.
        </TabsContent>

        <TabsContent :class="tabContentClass" value="account">
          <SettingsAccount />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="appearance">
          <SettingsAppearance />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="notifications">
          <SettingsNotifications />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="members">
          <SettingsMembers />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="overview">
          <SettingsOverview />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="teams">
          <SettingsTeams />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="workspaces">
          <SettingsWorkspaces />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="billing">
          <SettingsBilling />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="plans">
          <SettingsPlans />
        </TabsContent>

        <TabsContent :class="tabContentClass" value="logs">
          <SettingsLogs />
        </TabsContent>
      </div>
    </SidebarProvider>
  </Tabs>
</template>

<script lang="ts" setup>
import { defaultSettingsTab, defaultSettingsTabs } from "@/helpers/defaults"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

// Dialog state
const openSettings = ref(false)
const activeTab = ref(defaultSettingsTab)

emitter.on("Dialog.Settings.Open", (event) => {
  activeTab.value = event as string
  openSettings.value = !openSettings.value
})

// Active Tab Header (computed once, used in template)
const activeTabConfig = computed(() => {
  for (const nav of defaultSettingsTabs) {
    const link = nav.links.find((link) => link.id === activeTab.value)
    if (link) return link
  }
  return null
})

// Tab Content Class (DRY)
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
          <!-- Sidebar Navigation -->
          <Sidebar collapsible="none">
            <TabsList class="contents">
              <SidebarContent>
                <OverlayScrollbarsWrapper>
                  <SidebarGroup
                    v-for="navigation in defaultSettingsTabs"
                    :key="navigation.id"
                  >
                    <SidebarGroupLabel>{{
                      t(navigation.title)
                    }}</SidebarGroupLabel>
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

          <!-- Main Content Area -->
          <div class="grid grow">
            <!-- Header -->
            <DialogHeader class="m-6">
              <DialogTitle>{{ t(activeTabConfig?.name!) }}</DialogTitle>
              <DialogDescription>{{
                t(activeTabConfig?.description!)
              }}</DialogDescription>
            </DialogHeader>

            <Separator />

            <!-- Tab Contents (Fully Self-Contained) -->
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
    </DialogContent>
  </Dialog>
</template>

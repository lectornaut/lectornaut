<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconChevronRight, IconGift, IconPin } from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { storeToRefs } from "pinia"

const { open, setOpen, isMobile, setOpenMobile } = useSidebar()
const authStore = useAuthStore()
const layoutStore = useLayoutStore()
const { onboarding } = storeToRefs(authStore)
const { sidebarPinned } = storeToRefs(layoutStore)

const iconDisplay = computed({
  get: () => (open.value ? "text" : "icon"),
  set: (val) => setOpen(val === "text"),
})

const isFullscreen = useIsFullscreen()

function closeSidebarOnMobile() {
  if (isMobile.value) setOpenMobile(false)
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        :collapsible="sidebarPinned ? 'icon' : 'offcanvas'"
        :variant="sidebarPinned ? 'floating' : 'inset'"
        class="shadow-muted-foreground/5 inset-y-13 h-[calc(100vh-var(--spacing-13)-var(--spacing-13))] p-0 **:data-[slot='sidebar-inner']:rounded-l-none"
      >
        <SidebarHeader
          data-tauri-drag-region
          :class="{ 'mt-13': isTauri && isMobile && !isFullscreen }"
        >
          <TeamSwitcher />
        </SidebarHeader>
        <SidebarContent @click.capture="closeSidebarOnMobile">
          <OverlayScrollbarsWrapper data-tauri-drag-region>
            <Navigation />
          </OverlayScrollbarsWrapper>
        </SidebarContent>
        <SidebarFooter v-if="onboarding">
          <SidebarMenu id="tour-onboarding">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Complete your onboarding"
                class="bg-primary text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground active:bg-destructive active:text-destructive-foreground"
                as-child
              >
                <RouterLink to="/welcome">
                  <IconGift />
                  <span class="truncate"> Complete onboarding </span>
                  <SidebarMenuBadge>
                    <IconChevronRight />
                  </SidebarMenuBadge>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarFooter data-tauri-drag-region>
          <Agents />
          <Separator />
          <Support />
          <SettingsMenu />
          <CreateMenu />
          <AccountMenu />
        </SidebarFooter>
        <!-- <SidebarRail /> -->
      </Sidebar>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuLabel> Appearance </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="iconDisplay">
        <ContextMenuRadioItem value="icon"> Icons only </ContextMenuRadioItem>
        <ContextMenuRadioItem value="text">
          Icons and text
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem v-model="sidebarPinned">
        <IconPin />
        Pin sidebar
      </ContextMenuCheckboxItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
